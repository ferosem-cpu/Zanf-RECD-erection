import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInvoiceFilter, invoiceStatusWhere, summarizeOverdueInvoices, OVERDUE_INVOICE_STATUSES } from "../src/agent/tools/zanAppReadTools";
import { annotateListResult, LIST_CAP_HINT, EMPTY_LIST_NOTE } from "../src/agent/listResult";

const now = new Date("2026-10-08T00:00:00Z");
const row = (id: string, dueDate: string | null, balance: number | null) => ({ id, dueDate: dueDate ? new Date(dueDate) : null, balance });

test("a guessed status='overdue' (any case/spacing) maps to overdueOnly instead of a status filter", () => {
  assert.deepEqual(resolveInvoiceFilter({ status: " Overdue " }), { overdueOnly: true, status: undefined });
  assert.deepEqual(resolveInvoiceFilter({ overdueOnly: true }), { overdueOnly: true, status: undefined });
  assert.deepEqual(resolveInvoiceFilter({ status: "paid" }), { overdueOnly: false, status: "paid" });
  assert.deepEqual(resolveInvoiceFilter({}), { overdueOnly: false, status: undefined });
});

test("overdue where clause matches the finance dashboard: issued/partially_paid with dueDate before now", () => {
  assert.deepEqual(OVERDUE_INVOICE_STATUSES, ["issued", "partially_paid"]);
  assert.deepEqual(invoiceStatusWhere({ overdueOnly: true }, now), { status: { in: ["issued", "partially_paid"] }, dueDate: { lt: now } });
  // An explicit status only narrows; a status that can never be overdue yields nothing.
  assert.deepEqual(invoiceStatusWhere({ overdueOnly: true, status: "partially_paid" }, now), { status: { in: ["partially_paid"] }, dueDate: { lt: now } });
  assert.deepEqual(invoiceStatusWhere({ overdueOnly: true, status: "paid" }, now), { status: { in: [] }, dueDate: { lt: now } });
  assert.deepEqual(invoiceStatusWhere({ overdueOnly: false, status: "draft" }, now), { status: "draft" });
  assert.deepEqual(invoiceStatusWhere({ overdueOnly: false }, now), {});
});

test("overdue totals cover every overdue invoice, not just the listed page, and the list is sorted by due date", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(`inv${i}`, `2026-0${(i % 9) + 1}-${String(10 + i).padStart(2, "0")}T00:00:00Z`, 1000.005));
  const out = summarizeOverdueInvoices(rows, 15);
  assert.equal(out.overdueCount, 20);
  assert.equal(out.totalOverdueBalance, 20000.1);
  assert.equal(out.listed, 15);
  assert.equal(out.invoices.length, 15);
  const times = out.invoices.map((r) => r.dueDate!.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  // Earliest due dates are the ones listed.
  const allTimes = rows.map((r) => r.dueDate!.getTime()).sort((a, b) => a - b);
  assert.deepEqual(times, allTimes.slice(0, 15));
});

test("the expected live shape: 3 overdue invoices worth Rs 3,65,800", () => {
  const out = summarizeOverdueInvoices([row("c", "2026-09-30", 65800), row("a", "2026-07-01", 200000), row("b", "2026-08-15", 100000)], 15);
  assert.equal(out.overdueCount, 3);
  assert.equal(out.totalOverdueBalance, 365800);
  assert.deepEqual(out.invoices.map((r) => r.id), ["a", "b", "c"]);
  assert.deepEqual(summarizeOverdueInvoices([], 15), { overdueCount: 0, totalOverdueBalance: 0, listed: 0, invoices: [] });
});

test(`list results of ${LIST_CAP_HINT} or more are flagged as possibly truncated`, () => {
  const full = Array.from({ length: LIST_CAP_HINT }, (_, i) => ({ i }));
  const out = annotateListResult(full) as { resultCount: number; possiblyTruncated: boolean; results: unknown[]; note: string };
  assert.equal(out.resultCount, LIST_CAP_HINT);
  assert.equal(out.possiblyTruncated, true);
  assert.equal(out.results, full);
  assert.match(out.note, /capped/);
  // Below the cap the bare array passes through unchanged.
  const short = full.slice(0, LIST_CAP_HINT - 1);
  assert.equal(annotateListResult(short), short);
});

test("empty results carry a check-your-filter note; non-array results (objects, pending actions) are untouched", () => {
  assert.deepEqual(annotateListResult([]), { resultCount: 0, results: [], note: EMPTY_LIST_NOTE });
  assert.match(EMPTY_LIST_NOTE, /filter/);
  assert.match(EMPTY_LIST_NOTE, /another relevant tool/);
  const obj = { actionId: "a1", status: "pending_confirmation" };
  assert.equal(annotateListResult(obj), obj);
  const overdue = { overdueCount: 0, totalOverdueBalance: 0, listed: 0, invoices: [] };
  assert.equal(annotateListResult(overdue), overdue);
  assert.equal(annotateListResult(null), null);
});
