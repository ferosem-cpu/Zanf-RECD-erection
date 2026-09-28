import { test } from "node:test";
import assert from "node:assert/strict";
import { supplierAddressLines, poTaxMode } from "../src/lib/supplier";
import { NetworkError } from "../src/lib/apiClient";
import { isSessionRejected } from "../src/lib/sessionRetry";

test("structured supplier address renders as lines", () => {
  assert.deepEqual(
    supplierAddressLines({ address: "3rd Floor, Unipunch Pride, 40, 2nd Main Rd", addressLine2: "Ambattur Industrial Estate", city: "Chennai", pincode: "600058", state: "Tamil Nadu" }),
    ["3rd Floor, Unipunch Pride, 40, 2nd Main Rd", "Ambattur Industrial Estate", "Chennai - 600058, Tamil Nadu"],
  );
});

test("legacy one-field (possibly multi-line) addresses still render, state not repeated", () => {
  assert.deepEqual(supplierAddressLines({ address: "12 Main Rd\nGuindy, Chennai, Tamil Nadu", state: "Tamil Nadu" }), ["12 Main Rd", "Guindy, Chennai, Tamil Nadu"]);
  assert.deepEqual(supplierAddressLines({ state: "Karnataka" }), ["Karnataka"]);
  assert.deepEqual(supplierAddressLines(null), []);
});

test("client tax hint matches the API rule", () => {
  assert.equal(poTaxMode("Tamil Nadu", "tamil nadu (33)"), "intra");
  assert.equal(poTaxMode("Karnataka", "Tamil Nadu"), "inter");
  assert.equal(poTaxMode(null, "Tamil Nadu"), "intra");
  assert.equal(poTaxMode("Karnataka", ""), "intra");
});

test("network errors / timeouts never count as a rejected session", () => {
  assert.equal(isSessionRejected(new NetworkError("offline")), false);
  assert.equal(isSessionRejected(new NetworkError("slow", { timedOut: true })), false);
});
