import { test } from "node:test";
import assert from "node:assert/strict";
import { addUserHint, normaliseMobile, accessLabel, locationName, locationOptions, type LocationRow } from "../src/lib/customerLocations";

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
