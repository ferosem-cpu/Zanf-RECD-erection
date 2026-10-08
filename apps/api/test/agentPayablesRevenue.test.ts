import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../src/lib/prisma";
import {
  supplierNameMatches, summarizePayables, ageingBucket, indianFyQuarter, resolveRevenuePeriod, summarizeRevenue,
  zanAppFinanceTools, PAYABLE_BILL_STATUSES, type PayableBillRow,
} from "../src/agent/tools/zanAppFinanceTools";

const NOW = new Date("2026-10-08T06:00:00Z");

test("supplier matching tolerates case, punctuation, partial names and 'Ent.' vs 'Enterprises'", () => {
  for (const q of ["selvam", "Selvam Enterprises", "SELVAM ENT.", "selvam ent", "M/s. Selvam Enterprises", "selvam-enterprises", "Selvam Entps"]) {
    assert.ok(supplierNameMatches(q, "Selvam Enterprises"), q);
  }
  assert.ok(supplierNameMatches("platino", "Platino Automotive Pvt. Ltd."));
  assert.ok(supplierNameMatches("Platino Automotive Private Limited", "Platino Automotive Pvt. Ltd."));
  assert.equal(supplierNameMatches("selvam", "Platino Automotive"), false);
  assert.equal(supplierNameMatches("kumar enterprises", "Selvam Enterprises"), false);
});

test("ageing buckets match the payables report (days past due date, else bill date)", () => {
  const d = (s: string) => new Date(s);
  assert.equal(ageingBucket(d("2026-10-20T00:00:00Z"), NOW).bucket, "current");
  assert.equal(ageingBucket(d("2026-09-20T00:00:00Z"), NOW).bucket, "days0_30");
  assert.equal(ageingBucket(d("2026-08-20T00:00:00Z"), NOW).bucket, "days31_60");
  assert.equal(ageingBucket(d("2026-07-20T00:00:00Z"), NOW).bucket, "days61_90");
  assert.equal(ageingBucket(d("2026-01-01T00:00:00Z"), NOW).bucket, "days90Plus");
  assert.equal(ageingBucket(d("2026-10-20T00:00:00Z"), NOW).daysPastDue, 0);
});

test("payables = approved/partially paid bills minus payments; fully paid bills drop out; per-vendor + ageing add up", () => {
  const bill = (over: Partial<PayableBillRow>): PayableBillRow => ({
    id: "b", billNumber: "B", supplierId: "s1", supplier: "Selvam Enterprises", status: "approved",
    billDate: new Date("2026-09-01T00:00:00Z"), dueDate: null, total: 0, paid: 0, debitNotes: 0, ...over,
  });
  const out = summarizePayables([
    bill({ id: "1", billNumber: "SE/101", total: 118000, paid: 0, dueDate: new Date("2026-09-15T00:00:00Z") }),
    bill({ id: "2", billNumber: "SE/102", status: "partially_paid", total: 59000, paid: 20000.5 }),
    bill({ id: "3", billNumber: "PA/9", supplierId: "s2", supplier: "Platino Automotive", total: 418900, paid: 0, dueDate: new Date("2026-11-01T00:00:00Z") }),
    bill({ id: "4", billNumber: "PA/8", supplierId: "s2", supplier: "Platino Automotive", status: "partially_paid", total: 1000, paid: 1000 }),
  ], NOW);
  assert.equal(out.billCount, 3);
  assert.equal(out.totalOutstanding, 118000 + 38999.5 + 418900);
  assert.deepEqual(out.byVendor.map((v) => [v.supplier, v.billCount, v.outstanding]), [
    ["Platino Automotive", 1, 418900],
    ["Selvam Enterprises", 2, 156999.5],
  ]);
  const ageingTotal = Object.values(out.ageing).reduce((s, n) => s + n, 0);
  assert.equal(Math.round(ageingTotal * 100), Math.round(out.totalOutstanding * 100));
  assert.equal(out.ageing.current, 418900);
  assert.equal(out.overdueCount, 2);
  assert.equal(out.dueList[0].billNumber, "SE/102"); // anchored on bill date 2026-09-01: most overdue
  assert.equal(out.dueList.at(-1)!.billNumber, "PA/9"); // not yet due
  assert.deepEqual(PAYABLE_BILL_STATUSES, ["verified", "approved", "partially_paid"]);
});

