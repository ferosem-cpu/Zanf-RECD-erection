import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../src/lib/prisma";
import { documentAgeing, isPastDue, istStartOfDay } from "../src/services/ageing";
import { summarizePayables } from "../src/services/payables";
import { summarizeReceivables, zanAppFinanceTools } from "../src/agent/tools/zanAppFinanceTools";

const d = (s: string) => new Date(s);
const nineOctNoonIST = d("2026-10-09T06:30:00Z");

test("isPastDue: due date before today's IST date only; no due date is never overdue", () => {
  assert.equal(isPastDue(null, nineOctNoonIST), false);
  assert.equal(isPastDue(undefined, nineOctNoonIST), false);
  assert.equal(isPastDue(d("2026-10-09T00:00:00Z"), nineOctNoonIST), false); // due today
  assert.equal(isPastDue(d("2026-10-08T00:00:00Z"), nineOctNoonIST), true);
  assert.equal(istStartOfDay(nineOctNoonIST).toISOString(), "2026-10-08T18:30:00.000Z");
});

test("documentAgeing: no due date => no_due_date, daysPastDue null, aged by bill date, stable across the day", () => {
  const billDate = d("2026-09-20T00:00:00Z");
  for (const now of [d("2026-10-08T23:00:00Z"), nineOctNoonIST, d("2026-10-09T18:00:00Z")]) {
    const a = documentAgeing(null, billDate, now);
    assert.equal(a.dueStatus, "no_due_date");
    assert.equal(a.overdue, false);
    assert.equal(a.daysPastDue, null);
    assert.equal(a.ageingBasis, "aged by bill date (no due date)");
    assert.equal(a.bucket, "days0_30");
  }
  const due = documentAgeing(d("2026-09-29T00:00:00Z"), billDate, nineOctNoonIST);
  assert.deepEqual([due.dueStatus, due.overdue, due.daysPastDue, due.ageingBasis], ["overdue", true, 10, "due date"]);
  assert.equal(documentAgeing(d("2026-10-20T00:00:00Z"), billDate, nineOctNoonIST).dueStatus, "not_due");
});

test("payables: of 4 unpaid bills only the one with a past due date (TXIN0934) is overdue", () => {
  const row = (billNumber: string, dueDate: Date | null, supplier = "Selvam Enterprises") => ({
    id: billNumber, billNumber, supplierId: supplier, supplier, status: "approved",
    billDate: d("2026-09-01T00:00:00Z"), dueDate, total: 1000, paid: 0, debitNotes: 0,
  });
  const out = summarizePayables([
    row("TXIN0934", d("2026-09-29T00:00:00Z"), "Platino Automotive"),
    row("SE/1", null), row("SE/2", null), row("SE/3", null),
  ], nineOctNoonIST);
  assert.equal(out.billCount, 4);
  assert.equal(out.overdueCount, 1);
  assert.equal(out.overdueAmount, 1000);
  assert.equal(out.noDueDateCount, 3);
  assert.equal(out.dueList[0].billNumber, "TXIN0934");
  assert.equal(out.dueList[0].daysPastDue, 10);
  for (const b of out.dueList.slice(1)) assert.deepEqual([b.dueStatus, b.overdue, b.daysPastDue], ["no_due_date", false, null]);
});

test("receivables: an invoice without a due date is not overdue", () => {
  const inv = (invoiceNumber: string, dueDate: Date | null) => ({
    id: invoiceNumber, invoiceNumber, docType: "tax_invoice", customerId: "c", customer: "C", issueDate: d("2026-08-01T00:00:00Z"),
    dueDate, subtotal: 100, total: 118, creditNoteTotal: 0, settled: 0,
  });
  const out = summarizeReceivables([inv("A", null), inv("B", d("2026-09-01T00:00:00Z"))], nineOctNoonIST);
  assert.equal(out.totals.overdueCount, 1);
  assert.deepEqual(out.overdueInvoices.map((r) => r.invoiceNumber), ["B"]);
  const a = out.invoices.find((r) => r.invoiceNumber === "A")!;
  assert.deepEqual([a.dueStatus, a.daysPastDue, a.ageingBasis], ["no_due_date", null, "aged by issue date (no due date)"]);
});

