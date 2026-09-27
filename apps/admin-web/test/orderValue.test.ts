import { test } from "node:test";
import assert from "node:assert/strict";
import { computePricedCost, suggestNewOrderValue } from "../src/lib/orderValue";

// Mirrors the cases the 2026-09-09 handover said were never click-tested: auto-fill with an
// override, blank without one, multi-product sums, and the edit form's "Populate cost" totals.

const prices = { p250: "150000", p500: "240000.50" };

test("auto-fills price x quantity for a single priced product", () => {
  assert.equal(suggestNewOrderValue([{ productId: "p250", quantity: "2" }], prices), "300000.00");
});

test("stays blank when no selected product has a customer price override", () => {
  assert.equal(suggestNewOrderValue([{ productId: "unpriced", quantity: "3" }], prices), "");
  assert.equal(suggestNewOrderValue([{ productId: "p250", quantity: "1" }], {}), "");
});

test("stays blank when no product has been picked yet", () => {
  assert.equal(suggestNewOrderValue([{ productId: "", quantity: "1" }], prices), "");
});

test("sums across multiple product lines and ignores unpriced / unpicked lines", () => {
  const value = suggestNewOrderValue(
    [
      { productId: "p250", quantity: "1" },
      { productId: "p500", quantity: "2" },
      { productId: "unpriced", quantity: "5" },
      { productId: "", quantity: "9" },
    ],
    prices,
  );
  assert.equal(value, "630001.00");
});

test("blank or invalid quantity counts as 1", () => {
  assert.equal(suggestNewOrderValue([{ productId: "p250", quantity: "" }], prices), "150000.00");
  assert.equal(suggestNewOrderValue([{ productId: "p250", quantity: "abc" }], prices), "150000.00");
});

test("Populate cost: cumulative total and priced flags across main product + line items", () => {
  assert.deepEqual(
    computePricedCost([
      { price: "150000", quantity: 1 },
      { price: "240000.50", quantity: 2 },
    ]),
    { total: 630001, anyPriced: true, allPriced: true },
  );
  assert.deepEqual(
    computePricedCost([
      { price: "150000", quantity: 2 },
      { price: undefined, quantity: 4 },
    ]),
    { total: 300000, anyPriced: true, allPriced: false },
  );
  assert.deepEqual(computePricedCost([{ price: undefined, quantity: 1 }]), { total: 0, anyPriced: false, allPriced: false });
});
