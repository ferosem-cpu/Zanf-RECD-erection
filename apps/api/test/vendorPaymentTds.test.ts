import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { paymentMadeGeneralCreateSchema, paymentMadeAttachmentInputSchema } from "@recd/shared";
import { billBalance, billPaymentTotals, planVendorPayment, vendorPaymentSettles, vendorTdsEditError } from "../src/services/vendorPaymentTds";
import { billOutstanding, billSettled } from "../src/services/payables";
import { buildStatement, supplierPaymentMovements } from "../src/services/ledger";
import { buildVendorTdsRegister, buildTdsRegister } from "../src/services/tdsRegister";
import { attachmentsError, contentDisposition, dataUrlSizeBytes, decodeDataUrl } from "../src/services/paymentMadeAttachments";

const D = (n: number | string) => new Prisma.Decimal(String(n));
const plan = (outstanding: number | null, cash: number, tds = 0, allowAdvance?: boolean) => {
  const p = planVendorPayment({ outstanding, cash, tds, allowAdvance });
  return p.ok ? { applied: p.appliedCash.toNumber(), tds: p.tds.toNumber(), advance: p.advanceCash.toNumber() } : p.error;
};

test("a payment settles cash + TDS; null TDS (pre-migration row) counts as 0", () => {
  assert.equal(vendorPaymentSettles({ amount: "900", tdsAmount: "100" }).toNumber(), 1000);
  assert.equal(vendorPaymentSettles({ amount: "900", tdsAmount: null }).toNumber(), 900);
  const t = billPaymentTotals([{ amount: "500", tdsAmount: "0" }, { amount: "400", tdsAmount: "100" }, { amount: "50" }]);
  assert.deepEqual([t.cash.toNumber(), t.tds.toNumber(), t.settled.toNumber()], [950, 100, 1050]);
  assert.equal(billBalance("1180", [{ amount: "1000", tdsAmount: "20" }]).toNumber(), 160);
});

test("payables outstanding = total - (cash + TDS), same numbers as the TDS helper", () => {
  assert.equal(billSettled([{ amount: "1062", tdsAmount: "118" }]), 1180);
  assert.equal(billOutstanding("1180.00", [{ amount: "1062.00", tdsAmount: "118.00" }]), 0);
  assert.equal(billOutstanding("1180.00", [{ amount: "500", tdsAmount: null }]), 680);
  // old callers that only select amount still work
  assert.equal(billOutstanding("118000.00", [{ amount: "18000.50" }]), 99999.5);
});

