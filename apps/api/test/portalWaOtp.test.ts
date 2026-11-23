import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWaOtpQueue, waOtpBodySchema, waOtpText, GLOBAL_MAX, PER_PHONE_MAX, type WaOtpStore } from "../src/services/portalWaOtp";
import { createBridgeService, OTP_TTL_MS, type NewOutbox, type OutboxRow, type OtpUserLoader, type WaBridgeStore } from "../src/services/whatsappBridge";

let nowMs = 1_800_000_000_000;
const clock = () => new Date(nowMs);
type U = { isActive: boolean; roleKey: string; customerId: string | null; phoneE164: string | null };
const users: Record<string, U> = {
  cust: { isActive: true, roleKey: "customer", customerId: "c1", phoneE164: "+919876543210" },
  cust2: { isActive: true, roleKey: "customer", customerId: "c2", phoneE164: "+919876543211" },
  inactive: { isActive: false, roleKey: "customer", customerId: "c1", phoneE164: "+919876543212" },
  staff: { isActive: true, roleKey: "management", customerId: null, phoneE164: "+919876543213" },
  staffWithCust: { isActive: true, roleKey: "management", customerId: "c1", phoneE164: "+919876543214" },
  nocust: { isActive: true, roleKey: "customer", customerId: null, phoneE164: "+919876543215" },
  nophone: { isActive: true, roleKey: "customer", customerId: "c1", phoneE164: null },
};
const loadUser: OtpUserLoader = async (id) => users[id] ?? null;

// ---- in-memory outbox (only what the queue and the bridge poll/claim/ack use) ----
function fakeOutbox() {
  const rows: OutboxRow[] = []; let n = 0;
  const store: WaOtpStore & WaBridgeStore = {
    async countOtp(since, phone) { return rows.filter((r) => r.waGroup === "otp" && r.createdAt > since && (!phone || r.recipientPhone === phone)).length; },
    async insert(row: NewOutbox) { if (!rows.some((r) => r.inboundId === row.inboundId)) rows.push({ ...row, id: "o" + ++n, status: "pending", leasedKeyId: null, leaseUntil: null, sendBy: null, createdAt: clock() } as OutboxRow & { createdAt: Date }); },
    async insertOutboxIfAbsent(row: NewOutbox) { return this.insert(row); },
    async getOutbox(id) { return rows.find((r) => r.id === id) ?? null; },
    async updateOutboxIf(id, g, patch) {
      const r = rows.find((x) => x.id === id);
      if (!r || !g.statusIn.includes(r.status) || (g.leasedKeyId && r.leasedKeyId !== g.leasedKeyId) || (g.leaseUntilAfter && !(r.leaseUntil && r.leaseUntil > g.leaseUntilAfter))) return false;
      Object.assign(r, patch); return true;
    },
    async expireOutbox(now) {
      for (const r of rows) { if ((r.status === "pending" || r.status === "leased") && r.expiresAt < now) Object.assign(r, { status: "expired", text: null }); if (r.status === "sending" && r.sendBy && r.sendBy < now) Object.assign(r, { status: "uncertain", text: null }); }
    },
    async leaseOutbox(keyId, now, leaseMs, limit) {
      const out: OutboxRow[] = [];
      for (const r of rows) { if (out.length >= limit) break; if (r.expiresAt > now && (r.status === "pending" || (r.status === "leased" && r.leaseUntil! < now))) { Object.assign(r, { status: "leased", leasedKeyId: keyId, leaseUntil: new Date(now.getTime() + leaseMs) }); out.push({ ...r }); } }
      return out;
    },
    async listStaleJobs() { return []; },
  } as unknown as WaOtpStore & WaBridgeStore;
  return { rows, store };
}
const mkQueue = (o: ReturnType<typeof fakeOutbox>) => createWaOtpQueue({ store: o.store, loadUser, now: clock, key: () => "test-key" });
const mkBridge = (o: ReturnType<typeof fakeOutbox>, otpUser: OtpUserLoader | null = loadUser) => createBridgeService({
  store: o.store, senders: {} as never, otpUser: otpUser ?? undefined, openTurn: async () => ({ ok: false, reason: "x" }), runTurn: async () => ({}) as never,
  buildSystemPrompt: async () => "", sanitizeReply: (t) => t, sanitizeHistory: () => [], newDeadline: () => ({}) as never, now: clock, newToken: () => "t",
});

