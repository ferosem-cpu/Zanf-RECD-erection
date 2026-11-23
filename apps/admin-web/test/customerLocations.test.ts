import { test } from "node:test";
import assert from "node:assert/strict";
import { accessLabel, locationName, locationOptions, type LocationRow } from "../src/lib/customerLocations";

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
