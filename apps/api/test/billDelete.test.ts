import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BILL_STATUS, billDeleteSchema } from "@recd/shared";
import { archivedBillNumber, duplicateBillNumberMessage, rejectedBillDeleteBlocker } from "../src/services/billDelete";

const base = { status: BILL_STATUS.REJECTED, billNumber: "TXIN0933/26-27", paymentCount: 0, debitNoteCount: 0 };

test("only a rejected bill with no payments or debit notes can be deleted", () => {
  assert.equal(rejectedBillDeleteBlocker(base), null);
  for (const status of ["uploaded", "verified", "approved", "partially_paid", "paid", "cancelled", "deleted"]) {
    assert.match(rejectedBillDeleteBlocker({ ...base, status })!, /Only a rejected/, status);
  }
  assert.match(rejectedBillDeleteBlocker({ ...base, paymentCount: 1 })!, /payments/);
  assert.match(rejectedBillDeleteBlocker({ ...base, debitNoteCount: 2 })!, /debit notes/);
});

test("archived number frees the original, is unique per bill and keeps the original readable", () => {
  const when = new Date("2026-10-08T10:00:00Z");
  const a = archivedBillNumber("TXIN0933/26-27", "ckbill00000000abcd1234", when);
  const b = archivedBillNumber("TXIN0933/26-27", "ckbill00000000zzzz9999", when);
  assert.equal(a, "TXIN0933/26-27 [deleted 2026-10-08 abcd1234]");
  assert.notEqual(a, "TXIN0933/26-27");
  assert.notEqual(a, b);
});

test("duplicate-number error points at the rejected bill when that is the blocker", () => {
  assert.match(duplicateBillNumberMessage("rejected"), /Delete rejected invoice/);
  assert.equal(duplicateBillNumberMessage("approved"), "A bill with this number already exists for this supplier");
});

test("a delete reason is required", () => {
  assert.equal(billDeleteSchema.safeParse({ reason: "  " }).success, false);
  assert.equal(billDeleteSchema.safeParse({}).success, false);
  assert.equal(billDeleteSchema.safeParse({ reason: "typo in invoice number" }).success, true);
});

test("deleting a rejected vendor invoice is admin-only (Super Admin, Owner/Admin), not approvers", () => {
  const source = readFileSync(join(__dirname, "../src/routes/bills.ts"), "utf8");
  const route = source.split("\n").find((l) => l.includes('billsRouter.post("/:id/delete"'))!;
  assert.match(route, /requireRole\(ROLE_KEY\.SUPER_ADMIN, ROLE_KEY\.OWNER_ADMIN\)/);
  // approve_vendor_invoice holders (finance, management) can reject but not delete.
  assert.doesNotMatch(route, /requirePermission/);
});
