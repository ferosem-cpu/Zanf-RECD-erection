import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  countCustomerBlockers, customerBlockerMessage, nonZeroBlockers, deleteCustomerWithPortalData,
  type CustomerBlockerCounts,
} from "../src/services/customerDelete";

const none: CustomerBlockerCounts = { orders: 0, quotations: 0, invoices: 0, complaints: 0, paymentsReceived: 0, creditNotes: 0, purchaseOrders: 0 };

test("no blockers -> no message", () => {
  assert.equal(customerBlockerMessage(none), null);
  assert.deepEqual(nonZeroBlockers(none), {});
});

test("message lists every non-zero blocker with counts", () => {
  const c = { ...none, orders: 1, complaints: 1, creditNotes: 2 };
  const m = customerBlockerMessage(c)!;
  assert.match(m, /1 order\(s\)\/site\(s\)/);
  assert.match(m, /1 complaint\(s\)/);
  assert.match(m, /2 credit note\(s\)/);
  assert.doesNotMatch(m, /\d quotation|\d invoice/);
  assert.deepEqual(nonZeroBlockers(c), { orders: 1, complaints: 1, creditNotes: 2 });
});

test("restrict-FK tables skipped by the old guard now block (payments, credit notes, customer POs)", () => {
  for (const k of ["paymentsReceived", "creditNotes", "purchaseOrders"] as const) {
    assert.ok(customerBlockerMessage({ ...none, [k]: 1 }), k);
  }
});

test("countCustomerBlockers queries by customerId on every blocking table", async () => {
  const seen: string[] = [];
  const t = (name: string, n: number) => ({ count: async (a: any) => { assert.equal(a.where.customerId, "c1"); seen.push(name); return n; } });
  const db: any = { order: t("order", 1), quotation: t("quotation", 0), invoice: t("invoice", 0), complaint: t("complaint", 3), paymentReceived: t("pay", 0), creditNote: t("cn", 0), customerPurchaseOrder: t("po", 0) };
  const c = await countCustomerBlockers(db, "c1");
  assert.equal(seen.length, 7);
  assert.equal(c.orders, 1); assert.equal(c.complaints, 3);
});

function fakeTx(users: string[], failPortal = false) {
  const calls: string[] = [];
  const tx: any = {
    user: {
      findMany: async (a: any) => { calls.push("user.findMany:" + a.where.role.key); return users.map((id) => ({ id })); },
      deleteMany: async (a: any) => { calls.push("user.deleteMany:" + a.where.id.in.join(",")); },
    },
    whatsappSenderMapping: { deleteMany: async () => { calls.push("wa.deleteMany"); } },
    portalAttachment: { deleteMany: async () => { calls.push("attachment.deleteMany"); } },
    portalSubmission: { deleteMany: async () => { calls.push("submission.deleteMany"); } },
    customer: { delete: async (a: any) => { calls.push("customer.delete:" + a.where.id); } },
    $executeRawUnsafe: async (sql: string) => {
      calls.push("sql:" + sql.split(" ").slice(0, 3).join(" "));
      if (failPortal && /DELETE FROM portal/.test(sql)) throw new Error("permission denied");
    },
  };
  return { tx, calls };
}

test("delete removes portal users, portal rows, drafts and the customer, in order", async () => {
  const { tx, calls } = fakeTx(["u1", "u2"]);
  await deleteCustomerWithPortalData(tx, "c1");
  assert.deepEqual(calls.filter((c) => !c.startsWith("sql:DELETE FROM portal")), [
    "user.findMany:customer", "sql:SAVEPOINT customer_delete_portal", "sql:RELEASE SAVEPOINT customer_delete_portal",
    "wa.deleteMany", "user.deleteMany:u1,u2", "attachment.deleteMany", "submission.deleteMany", "customer.delete:c1",
  ]);
  assert.equal(calls.filter((c) => c.startsWith("sql:DELETE FROM portal")).length, 5); // session, otp_challenge, notification, audit_log, order_draft
});

test("a failing portal.* cleanup rolls back to the savepoint and the customer is still deleted", async () => {
  const { tx, calls } = fakeTx(["u1"], true);
  await deleteCustomerWithPortalData(tx, "c1");
  assert.ok(calls.includes("sql:ROLLBACK TO SAVEPOINT"));
  assert.ok(calls.includes("customer.delete:c1"));
});

test("customer without portal users still deletes (no user/mapping calls)", async () => {
  const { tx, calls } = fakeTx([]);
  await deleteCustomerWithPortalData(tx, "c1");
  assert.ok(!calls.some((c) => c.startsWith("user.deleteMany") || c === "wa.deleteMany"));
  assert.ok(calls.includes("customer.delete:c1"));
});

test("route returns 409 with blockers, guards before deleting, maps P2003 to 409", () => {
  const src = readFileSync(join(__dirname, "../src/routes/customers.ts"), "utf8");
  const del = src.slice(src.indexOf('customersRouter.delete("/:id"'));
  assert.match(del, /status\(409\)\.json\(\{ error: message, blockers/);
  assert.ok(del.indexOf("customerBlockerMessage") < del.indexOf("deleteCustomerWithPortalData"));
  assert.match(del, /P2003/);
  assert.doesNotMatch(del.slice(0, del.indexOf("// Payments recorded")), /status\(400\)/);
});
