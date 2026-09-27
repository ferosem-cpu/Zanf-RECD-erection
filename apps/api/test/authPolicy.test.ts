import { test } from "node:test";
import assert from "node:assert/strict";
import { isGoogleOnlyStaffEmail, isVendorAccessBlocked } from "../src/lib/authPolicy";

test("staff and customers (no vendorId) are never vendor-blocked", () => {
  assert.equal(isVendorAccessBlocked({ vendorId: null }), false);
  assert.equal(isVendorAccessBlocked({ vendorId: undefined, vendor: null }), false);
  assert.equal(isVendorAccessBlocked({}), false);
});

test("members of an approved vendor are allowed", () => {
  assert.equal(isVendorAccessBlocked({ vendorId: "v1", vendor: { status: "approved" } }), false);
});

test("members of a pending / rejected / archived vendor are blocked", () => {
  for (const status of ["pending", "rejected", "archived", "anything-else"]) {
    assert.equal(isVendorAccessBlocked({ vendorId: "v1", vendor: { status } }), true, status);
  }
});

test("a vendorId whose vendor row was not loaded or is missing fails closed", () => {
  assert.equal(isVendorAccessBlocked({ vendorId: "v1" }), true);
  assert.equal(isVendorAccessBlocked({ vendorId: "v1", vendor: null }), true);
});

test("Google-only policy is case/whitespace-insensitive", () => {
  assert.equal(isGoogleOnlyStaffEmail("  FeroseM@Gmail.com "), true);
  assert.equal(isGoogleOnlyStaffEmail("someone@zanf.org"), false);
});
