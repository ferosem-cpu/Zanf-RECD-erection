import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMapping, isUniqueViolation, MappingError, setEnabled, type MappingRecord, type MappingStore } from "../src/services/whatsappMapping";
import { projectDetail } from "../src/agent/whatsapp/policy";

const row: MappingRecord = {
  id: "m1", userId: "u1", phoneE164: "+919876543210", lid: null, enabled: false, aiPaused: false, note: null,
  createdById: "a", updatedById: "a", verifiedById: "a", verifiedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
};
function store(fail: unknown): MappingStore {
  return {
    list: async () => [], get: async () => row, findByPhone: async () => null, findByLid: async () => null, findEnabledByUser: async () => [],
    findUser: async () => ({ id: "u1", name: "U", roleKey: "sales", isActive: true, customerId: null }),
    create: async () => { throw fail; }, update: async () => { throw fail; }, remove: async () => undefined,
  };
}

test("isUniqueViolation recognises Prisma P2002 and raw Postgres 23505 shapes", () => {
  assert.ok(isUniqueViolation({ code: "P2002" }));
  assert.ok(isUniqueViolation({ code: "23505" }));
  assert.ok(isUniqueViolation({ code: "P2010", meta: { code: "23505" } }));
  assert.ok(isUniqueViolation(new Error('duplicate key value violates unique constraint "WhatsappSenderMapping_one_enabled_user_idx"')));
  assert.ok(!isUniqueViolation(new Error("connection refused")));
  assert.ok(!isUniqueViolation(null));
});

test("add and enable turn a unique-index race (P2002 or 23505) into a 409, other errors stay errors", async () => {
  for (const fail of [{ code: "P2002" }, { code: "23505" }]) {
    await assert.rejects(createMapping(store(fail), "a", { userId: "u1", phone: "9876543210" }), (e) => e instanceof MappingError && e.status === 409);
    await assert.rejects(setEnabled(store(fail), "a", "m1", true), (e) => e instanceof MappingError && e.status === 409 && /already has an enabled/.test(e.message));
  }
  await assert.rejects(createMapping(store(new Error("db down")), "a", { userId: "u1", phone: "9876543210" }), (e) => !(e instanceof MappingError));
});

test("vendor detail on WhatsApp uses a fixed field list: Drive, approver and e-mail fields are dropped at every depth", () => {
  const out = projectDetail("vendor", {
    id: "v1", name: "V", status: "approved", contactName: "C", contactEmail: "c@x.in", contactPhone: "+91", address: "A",
    approvedById: "u9", archivedById: null, driveFolderId: "d1", createdAt: "2026-01-01",
    members: [{ name: "M", phone: "1", email: "m@x.in", passwordHash: "h" }],
    sites: [{ id: "s1", address: "SA", companyName: "Co", driveFolderId: "d2", driveFolderUrl: "http://d", otpSecret: "x",
      order: { orderNumber: "ZE-1", value: 100 }, currentStage: { key: "k", label: "L", phase: "p", sequenceOrder: 3, internalNote: "n" } }],
  }, false) as Record<string, unknown>;
  assert.deepEqual(Object.keys(out).sort(), ["address", "contactName", "contactPhone", "createdAt", "id", "members", "name", "sites", "status"]);
  assert.deepEqual(out.members, [{ name: "M", phone: "1" }]);
  assert.deepEqual(out.sites, [{ id: "s1", address: "SA", companyName: "Co", order: { orderNumber: "ZE-1" }, currentStage: { key: "k", label: "L", phase: "p", sequenceOrder: 3 } }]);
  assert.equal(JSON.stringify(out).includes("drive"), false);
});
