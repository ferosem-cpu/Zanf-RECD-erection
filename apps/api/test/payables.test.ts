import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../src/lib/prisma";
import { PAYABLE_BILL_STATUSES, billOutstanding, summarizePayables, isPayableStatus, type PayableBillRow } from "../src/services/payables";
import { ageingBucket } from "../src/services/ageing";
import { poVsBillsByVendor, resolveBillStatusFilter, zanAppFinanceTools } from "../src/agent/tools/zanAppFinanceTools";

const NOW = new Date("2026-10-08T06:00:00Z");
const bill = (status: string, total: number, paid: number, over: Partial<PayableBillRow> = {}): PayableBillRow => ({
  id: `${status}-${total}`, billNumber: `${status}/${total}`, supplierId: "s", supplier: "Platino Automotive", status,
  billDate: new Date("2026-09-01T00:00:00Z"), dueDate: null, total, paid, debitNotes: 0, ...over,
});

test("shared payables rule: Verified + Approved + Partially Paid counted; Uploaded, Rejected, Paid, Cancelled excluded", () => {
  assert.deepEqual(PAYABLE_BILL_STATUSES, ["verified", "approved", "partially_paid"]);
  const out = summarizePayables([
    bill("verified", 100000, 0), bill("verified", 50000, 0), bill("verified", 25000, 0), // Platino's 3 unpaid verified bills
    bill("partially_paid", 59000, 9000, { supplierId: "sel", supplier: "Selvam Enterprises" }),
    bill("approved", 10000, 0),
    bill("rejected", 99999, 0), bill("paid", 5000, 5000), bill("uploaded", 7000, 0), bill("cancelled", 3000, 0),
  ], NOW);
  assert.equal(out.totalOutstanding, 100000 + 50000 + 25000 + 50000 + 10000);
  assert.equal(out.billCount, 5);
  assert.deepEqual(out.byStatus, {
    verified: { count: 3, outstanding: 175000 },
    partially_paid: { count: 1, outstanding: 50000 },
    approved: { count: 1, outstanding: 10000 },
  });
  assert.deepEqual(out.byVendor.map((v) => [v.supplier, v.outstanding]), [["Platino Automotive", 185000], ["Selvam Enterprises", 50000]]);
  assert.equal(isPayableStatus("rejected"), false);
  assert.equal(billOutstanding("118000.00", [{ amount: "18000.50" }]), 99999.5);
});

test("Finance dashboard uses the shared payables helper (no private status list left)", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/routes/financeDashboard.ts", import.meta.url), "utf8");
  assert.match(src, /from "\.\.\/services\/payables"/);
  assert.equal((src.match(/status: \{ in: PAYABLE_BILL_STATUSES \}/g) ?? []).length, 2); // summary KPI + ageing report
  assert.doesNotMatch(src, /BILL_STATUS\.APPROVED, BILL_STATUS\.PARTIALLY_PAID\]/);
});

test("vendor bill status filter: labels, any case, lists, 'unpaid', unknown values reported", () => {
  assert.deepEqual(resolveBillStatusFilter("Partially Paid").statuses, ["partially_paid"]);
  assert.deepEqual(resolveBillStatusFilter("VERIFIED, rejected").statuses, ["verified", "rejected"]);
  assert.deepEqual(resolveBillStatusFilter("unpaid").statuses, ["verified", "approved", "partially_paid"]);
  assert.equal(resolveBillStatusFilter(undefined).statuses, undefined);
  assert.deepEqual(resolveBillStatusFilter("overdue-ish").unknown, ["overdue-ish"]);
});

test("PO vs bills per vendor: PO value, billed, paid, balance, open commitment", () => {
  const [platino] = poVsBillsByVendor([{
    supplierId: "p", supplier: "Platino Automotive",
    pos: [{ total: 418900, status: "issued", billedAgainst: 100000 }, { total: 50000, status: "closed", billedAgainst: 50000 }],
    bills: [{ total: 100000, paid: 0, status: "verified" }, { total: 50000, paid: 50000, status: "paid" }],
  }]);
  assert.deepEqual(platino, {
    supplierId: "p", supplier: "Platino Automotive", poCount: 2, poValue: 468900, billCount: 2,
    billedTotal: 150000, paidTotal: 50000, billBalance: 100000, openPoCommitment: 318900,
  });
});

test("search_vendor_bills: status + tolerant vendor filters reach the query; totals cover every match", async (t) => {
  const tool = zanAppFinanceTools.find((x) => x.name === "search_vendor_bills")!;
  const replace = (key: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(prisma, key, original);
      else Reflect.deleteProperty(prisma, key);
    });
  };
  replace("supplier", { findMany: async () => [{ id: "sel", name: "Selvam Enterprises" }, { id: "p", name: "Platino Automotive" }] });
  const wheres: any[] = [];
  const rows = Array.from({ length: 17 }, (_, i) => ({
    id: `b${i}`, billNumber: `PA/${i}`, status: "verified", supplier: { name: "Platino Automotive" },
    billDate: new Date("2026-09-27T18:30:00Z"), dueDate: new Date("2026-09-30T18:30:00Z"),
    subtotal: "1000.00", taxAmount: "180.00", total: "1180.00", payments: [], rejectedReason: null,
  }));
  replace("bill", { findMany: async (args: any) => { wheres.push(args.where); return rows; } });
  const auth = { userId: "f", roleKey: "finance", permissions: new Set([PERMISSION_KEY.APPROVE_VENDOR_INVOICE]) };

  const res: any = await tool.handler({ supplier: "platino", status: "Verified" }, auth);
  assert.deepEqual(wheres[0], { status: { in: ["verified"] }, supplierId: { in: ["p"] } });
  assert.equal(res.totalCount, 17);
  assert.equal(res.bills.length, 15);
  assert.equal(res.complete, false);
  assert.deepEqual(res.totals, { count: 17, totalAmount: 20060, taxableAmount: 17000, gstAmount: 3060, paid: 0, outstanding: 20060 });
  assert.equal(res.bills[0].billDate, "2026-09-28"); // IST, not the UTC day before
  // The tool ages against the real clock, so the expected day count does too.
  assert.equal(res.bills[0].daysOverdue, ageingBucket(new Date("2026-09-30T18:30:00Z"), new Date()).daysPastDue);
  assert.ok(res.bills[0].daysOverdue >= 8);

  await tool.handler({}, auth);
  assert.deepEqual(wheres[1], { status: { not: "deleted" } });
  const bad: any = await tool.handler({ status: "lost" }, auth);
  assert.match(bad.error, /Unknown vendor invoice status "lost"/);
  const customer = { userId: "c", roleKey: "customer", customerId: "x", permissions: new Set([PERMISSION_KEY.APPROVE_VENDOR_INVOICE]) };
  assert.match((await tool.handler({}, customer) as any).error, /permission/);
});
