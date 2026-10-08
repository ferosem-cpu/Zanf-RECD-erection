import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../src/lib/prisma";
import { settledFromAllocations } from "../src/services/settlement";
import { summarizeReceivables, zanAppFinanceTools, RECEIVABLES_BASIS, type ReceivableInvoiceRow } from "../src/agent/tools/zanAppFinanceTools";
import { exclGstPortion, summarizeInvoices, sumMoney } from "../src/agent/tools/zanAppReadTools";
import { ageingBucket } from "../src/services/ageing";

const NOW = new Date("2026-10-08T06:00:00Z");
const settled = (allocs: Array<[number, number, number]>) =>
  Number(settledFromAllocations(allocs.map(([amount, payAmount, tds]) => ({ amount: String(amount), payment: { amount: String(payAmount), tdsAmount: String(tds) } }))));

/** Mixed GST rates, a partial payment with TDS, an issued credit note, a legacy "TDS Deducted"
 * allocation and an unpaid proforma. */
function fixture(): ReceivableInvoiceRow[] {
  return [
    {
      // 1,00,000 @ 18% + 1,00,000 @ 5% = 2,00,000 taxable + 23,000 GST.
      id: "i1", invoiceNumber: "INV/2026-27/0001", docType: "tax_invoice", customerId: "a", customer: "Acme",
      issueDate: new Date("2026-08-01T00:00:00Z"), dueDate: new Date("2026-08-31T00:00:00Z"),
      subtotal: 200000, total: 223000, creditNoteTotal: 11150,
      settled: settled([[100000, 100000, 2000]]), // 1,00,000 cash + 2,000 TDS
    },
    {
      id: "i2", invoiceNumber: "INV/2026-27/0002", docType: "tax_invoice", customerId: "a", customer: "Acme",
      issueDate: new Date("2026-09-15T00:00:00Z"), dueDate: new Date("2026-10-15T00:00:00Z"),
      subtotal: 100000, total: 118000, creditNoteTotal: 0,
      settled: settled([[2000, 2000, 0]]), // legacy "TDS Deducted" receipt allocated: 2,000 settled
    },
    {
      id: "p1", invoiceNumber: "PI/2026-27/0003", docType: "proforma", customerId: "b", customer: "Bostik",
      issueDate: new Date("2026-10-01T00:00:00Z"), dueDate: null,
      subtotal: 50000, total: 59000, creditNoteTotal: 0, settled: 0,
    },
  ];
}

test("receivables incl. GST = total - credit notes - receipts - TDS (settlement.ts)", () => {
  const out = summarizeReceivables(fixture(), NOW);
  // i1: 223000 - 11150 - 102000 = 109850; i2: 118000 - 2000 = 116000; p1: 59000.
  assert.equal(out.totals.outstandingInclGst, 109850 + 116000 + 59000);
  assert.equal(out.totals.invoiceCount, 3);
  assert.equal(out.byDocType.proforma.outstandingInclGst, 59000);
  assert.equal(out.totals.overdueCount, 1); // only i1 is past its due date
  assert.equal(out.totals.overdueInclGst, 109850);
});

test("excl. GST follows the documented basis: each invoice's outstanding x subtotal/total", () => {
  const out = summarizeReceivables(fixture(), NOW);
  const byNumber = Object.fromEntries(out.invoices.map((i) => [i.invoiceNumber, i]));
  assert.equal(byNumber["INV/2026-27/0001"].outstandingExclGst, 98520.18); // 109850 x 200000/223000
  assert.equal(byNumber["INV/2026-27/0002"].outstandingExclGst, 98305.08); // 116000 / 1.18
  assert.equal(byNumber["PI/2026-27/0003"].outstandingExclGst, 50000);
  assert.equal(out.totals.outstandingExclGst, sumMoney([98520.18, 98305.08, 50000]));
  assert.match(RECEIVABLES_BASIS, /taxable share \(subtotal \/ total\)/);
});

