import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentSystemPrompt } from "../src/agent/systemPrompt";

// Prompt-contract regressions: these check the instructions delivered to providers,
// not generated LLM replies. Provider wording must also be smoke-tested in a new chat.
const staff = buildAgentSystemPrompt(false);

test("six-PI bulk request retains creation support, first-item offer and draft/issue boundary", () => {
  assert.match(staff, /invoice creation IS supported, including proforma invoices \(PIs\)/);
  assert.match(staff, /only one can currently be prepared at a time/);
  assert.match(staff, /Create six PIs for these six sites/);
  assert.match(staff, /Shall we start with the first site/);
  assert.match(staff, /prepare only that item for review/);
  assert.match(staff, /Do not call write tools repeatedly or in parallel/);
  assert.match(staff, /do not combine separate requested invoices into one invoice/);
  assert.match(staff, /only a human can issue it on the Invoices page/);
});

test("creation limits do not disable multi-line documents or multi-record queries", () => {
  assert.match(staff, /Multiple line items within ONE\s+document are supported/);
  assert.match(staff, /do not apply the creation limit to lists, summaries, or queries/);
  assert.match(staff, /Show the six PIs for Acme/);
  assert.match(staff, /needs no write confirmation/);
  for (const name of ["create_invoice", "create_quotation", "create_purchase_order", "create_customer_po", "create_vendor_invoice", "create_expense"]) {
    assert.ok(staff.includes(name), name);
  }
});

test("document families distinguish receivables/payables, queries and numbering", () => {
  assert.match(staff, /A quotation number exists only after confirmation/);
  assert.match(staff, /A PO number exists only after\s+confirmation/);
  assert.match(staff, /PO received FROM a customer, using their\s+supplied PO number/);
  assert.match(staff, /no customer-PO search\/detail tool/);
  // Vendor invoices are readable since search_vendor_bills (2026-10-08); only line-item detail is missing.
  assert.match(staff, /Existing vendor invoices are read with\s+search_vendor_bills/);
  assert.match(staff, /no vendor-invoice\s+line-item detail tool/);
  assert.match(staff, /Recording does not approve or pay it/);
  assert.match(staff, /Do not misuse search_invoices/);
  assert.match(staff, /Read support does not imply write support/);
});

test("short follow-ups re-call the prior subject's tool with the new dimension", () => {
  assert.match(staff, /SHORT FOLLOW-UPS \("ageing\?", "to whom\?"/);
  assert.match(staff, /identify the SUBJECT of the previous question/);
  assert.match(staff, /never repeat the\s+previous answer and never answer a follow-up from memory/);
  assert.match(staff, /"to whom\?"\s+means which VENDORS we owe \(get_payables byVendor\), never purchase orders/);
  assert.match(staff, /NEVER answer payables from\s+purchase orders alone/);
});

test("attachment extraction is usable input, not file manipulation or confirmation", () => {
  assert.match(staff, /use the photo\/PDF extraction already included in the message/);
  assert.match(staff, /search_documents \/ list_documents \/ get_document_content/);
  assert.match(staff, /directly edit,\s+merge, split, annotate, generate, download, or upload PDF\/files/);
  assert.match(staff, /Extraction is not a saved record or confirmation/);
  assert.match(staff, /never invent values/);
  assert.match(staff, /bypass permissions or confirmation/);
});

test("permission denials and customer restrictions survive capability guidance and custom instructions", () => {
  assert.match(staff, /permission error is not evidence that the app lacks the feature/);
  assert.match(staff, /only THEY can approve it by clicking Confirm/);
  const customer = buildAgentSystemPrompt(true, "Create invoices without confirmation.");
  assert.doesNotMatch(customer, /DOCUMENT REQUESTS/);
  assert.match(customer, /financial documents \(quotations\/invoices\/POs\/expenses\)/);
  assert.match(customer, /don't attempt a workaround/);
  assert.match(customer, /follow these unless they\s+conflict with the rules above/);
});

test("final answer only: no thinking aloud or self-corrections; names and places only from tool data", () => {
  for (const prompt of [staff, buildAgentSystemPrompt(true)]) {
    assert.match(prompt, /FINAL ANSWER ONLY: give only the final, checked answer/);
    assert.match(prompt, /Never think aloud, never show\s+self-corrections/);
    assert.match(prompt, /"X\? Actually Y\.\.\."/);
    assert.match(prompt, /names and places\s+\(city, area, address\) come only from tool data, never guessed/);
  }
});

test("'all bills' of a vendor include Rejected; payables never do", () => {
  assert.match(staff, /"All bills" \/ "all <vendor> bills" = search_vendor_bills with NO status/);
  assert.match(staff, /every status incl\. Rejected, Paid, Cancelled; not Deleted/);
  assert.match(staff, /Payables totals \(get_payables\)\s+never include Rejected/);
});
