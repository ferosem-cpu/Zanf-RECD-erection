import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStateForGst,
  supplierCreateSchema,
  purchaseOrderCreateSchema,
  purchaseOrderUpdateSchema,
  DEFAULT_PO_SHIP_TO_ADDRESS,
} from "@recd/shared";
import { poTaxStates } from "../src/lib/purchaseOrderTax";
import { normalizeSupplierInput } from "../src/lib/supplierInput";
import { computeDocumentTotals } from "../src/services/taxCalc";

const line = [{ quantity: 8, unitPrice: 40000, discountPct: 0, taxRatePct: 18 }];

test("state names compare loosely for GST (case, spaces, GST code suffix)", () => {
  assert.equal(normalizeStateForGst("Tamil Nadu"), "tamilnadu");
  assert.equal(normalizeStateForGst(" tamil  nadu "), "tamilnadu");
  assert.equal(normalizeStateForGst("Tamil Nadu (33)"), "tamilnadu");
  assert.equal(normalizeStateForGst(""), null);
  assert.equal(normalizeStateForGst(null), null);
});

test("PO tax: same state -> CGST+SGST, different state -> IGST", () => {
  const intra = computeDocumentTotals(line, ...poTaxStates("Tamil Nadu", "tamil nadu (33)"));
  assert.equal(Number(intra.cgstAmount), 28800);
  assert.equal(Number(intra.sgstAmount), 28800);
  assert.equal(Number(intra.igstAmount), 0);

  const inter = computeDocumentTotals(line, ...poTaxStates("Karnataka", "Tamil Nadu"));
  assert.equal(Number(inter.igstAmount), 57600);
  assert.equal(Number(inter.cgstAmount), 0);
  assert.equal(Number(inter.total), 377600);
});

test("PO tax stays intra-state (legacy behaviour) when either state is unknown", () => {
  for (const [supplierState, pos] of [[null, "Tamil Nadu"], ["Karnataka", null], [null, null], ["", ""]] as const) {
    const t = computeDocumentTotals(line, ...poTaxStates(supplierState, pos));
    assert.equal(Number(t.igstAmount), 0, `${supplierState} / ${pos}`);
    assert.equal(Number(t.cgstAmount), 28800);
  }
});

test("supplier schema accepts the structured address and blank optional fields", () => {
  const ok = supplierCreateSchema.safeParse({
    name: "Platino Automotive Private Limited",
    gstin: "33aamcp8191n1zn",
    state: "Tamil Nadu",
    address: "3rd Floor, Unipunch Pride, 40, 2nd Main Rd",
    addressLine2: "Ambattur Industrial Estate",
    city: "Chennai",
    pincode: "600 058",
    contactEmail: "",
    contactPhone: "",
  });
  assert.equal(ok.success, true);
  assert.equal(supplierCreateSchema.safeParse({ name: "X", pincode: "6000" }).success, false);
  assert.equal(supplierCreateSchema.safeParse({ name: "X", contactEmail: "not-an-email" }).success, false);
  assert.equal(supplierCreateSchema.safeParse({ name: "   " }).success, false);
});

test("supplier input normalisation: blanks -> null, GSTIN/PAN upper-cased, PIN spaces removed", () => {
  const out = normalizeSupplierInput({ name: " Acme ", gstin: "33abcde1234f1z5", pan: " abcde1234f ", pincode: "600 043", city: "", contactEmail: "  " });
  assert.equal(out.name, "Acme");
  assert.equal(out.gstin, "33ABCDE1234F1Z5");
  assert.equal(out.pan, "ABCDE1234F");
  assert.equal(out.pincode, "600043");
  assert.equal(out.city, null);
  assert.equal(out.contactEmail, null);
});

test("PO schemas accept the new header fields and stay backward compatible", () => {
  const base = { supplierId: "s1", lineItems: [{ description: "IOT PANEL", hsnCode: "85371000", quantity: 8, unitPrice: 40000, taxRatePct: 18 }] };
  assert.equal(purchaseOrderCreateSchema.safeParse(base).success, true); // old clients / agent
  const full = purchaseOrderCreateSchema.safeParse({
    ...base,
    orderDate: "2026-09-28T00:00:00.000Z",
    vendorQuoteRef: "PASQ/1611/26-27",
    vendorQuoteDate: "2026-09-28T00:00:00.000Z",
    shipToAddress: DEFAULT_PO_SHIP_TO_ADDRESS,
    placeOfSupply: "Tamil Nadu",
    paymentTerms: "Immediate",
  });
  assert.equal(full.success, true);
  // An edit may clear header fields.
  assert.equal(purchaseOrderUpdateSchema.safeParse({ vendorQuoteRef: "", vendorQuoteDate: null, paymentTerms: "" }).success, true);
  assert.equal(purchaseOrderUpdateSchema.safeParse({ vendorQuoteDate: "28/09/2026" }).success, false);
});

test("default ship-to is Zan-F's own address", () => {
  assert.match(DEFAULT_PO_SHIP_TO_ADDRESS, /Zan-F Power Systems/);
  assert.match(DEFAULT_PO_SHIP_TO_ADDRESS, /600 043/);
  assert.match(DEFAULT_PO_SHIP_TO_ADDRESS, /33ACZPZ6285D1ZR/);
  assert.match(DEFAULT_PO_SHIP_TO_ADDRESS, /9500245599/);
  assert.match(DEFAULT_PO_SHIP_TO_ADDRESS, /info@zanf\.in/);
});
