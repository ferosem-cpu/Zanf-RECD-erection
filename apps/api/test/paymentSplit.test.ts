import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { splitPayment, paymentCashAndTds, isLegacyTdsPayment } from "../src/services/paymentSplit";
import { buildTdsRegister, type TdsRegisterPayment } from "../src/services/tdsRegister";
import { buildStatement, customerPaymentMovements, type LedgerPayment, type RawMovement } from "../src/services/ledger";
import { settledFromAllocations } from "../src/services/settlement";

const dec = (n: number | string) => new Prisma.Decimal(String(n));
const day = (s: string) => new Date(`${s}T00:00:00Z`);

test("splitPayment: current rows split amount/tdsAmount; legacy tds rows are all TDS", () => {
  const cur = splitPayment({ amount: dec(49000), tdsAmount: dec(1000), method: "upi" });
  assert.equal(cur.cash.toString(), "49000");
  assert.equal(cur.tds.toString(), "1000");
  const legacy = splitPayment({ amount: "2000.50", tdsAmount: "0", method: "tds" });
  assert.equal(legacy.cash.toString(), "0");
  assert.equal(legacy.tds.toString(), "2000.5");
  // Defensive: legacy row that also carries tdsAmount - all of it is TDS.
  assert.equal(splitPayment({ amount: 100, tdsAmount: 5, method: " TDS " }).tds.toString(), "105");
  assert.equal(splitPayment({ amount: null, tdsAmount: null, method: "cash" }).cash.toString(), "0");
  assert.ok(isLegacyTdsPayment({ method: "Tds" }));
  assert.ok(!isLegacyTdsPayment({ method: "bank_transfer" }));
  assert.deepEqual(paymentCashAndTds({ amount: 1500.25, tdsAmount: 0, method: "tds" }), { cash: 0, tds: 1500.25 });
  assert.deepEqual(paymentCashAndTds({ amount: 0.1, tdsAmount: 0.2, method: "upi" }), { cash: 0.1, tds: 0.2 });
});

function registerPayment(id: string, customer: string, amount: string, tdsAmount: string, method: string, date: string): TdsRegisterPayment {
  return {
    id, amount: dec(amount), tdsAmount: dec(tdsAmount), method, tdsCertificateRef: null, receivedDate: day(date),
    customer: { id: customer, name: customer.toUpperCase() }, invoice: null,
    allocations: [{ invoice: { invoiceNumber: `INV-${id}` } }],
  };
}

test("TDS register includes legacy TDS Deducted rows once, with gross 0, in every total", () => {
  const out = buildTdsRegister([
    registerPayment("p1", "c1", "49000", "1000", "bank_transfer", "2026-04-10"),
    registerPayment("t1", "c1", "2000", "0", "tds", "2026-05-01"),
    registerPayment("t2", "c2", "1500.25", "0", "tds", "2026-06-01"),
    registerPayment("p2", "c2", "20000", "400.5", "upi", "2026-06-02"),
    // Plain cash with no TDS (would only reach here via a broader query) - excluded.
    registerPayment("p3", "c2", "5000", "0", "cheque", "2026-06-03"),
  ]);
  assert.deepEqual(out.rows.map((r) => [r.paymentId, r.grossAmount.toString(), r.tdsAmount.toString(), r.legacyTdsEntry]), [
    ["p1", "49000", "1000", false],
    ["t1", "0", "2000", true],
    ["t2", "0", "1500.25", true],
    ["p2", "20000", "400.5", false],
  ]);
  assert.deepEqual(out.totalsByCustomer, [
    { customerId: "c1", customerName: "C1", grossAmount: 49000, tdsAmount: 3000 },
    { customerId: "c2", customerName: "C2", grossAmount: 20000, tdsAmount: 1900.75 },
  ]);
  assert.equal(out.grandTotalTds, 4900.75);
  // JSON shape the admin-web page/CSV reads: Decimal amounts serialise as strings.
  const json = JSON.parse(JSON.stringify(out.rows[1]));
  assert.equal(json.grossAmount, "0");
  assert.equal(json.tdsAmount, "2000");
});