test("Indian FY quarters: 2026-10-08 is FY 2026-27 Q3 (01 Oct - 31 Dec 2026)", () => {
  assert.deepEqual(indianFyQuarter("2026-10-08"), { fy: "2026-27", quarter: 3, from: "2026-10-01", to: "2026-12-31" });
  assert.deepEqual(indianFyQuarter("2026-04-01"), { fy: "2026-27", quarter: 1, from: "2026-04-01", to: "2026-06-30" });
  assert.deepEqual(indianFyQuarter("2026-09-30"), { fy: "2026-27", quarter: 2, from: "2026-07-01", to: "2026-09-30" });
  assert.deepEqual(indianFyQuarter("2027-02-28"), { fy: "2026-27", quarter: 4, from: "2027-01-01", to: "2027-03-31" });
  assert.deepEqual(indianFyQuarter("2026-03-31"), { fy: "2025-26", quarter: 4, from: "2026-01-01", to: "2026-03-31" });
});

test("revenue periods resolve to explicit dates", () => {
  const today = "2026-10-08";
  assert.deepEqual(resolveRevenuePeriod({}, today), { label: "FY 2026-27 Q3 to date (current quarter)", from: "2026-10-01", to: "2026-10-08" });
  assert.deepEqual(resolveRevenuePeriod({ period: "last quarter" }, today), { label: "FY 2026-27 Q2 (previous quarter)", from: "2026-07-01", to: "2026-09-30" });
  assert.deepEqual(resolveRevenuePeriod({ period: "this_month" }, today), { label: "2026-10 to date (current month)", from: "2026-10-01", to: "2026-10-08" });
  assert.deepEqual(resolveRevenuePeriod({ period: "last_month" }, today), { label: "2026-09 (previous month)", from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(resolveRevenuePeriod({ period: "this_fy" }, today), { label: "FY 2026-27 to date (current financial year)", from: "2026-04-01", to: "2026-10-08" });
  assert.deepEqual(resolveRevenuePeriod({ period: "FY to date" }, today), { label: "FY 2026-27 to date (current financial year)", from: "2026-04-01", to: "2026-10-08" });
  assert.deepEqual(resolveRevenuePeriod({ period: "all time" }, today), { label: "All time to date (total invoiced)", from: "2000-01-01", to: "2026-10-08" });
  assert.equal(resolveRevenuePeriod({ period: "last_quarter" }, "2026-05-10").hasOwnProperty("error"), false);
  assert.deepEqual(resolveRevenuePeriod({ period: "last_quarter" }, "2026-05-10"), { label: "FY 2025-26 Q4 (previous quarter)", from: "2026-01-01", to: "2026-03-31" });
  assert.deepEqual(resolveRevenuePeriod({ from: "2026-07-01", to: "2026-09-30" }, today), { label: "2026-07-01 to 2026-09-30", from: "2026-07-01", to: "2026-09-30" });
  assert.ok("error" in resolveRevenuePeriod({ from: "2026-07-01" }, today));
  assert.ok("error" in resolveRevenuePeriod({ period: "fortnight" }, today));
});

test("revenue: invoiced excl. GST net of credit notes; collected = cash, TDS and settled total", () => {
  const out = summarizeRevenue(
    [{ subtotal: 100000, gst: 18000, total: 118000 }, { subtotal: 50000, gst: 9000, total: 59000 }],
    [{ subtotal: 10000, gst: 1800, total: 11800 }],
    [
      { amount: 100000, tdsAmount: 2000, method: "bank_transfer" },
      { amount: 3000, tdsAmount: 0, method: "tds" }, // legacy "TDS Deducted" row
    ],
  );
  assert.equal(out.invoiced.netExclGst, 140000);
  assert.equal(out.invoiced.netGst, 25200);
  assert.equal(out.invoiced.netInclGst, 165200);
  assert.equal(out.invoiced.invoiceCount, 2);
  assert.equal(out.collected.cashReceived, 100000);
  assert.equal(out.collected.tdsDeducted, 5000); // 2000 tdsAmount + the whole legacy "tds" row
  assert.equal(out.collected.settledTotal, 105000);
  assert.match(out.collected.basis, /settledTotal = cash \+ TDS/);
  assert.match(out.invoiced.basis, /net of issued credit notes/);
  assert.match(out.collected.basis, /Finance dashboard/);
});

test("get_payables and get_revenue_summary refuse customers and users without finance permissions", async () => {
  const [payables, revenue] = ["get_payables", "get_revenue_summary"].map((n) => zanAppFinanceTools.find((t) => t.name === n)!);
  const customer = { userId: "c", roleKey: "customer", customerId: "cust1", permissions: new Set([PERMISSION_KEY.VIEW_FINANCE_DASHBOARD]) };
  const sales = { userId: "s", roleKey: "sales", permissions: new Set([PERMISSION_KEY.MANAGE_ORDERS]) };
  for (const auth of [customer, sales]) {
    assert.match((await payables.handler({}, auth) as any).error, /permission/);
    assert.match((await revenue.handler({}, auth) as any).error, /permission/);
  }
});

test("get_payables: tolerant supplier filter, separate POs/awaiting approval, unknown supplier lists names", async (t) => {
  const tool = zanAppFinanceTools.find((x) => x.name === "get_payables")!;
  const auth = { userId: "f", roleKey: "finance", permissions: new Set([PERMISSION_KEY.VIEW_FINANCE_DASHBOARD]) };
  const replace = (key: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(prisma, key, original);
      else Reflect.deleteProperty(prisma, key);
    });
  };
  replace("supplier", { findMany: async () => [{ id: "s1", name: "Selvam Enterprises" }, { id: "s2", name: "Platino Automotive" }] });
  const billWheres: any[] = [];
  replace("bill", {
    findMany: async (args: any) => {
      billWheres.push(args.where);
      assert.deepEqual(args.where.status, { notIn: ["rejected", "cancelled", "deleted"] });
      return [{
        id: "b1", billNumber: "SE/101", supplierId: "s1", supplier: { name: "Selvam Enterprises" }, status: "partially_paid",
        billDate: new Date("2026-09-01T00:00:00Z"), dueDate: null, total: "118000.00", payments: [{ amount: "18000.00" }], debitNotes: [],
      }];
    },
  });
  replace("purchaseOrder", {
    findMany: async () => [{
      id: "po1", poNumber: "PO/2026-27/0007", status: "issued", orderDate: new Date("2026-09-10T00:00:00Z"), total: "418900.00",
      supplierId: "s2", supplier: { name: "Platino Automotive" }, bills: [],
    }],
  });
  replace("paymentMade", { findMany: async () => [] });

  const res: any = await tool.handler({ supplier: "selvam ent." }, auth);
  assert.deepEqual(res.matchedSuppliers, ["Selvam Enterprises"]);
  assert.deepEqual(billWheres[0].supplierId, { in: ["s1"] });
  assert.equal(res.totalOutstanding, 100000);
  assert.equal(res.byVendor[0].supplier, "Selvam Enterprises");
  assert.match(res.openPurchaseOrders.note, /COMMITMENTS, not payables/);
  assert.equal(res.openPurchaseOrders.notYetBilled, 418900);
  assert.match(res.basis, /approved or partially_paid/);

  const missing: any = await tool.handler({ supplier: "Kumar Traders" }, auth);
  assert.match(missing.error, /No supplier matches/);
  assert.ok(missing.suppliers.includes("Selvam Enterprises"));
});

