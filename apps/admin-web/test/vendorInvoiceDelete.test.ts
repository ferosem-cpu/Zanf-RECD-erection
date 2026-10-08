import { test } from "node:test";
import assert from "node:assert/strict";
import { canDeleteRejectedBill, BILL_STATUS_LABEL, statusPillClass } from "../src/lib/finance";

test("'Delete rejected invoice' shows only for admins on a rejected bill without payments", () => {
  assert.equal(canDeleteRejectedBill({ status: "rejected", payments: [] }, "super_admin"), true);
  assert.equal(canDeleteRejectedBill({ status: "rejected", payments: [] }, "owner_admin"), true);
  // Approvers (finance, management, ...) can reject but not delete.
  for (const role of ["finance", "management", "customer", undefined]) {
    assert.equal(canDeleteRejectedBill({ status: "rejected", payments: [] }, role), false, String(role));
  }
  assert.equal(canDeleteRejectedBill({ status: "rejected", payments: [{}] }, "super_admin"), false);
  for (const status of ["uploaded", "verified", "approved", "partially_paid", "paid", "cancelled", "deleted"]) {
    assert.equal(canDeleteRejectedBill({ status, payments: [] }, "super_admin"), false, status);
  }
  assert.equal(BILL_STATUS_LABEL.deleted, "Deleted");
  assert.equal(statusPillClass("deleted"), "status-pill status-pill-error");
});
