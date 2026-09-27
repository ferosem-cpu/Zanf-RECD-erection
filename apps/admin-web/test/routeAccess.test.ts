import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROUTE_PERMISSIONS, matchRoute, canAccessPath, firstLanding } from "../src/lib/routeAccess";

// Production role grants as of 2026-09-27 (RolePermission rows), for the roles whose testing
// exposed the guard mismatches.
const OPERATIONS_PM = ["change_site_status", "manage_work_orders", "record_vendor_invoice", "resolve_pending_action", "view_site_status"];
const ENGINEER = ["act_assigned_complaints", "act_assigned_work_orders", "change_site_status", "record_vendor_invoice", "view_site_status"];
const SERVICE_TEAM = ["act_assigned_work_orders", "manage_complaints", "view_site_status"];
const SALES = ["manage_orders", "manage_quotations", "view_site_status"];
const FINANCE = ["approve_vendor_invoice", "manage_credit_notes", "manage_expenses", "manage_invoices", "manage_purchase_orders", "manage_quotations", "record_payments", "record_vendor_invoice", "view_finance_dashboard", "view_ledgers", "view_orders"];

test("matchRoute picks the most specific prefix", () => {
  assert.equal(matchRoute("/finance"), "/finance");
  assert.equal(matchRoute("/finance/vendor-invoices"), "/finance/vendor-invoices");
  assert.equal(matchRoute("/finance/vendor-invoices/new"), "/finance/vendor-invoices");
  assert.equal(matchRoute("/finance/vendor-invoices/abc123"), "/finance/vendor-invoices");
  assert.equal(matchRoute("/reports/tds"), "/reports/tds");
  assert.equal(matchRoute("/reports"), "/reports");
  assert.equal(matchRoute("/products/xyz"), "/products");
  // Prefix must end at a path segment boundary.
  assert.equal(matchRoute("/financeX"), undefined);
  assert.equal(matchRoute("/login"), undefined);
});

test("Operations/PM and engineers can open Vendor Invoices but not the finance dashboard", () => {
  for (const perms of [OPERATIONS_PM, ENGINEER]) {
    assert.equal(canAccessPath(perms, "/finance/vendor-invoices"), true);
    assert.equal(canAccessPath(perms, "/finance/vendor-invoices/new"), true);
    assert.equal(canAccessPath(perms, "/finance"), false);
    assert.equal(canAccessPath(perms, "/finance/ledgers"), false);
    assert.equal(canAccessPath(perms, "/purchase-orders"), false);
  }
});

test("each /finance sub-page follows its own permission, not view_finance_dashboard", () => {
  assert.equal(canAccessPath(["manage_quotations"], "/finance/customer-pricing"), true);
  assert.equal(canAccessPath(["manage_credit_notes"], "/finance/credit-notes"), true);
  assert.equal(canAccessPath(["manage_credit_notes"], "/finance/debit-notes"), true);
  assert.equal(canAccessPath(["view_ledgers"], "/finance/ledgers"), true);
  assert.equal(canAccessPath(["record_payments"], "/finance/payments"), true);
  assert.equal(canAccessPath(["approve_vendor_invoice"], "/finance/vendor-payments"), true);
  assert.equal(canAccessPath(["view_ledgers"], "/finance"), false);
});

test("Finance keeps access to everything it had", () => {
  for (const p of ["/finance", "/finance/vendor-invoices", "/finance/ledgers", "/finance/payments", "/finance/vendor-payments", "/finance/credit-notes", "/purchase-orders", "/invoices", "/quotations", "/expenses", "/orders", "/reports/tds", "/reports/finance"]) {
    assert.equal(canAccessPath(FINANCE, p), true, p);
  }
});

test("Service Team: complaints and sites yes, finance no; lands on /sites", () => {
  assert.equal(canAccessPath(SERVICE_TEAM, "/complaints"), true);
  assert.equal(canAccessPath(SERVICE_TEAM, "/finance"), false);
  assert.equal(firstLanding(SERVICE_TEAM), "/sites");
});

test("newly guarded pages: products, customer POs, reports", () => {
  assert.equal(canAccessPath(SALES, "/products"), true);
  assert.equal(canAccessPath(SALES, "/customer-pos/new"), true);
  assert.equal(canAccessPath(OPERATIONS_PM, "/products"), false);
  assert.equal(canAccessPath(OPERATIONS_PM, "/customer-pos"), false);
  assert.equal(canAccessPath(OPERATIONS_PM, "/reports"), true); // view_site_status -> SITC report
  assert.equal(canAccessPath(OPERATIONS_PM, "/reports/sitc"), true);
  assert.equal(canAccessPath(OPERATIONS_PM, "/reports/finance"), false);
  assert.equal(canAccessPath(SALES, "/reports/customer-history"), true);
  assert.equal(canAccessPath(SALES, "/reports/tds"), false);
});

test("every sidebar link has a guard entry (sidebar and guard share one map)", () => {
  const nav = fs.readFileSync(path.join(__dirname, "../src/components/Nav.tsx"), "utf8");
  const hrefs = [...nav.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 20, "expected to find the sidebar links");
  for (const href of hrefs) assert.ok(ROUTE_PERMISSIONS[href], `no guard entry for sidebar link ${href}`);
});

test("every /finance and /reports page directory has its own guard entry", () => {
  for (const section of ["finance", "reports"]) {
    const dir = path.join(__dirname, "../src/app", section);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const route = `/${section}/${entry.name}`;
      assert.ok(ROUTE_PERMISSIONS[route], `no guard entry for ${route}`);
    }
  }
});
