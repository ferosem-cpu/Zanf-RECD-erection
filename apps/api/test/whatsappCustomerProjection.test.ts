import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectForCustomer, CUSTOMER_PROJECTED_TOOLS, CUSTOMER_PROJECTED_DOCS } from "../src/agent/whatsapp/customerProjection";

test("customer projection: unknown tools/doc types fail closed; unknown fields are dropped", () => {
  assert.deepEqual(CUSTOMER_PROJECTED_TOOLS.sort(), ["search_complaints", "search_orders_and_sites", "search_site_status_updates"]);
  assert.deepEqual(CUSTOMER_PROJECTED_DOCS.sort(), ["complaint", "order"]);
  assert.match(JSON.stringify(projectForCustomer("search_invoices", "", { results: [{ total: 5 }] })), /isn't available/);
  assert.match(JSON.stringify(projectForCustomer("get_document_detail", "invoice", { id: "i" })), /isn't available/);
  const out = projectForCustomer("get_document_detail", "complaint", { id: "k", ticketNumber: "T", newInternalField: "x", rootCause: "y" });
  assert.deepEqual(out, { id: "k", ticketNumber: "T" });
});

test("customer projection: errors keep only message and valid values", () => {
  const out = projectForCustomer("search_orders_and_sites", "", { error: "Unknown stage", validStages: ["a"], debug: { sql: "x" } });
  assert.deepEqual(out, { error: "Unknown stage", validStages: ["a"] });
});

test("customer projection: count maps keep counts only (no totalValue)", () => {
  const out = projectForCustomer("search_complaints", "", { byStatus: { open: { count: 2, totalValue: 9 } }, results: [] }) as any;
  assert.deepEqual(out.byStatus, { open: { count: 2 } });
});
