import "./_testEnv";
import { test, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { withFinalCheck } from "../src/agent/whatsapp/finalCheck";
import { createWhatsappTurn } from "../src/agent/whatsapp/resolver";
import { resolveSender, type MappingRow, type SenderStore, type WaUserContext } from "../src/agent/whatsapp/policy";
import { isWriteTool } from "../src/agent/tools/registry";
import type { RunAgentTurnParams, RunAgentTurnResult } from "../src/agent/llm";
import { createWhatsappBridgeRouter } from "../src/routes/whatsappBridge";
import { sha256Hex, signBridgeRequest, type NonceStore } from "../src/services/whatsappBridgeAuth";
import {
  createBridgeService, MAX_ATTEMPTS, NEUTRAL_FAILURE_REPLY, WHATSAPP_PROMPT_ADDENDUM,
  type InboundRow, type NewOutbox, type OpenTurn, type OutboxRow, type WaBridgeStore,
} from "../src/services/whatsappBridge";

const SECRET = "bridge-secret-0123456789";
let nowMs = 1_800_000_000_000;
const clock = () => new Date(nowMs);

// ---- in-memory store (executes each conditional step atomically, like the Prisma updateMany calls) ----
function fakeStore() {
  const inbound: InboundRow[] = [];
  const outbox: OutboxRow[] = [];
  const conversations = new Map<string, { id: string; messages: unknown }>();
  let n = 0;
  const store: WaBridgeStore = {
    async insertInbound(row) {
      const dup = inbound.find((r) => r.waMessageId === row.waMessageId);
      if (dup) return { row: dup, created: false };
      const r: InboundRow = { ...row, id: `in${++n}`, attempts: 0, leaseUntil: null, leaseToken: null, createdAt: clock() };
      inbound.push(r);
      return { row: r, created: true };
    },
    async claimJob(id, token, now, leaseMs, max) {
      const j = inbound.find((r) => r.id === id);
      if (!j || !j.mappingId || j.attempts >= max) return null;
      if (inbound.some((e) => e.id !== id && e.mappingId === j.mappingId && e.createdAt < j.createdAt && (e.status === "received" || e.status === "processing"))) return null;
      const ok = j.status === "received" || (j.status === "processing" && !!j.leaseUntil && j.leaseUntil < now);
      if (!ok) return null;
      Object.assign(j, { status: "processing", leaseToken: token, leaseUntil: new Date(now.getTime() + leaseMs), attempts: j.attempts + 1 });
      return { ...j };
    },
    async completeJob(id, token, patch, ob, conv) {
      const j = inbound.find((r) => r.id === id);
      if (!j || j.leaseToken !== token || j.status !== "processing") return false;
      Object.assign(j, { status: patch.status, text: null, leaseToken: null, leaseUntil: null });
      if (ob && !outbox.some((o) => o.inboundId === ob.inboundId)) outbox.push({ ...ob, id: `out${++n}`, status: "pending", leasedKeyId: null, leaseUntil: null, sendBy: null });
      if (conv) conversations.set(conv.id, { id: conv.id, messages: conv.messages });
      return true;
    },
    async releaseJob(id, token) {
      const j = inbound.find((r) => r.id === id);
      if (j && j.leaseToken === token && j.status === "processing") Object.assign(j, { status: "received", leaseToken: null, leaseUntil: null });
    },
    async listStaleJobs(now, restartAfterMs, limit) {
      return inbound
        .filter((j) => (j.status === "processing" && !!j.leaseUntil && j.leaseUntil < now) || (j.status === "received" && j.decision === "accept" && j.createdAt.getTime() < now.getTime() - restartAfterMs))
        .slice(0, limit);
    },
    async failStaleJob(id) {
      const j = inbound.find((r) => r.id === id);
      if (!j || (j.status !== "processing" && j.status !== "received")) return false;
      Object.assign(j, { status: "failed", text: null });
      return true;
    },
    async getConversation(userId) {
      const key = `conv-${userId}`;
      if (!conversations.has(key)) conversations.set(key, { id: key, messages: [] });
      return conversations.get(key)!;
    },
    async insertOutboxIfAbsent(row: NewOutbox) {
      if (!outbox.some((o) => o.inboundId === row.inboundId)) outbox.push({ ...row, id: `out${++n}`, status: "pending", leasedKeyId: null, leaseUntil: null, sendBy: null });
    },
    async getOutbox(id) {
      const o = outbox.find((r) => r.id === id);
      return o ? { ...o } : null;
    },
    async updateOutboxIf(id, guard, patch) {
      const o = outbox.find((r) => r.id === id);
      if (!o || !guard.statusIn.includes(o.status)) return false;
      if (guard.leasedKeyId && o.leasedKeyId !== guard.leasedKeyId) return false;
      if (guard.leaseUntilAfter && !(o.leaseUntil && o.leaseUntil > guard.leaseUntilAfter)) return false;
      Object.assign(o, patch);
      return true;
    },
    async expireOutbox(now) {
      for (const o of outbox) {
        if ((o.status === "pending" || o.status === "leased") && o.expiresAt < now) Object.assign(o, { status: "expired", text: null });
        if (o.status === "sending" && o.sendBy && o.sendBy < now) Object.assign(o, { status: "uncertain", text: null });
      }
    },
    async leaseOutbox(keyId, now, leaseMs, limit) {
      const out: OutboxRow[] = [];
      for (const o of outbox) {
        if (out.length >= limit) break;
        if (o.expiresAt > now && (o.status === "pending" || (o.status === "leased" && !!o.leaseUntil && o.leaseUntil < now))) {
          Object.assign(o, { status: "leased", leasedKeyId: keyId, leaseUntil: new Date(now.getTime() + leaseMs) });
          out.push({ ...o });
        }
      }
      return out;
    },
  };
  return { store, inbound, outbox, conversations };
}

// ---- world state ----
let mapping: MappingRow;
let user: WaUserContext;
let fs_: ReturnType<typeof fakeStore>;
let bg: Promise<unknown>[];
let seenNonces: Set<string>;
let runs: RunAgentTurnParams[];
let turnBehaviour: (p: RunAgentTurnParams) => Promise<RunAgentTurnResult>;
let server: Server;
let base = "";

const senders: SenderStore = {
  findByPhone: async (p) => (mapping.phoneE164 === p ? [mapping] : []),
  findByLid: async (l) => (mapping.lid === l ? [mapping] : []),
  findById: async (id) => (mapping.id === id ? mapping : null),
  loadUser: async () => user,
};
const openTurn: OpenTurn = async (identity) => {
  const decision = await resolveSender(identity, senders);
  if (!decision.ok) return { ok: false, reason: decision.reason };
  return { ok: true, decision, turn: createWhatsappTurn(decision, { store: senders, tools: [], isWriteTool, siteLookup: async () => null }) };
};

const nonces: NonceStore = { claim: async (k, n) => (seenNonces.has(`${k}|${n}`) ? false : (seenNonces.add(`${k}|${n}`), true)) };
const baseUser = (over: Partial<WaUserContext> = {}): WaUserContext =>
  ({ userId: "u1", roleKey: "sales", isActive: true, customerId: null, vendorId: null, vendorBlocked: false, permissions: new Set(), ...over });

before(async () => {
  const service = createBridgeService({
    store: new Proxy({}, { get: (_t, k) => (fs_.store as unknown as Record<string | symbol, unknown>)[k] }) as WaBridgeStore,
    senders,
    openTurn,
    // Same wrapper as the real runAgentTurn: finalCheck is applied around the (fake provider) loop.
    runTurn: (p) => { runs.push(p); return withFinalCheck(() => turnBehaviour(p), p.finalCheck); },
    buildSystemPrompt: async () => "BASE" + WHATSAPP_PROMPT_ADDENDUM,
    sanitizeReply: (t) => t,
    sanitizeHistory: (m) => (Array.isArray(m) ? (m as never) : []),
    newDeadline: () => undefined,
    now: clock,
    newToken: () => crypto.randomUUID(),
  });
  const app = express();
  app.use("/wa", createWhatsappBridgeRouter({
    nonces, service, background: (p) => { bg.push(p); }, now: () => nowMs, keys: () => new Map([["k1", SECRET], ["k2", "other-secret-0123456789"]]),
  }));
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); });