test("plan: TDS lands on the bill first, cash fills the rest, excess cash becomes an advance", () => {
  assert.deepEqual(plan(1000, 900, 100), { applied: 900, tds: 100, advance: 0 });
  assert.deepEqual(plan(1000, 950, 100), { applied: 900, tds: 100, advance: 50 });
  assert.deepEqual(plan(1000, 500, 0), { applied: 500, tds: 0, advance: 0 });
  assert.deepEqual(plan(1000, 0, 100), { applied: 0, tds: 100, advance: 0 }, "TDS-only row allowed");
  assert.deepEqual(plan(0, 300, 0), { applied: 0, tds: 0, advance: 300 }, "already-settled bill: all cash is advance");
  assert.deepEqual(plan(1000, 900.005, 100), { applied: 900, tds: 100, advance: 0 }, "rounding dust is not an advance");
  assert.match(String(plan(1000, 100, 1000.5)), /TDS .* exceeds the bill's outstanding balance/);
});

test("plan: no bill = pure advance and TDS refused; strict route refuses any excess", () => {
  assert.deepEqual(plan(null, 700), { applied: 0, tds: 0, advance: 700 });
  assert.match(String(plan(null, 700, 10)), /advance carries no TDS/);
  assert.deepEqual(plan(1000, 900, 100, false), { applied: 900, tds: 100, advance: 0 });
  assert.match(String(plan(1000, 901, 100, false)), /exceeds the outstanding balance/);
});

test("editing TDS is re-validated against the bill total", () => {
  assert.equal(vendorTdsEditError({ billTotal: "1000", otherSettled: "500", cash: "400", newTds: 100 }), null);
  assert.match(vendorTdsEditError({ billTotal: "1000", otherSettled: "500", cash: "400", newTds: 101 })!, /more than the bill total/);
  assert.match(vendorTdsEditError({ billTotal: null, otherSettled: 0, cash: "400", newTds: 5 })!, /advance carries no TDS/);
  assert.equal(vendorTdsEditError({ billTotal: null, otherSettled: 0, cash: "400", newTds: 0 }), null);
});

test("schema: TDS without a bill is rejected; attachments must be image/PDF data-URLs", () => {
  const base = { supplierId: "s1", amount: 100, method: "bank_transfer" as const };
  assert.equal(paymentMadeGeneralCreateSchema.safeParse({ ...base, tdsAmount: 10 }).success, false);
  assert.equal(paymentMadeGeneralCreateSchema.safeParse({ ...base, billId: "b1", tdsAmount: 10 }).success, true);
  assert.equal(paymentMadeGeneralCreateSchema.safeParse(base).success, true);
  assert.equal(paymentMadeAttachmentInputSchema.safeParse({ fileName: "a.pdf", mimeType: "application/pdf", dataUrl: "data:application/pdf;base64,AAAA" }).success, true);
  assert.equal(paymentMadeAttachmentInputSchema.safeParse({ fileName: "a.exe", mimeType: "application/x-msdownload", dataUrl: "data:application/x-msdownload;base64,AA" }).success, false);
  assert.equal(paymentMadeAttachmentInputSchema.safeParse({ fileName: "a.pdf", mimeType: "application/pdf", dataUrl: "https://evil/x.pdf" }).success, false);
});

test("supplier ledger: cash and TDS are separate credit lines, each counted once", () => {
  const movements = supplierPaymentMovements([
    { id: "p1", amount: "900", tdsAmount: "100", paidDate: new Date("2026-10-02T00:00:00Z"), bill: { billNumber: "B-1" } },
    { id: "p2", amount: "250", tdsAmount: null, paidDate: new Date("2026-10-03T00:00:00Z"), bill: null },
  ]);
  assert.deepEqual(movements.map((m) => [m.type, m.refNumber, m.credit.toNumber()]), [
    ["payment_made", "B-1", 900], ["tds", "TDS - B-1", 100], ["payment_made", "Payment / advance", 250],
  ]);
  const bill = { date: new Date("2026-10-01T00:00:00Z"), type: "bill" as const, refNumber: "B-1", refId: "b1", debit: D(1000), credit: D(0) };
  const st = buildStatement("s1", "Selvam", D(0), null, [bill, ...movements]);
  assert.equal(st.closingBalance.toNumber(), -250, "bill fully settled by cash + TDS; the 250 advance is a debit balance");
});

test("TDS register: vendor TDS is its own section; customer totals untouched", () => {
  const vendor = buildVendorTdsRegister([
    { id: "p1", amount: "900", tdsAmount: "100", tdsCertificateRef: "16A-1", paidDate: new Date("2026-10-02T00:00:00Z"), supplier: { id: "s1", name: "Selvam", pan: "ABCDE1234F" }, bill: { billNumber: "B-1" } },
    { id: "p2", amount: "500", tdsAmount: "0", tdsCertificateRef: null, paidDate: new Date("2026-10-03T00:00:00Z"), supplier: { id: "s1", name: "Selvam", pan: null }, bill: null },
    { id: "p3", amount: "1800", tdsAmount: "200", tdsCertificateRef: null, paidDate: new Date("2026-10-04T00:00:00Z"), supplier: { id: "s1", name: "Selvam", pan: "ABCDE1234F" }, bill: { billNumber: "B-2" } },
  ]);
  assert.equal(vendor.rows.length, 2, "rows without TDS are dropped");
  assert.equal(vendor.grandTotalTds, 300);
  assert.deepEqual(vendor.totalsBySupplier, [{ supplierId: "s1", supplierName: "Selvam", supplierPan: "ABCDE1234F", cashPaid: 2700, tdsAmount: 300 }]);
  assert.equal(buildTdsRegister([]).grandTotalTds, 0);
});

test("attachment helpers: size/type checks, decode and safe Content-Disposition", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(dataUrlSizeBytes(png), 9);
  assert.deepEqual([...decodeDataUrl(png).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(attachmentsError([{ fileName: "a.png", mimeType: "image/png", dataUrl: png }], 0), null);
  assert.match(attachmentsError([{ fileName: "a.png", mimeType: "application/pdf", dataUrl: png }], 0)!, /does not match/);
  assert.match(attachmentsError([{ fileName: "a.png", mimeType: "image/png", dataUrl: png }], 5)!, /at most 5/);
  assert.match(attachmentsError([{ fileName: "big.png", mimeType: "image/png", dataUrl: `data:image/png;base64,${"A".repeat(6_100_000)}` }], 0)!, /too large/);
  assert.equal(contentDisposition('UTR "1".pdf', true), `inline; filename="UTR _1_.pdf"; filename*=UTF-8''UTR%20%221%22.pdf`);
  assert.match(contentDisposition("रसीद.pdf", false), /^attachment; filename="____.pdf"; filename\*=UTF-8''/);
});
