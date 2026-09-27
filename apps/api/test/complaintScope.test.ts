import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMISSION_KEY } from "@recd/shared";
import { complaintListWhere, COMPLAINT_LIST_PERMISSIONS } from "../src/lib/complaintScope";

const caller = (perms: string[], extra: { customerId?: string | null } = {}) => ({ userId: "u1", permissions: new Set(perms), ...extra });

test("engineers holding only act_assigned_complaints may list, and see only their assigned complaints", () => {
  assert.ok((COMPLAINT_LIST_PERMISSIONS as readonly string[]).includes(PERMISSION_KEY.ACT_ASSIGNED_COMPLAINTS));
  assert.deepEqual(complaintListWhere(caller([PERMISSION_KEY.ACT_ASSIGNED_COMPLAINTS])), { assignedToId: "u1" });
});

test("service team (manage_complaints) and overview viewers see all complaints", () => {
  assert.deepEqual(complaintListWhere(caller([PERMISSION_KEY.MANAGE_COMPLAINTS])), {});
  assert.deepEqual(complaintListWhere(caller([PERMISSION_KEY.VIEW_COMPLAINTS_OVERVIEW])), {});
  assert.deepEqual(complaintListWhere(caller([PERMISSION_KEY.ACT_ASSIGNED_COMPLAINTS, PERMISSION_KEY.MANAGE_COMPLAINTS])), {});
});

test("customers see only their own company's complaints, whatever else they hold", () => {
  assert.deepEqual(complaintListWhere(caller([PERMISSION_KEY.RAISE_COMPLAINT], { customerId: "c9" })), { customerId: "c9" });
  assert.deepEqual(complaintListWhere(caller([PERMISSION_KEY.MANAGE_COMPLAINTS], { customerId: "c9" })), { customerId: "c9" });
});

test("staff holding only raise_complaint are scoped to complaints assigned to them", () => {
  assert.deepEqual(complaintListWhere(caller([PERMISSION_KEY.RAISE_COMPLAINT])), { assignedToId: "u1" });
});
