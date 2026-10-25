import "./_testEnv";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { allowlistHash, buildAllowlist, ALLOWLIST_TTL_SECONDS, type AllowlistCandidate, type AllowlistResponse } from "../src/services/whatsappAllowlist";
import { createWhatsappBridgeRouter } from "../src/routes/whatsappBridge";
import { parseBridgeKeys, sha256Hex, signBridgeRequest, type NonceStore } from "../src/services/whatsappBridgeAuth";
import { normalizePhoneE164 } from "../src/services/whatsappPhone";
import { identityFromIngest } from "../src/services/whatsappBridge";
import type { WaUserContext } from "../src/agent/whatsapp/policy";

const u = (o: Partial<WaUserContext> = {}): WaUserContext => ({ userId: "u", roleKey: "management", isActive: true, customerId: null, vendorId: null, vendorBlocked: false, permissions: new Set(), ...o });
const c = (phone: string, o: Partial<AllowlistCandidate> = {}): AllowlistCandidate => ({ phoneE164: phone, lid: null, enabled: true, aiPaused: false, user: u(), ...o });
const has = (r: AllowlistResponse, digits: string) => r.phones.includes(allowlistHash(r.salt, "p", digits));

test("only enabled, non-paused mappings of active users with a WhatsApp role are listed", () => {
  const r = buildAllowlist([
    c("+919800000001"),
    c("+919800000002", { enabled: false }),
    c("+919800000003", { aiPaused: true }),
    c("+919800000004", { user: u({ isActive: false }) }),
    c("+919800000005", { user: null }),
    c("+919800000006", { user: u({ roleKey: "customer", customerId: null }) }),
    c("+919800000007", { user: u({ roleKey: "customer", customerId: "c1" }) }),
    c("+919800000008", { user: u({ vendorBlocked: true }) }),
    c("+919800000009", { user: u({ roleKey: "erection_engineer" }) }),
  ], "salt1");
  assert.deepEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => has(r, `91980000000${n}`)), [true, false, false, false, false, false, true, false, true]);
  assert.equal(r.phones.length, 3);
  assert.equal(r.ttlSeconds, ALLOWLIST_TTL_SECONDS);
});

test("entries are salted hashes: no digits of any number appear, and a new salt changes every hash", () => {
  const a = buildAllowlist([c("+919800000001", { lid: "123456789012345" })]);
  const b = buildAllowlist([c("+919800000001", { lid: "123456789012345" })]);
  const text = JSON.stringify(a);
  assert.doesNotMatch(text, /9800000001|123456789012345/);
  assert.notEqual(a.salt, b.salt);
  assert.notDeepEqual(a.phones, b.phones);
  assert.equal(a.lids[0], allowlistHash(a.salt, "l", "123456789012345"));
  assert.equal(a.phones[0], crypto.createHash("sha256").update(`${a.salt}:p:919800000001`).digest("hex"), "documented hash format");
});

test("normalisation matches ingest: every spelling saved in Settings hashes to what the bridge sends", () => {
  for (const typed of ["9800000001", "09800000001", "+91 98000 00001", "919800000001", "0091 9800000001"]) {
    const stored = normalizePhoneE164(typed)!;
    const r = buildAllowlist([c(stored)], "s");
    // The bridge sends JID digits (no +); ingest treats them as "+<digits>" and looks the mapping up by that.
    const id = identityFromIngest({ messageId: "m", senderJid: "919800000001@s.whatsapp.net", chatJid: "x", timestamp: 1, text: "hi" });
    assert.equal(id.phoneE164, stored, typed);
    assert.ok(has(r, "919800000001"), typed);
  }
});

test("disabling a mapping removes it from the next response", () => {
  const rows = [c("+919800000001")];
  assert.ok(has(buildAllowlist(rows, "s"), "919800000001"));
  rows[0].enabled = false;
  assert.equal(buildAllowlist(rows, "s").phones.length, 0);
});

