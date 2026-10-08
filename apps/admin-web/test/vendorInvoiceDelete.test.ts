import { test } from "node:test";
import assert from "node:assert/strict";
import { canDeleteRejectedBill, BILL_STATUS_LABEL, statusPillClass } from "../src/lib/finance";

test("'Delete rejected invoice' shows only for approvers on a rejected bill without payments", () => {
  assert.equal(canDeleteRejectedBill({ status: "rejected", payments: [] }, true), true);
  assert.equal(canDeleteRejectedBill({ status: "rejected", payments: [] }, false), false);
  assert.equal(canDeleteRejectedBill({ status: "rejected", payments: [{}] }, true), false);
  for (const status of ["uploaded", "verified", "approved", "partially_paid", "paid", "cancelled", "deleted"]) {
    assert.equal(canDeleteRejectedBill({ status, payments: [] }, true), false, status);
  }
  assert.equal(BILL_STATUS_LABEL.deleted, "Deleted");
  assert.equal(statusPillClass("deleted"), "status-pill status-pill-error");
});
