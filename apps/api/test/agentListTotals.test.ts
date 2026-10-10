import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeOrders, isOrderOpen, orderOpenWhere, resolveOpenCutoff, summarizeInvoices, resolveInvoiceFilter, invoiceStatusWhere,
  summarizePayments, isoDateIST, istDayStart, statusBreakdown, sumMoney, type OrderSummaryRow,
} from "../src/agent/tools/zanAppReadTools";
import { annotateListResult, listMeta, listPage, LIST_LIMIT, truncatedListNote } from "../src/agent/listResult";

const COMMISSIONED = 11; // commissioned in the seed
const FINAL = 12; // customer_signoff in the seed
const stage = (sequenceOrder: number) => ({ label: `Stage ${sequenceOrder}`, sequenceOrder });

/** 21 orders, 12 open (3 at Commissioned + 6 at customer sign-off = 9 closed). */
function productionOrders(): OrderSummaryRow[] {
  const rows: OrderSummaryRow[] = [];
  for (let i = 0; i < 21; i++) {
    rows.push({
      value: i === 20 ? null : 100000 + i * 1000.5,
      quantity: 1,
      product: i % 2 ? "RECD (RECD-500)" : "RECD (RECD-380)",
      lineItems: i === 3 ? [{ product: "RECD (RECD-500)", quantity: 2 }] : [],
      stage: i < 3 ? stage(COMMISSIONED) : i < 9 ? stage(FINAL) : i < 11 ? null : stage((i % 11) + 1),
    });
  }
  return rows;
}

test("order totals cover all 21 orders, not the first 15", () => {
  const rows = productionOrders();
  const out = summarizeOrders(rows, COMMISSIONED);
  assert.equal(out.count, 21);
  assert.equal(out.openCount, 12);
  assert.equal(out.completedCount, 9);
  assert.equal(out.ordersWithoutValue, 1);
  // Server totals match the rows exactly.
  const expectedValue = sumMoney(rows.map((r) => r.value));
  assert.equal(out.totalValue, expectedValue);
  assert.equal(out.totalValue, 2190095); // 20 x 100000 + 1000.5 x (0+..+19)
  const open = rows.filter((r) => isOrderOpen(r.stage?.sequenceOrder ?? null, COMMISSIONED));
  assert.equal(out.openValue, sumMoney(open.map((r) => r.value)));
  assert.equal(out.totalUnits, 23);
  assert.deepEqual(out.unitsByProduct, [
    { product: "RECD (RECD-500)", units: 12 },
    { product: "RECD (RECD-380)", units: 11 },
  ]);
  assert.equal(out.byStage.reduce((s, b) => s + b.count, 0), 21);
  assert.equal(out.byStage[0].stage, "No site yet");
  assert.equal(sumMoney(out.byStage.map((b) => b.value)), out.totalValue);
});

test("open = no site yet, or site before the Commissioned SITC stage", () => {
  assert.equal(isOrderOpen(null, COMMISSIONED), true); // no site
  assert.equal(isOrderOpen(1, COMMISSIONED), true);
  assert.equal(isOrderOpen(10, COMMISSIONED), true); // commissioning (before Commissioned)
  assert.equal(isOrderOpen(11, COMMISSIONED), false); // at Commissioned
  assert.equal(isOrderOpen(12, COMMISSIONED), false); // after (customer sign-off)
  assert.equal(isOrderOpen(5, null), true);
  assert.deepEqual(orderOpenWhere(COMMISSIONED), {
    OR: [{ site: { is: null } }, { site: { is: { currentStage: { sequenceOrder: { lt: COMMISSIONED } } } } }],
  });
});