test("sanity: incl. >= excl. for totals and every customer, and incl - excl = the GST portion", () => {
  const out = summarizeReceivables(fixture(), NOW);
  assert.ok(out.totals.outstandingInclGst >= out.totals.outstandingExclGst);
  assert.equal(out.totals.gstPortion, sumMoney([out.totals.outstandingInclGst, -out.totals.outstandingExclGst]));
  // GST portion is close to each invoice's own GST share (18% / mixed 11.5%).
  assert.ok(Math.abs(out.totals.gstPortion - (109850 * 23000 / 223000 + 116000 * 18 / 118 + 9000)) < 0.05);
  for (const c of out.byCustomer) {
    assert.ok(c.outstandingInclGst >= c.outstandingExclGst, c.customer);
    assert.equal(c.gstPortion, sumMoney([c.outstandingInclGst, -c.outstandingExclGst]));
  }
  assert.deepEqual(out.byCustomer.map((c) => [c.customer, c.outstandingInclGst, c.outstandingExclGst]), [
    ["Acme", 225850, 196825.26],
    ["Bostik", 59000, 50000],
  ]);
  const ageing = Object.values(out.ageingInclGst).reduce((s, n) => s + n, 0);
  assert.equal(Math.round(ageing * 100), Math.round(out.totals.outstandingInclGst * 100));
});

test("overdue list names every overdue invoice with due date, balance and days overdue", () => {
  const out = summarizeReceivables(fixture(), NOW);
  assert.deepEqual(out.overdueInvoices, [
    { id: "i1", invoiceNumber: "INV/2026-27/0001", customer: "Acme", dueDate: "2026-08-31", balanceInclGst: 109850, balanceExclGst: 98520.18, daysOverdue: 38 },
  ]);
  assert.equal(out.overdueListComplete, true);
});

test("receivables ageing uses the Finance report's buckets (services/ageing.ts)", () => {
  const out = summarizeReceivables(fixture(), NOW);
  // i1 due 31 Aug -> 31-60; i2 due 15 Oct -> current; p1 (no due date, issued 01 Oct) -> 0-30.
  assert.deepEqual(out.ageingInclGst, { current: 116000, days0_30: 59000, days31_60: 109850, days61_90: 0, days90Plus: 0 });
  assert.equal(ageingBucket(new Date("2026-08-31T00:00:00Z"), NOW).bucket, "days31_60");
});

test("exclGstPortion edge cases and search_invoices carries the same excl.-GST total", () => {
  assert.equal(exclGstPortion(118, 100, 118), 100);
  assert.equal(exclGstPortion(50, 0, 0), 50);
  assert.equal(exclGstPortion(0, 100, 118), 0);
  const row = (status: string, balance: number, balanceExclGst: number) => ({
    status, dueDate: null, total: balance, creditNoteTotal: 0, netTotal: balance, amountPaid: 0, balance, balanceExclGst, overdue: false,
  });
  const out = summarizeInvoices([row("issued", 118000, 100000), row("partially_paid", 59000, 50000), row("draft", 1180, 1000)], 15, { overdueOnly: false });
  assert.equal(out.totals.outstandingBalance, 177000);
  assert.equal(out.totals.outstandingBalanceExclGst, 150000);
});

test("get_receivables returns asOf + basis from the same rows, refuses customers", async (t) => {
  const tool = zanAppFinanceTools.find((x) => x.name === "get_receivables")!;
  const replace = (key: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(prisma, key, original);
      else Reflect.deleteProperty(prisma, key);
    });
  };
  const D = (n: number) => new Prisma.Decimal(n);
  replace("invoice", {
    findMany: async (args: any) => {
      assert.deepEqual(args.where.status, { in: ["issued", "partially_paid"] });
      return [{
        id: "i2", invoiceNumber: "INV/2026-27/0002", docType: "tax_invoice", customerId: "a", issueDate: new Date("2026-09-15T00:00:00Z"),
        dueDate: null, subtotal: D(100000), total: D(118000), customer: { name: "Acme" },
        paymentAllocations: [{ amount: D(50000), payment: { amount: D(50000), tdsAmount: D(1000) } }],
        creditNotes: [{ total: D(5900) }],
      }];
    },
  });
  const finance = { userId: "f", roleKey: "finance", permissions: new Set([PERMISSION_KEY.VIEW_FINANCE_DASHBOARD]) };
  const res: any = await tool.handler({}, finance);
  assert.match(res.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(res.basis, RECEIVABLES_BASIS);
  assert.equal(res.totals.outstandingInclGst, 61100); // 118000 - 5900 - 50000 - 1000
  assert.equal(res.totals.outstandingExclGst, 51779.66); // 61100 / 1.18
  assert.ok(res.totals.outstandingInclGst >= res.totals.outstandingExclGst);

  const customer = { userId: "c", roleKey: "customer", customerId: "a", permissions: new Set([PERMISSION_KEY.VIEW_FINANCE_DASHBOARD]) };
  assert.match((await tool.handler({}, customer) as any).error, /permission/);
});