// ---------- route ----------
const SECRET = "current-secret-0123456789";
let now = 1_800_000_000_000;
const seen = new Set<string>();
const nonces: NonceStore = { claim: async (k, n) => (seen.has(`${k}|${n}`) ? false : (seen.add(`${k}|${n}`), true)) };
let mode: "ok" | "throw" = "ok";
let server: Server; let server2: Server; let base = ""; let base2 = "";
const service = {} as never;
before(async () => {
  const mk = (withList: boolean) => {
    const app = express();
    app.use("/wa", createWhatsappBridgeRouter({ nonces, service, background: () => {}, now: () => now, keys: () => parseBridgeKeys(`k2:${SECRET}`),
      ...(withList ? { allowlist: async () => { if (mode === "throw") throw new Error("db down"); return buildAllowlist([c("+919800000001")], "s"); } } : {}) }));
    return app;
  };
  await new Promise<void>((r) => { server = mk(true).listen(0, "127.0.0.1", () => r()); });
  await new Promise<void>((r) => { server2 = mk(false).listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  base2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
});
after(() => { server.close(); server2.close(); });
function signedGet(b: string, path: string) {
  const ts = String(Math.floor(now / 1000)); const nonce = crypto.randomBytes(16).toString("hex"); const sha = sha256Hex("");
  return fetch(b + path, { headers: { "x-zan-key-id": "k2", "x-zan-timestamp": ts, "x-zan-nonce": nonce, "x-zan-body-sha256": sha, "x-zan-signature": signBridgeRequest(SECRET, "GET", path, ts, nonce, sha) } });
}

test("GET /wa/allowlist: signed request gets hashes with no-store; unsigned is refused", async () => {
  mode = "ok";
  const res = await signedGet(base, "/wa/allowlist");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = (await res.json()) as AllowlistResponse;
  assert.ok(has(body, "919800000001"));
  assert.equal((await fetch(base + "/wa/allowlist")).status, 401);
});

test("GET /wa/allowlist: store failure is 503 (bridge fails closed), and absent wiring is 404", async () => {
  mode = "throw";
  assert.equal((await signedGet(base, "/wa/allowlist")).status, 503);
  assert.equal((await signedGet(base2, "/wa/allowlist")).status, 404);
});

test("allowlistHash matches the bridge's Go test vector (zanallow.TestHashMatchesZanVector)", () => {
  assert.equal(
    allowlistHash("abc", "p", "919800000001"),
    "35789f36876fd1cf7dfd07e4b51122f233f768af08a638441c057d4c5a6d38e4",
  );
});

test("allowlist candidates: one joined query, same eligibility as loading each user separately", async () => {
  const { prisma } = await import("../src/lib/prisma");
  const { loadAllowlistCandidates, loadWaUserContext } = await import("../src/services/whatsappMappingStore");
  const role = (key: string, perms: string[] = ["view_site_status"]) => ({ key, permissions: perms.map((k) => ({ permission: { key: k } })) });
  const users: Record<string, any> = {
    u1: { id: "u1", isActive: true, customerId: null, vendorId: null, vendor: null, role: role("management") },
    u2: { id: "u2", isActive: false, customerId: null, vendorId: null, vendor: null, role: role("management") },
    u3: { id: "u3", isActive: true, customerId: "c1", vendorId: null, vendor: null, role: role("customer") },
    u4: { id: "u4", isActive: true, customerId: null, vendorId: null, vendor: null, role: role("customer") },
    u5: { id: "u5", isActive: true, customerId: "c1", vendorId: null, vendor: null, role: role("management") },
    u6: { id: "u6", isActive: true, customerId: null, vendorId: "v1", vendor: { status: "blocked" }, role: role("erection_engineer") },
    u7: { id: "u7", isActive: true, customerId: null, vendorId: null, vendor: null, role: role("guest") },
  };
  const maps = Object.keys(users).map((id, i) => ({ phoneE164: `+91980000000${i + 1}`, lid: i === 0 ? "123456789" : null, enabled: true, aiPaused: false, userId: id }));
  const calls: string[] = [];
  const saved = [Object.getOwnPropertyDescriptor(prisma, "whatsappSenderMapping"), Object.getOwnPropertyDescriptor(prisma, "user")] as const;
  Object.defineProperty(prisma, "whatsappSenderMapping", { configurable: true, value: { findMany: async (args: any) => {
    calls.push("mapping.findMany");
    assert.deepEqual(args.where, { enabled: true, aiPaused: false });
    return maps.map((m) => ({ ...m, user: users[m.userId] }));
  } } });
  Object.defineProperty(prisma, "user", { configurable: true, value: { findUnique: async (args: any) => { calls.push("user.findUnique"); return users[args.where.id] ?? null; } } });
  try {
    const joined = await loadAllowlistCandidates();
    assert.deepEqual(calls, ["mapping.findMany"], "exactly one query, no per-user lookups");
    const perUser = await Promise.all(maps.map(async (m) => ({ phoneE164: m.phoneE164, lid: m.lid, enabled: true, aiPaused: false, user: await loadWaUserContext(m.userId) })));
    assert.deepEqual(buildAllowlist(joined, "fixed"), buildAllowlist(perUser, "fixed"));
    const res = buildAllowlist(joined, "fixed");
    assert.deepEqual(res.phones, [allowlistHash("fixed", "p", "919800000001"), allowlistHash("fixed", "p", "919800000003")].sort());
    assert.deepEqual(res.lids, [allowlistHash("fixed", "l", "123456789")]);
  } finally {
    saved[0] ? Object.defineProperty(prisma, "whatsappSenderMapping", saved[0]) : Reflect.deleteProperty(prisma, "whatsappSenderMapping");
    saved[1] ? Object.defineProperty(prisma, "user", saved[1]) : Reflect.deleteProperty(prisma, "user");
  }
});