function ledgerPayment(id: string, amount: string, tdsAmount: string, method: string, date: string, invoiceNumber?: string): LedgerPayment {
  return {
    id, amount: dec(amount), tdsAmount: dec(tdsAmount), method, receivedDate: day(date), invoice: null,
    allocations: invoiceNumber ? [{ invoice: { invoiceNumber } }] : [],
  };
}

test("customer ledger: cash, current-form TDS and legacy tds rows - each counted once", () => {
  const payments = [
    ledgerPayment("p1", "49000", "1000", "bank_transfer", "2026-04-05", "INV-1"),
    ledgerPayment("t1", "2000", "0", "tds", "2026-04-10", "INV-2"),
    ledgerPayment("p2", "48000", "0", "upi", "2026-04-11", "INV-2"),
    ledgerPayment("t2", "500", "0", "TDS", "2026-04-20"), // unallocated legacy TDS
  ];
  const paymentMoves = customerPaymentMovements(payments);
  assert.deepEqual(paymentMoves.map((m) => [m.type, m.refId, m.credit.toString()]), [
    ["payment", "p1", "49000"],
    ["tds", "p1", "1000"],
    ["tds", "t1", "2000"],
    ["payment", "p2", "48000"],
    ["tds", "t2", "500"],
  ]);
  assert.equal(paymentMoves.filter((m) => m.refId === "t1").length, 1, "legacy row appears exactly once");
  assert.equal(paymentMoves.find((m) => m.refId === "t2")!.refNumber, "TDS - Advance");

  const invoices: RawMovement[] = [
    { date: day("2026-04-01"), type: "invoice", refNumber: "INV-1", refId: "i1", debit: dec(50000), credit: dec(0) },
    { date: day("2026-04-02"), type: "invoice", refNumber: "INV-2", refId: "i2", debit: dec(50000), credit: dec(0) },
  ];
  const full = buildStatement("c1", "C1", dec(1000), day("2026-03-31"), [...invoices, ...paymentMoves]);
  assert.deepEqual(full.entries.map((e) => [e.type, e.runningBalance.toString()]), [
    ["opening_balance", "1000"],
    ["invoice", "51000"],
    ["invoice", "101000"],
    ["payment", "52000"],
    ["tds", "51000"],
    ["tds", "49000"],
    ["payment", "1000"],
    ["tds", "500"],
  ]);
  assert.equal(full.closingBalance.toString(), "500");
  // Total credits = sum(amount + tdsAmount) over payments: nothing doubled or dropped.
  const credits = full.entries.reduce((s, e) => s.plus(e.credit), dec(0));
  assert.equal(credits.toString(), "100500");

  // Ranged view: opening carried in, closing as of `to`.
  const ranged = buildStatement("c1", "C1", dec(1000), day("2026-03-31"), [...invoices, ...paymentMoves], day("2026-04-06"), day("2026-04-15"));
  assert.equal(ranged.openingBalance.toString(), "51000");
  assert.deepEqual(ranged.entries.map((e) => e.refId), ["t1", "p2"]);
  assert.equal(ranged.closingBalance.toString(), "1000");
});

test("invoice settlement agrees with the ledger for legacy tds allocations", () => {
  // INV-2 above: legacy t1 (2000, allocated whole) + p2 cash 48000 = 50000 settled, nothing doubled.
  const settled = settledFromAllocations([
    { amount: dec(2000), payment: { amount: dec(2000), tdsAmount: dec(0) } },
    { amount: dec(48000), payment: { amount: dec(48000), tdsAmount: dec(0) } },
  ]);
  assert.equal(settled.toString(), "50000");
  // INV-1: current-form p1 settles cash + its TDS.
  assert.equal(settledFromAllocations([{ amount: dec(49000), payment: { amount: dec(49000), tdsAmount: dec(1000) } }]).toString(), "50000");
});