test("get_revenue_summary counts tax invoices only; proformas are excluded and the rule is stated", async (t) => {
  const tool = zanAppFinanceTools.find((x) => x.name === "get_revenue_summary")!;
  const auth = { userId: "f", roleKey: "finance", permissions: new Set([PERMISSION_KEY.VIEW_FINANCE_DASHBOARD]) };
  const replace = (key: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(prisma, key, original);
      else Reflect.deleteProperty(prisma, key);
    });
  };
  const rows = [
    { docType: "tax_invoice", subtotal: "100000.00", cgstAmount: "9000.00", sgstAmount: "9000.00", igstAmount: "0", total: "118000.00" },
    { docType: "proforma", subtotal: "500000.00", cgstAmount: "45000.00", sgstAmount: "45000.00", igstAmount: "0", total: "590000.00" },
  ];
  const invoiceWheres: any[] = [];
  replace("invoice", {
    findMany: async (args: any) => {
      invoiceWheres.push(args.where);
      return rows.filter((r) => r.docType === args.where.docType);
    },
    count: async (args: any) => rows.filter((r) => r.docType === args.where.docType).length,
  });
  replace("creditNote", { findMany: async () => [] });
  replace("paymentReceived", {
    findMany: async () => [
      { amount: "50000.00", tdsAmount: "1000.00", method: "neft" },
      { amount: "2000.00", tdsAmount: "0", method: "tds" },
    ],
  });

  const res: any = await tool.handler({ period: "this_fy" }, auth);
  assert.deepEqual(
    [res.collected.cashReceived, res.collected.tdsDeducted, res.collected.settledTotal],
    [50000, 3000, 53000],
  );
  assert.match(res.answerRule, /cash \+ TDS = settled total/);
  assert.equal(invoiceWheres[0].docType, "tax_invoice");
  assert.equal(res.invoiced.invoiceCount, 1);
  assert.equal(res.invoiced.netExclGst, 100000);
  assert.equal(res.invoiced.netInclGst, 118000);
  assert.equal(res.proformaInvoicesInPeriod.count, 1);
  assert.match(res.revenueRule, /tax invoices only; proforma invoices are excluded/);
  assert.match(res.answerRule, /tax invoices only, proformas excluded/);
  assert.match(tool.description, /proforma/);
});