test("open cutoff: Commissioned stage, else final stage fallback, else everything open", () => {
  const commissioned = { label: "Commissioned", sequenceOrder: COMMISSIONED };
  const signoff = { label: "Customer sign-off", sequenceOrder: FINAL };
  const found = resolveOpenCutoff(commissioned, signoff);
  assert.equal(found.closedFromSeq, COMMISSIONED);
  assert.match(found.openDefinition, /"Commissioned" SITC stage \(Commissioned or later\)/);
  const fallback = resolveOpenCutoff(null, signoff);
  assert.equal(fallback.closedFromSeq, FINAL);
  assert.match(fallback.openDefinition, /No "Commissioned" SITC stage is configured/);
  const none = resolveOpenCutoff(null, null);
  assert.equal(none.closedFromSeq, null);
  assert.equal(isOrderOpen(11, none.closedFromSeq), true);
});

test("completeness comes from a real count: exactly 15 complete rows are not flagged", () => {
  const fifteen = Array.from({ length: LIST_LIMIT }, (_, i) => ({ i }));
  const exact = listPage(fifteen, 15);
  assert.equal(exact.complete, true);
  assert.equal(annotateListResult(exact), exact); // no note added
  const bare = annotateListResult(fifteen) as { complete: boolean; totalCount: number; note?: string };
  assert.equal(bare.complete, true);
  assert.equal(bare.totalCount, 15);
  assert.equal(bare.note, undefined);

  const capped = listPage(fifteen, 21);
  assert.deepEqual({ complete: capped.complete, totalCount: capped.totalCount, returnedCount: capped.returnedCount }, { complete: false, totalCount: 21, returnedCount: 15 });
  const annotated = annotateListResult(capped) as { note: string };
  assert.equal(annotated.note, truncatedListNote(15, 21));
  assert.match(annotated.note, /15 of 21/);

  assert.deepEqual(listMeta(3, 3), { complete: true, totalCount: 3, returnedCount: 3 });
  // A row added between the page query and the count query can't produce total < listed.
  assert.deepEqual(listMeta(4, 3), { complete: true, totalCount: 4, returnedCount: 4 });
});

test("invoice totals cover every matching invoice and match the rows (incl. the 16th)", () => {
  const rows = Array.from({ length: 16 }, (_, i) => {
    const status = i < 11 ? "issued" : i < 13 ? "partially_paid" : i < 15 ? "paid" : "draft";
    const total = 10000 + i * 0.01;
    const amountPaid = status === "paid" ? total : status === "partially_paid" ? 2500 : 0;
    const creditNoteTotal = i === 2 ? 1000 : 0;
    const netTotal = total - creditNoteTotal;
    return { id: `i${i}`, status, dueDate: null, total, creditNoteTotal, netTotal, amountPaid, balance: netTotal - amountPaid, overdue: false };
  });
  const out = summarizeInvoices(rows, LIST_LIMIT, { overdueOnly: false });
  assert.equal(out.complete, false);
  assert.equal(out.totalCount, 16);
  assert.equal(out.invoices.length, 15);
  assert.equal(out.totals.count, 16);
  assert.equal(out.totals.totalAmount, sumMoney(rows.map((r) => r.total)));
  assert.equal(out.totals.totalAmount, 160001.2);
  assert.equal(out.totals.creditNoteTotal, 1000);
  assert.equal(out.totals.netTotal, 159001.2);
  // Outstanding = issued + partially_paid balances only (drafts aren't owed), like the dashboard.
  const receivable = rows.filter((r) => r.status === "issued" || r.status === "partially_paid");
  assert.equal(out.totals.outstandingBalance, sumMoney(receivable.map((r) => r.balance)));
  assert.equal(out.byStatus.issued.count, 11);
  assert.equal(out.byStatus.issued.totalAmount, sumMoney(rows.slice(0, 11).map((r) => r.total)));
  assert.equal(out.byStatus.draft.count, 1);
  assert.equal("overdueCount" in out, false);
});

test("invoice totals carry taxable value (excl. GST) and GST, adding up to the incl.-GST total", () => {
  const rows = Array.from({ length: 16 }, (_, i) => ({
    id: `i${i}`, status: "issued", dueDate: null, taxableValue: 10000, gstAmount: 1800, total: 11800,
    creditNoteTotal: 0, netTotal: 11800, amountPaid: 0, balance: 11800, overdue: false,
  }));
  const out = summarizeInvoices(rows, LIST_LIMIT, { overdueOnly: false });
  assert.equal(out.totals.taxableValue, 160000);
  assert.equal(out.totals.gstAmount, 28800);
  assert.equal(out.totals.totalAmount, 188800);
  assert.equal(out.totals.taxableValue + out.totals.gstAmount, out.totals.totalAmount);
  assert.notEqual(out.totals.netTotal, out.totals.taxableValue); // netTotal is incl. GST, not before GST
});

