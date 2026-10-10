import { test } from "node:test";
import assert from "node:assert/strict";
import { formatInr, formatInrFields } from "../src/agent/formatInr";

test("rupees use Indian lakh/crore grouping with paise", () => {
  assert.equal(formatInr(1253514), "₹12,53,514.00");
  assert.equal(formatInr(12500000.5), "₹1,25,00,000.50");
  assert.equal(formatInr(100000), "₹1,00,000.00");
  assert.equal(formatInr(999), "₹999.00");
  assert.equal(formatInr(0), "₹0.00");
  assert.equal(formatInr(1234567890.126), "₹1,23,45,67,890.13");
  assert.equal(formatInr(0.05), "₹0.05");
});

test("negatives, null and non-finite values", () => {
  assert.equal(formatInr(-1253514.5), "-₹12,53,514.50");
  assert.equal(formatInr(-0.001), "₹0.00");
  assert.equal(formatInr(null), "₹0.00");
  assert.equal(formatInr(undefined), "₹0.00");
  assert.equal(formatInr(NaN), "₹0.00");
  assert.ok(!/1,253,514/.test(formatInr(1253514)));
});

test("formatInrFields formats only numeric fields", () => {
  assert.deepEqual(formatInrFields({ a: 100000, b: "x", c: null as number | null }, ["a", "b", "c"]), { a: "₹1,00,000.00" });
});