test("search_vendor_bills overdueOnly: bills without a due date are excluded and labelled no_due_date", async (t) => {
  const tool = zanAppFinanceTools.find((x) => x.name === "search_vendor_bills")!;
  const auth = { userId: "f", roleKey: "finance", permissions: new Set([PERMISSION_KEY.VIEW_FINANCE_DASHBOARD]) };
  const original = Object.getOwnPropertyDescriptor(prisma, "bill");
  t.after(() => (original ? Object.defineProperty(prisma, "bill", original) : Reflect.deleteProperty(prisma, "bill")));
  const bill = (billNumber: string, dueDate: Date | null) => ({
    id: billNumber, billNumber, supplier: { name: "Selvam Enterprises" }, status: "approved", billDate: d("2026-09-01T00:00:00Z"),
    dueDate, subtotal: "1000", taxAmount: "180", total: "1180", payments: [], rejectedReason: null,
  });
  Object.defineProperty(prisma, "bill", {
    configurable: true,
    value: { findMany: async () => [bill("TXIN0934", d("2020-01-01T00:00:00Z")), bill("SE/1", null)] },
  });
  const all = (await tool.handler({}, auth)) as any;
  assert.equal(all.overdueCount, 1);
  assert.equal(all.noDueDateCount, 1);
  const se1 = all.bills.find((b: any) => b.billNumber === "SE/1");
  assert.deepEqual([se1.dueStatus, se1.overdue, se1.daysOverdue, se1.ageingBasis], ["no_due_date", false, 0, "aged by bill date (no due date)"]);
  const overdue = (await tool.handler({ overdueOnly: true }, auth)) as any;
  assert.deepEqual(overdue.bills.map((b: any) => b.billNumber), ["TXIN0934"]);
});

test("search_vendor_bills 'all bills': overdue bills carry a dueNote; no-due-date, rejected and paid never do", async (t) => {
  const tool = zanAppFinanceTools.find((x) => x.name === "search_vendor_bills")!;
  const auth = { userId: "f", roleKey: "finance", permissions: new Set([PERMISSION_KEY.VIEW_FINANCE_DASHBOARD]) };
  const original = Object.getOwnPropertyDescriptor(prisma, "bill");
  t.after(() => (original ? Object.defineProperty(prisma, "bill", original) : Reflect.deleteProperty(prisma, "bill")));
  const bill = (billNumber: string, status: string, dueDate: Date | null) => ({
    id: billNumber, billNumber, supplier: { name: "Platino" }, status, billDate: d("2020-01-01T00:00:00Z"),
    dueDate, subtotal: "1000", taxAmount: "180", total: "1180", payments: [], rejectedReason: null,
  });
  Object.defineProperty(prisma, "bill", {
    configurable: true,
    value: {
      findMany: async () => [
        bill("TXIN0934", "approved", d("2020-01-01T00:00:00Z")),
        bill("R/1", "rejected", d("2020-01-01T00:00:00Z")),
        bill("P/1", "paid", d("2020-01-01T00:00:00Z")),
        bill("N/1", "approved", null),
        bill("F/1", "approved", d("2999-01-01T00:00:00Z")),
      ],
    },
  });
  const out = (await tool.handler({}, auth)) as any;
  const note = (n: string) => out.bills.find((b: any) => b.billNumber === n).dueNote;
  assert.match(note("TXIN0934"), /^TXIN0934 overdue by \d+ days$/);
  assert.equal(note("R/1"), null);
  assert.equal(note("P/1"), null);
  assert.equal(note("N/1"), "no due date");
  assert.equal(note("F/1"), "not yet due");
  assert.equal(out.overdueBills.length, 1);
  assert.equal(out.overdueBills[0], note("TXIN0934"));
});
