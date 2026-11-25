import { test } from "node:test";
import assert from "node:assert/strict";
import { addUserHint, normaliseMobile, accessLabel, locationName, locationOptions, assignableSites, assignHint, shortAddress, fullAddress, type LocationRow } from "../src/lib/customerLocations";

const locs: LocationRow[] = [
  { id: "b", name: "Bangalore", active: true }, { id: "m", name: "Mangalore", active: true }, { id: "y", name: "Mysore", active: false },
];

test("dropdown options: active locations, sorted, plus the current one even when deactivated", () => {
  assert.deepEqual(locationOptions(locs).map((l) => l.name), ["Bangalore", "Mangalore"]);
  assert.deepEqual(locationOptions(locs, "y").map((l) => l.name), ["Bangalore", "Mangalore", "Mysore"]);
  assert.deepEqual(locationOptions([], null), []);
});

test("labels: no location = customer admin; a deactivated location warns that its users cannot sign in", () => {
  assert.equal(accessLabel(locs, null), "Customer admin");
  assert.equal(accessLabel(locs, "b"), "Bangalore only");
  assert.match(accessLabel(locs, "y"), /cannot sign in/);
  assert.equal(accessLabel(locs, "zzz"), "Unknown location");
  assert.match(locationName(locs, null), /All locations/);
  assert.equal(locationName(locs, "y"), "Mysore (deactivated)");
});

test("mobile: +91 and 10 digits, blank allowed, junk rejected", () => {
  assert.equal(normaliseMobile("98765 43210"), "+919876543210");
  assert.equal(normaliseMobile("+91 98765-43210"), "+919876543210");
  assert.equal(normaliseMobile("09876543210"), "+919876543210");
  assert.equal(normaliseMobile("  "), "");
  for (const bad of ["12345", "5876543210", "98765432101", "abc"]) assert.equal(normaliseMobile(bad), null, bad);
});

test("add-portal-user hint: empty = ready, otherwise says what is missing", () => {
  assert.equal(addUserHint({ name: "A", email: "a@b.in", phone: "" }), "");
  assert.equal(addUserHint({ name: "A", email: "a@b.in", phone: "9876543210" }), "");
  assert.match(addUserHint({ name: " ", email: "a@b.in", phone: "" }), /name/);
  assert.match(addUserHint({ name: "A", email: "nope", phone: "" }), /e-mail/);
  assert.match(addUserHint({ name: "A", email: "a@b.in", phone: "123" }), /Mobile/);
});

test("assign-sites box: unassigned by default, all on request, search by site or order", () => {
  const s = [{ id: "1", name: "VRL", orderNumber: "ORD-6021", stage: null, customerLocationId: null }, { id: "2", name: "BPCL", orderNumber: "ORD-6007", stage: null, customerLocationId: "b" }];
  assert.deepEqual(assignableSites(s, false).map((x) => x.id), ["1"]);
  assert.deepEqual(assignableSites(s, true).map((x) => x.id), ["1", "2"]);
  assert.deepEqual(assignableSites(s, true, "6007").map((x) => x.id), ["2"]);
  assert.match(assignHint("", 2), /location/); assert.match(assignHint("b", 0), /site/); assert.equal(assignHint("b", 1), "");
});

test("assign-sites: address shown short (city first), full in tooltip; search matches address, city and product", () => {
  const full = "Plot 4, MIDC Road, Chincholi, Gulbarga - 585307, Karnataka";
  const a = { id: "1", name: "BPCL", orderNumber: "ORD-6007", stage: null, customerLocationId: null, address: full, city: null, product: "RECD-500" };
  const b = { id: "2", name: "BPCL", orderNumber: "ORD-9", stage: null, customerLocationId: null, address: "Hubli", city: "Hubballi" };
  assert.equal(shortAddress({ address: "Gulbarga", city: null }), "Gulbarga");
  assert.equal(shortAddress({ address: full + " extra extra extra", city: null }).length <= 48, true);
  assert.equal(shortAddress({ address: full, city: "Gulbarga" }), "Gulbarga");
  assert.equal(fullAddress(a), full); assert.equal(shortAddress({ address: null, city: null }), "");
  assert.deepEqual(assignableSites([a, b], false, "gul").map((x) => x.id), ["1"]);
  assert.deepEqual(assignableSites([a, b], false, "hubballi").map((x) => x.id), ["2"]);
  assert.deepEqual(assignableSites([a, b], false, "recd-500").map((x) => x.id), ["1"]);
  assert.deepEqual(assignableSites([a, b], false, "bpcl").map((x) => x.id), ["1", "2"]);
});