test("'unpaid or partially paid' style filters resolve to issued + partially_paid", () => {
  for (const status of ["unpaid", "Outstanding", "issued, partially paid", "issued,partially-paid"]) {
    assert.deepEqual(resolveInvoiceFilter({ status }).statuses, ["issued", "partially_paid"], status);
  }
  assert.deepEqual(resolveInvoiceFilter({ status: ["paid", "cancelled"] }).statuses, ["paid", "cancelled"]);
  assert.deepEqual(invoiceStatusWhere({ overdueOnly: false, statuses: ["issued", "partially_paid"] }, new Date()), { status: { in: ["issued", "partially_paid"] } });
});

test("payment dates are IST yyyy-mm-dd whether stored as UTC or IST midnight", () => {
  assert.equal(isoDateIST(new Date("2025-12-01T00:00:00Z")), "2025-12-01"); // date-only input, UTC midnight
  assert.equal(isoDateIST(new Date("2025-11-30T18:30:00Z")), "2025-12-01"); // IST midnight
  assert.equal(isoDateIST(new Date("2026-08-31T19:00:00Z")), "2026-09-01"); // 00:30 IST next day
  assert.equal(istDayStart("2026-04-01")!.toISOString(), "2026-03-31T18:30:00.000Z");
  assert.equal(istDayStart("2026-02-30"), undefined);
  assert.equal(istDayStart("April 2026"), undefined);
});

test("payment totals and month grouping cover every payment (Dec 2025 - Aug 2026), newest listed first", () => {
  const months = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  const rows = months.flatMap((m, i) => [
    { id: `${m}-a`, receivedDate: `${m}-05`, amount: 50000 + i, tdsAmount: 1000, method: "bank_transfer", unallocatedAmount: 0 },
    { id: `${m}-b`, receivedDate: `${m}-20`, amount: 25000.25, tdsAmount: 0, method: "upi", unallocatedAmount: i === 0 ? 500 : 0 },
  ]);
  const out = summarizePayments(rows, LIST_LIMIT);
  assert.equal(out.totalCount, 18);
  assert.equal(out.complete, false);
  assert.equal(out.payments.length, 15);
  assert.equal(out.payments[0].receivedDate, "2026-08-20");
  assert.equal(out.firstPaymentDate, "2025-12-05");
  assert.equal(out.lastPaymentDate, "2026-08-20");
  assert.deepEqual(out.byMonth.map((m) => m.month), months);
  assert.ok(out.byMonth.every((m) => m.count === 2));
  assert.deepEqual(out.byMonth[0], { month: "2025-12", count: 2, amount: 75000.25, cash: 75000.25, tds: 1000 });
  assert.equal(out.totals.totalAmount, sumMoney(rows.map((r) => r.amount)));
  assert.equal(sumMoney(out.byMonth.map((m) => m.amount)), out.totals.totalAmount);
  assert.equal(out.totals.totalTds, 9000);
  assert.equal(out.totals.unallocatedAmount, 500);
  // The months visible in the listed rows alone would be wrong - that's why byMonth exists.
  assert.notDeepEqual([...new Set(out.payments.map((p) => p.receivedDate.slice(0, 7)))].sort(), months);
});