test("an active customer gets one marker row: fixed text, number from the DB row, 5 minute expiry, no mapping", async () => {
  const o = fakeOutbox();
  assert.deepEqual(await mkQueue(o)({ userId: "cust", code: "123456" }), { queued: true });
  assert.equal(o.rows.length, 1);
  const r = o.rows[0];
  assert.equal(r.waGroup, "otp"); assert.match(r.inboundId, /^otp:[0-9a-f]{32}$/); assert.equal(r.mappingId, "otp:cust");
  assert.equal(r.recipientPhone, "+919876543210"); assert.equal(r.recipientLid, null);
  assert.equal(r.text, "Your Zan-F portal sign-in code is 123456. It expires in 5 minutes. Do not share it.");
  assert.equal(r.text, waOtpText("123456"));
  assert.equal(r.expiresAt.getTime(), nowMs + OTP_TTL_MS);
  assert.doesNotMatch(r.inboundId, /123456/);
});
test("nothing is queued for a non-customer, inactive, customer-less, phone-less or unknown user", async () => {
  const o = fakeOutbox(); const q = mkQueue(o);
  for (const u of ["staff", "staffWithCust", "inactive", "nocust", "nophone", "ghost"]) assert.deepEqual(await q({ userId: u, code: "123456" }), { queued: false, reason: "not_eligible" }, u);
  assert.equal(o.rows.length, 0);
});
test("the request cannot choose the number or the text: strict {userId, code} only, code exactly 6 digits", () => {
  for (const bad of [{ userId: "cust", code: "123456", phone: "+919000000000" }, { userId: "cust", code: "123456", text: "hi" }, { userId: "cust", code: "12345" }, { userId: "cust", code: "12345a" }, { userId: "", code: "123456" }, { code: "123456" }, { userId: "cust" }])
    assert.equal(waOtpBodySchema.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(waOtpBodySchema.safeParse({ userId: "cust", code: "123456" }).success, true);
});
test("idempotent: the same (user, code) queued twice is one row", async () => {
  const o = fakeOutbox(); const q = mkQueue(o);
  await q({ userId: "cust", code: "123456" }); await q({ userId: "cust", code: "123456" });
  assert.equal(o.rows.length, 1);
});
test("limits: 3 per phone per 15 minutes, 60 per hour overall", async () => {
  const o = fakeOutbox(); const q = mkQueue(o);
  for (let i = 0; i < PER_PHONE_MAX; i++) assert.equal((await q({ userId: "cust", code: String(100000 + i) })).queued, true);
  assert.deepEqual(await q({ userId: "cust", code: "999999" }), { queued: false, reason: "rate_limited" });
  assert.equal((await q({ userId: "cust2", code: "111111" })).queued, true); // other phone unaffected
  nowMs += 16 * 60_000;
  assert.equal((await q({ userId: "cust", code: "888888" })).queued, true);
  // global
  const g = fakeOutbox(); const gq = mkQueue(g);
  for (let i = 0; i < GLOBAL_MAX; i++) g.rows.push({ id: "x" + i, inboundId: "otp:g" + i, mappingId: "otp:u" + i, waGroup: "otp", recipientPhone: "+9199000" + String(10000 + i), recipientLid: null, text: null, status: "sent", leasedKeyId: null, leaseUntil: null, sendBy: null, expiresAt: clock(), createdAt: clock() } as unknown as OutboxRow);
  assert.deepEqual(await gq({ userId: "cust", code: "123123" }), { queued: false, reason: "global_limit" });
});
test("never writes the code, text or number to the console", async () => {
  const seen: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => { seen.push(a.map(String).join(" ")); };
  try { const o = fakeOutbox(); await mkQueue(o)({ userId: "cust", code: "654321" }); await mkQueue(o)({ userId: "staff", code: "654321" }); } finally { Object.assign(console, orig); }
  assert.doesNotMatch(seen.join("\n"), /654321|9876543210/);
});

// ---- the existing bridge flow delivers it: poll -> claim -> ack ----
test("poll offers the row to the bridge, claim releases the fixed text, ack(sent) clears it", async () => {
  const o = fakeOutbox(); await mkQueue(o)({ userId: "cust", code: "123456" });
  const b = mkBridge(o);
  const p = await b.poll("bridge", 5);
  assert.equal(p.items.length, 1); assert.equal(p.items[0].recipient.jid, "919876543210@s.whatsapp.net"); assert.equal(p.items[0].recipient.lid, undefined);
  const c = await b.claim("bridge", p.items[0].outboxId);
  assert.equal(c.status, 200); assert.equal((c as { text: string }).text, waOtpText("123456"));
  assert.equal(await b.ack("bridge", { outboxId: p.items[0].outboxId, status: "sent", at: 1 } as never), 200);
  assert.equal(o.rows[0].status, "sent"); assert.equal(o.rows[0].text, null);
});
test("ack failed and uncertain also clear the code text", async () => {
  for (const status of ["failed", "uncertain"] as const) {
    const o = fakeOutbox(); await mkQueue(o)({ userId: "cust", code: "123456" }); const b = mkBridge(o);
    const id = (await b.poll("bridge", 5)).items[0].outboxId; await b.claim("bridge", id);
    await b.ack("bridge", { outboxId: id, status, at: 1 } as never);
    assert.equal(o.rows[0].text, null, status);
  }
});
test("an unclaimed code expires after 5 minutes and its text is cleared; a late claim is Gone", async () => {
  const o = fakeOutbox(); await mkQueue(o)({ userId: "cust", code: "123456" }); const b = mkBridge(o);
  const id = (await b.poll("bridge", 5)).items[0].outboxId;
  o.rows[0].expiresAt = new Date(nowMs - 1); // the 5 minutes ran out while the lease was still valid
  assert.deepEqual(await b.claim("bridge", id), { status: 410 });
  assert.equal(o.rows[0].status, "expired"); assert.equal(o.rows[0].text, null);
  const o2 = fakeOutbox(); await mkQueue(o2)({ userId: "cust", code: "223456" }); nowMs += OTP_TTL_MS + 1000;
  assert.equal((await mkBridge(o2).poll("bridge", 5)).items.length, 0); assert.equal(o2.rows[0].text, null);
});
test("claim re-checks the user: deactivated, changed to staff, or a changed number -> discarded, text cleared", async () => {
  const original = { ...users.cust };
  for (const mutate of [(u: U) => { u.isActive = false; }, (u: U) => { u.roleKey = "management"; }, (u: U) => { u.phoneE164 = "+919000000001"; }, (u: U) => { u.customerId = null; }]) {
    Object.assign(users.cust, original);
    const o = fakeOutbox(); await mkQueue(o)({ userId: "cust", code: "123456" }); const b = mkBridge(o);
    const id = (await b.poll("bridge", 5)).items[0].outboxId;
    mutate(users.cust);
    assert.deepEqual(await b.claim("bridge", id), { status: 410 });
    assert.equal(o.rows[0].status, "discarded"); assert.equal(o.rows[0].text, null);
  }
  Object.assign(users.cust, original);
});
test("a bridge without the otp user loader discards sign-in code rows (fail closed)", async () => {
  const o = fakeOutbox(); await mkQueue(o)({ userId: "cust", code: "123456" });
  assert.equal((await mkBridge(o, null).poll("bridge", 5)).items.length, 0);
  assert.equal(o.rows[0].status, "discarded"); assert.equal(o.rows[0].text, null);
});
test("a half-marked or forged row never takes the normal mapping path", async () => {
  const o = fakeOutbox();
  for (const [g, i, m] of [["otp", "plain", "otp:cust"], ["customer", "otp:abc", "m1"], ["otp", "otp:abc", "plain"]] as const)
    o.rows.push({ id: "f" + i + m, inboundId: i, mappingId: m, waGroup: g, recipientPhone: "+919876543210", recipientLid: null, text: "x", status: "pending", leasedKeyId: null, leaseUntil: null, sendBy: null, expiresAt: new Date(nowMs + 60_000), createdAt: clock() } as unknown as OutboxRow);
  const b = mkBridge(o);
  assert.equal((await b.poll("bridge", 5)).items.length, 0);
  assert.ok(o.rows.every((r) => r.status === "discarded" && r.text === null));
});