beforeEach(() => {
  nowMs = 1_800_000_000_000;
  mapping = { id: "m1", userId: "u1", phoneE164: "+919876543210", lid: null, enabled: true, aiPaused: false };
  user = baseUser();
  fs_ = fakeStore();
  bg = [];
  seenNonces = new Set();
  runs = [];
  turnBehaviour = async (p) => ({ reply: "Order ZE-1 is at stage 5.", history: [...p.history, { role: "assistant", content: "Order ZE-1 is at stage 5." }] });
});

function call(method: "GET" | "POST", path: string, body?: unknown, over: Record<string, string> = {}, keyId = "k1") {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(Math.floor(nowMs / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const sha = sha256Hex(raw);
  return fetch(base + path, {
    method,
    body: method === "GET" ? undefined : raw,
    headers: {
      "content-type": "application/json", "x-zan-key-id": keyId, "x-zan-timestamp": ts, "x-zan-nonce": nonce, "x-zan-body-sha256": sha,
      "x-zan-signature": signBridgeRequest(keyId === "k1" ? SECRET : "other-secret-0123456789", method, path, ts, nonce, sha), ...over,
    },
  });
}
const msg = (id: string, over: Record<string, unknown> = {}) => ({
  messageId: id, senderJid: "919876543210@s.whatsapp.net", chatJid: "919876543210@s.whatsapp.net", timestamp: Math.floor(nowMs / 1000), text: "status of ZE-1?", ...over,
});
const settle = async () => { await Promise.all(bg); bg = []; };

test("end to end: signed ingest -> turn -> outbox -> poll (no text) -> claim (text + sendBy) -> ack", async () => {
  const res = await call("POST", "/wa/ingest", msg("m-1"), { "idempotency-key": "m-1" });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { decision: "accept" });
  await settle();

  assert.equal(runs.length, 1);
  assert.equal(typeof runs[0].finalCheck, "function", "route must pass finalCheck: turn.recheck");
  assert.ok(runs[0].systemPrompt.includes("1-3 short sentences"));
  assert.equal(runs[0].auth.waGroup, "sales");
  assert.equal(runs[0].history.at(-1)?.content, "status of ZE-1?");
  assert.equal(fs_.conversations.get("conv-u1")?.id, "conv-u1");

  const poll = await (await call("GET", "/wa/outbox?limit=5")).json();
  assert.equal(poll.items.length, 1);
  assert.deepEqual(poll.items[0].recipient, { jid: "919876543210@s.whatsapp.net" });
  assert.equal(JSON.stringify(poll).includes("Order ZE-1"), false, "poll never carries text");
  const id = poll.items[0].outboxId;

  const claim = await call("POST", `/wa/outbox/${id}/claim`, {}, { "idempotency-key": `claim:${id}` });
  assert.equal(claim.status, 200);
  const c = await claim.json();
  assert.equal(c.text, "Order ZE-1 is at stage 5.");
  assert.equal(c.sendBy, Math.floor(nowMs / 1000) + 15);
  assert.equal((await call("POST", `/wa/outbox/${id}/claim`, {})).status, 409, "text is never released twice");

  const ack = (status: string) => call("POST", "/wa/ack", { outboxId: id, status, at: Math.floor(nowMs / 1000) });
  assert.equal((await ack("sent")).status, 200);
  assert.equal(fs_.outbox[0].status, "sent");
  assert.equal(fs_.outbox[0].text, null);
  assert.equal((await ack("sent")).status, 200);
  assert.equal((await ack("delivered")).status, 200);
  assert.equal(fs_.outbox[0].status, "delivered");
  assert.equal((await ack("sent")).status, 200);
  assert.equal(fs_.outbox[0].status, "delivered", "never backwards");
});

test("unknown / disabled / paused / customer senders get the same 202 shape as a mapped one, with no job or reply", async () => {
  mapping.phoneE164 = "+910000000000";
  const unknown = await call("POST", "/wa/ingest", msg("m-u"));
  assert.equal(unknown.status, 202);
  assert.deepEqual(await unknown.json(), { decision: "ignore" });
  mapping.phoneE164 = "+919876543210";
  mapping.enabled = false;
  assert.deepEqual(await (await call("POST", "/wa/ingest", msg("m-d"))).json(), { decision: "ignore" });
  mapping.enabled = true; mapping.aiPaused = true;
  assert.deepEqual(await (await call("POST", "/wa/ingest", msg("m-p"))).json(), { decision: "ignore" });
  mapping.aiPaused = false; user = baseUser({ customerId: "c1", roleKey: "customer" });
  assert.deepEqual(await (await call("POST", "/wa/ingest", msg("m-c"))).json(), { decision: "ignore" });
  await settle();
  assert.equal(runs.length, 0);
  assert.equal(fs_.outbox.length, 0);
  assert.ok(fs_.inbound.every((r) => r.text === null), "ignored messages keep no text");
});

test("duplicate message id: original decision, one job, no second reply", async () => {
  assert.deepEqual(await (await call("POST", "/wa/ingest", msg("dup"))).json(), { decision: "accept" });
  await settle();
  mapping.enabled = false; // even if the sender is revoked later, a duplicate returns the ORIGINAL decision
  const again = await call("POST", "/wa/ingest", msg("dup"));
  assert.equal(again.status, 202);
  assert.deepEqual(await again.json(), { decision: "accept" });
  await settle();
  assert.equal(runs.length, 1);
  assert.equal(fs_.outbox.length, 1);
  assert.equal(fs_.inbound.length, 1);
});

test("bad signature, stale timestamp, reused nonce, body-hash mismatch -> 401 and nothing stored", async () => {
  assert.equal((await call("POST", "/wa/ingest", msg("a"), { "x-zan-signature": "0".repeat(64) })).status, 401);
  assert.equal((await call("POST", "/wa/ingest", msg("b"), { "x-zan-timestamp": String(Math.floor(nowMs / 1000) - 400) })).status, 401);
  assert.equal((await call("POST", "/wa/ingest", msg("c"), { "x-zan-body-sha256": sha256Hex("{}") })).status, 401);
  assert.equal((await call("POST", "/wa/ingest", msg("d"), {}, "k9")).status, 401);
  const nonce = "a".repeat(32);
  const sha = sha256Hex(JSON.stringify(msg("e")));
  const ts = String(Math.floor(nowMs / 1000));
  const replay = { "x-zan-nonce": nonce, "x-zan-signature": signBridgeRequest(SECRET, "POST", "/wa/ingest", ts, nonce, sha) };
  assert.equal((await call("POST", "/wa/ingest", msg("e"), replay)).status, 202);
  assert.equal((await call("POST", "/wa/ingest", msg("e"), replay)).status, 401);
  await settle();
  assert.deepEqual(fs_.inbound.map((r) => r.waMessageId), ["e"]);
});

test("malformed ingest bodies are 400", async () => {
  assert.equal((await call("POST", "/wa/ingest", { messageId: "x" })).status, 400);
  assert.equal((await call("POST", "/wa/ingest", msg("y", { extra: 1 }))).status, 400);
  assert.equal((await call("POST", "/wa/ingest", msg("z"), { "idempotency-key": "other" })).status, 400);
});

test("revoked mid-turn (mapping disabled while the model runs): silent, no outbox row", async () => {
  turnBehaviour = async (p) => { mapping = { ...mapping, enabled: false }; return { reply: "secret answer", history: p.history }; };
  assert.equal((await call("POST", "/wa/ingest", msg("r1"))).status, 202);
  await settle();
  assert.equal(runs.length, 1);
  assert.equal(fs_.outbox.length, 0);
  assert.equal(fs_.inbound[0].status, "done");
  assert.deepEqual(fs_.conversations.get("conv-u1")?.messages, [], "a revoked turn is not saved to the thread");
  assert.deepEqual((await (await call("GET", "/wa/outbox")).json()).items, []);
});

test("role downgrade mid-turn is silent too", async () => {
  turnBehaviour = async (p) => { user = baseUser({ roleKey: "finance" }); return { reply: "x", history: p.history }; };
  await call("POST", "/wa/ingest", msg("r2"));
  await settle();
  assert.equal(fs_.outbox.length, 0);
});

test("revoked between poll and claim -> 410, no text released, row discarded", async () => {
  await call("POST", "/wa/ingest", msg("c1"));
  await settle();
  const id = (await (await call("GET", "/wa/outbox")).json()).items[0].outboxId;
  mapping.enabled = false;
  const claim = await call("POST", `/wa/outbox/${id}/claim`, {});
  assert.equal(claim.status, 410);
  assert.equal(JSON.stringify(await claim.json()).includes("Order"), false);
  assert.equal(fs_.outbox[0].status, "discarded");
  assert.equal(fs_.outbox[0].text, null);
});

test("revoked before poll: the row is discarded and never offered; recipient change at claim is refused", async () => {
  await call("POST", "/wa/ingest", msg("p1"));
  await settle();
  user = baseUser({ isActive: false });
  assert.deepEqual((await (await call("GET", "/wa/outbox")).json()).items, []);
  assert.equal(fs_.outbox[0].status, "discarded");

  user = baseUser();
  await call("POST", "/wa/ingest", msg("p2", { timestamp: Math.floor(nowMs / 1000) + 1 }));
  await settle();
  const fresh = fs_.outbox.find((o) => o.status === "pending")!;
  const id = (await (await call("GET", "/wa/outbox")).json()).items[0].outboxId;
  assert.equal(id, fresh.id);
  mapping.phoneE164 = "+911111111111"; // number re-assigned after queueing
  assert.equal((await call("POST", `/wa/outbox/${id}/claim`, {})).status, 410);
});

test("claim ownership and lease: other key id, expired lease, expired row; sending past sendBy becomes uncertain", async () => {
  await call("POST", "/wa/ingest", msg("o1"));
  await settle();
  const id = (await (await call("GET", "/wa/outbox")).json()).items[0].outboxId;
  assert.equal((await call("POST", `/wa/outbox/${id}/claim`, {}, {}, "k2")).status, 404, "another key cannot claim");
  nowMs += 31_000; // lease (30 s) expired
  assert.equal((await call("POST", `/wa/outbox/${id}/claim`, {})).status, 409);
  const again = await (await call("GET", "/wa/outbox")).json(); // re-leased by the next poll
  assert.equal(again.items[0].outboxId, id);
  assert.equal((await call("POST", `/wa/outbox/${id}/claim`, {})).status, 200);
  nowMs += 20_000; // bridge never acked
  await call("GET", "/wa/outbox");
  assert.equal(fs_.outbox[0].status, "uncertain");
  assert.equal(fs_.outbox[0].text, null);
  assert.equal((await call("POST", `/wa/outbox/${id}/claim`, {})).status, 409, "never resent");

  await call("POST", "/wa/ingest", msg("o2", { timestamp: Math.floor(nowMs / 1000) }));
  await settle();
  nowMs += 11 * 60_000;
  await call("GET", "/wa/outbox");
  assert.equal(fs_.outbox[1].status, "expired");
});

test("ack for an unknown or foreign outbox id is 404 (final)", async () => {
  assert.equal((await call("POST", "/wa/ack", { outboxId: "nope", status: "sent", at: 1 })).status, 404);
});

test("turn errors retry via the poll backstop; after the last attempt one neutral reply is queued", async () => {
  turnBehaviour = async () => { throw new Error("provider down"); };
  const quiet = console.error; console.error = () => undefined;
  try {
    await call("POST", "/wa/ingest", msg("f1"));
    await settle();
    assert.equal(fs_.inbound[0].status, "received");
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      nowMs += 25_000;
      await call("GET", "/wa/outbox");
      await settle();
    }
  } finally { console.error = quiet; }
  assert.equal(runs.length, MAX_ATTEMPTS);
  assert.equal(fs_.inbound[0].status, "failed");
  assert.equal(fs_.outbox.length, 1);
  assert.equal(fs_.outbox[0].text, NEUTRAL_FAILURE_REPLY);
});

test("a zombie worker (lease reclaimed) cannot complete the job or queue a reply", async () => {
  await fs_.store.insertInbound({ waMessageId: "z1", keyId: "k1", senderJid: "919876543210@s.whatsapp.net", senderLid: null, resolvedPhone: null, chatJid: "c", messageAt: clock(), decision: "accept", mappingId: "m1", text: "hi", status: "received" });
  const j = fs_.inbound[0];
  const first = await fs_.store.claimJob(j.id, "tok-1", clock(), 90_000, 3);
  assert.ok(first);
  nowMs += 100_000;
  const second = await fs_.store.claimJob(j.id, "tok-2", clock(), 90_000, 3);
  assert.ok(second);
  assert.equal(await fs_.store.completeJob(j.id, "tok-1", { status: "done" }, { inboundId: j.id, mappingId: "m1", waGroup: "sales", recipientPhone: "+919876543210", recipientLid: null, text: "late", expiresAt: new Date(nowMs + 1000) }, null), false);
  assert.equal(fs_.outbox.length, 0);
  await settle();
});

test("bridge key grants nothing outside /wa/*: other paths are not served by this router", async () => {
  assert.equal((await call("GET", "/wa/orders")).status, 404);
});
