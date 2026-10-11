/** Opt-in Postgres integration test for the WhatsApp bridge Prisma stores. SKIPPED unless WA_PG_TEST_URL is set
 * (an already-migrated throwaway database). Cleans up every row it creates (ids prefixed with RUN). */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createPrismaBridgeStore } from "../src/services/whatsappBridgeStore";
import { createPrismaNonceStore } from "../src/services/whatsappBridgeNonceStore";
import type { NewInbound } from "../src/services/whatsappBridge";

const url = process.env.WA_PG_TEST_URL;
const skip = url ? false : "WA_PG_TEST_URL not set";
const RUN = `patest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const LEASE = 90_000;

const inbound = (suffix: string, mappingId: string): NewInbound => ({
  waMessageId: `${RUN}-${suffix}`, keyId: `${RUN}-key`, senderJid: "919876543210@s.whatsapp.net", senderLid: null, resolvedPhone: null,
  chatJid: "c", messageAt: new Date(), decision: "accept", mappingId, text: "hi", status: "received",
});

let client: PrismaClient | undefined;
const db = () => (client ??= new PrismaClient({ datasourceUrl: url }));

after(async () => {
  if (!client) return;
  const ids = (await client.whatsappInbound.findMany({ where: { waMessageId: { startsWith: RUN } }, select: { id: true } })).map((r) => r.id);
  await client.whatsappOutbox.deleteMany({ where: { inboundId: { in: ids } } });
  await client.whatsappInbound.deleteMany({ where: { waMessageId: { startsWith: RUN } } });
  await client.whatsappBridgeNonce.deleteMany({ where: { keyId: `${RUN}-key` } });
  await client.$disconnect();
});

test("pg: insertInbound dedups on waMessageId", { skip }, async () => {
  const store = createPrismaBridgeStore(db());
  const a = await store.insertInbound(inbound("dup", `${RUN}-mA`));
  const b = await store.insertInbound(inbound("dup", `${RUN}-mA`));
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(b.row.id, a.row.id);
});

test("pg: claim ordering per sender and lease expiry", { skip }, async () => {
  const store = createPrismaBridgeStore(db());
  const first = (await store.insertInbound(inbound("o1", `${RUN}-mO`))).row;
  await new Promise((r) => setTimeout(r, 15));
  const second = (await store.insertInbound(inbound("o2", `${RUN}-mO`))).row;
  const now = new Date();
  assert.equal(await store.claimJob(second.id, "t2", now, LEASE, 3), null, "later job waits for the earlier one");
  assert.ok(await store.claimJob(first.id, "t1", now, LEASE, 3));
  assert.equal(await store.claimJob(second.id, "t2", now, LEASE, 3), null, "blocked while the first runs");
  assert.equal(await store.completeJob(first.id, "t1", { status: "done" }, null, null), true);
  assert.ok(await store.claimJob(second.id, "t2", now, LEASE, 3));
  const later = new Date(now.getTime() + LEASE + 1000);
  assert.ok(await store.claimJob(second.id, "t3", later, LEASE, 3), "expired lease is reclaimable");
  await store.completeJob(second.id, "t3", { status: "done" }, null, null);
});

test("pg: concurrent claims never exceed the cap of 2 (expected globally only when no other WhatsApp jobs are running)", { skip }, async () => {
  const store = createPrismaBridgeStore(db());
  const jobs = [];
  for (let i = 0; i < 5; i++) jobs.push((await store.insertInbound(inbound(`cap${i}`, `${RUN}-mC${i}`))).row);
  const now = new Date();
  const results = await Promise.all(jobs.map((j, i) => store.claimJob(j.id, `tok${i}`, now, LEASE, 3)));
  assert.ok(results.filter(Boolean).length <= 2);
  assert.ok(results.filter(Boolean).length >= 1);
  for (const [i, r] of results.entries()) if (r) await store.completeJob(jobs[i].id, `tok${i}`, { status: "done" }, null, null);
});

test("pg: outbox lease, claim guard and ack transitions", { skip }, async () => {
  const store = createPrismaBridgeStore(db());
  const job = (await store.insertInbound(inbound("ob", `${RUN}-mB`))).row;
  const now = new Date();
  assert.ok(await store.claimJob(job.id, "t", now, LEASE, 3));
  const ob = { inboundId: job.id, mappingId: `${RUN}-mB`, waGroup: "sales", recipientPhone: "+919876543210", recipientLid: null, text: "reply", expiresAt: new Date(now.getTime() + 600_000) };
  assert.equal(await store.completeJob(job.id, "t", { status: "done" }, ob, null), true);
  await store.insertOutboxIfAbsent(ob);
  const row = await db().whatsappOutbox.findUniqueOrThrow({ where: { inboundId: job.id } });
  assert.equal(row.status, "pending");
  const leased = (await store.leaseOutbox(`${RUN}-key`, now, 30_000, 1000)).filter((o) => o.inboundId === job.id);
  assert.equal(leased.length, 1);
  assert.equal(await store.updateOutboxIf(row.id, { statusIn: ["leased"], leasedKeyId: "other-key" }, { status: "sending" }), false);
  assert.equal(await store.updateOutboxIf(row.id, { statusIn: ["leased"], leasedKeyId: `${RUN}-key`, leaseUntilAfter: now }, { status: "sending", sendBy: new Date(now.getTime() + 15_000) }), true);
  assert.equal(await store.updateOutboxIf(row.id, { statusIn: ["leased"], leasedKeyId: `${RUN}-key` }, { status: "sending" }), false, "no second claim");
  assert.equal(await store.updateOutboxIf(row.id, { statusIn: ["sending"] }, { status: "sent", text: null }), true);
  assert.equal((await store.getOutbox(row.id))?.status, "sent");
});

test("pg: nonce insert then replay", { skip }, async () => {
  const nonces = createPrismaNonceStore(db());
  const exp = new Date(Date.now() + 900_000);
  assert.equal(await nonces.claim(`${RUN}-key`, "n1", exp), true);
  assert.equal(await nonces.claim(`${RUN}-key`, "n1", exp), false);
  assert.equal(await nonces.claim(`${RUN}-key`, "n2", exp), true);
});
