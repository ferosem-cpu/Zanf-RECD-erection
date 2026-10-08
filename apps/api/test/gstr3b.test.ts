import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { buildGstr3b } from "../src/services/gstExport";
import { computeDocumentTotals } from "../src/services/taxCalc";

const dec = (n: number | string) => new Prisma.Decimal(String(n));

test("GSTR-3B taxable value is the invoice subtotal, which is already after discounts (no double discount)", async (t) => {
  const replace = (key: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(prisma, key, original);
      else Reflect.deleteProperty(prisma, key);
    });
  };
  // 10% line discount on 1,00,000: subtotal is the discounted 90,000.
  const totals = computeDocumentTotals([{ quantity: 1, unitPrice: 100000, discountPct: 10, taxRatePct: 18 }] as any);
  assert.equal(totals.subtotal.toString(), "90000");
  assert.equal(totals.discountAmount.toString(), "10000");

  replace("invoice", {
    findMany: async () => [{ subtotal: totals.subtotal, discountAmount: totals.discountAmount, cgstAmount: dec(8100), sgstAmount: dec(8100), igstAmount: dec(0) }],
  });
  replace("creditNote", { findMany: async () => [{ subtotal: dec(5000), cgstAmount: dec(450), sgstAmount: dec(450), igstAmount: dec(0) }] });
  replace("bill", { findMany: async () => [] });

  const r = await buildGstr3b(new Date("2026-04-01T00:00:00Z"), new Date("2026-06-30T00:00:00Z"));
  assert.equal(r.outwardTaxableValue, "90000.00");
  assert.equal(r.creditNoteTaxableValue, "5000.00");
  assert.equal(r.netTaxableValue, "85000.00");
});
