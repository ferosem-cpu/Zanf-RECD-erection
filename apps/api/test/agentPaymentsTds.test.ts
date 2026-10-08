import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizePayments, paymentCashAndTds, resolvePaymentMethodFilter, normalizePaymentMethod, sumMoney,
} from "../src/agent/tools/zanAppReadTools";
import { LIST_LIMIT } from "../src/agent/listResult";

/** Mirrors prod (2026-10): cash payments every month, TDS on legacy method="tds" rows
 * ("TDS Deducted" on the Payments page, whole amount is TDS, tdsAmount 0) in three months,
 * plus current-style rows carrying TDS in tdsAmount. */
function paymentsWithTds() {
  return [
    { id: "p1", receivedDate: "2025-12-05", amount: 100000, tdsAmount: 0, method: "bank_transfer", unallocatedAmount: 0 },
    { id: "t1", receivedDate: "2025-12-05", amount: 2000, tdsAmount: 0, method: "tds", unallocatedAmount: 0 },
    { id: "p2", receivedDate: "2026-02-10", amount: 49000, tdsAmount: 1000, method: "upi", unallocatedAmount: 0 },
    { id: "p3", receivedDate: "2026-04-01", amount: 75000.5, tdsAmount: 0, method: "cheque", unallocatedAmount: 500 },
    { id: "t2", receivedDate: "2026-04-01", amount: 1500.25, tdsAmount: 0, method: "tds", unallocatedAmount: 0 },
    { id: "t3", receivedDate: "2026-07-15", amount: 3000, tdsAmount: 0, method: "tds", unallocatedAmount: 0 },
    { id: "p4", receivedDate: "2026-07-20", amount: 20000, tdsAmount: 400, method: "bank_transfer", unallocatedAmount: 0 },
  ];
}

test("legacy method=tds rows count as TDS, not cash; tdsAmount counts as TDS on any method", () => {
  assert.deepEqual(paymentCashAndTds({ amount: 2000, tdsAmount: 0, method: "tds" }), { cash: 0, tds: 2000 });
  assert.deepEqual(paymentCashAndTds({ amount: 49000, tdsAmount: 1000, method: "upi" }), { cash: 49000, tds: 1000 });
  // Defensive: a legacy row that somehow also has tdsAmount set - both are TDS.
  assert.deepEqual(paymentCashAndTds({ amount: 100, tdsAmount: 5, method: "tds" }), { cash: 0, tds: 105 });
  assert.deepEqual(paymentCashAndTds({ amount: null, tdsAmount: null, method: "cash" }), { cash: 0, tds: 0 });
  // Stored-value variants: the app writes "tds"; tolerate case/whitespace drift.
  for (const method of ["tds", "TDS", " Tds "]) {
    assert.deepEqual(paymentCashAndTds({ amount: 10, tdsAmount: 0, method }), { cash: 0, tds: 10 }, method);
  }
});

test("by-month totals split TDS out of legacy TDS-method rows in several months", () => {
  const rows = paymentsWithTds();
  const out = summarizePayments(rows, LIST_LIMIT);
  assert.deepEqual(out.byMonth, [
    { month: "2025-12", count: 2, amount: 102000, cash: 100000, tds: 2000 },
    { month: "2026-02", count: 1, amount: 49000, cash: 49000, tds: 1000 },
    { month: "2026-04", count: 2, amount: 76500.75, cash: 75000.5, tds: 1500.25 },
    { month: "2026-07", count: 2, amount: 23000, cash: 20000, tds: 3400 },
  ]);
  // Grand total (Payments page Amount column) is unchanged by the fix.
  assert.equal(out.totals.totalAmount, sumMoney(rows.map((r) => r.amount)));
  assert.equal(out.totals.totalAmount, 250500.75);
  assert.equal(out.totals.cashAmount, 244000.5);
  assert.equal(out.totals.totalTds, 7900.25);
  assert.equal(out.totals.totalSettled, 251900.75); // cash + TDS = amount + tdsAmount field
  assert.equal(out.totals.unallocatedAmount, 500);
  assert.equal(sumMoney(out.byMonth.map((m) => m.tds)), out.totals.totalTds);
  assert.equal(sumMoney(out.byMonth.map((m) => m.cash)), out.totals.cashAmount);
  assert.ok(out.byMonth.every((m) => m.tds > 0), "no month reports TDS = 0");
});

test("by-method totals: TDS Deducted is its own bucket and every bucket adds up", () => {
  const out = summarizePayments(paymentsWithTds(), LIST_LIMIT);
  assert.deepEqual(out.byMethod, [
    { method: "bank_transfer", label: "Bank Transfer", count: 2, amount: 120000, cash: 120000, tds: 400 },
    { method: "cheque", label: "Cheque", count: 1, amount: 75000.5, cash: 75000.5, tds: 0 },
    { method: "tds", label: "TDS Deducted", count: 3, amount: 6500.25, cash: 0, tds: 6500.25 },
    { method: "upi", label: "UPI", count: 1, amount: 49000, cash: 49000, tds: 1000 },
  ]);
  assert.equal(sumMoney(out.byMethod.map((m) => m.amount)), out.totals.totalAmount);
  assert.equal(sumMoney(out.byMethod.map((m) => m.tds)), out.totals.totalTds);
  assert.equal(out.byMethod.reduce((s, m) => s + m.count, 0), out.totals.count);
});

test("method variants group together and the filter accepts the page label", () => {
  const out = summarizePayments([
    { receivedDate: "2026-05-01", amount: 100, tdsAmount: 0, method: "TDS", unallocatedAmount: 0 },
    { receivedDate: "2026-05-02", amount: 50, tdsAmount: 0, method: "tds", unallocatedAmount: 0 },
  ], LIST_LIMIT);
  assert.deepEqual(out.byMethod, [{ method: "tds", label: "TDS Deducted", count: 2, amount: 150, cash: 0, tds: 150 }]);
  assert.equal(normalizePaymentMethod(" UPI "), "upi");
  for (const [input, key] of [["TDS Deducted", "tds"], ["tds", "tds"], ["tds-deducted", "tds"], ["Bank Transfer", "bank_transfer"], ["bank_transfer", "bank_transfer"], ["UPI", "upi"], ["Cheque", "cheque"]]) {
    assert.equal(resolvePaymentMethodFilter(input), key, input);
  }
});
