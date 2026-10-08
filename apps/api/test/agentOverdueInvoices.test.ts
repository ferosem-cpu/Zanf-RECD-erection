import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInvoiceFilter, invoiceStatusWhere, summarizeInvoices, OVERDUE_INVOICE_STATUSES } from "../src/agent/tools/zanAppReadTools";
import { annotateListResult, EMPTY_LIST_NOTE, LIST_LIMIT } from "../src/agent/listResult";

const now = new Date("2026-10-08T00:00:00Z");
const row = (id: string, dueDate: string | null, balance: number | null) => ({
  id, status: "issued", dueDate: dueDate ? new Date(dueDate) : null,
  total: balance, creditNoteTotal: 0, netTotal: balance, amountPaid: 0, balance, overdue: true,
});

test("a guessed status='overdue' (any case/spacing) maps to overdueOnly instead of a status filter", () => {
  assert.deepEqual(resolveInvoiceFilter({ status: " Overdue " }), { overdueOnly: true, statuses: undefined });
  assert.deepEqual(resolveInvoiceFilter({ overdueOnly: true }), { overdueOnly: true, statuses: undefined });
  assert.deepEqual(resolveInvoiceFilter({ status: "paid" }), { overdueOnly: false, statuses: ["paid"] });
  assert.deepEqual(resolveInvoiceFilter({}), { overdueOnly: false, statuses: undefined });
});

test("overdue where clause matches the finance dashboard: issued/partially_paid with dueDate before now", () => {
  assert.deepEqual(OVERDUE_INVOICE_STATUSES, ["issued", "partially_paid"]);
  assert.deepEqual(invoiceStatusWhere({ overdueOnly: true }, now), { status: { in: ["issued", "partially_paid"] }, dueDate: { lt: now } });
  // An explicit status only narrows; a status that can never be overdue yields nothing.
  assert.deepEqual(invoiceStatusWhere({ overdueOnly: true, statuses: ["partially_paid"] }, now), { status: { in: ["partially_paid"] }, dueDate: { lt: now } });
  assert.deepEqual(invoiceStatusWhere({ overdueOnly: true, statuses: ["paid"] }, now), { status: { in: [] }, dueDate: { lt: now } });
  assert.deepEqual(invoiceStatusWhere({ overdueOnly: false, statuses: ["draft"] }, now), { status: "draft" });
  assert.deepEqual(invoiceStatusWhere({ overdueOnly: false }, now), {});
});

test("overdue totals cover every overdue invoice, not just the listed page, and the list is sorted by due date", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(`inv${i}`, `2026-0${(i % 9) + 1}-${String(10 + i).padStart(2, "0")}T00:00:00Z`, 1000.01));
  const out = summarizeInvoices(rows, 15, { overdueOnly: true });
  assert.equal(out.overdueCount, 20);
  assert.equal(out.totalOverdueBalance, 20000.2);
  assert.equal(out.listed, 15);
  assert.equal(out.invoices.length, 15);
  assert.equal(out.complete, false);
  assert.equal(out.totalCount, 20);
  const times = out.invoices.map((r) => r.dueDate!.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  // Earliest due dates are the ones listed.
  const allTimes = rows.map((r) => r.dueDate!.getTime()).sort((a, b) => a - b);
  assert.deepEqual(times, allTimes.slice(0, 15));
});

test("the expected live shape: 3 overdue invoices worth Rs 3,65,800", () => {
  const out = summarizeInvoices([row("c", "2026-09-30", 65800), row("a", "2026-07-01", 200000), row("b", "2026-08-15", 100000)], 15, { overdueOnly: true });
  assert.equal(out.overdueCount, 3);
  assert.equal(out.totalOverdueBalance, 365800);
  assert.equal(out.complete, true);
  assert.deepEqual(out.invoices.map((r) => r.id), ["a", "b", "c"]);
  const empty = summarizeInvoices([], 15, { overdueOnly: true });
  assert.equal(empty.overdueCount, 0);
  assert.equal(empty.totalOverdueBalance, 0);
  assert.equal(empty.totalCount, 0);
  assert.deepEqual(empty.invoices, []);
});

test("empty results carry a check-your-filter note; non-list objects (pending actions) are untouched", () => {
  assert.deepEqual(annotateListResult([]), { complete: true, totalCount: 0, returnedCount: 0, results: [], note: EMPTY_LIST_NOTE });
  assert.match(EMPTY_LIST_NOTE, /filter/);
  assert.match(EMPTY_LIST_NOTE, /another relevant tool/);
  const obj = { actionId: "a1", status: "pending_confirmation" };
  assert.equal(annotateListResult(obj), obj);
  assert.equal(annotateListResult(null), null);
  const overdue = summarizeInvoices([], LIST_LIMIT, { overdueOnly: true });
  assert.equal((annotateListResult(overdue) as { note: string }).note, EMPTY_LIST_NOTE);
});