test("status breakdowns from groupBy give exact count and value", () => {
  const D = (n: number) => ({ toString: () => String(n) }) as never;
  const out = statusBreakdown([
    { status: "sent", _count: { _all: 9 }, _sum: { total: D(90000.1) } },
    { status: "accepted", _count: { _all: 8 }, _sum: { total: D(80000.2) } },
    { status: "draft", _count: { _all: 1 }, _sum: { total: null } },
  ]);
  assert.equal(out.totalCount, 18);
  assert.equal(out.totalValue, 170000.3);
  assert.deepEqual(Object.keys(out.byStatus), ["accepted", "draft", "sent"]);
  assert.deepEqual(out.byStatus.draft, { count: 1, totalValue: 0 });
  const countsOnly = statusBreakdown([{ status: "open", _count: { _all: 4 } }]);
  assert.deepEqual(countsOnly, { totalCount: 4, byStatus: { open: { count: 4 } } });
});

test("search_purchase_orders: status 'open' = issued + partially received; unknown statuses list the valid ones", async (t) => {
  const { zanAppReadTools, resolvePoStatusFilter, OPEN_PO_STATUSES } = await import("../src/agent/tools/zanAppReadTools");
  const { prisma } = await import("../src/lib/prisma");
  const { PERMISSION_KEY } = await import("@recd/shared");
  const tool = zanAppReadTools.find((x) => x.name === "search_purchase_orders")!;
  const auth = { userId: "p", roleKey: "purchase", permissions: new Set<string>([PERMISSION_KEY.MANAGE_PURCHASE_ORDERS]) };
  const pos = [
    { id: "1", poNumber: "PO/2026-27/0001", status: "issued", total: "1000.00" },
    { id: "2", poNumber: "PO/2026-27/0002", status: "closed", total: "2000.00" },
    { id: "3", poNumber: "PO/2026-27/0003", status: "partially_received", total: "3000.00" },
    { id: "4", poNumber: "PO/2026-27/0004", status: "draft", total: "4000.00" },
  ].map((p) => ({ ...p, supplier: { name: "Selvam Enterprises" }, orderDate: new Date("2026-10-01T00:00:00Z"), expectedDate: null }));
  const matches = (where: any) => pos.filter((p) => !where.status || where.status.in.includes(p.status));
  const original = Object.getOwnPropertyDescriptor(prisma, "purchaseOrder");
  Object.defineProperty(prisma, "purchaseOrder", {
    configurable: true,
    value: {
      findMany: async (args: any) => matches(args.where),
      groupBy: async (args: any) => {
        const by = new Map<string, any[]>();
        for (const p of matches(args.where)) by.set(p.status, [...(by.get(p.status) ?? []), p]);
        return [...by].map(([status, rows]) => ({ status, _count: { _all: rows.length }, _sum: { total: sumMoney(rows.map((r) => Number(r.total))) } }));
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(prisma, "purchaseOrder", original);
    else Reflect.deleteProperty(prisma, "purchaseOrder");
  });

  assert.deepEqual(OPEN_PO_STATUSES, ["issued", "partially_received"]);
  for (const status of ["open", "Open", " OPEN ", "open, issued"]) {
    const res: any = await tool.handler({ status }, auth);
    assert.deepEqual(res.results.map((r: any) => r.poNumber), ["PO/2026-27/0001", "PO/2026-27/0003"], status);
  }
  assert.deepEqual(resolvePoStatusFilter("Partially received"), { statuses: ["partially_received"] });
  assert.deepEqual(resolvePoStatusFilter(undefined), { statuses: [] });
  const closed: any = await tool.handler({ status: "closed" }, auth);
  assert.deepEqual(closed.results.map((r: any) => r.poNumber), ["PO/2026-27/0002"]);
  const unknown: any = await tool.handler({ status: "pending" }, auth);
  assert.match(unknown.error, /Unknown purchase order status/);
  assert.ok(unknown.validStatuses.includes("closed"));
  assert.ok(unknown.validStatuses.some((s: string) => s.startsWith("open")));
});

test("open-order rule wording: '(Commissioned or later)', never '(site stage = ...)'", () => {
  const { openDefinition } = resolveOpenCutoff({ label: "Commissioned", sequenceOrder: 11 }, { label: "Customer sign-off", sequenceOrder: 12 });
  assert.match(openDefinition, /\(Commissioned or later\)/);
  assert.doesNotMatch(openDefinition, /site stage =/);
});
