import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { siteView } from "../src/routes/portal/sites";
import { assertCustomerSafe, findForbiddenKeys } from "../src/lib/portalProjection";

const d = (s: string) => new Date(s);
const row: any = {
  id: "s1", orderId: "o1", companyName: "Plant", address: "1 St, Chennai", addressParts: { line: "1 St", city: "Chennai" }, gpsLat: 13.1, gpsLng: 80.2, source: "portal",
  dgCapacityKva: "250", dgModel: "X", dgLocation: "Indoor", accessNotes: "gate pass", requestedStartDate: d("2026-12-01"), requestedCompletionDate: null,
  installPriority: "high", priorityReason: "Audit", updatedAt: d("2026-11-22T10:00:00Z"), currentStage: { key: "measuring", label: "Measuring", phase: "INSTALLATION", sequenceOrder: 4 },
  order: { id: "o1", orderNumber: "ORD-2026-1111", customerId: "c1", portalSubmissionId: "ps1" },
  // internal fields that must never leak:
  assignedEngineerId: "eng1", vendorId: "v1", photosDriveFolderUrl: "http://drive", structureDiagramUrl: "x",
  contacts: [{ id: "k1", name: "Raj", phone: "+919876543210", email: null, role: "FM", createdAt: d("2026-11-22") }],
  documentRequirements: [{ required: true, status: "submitted", documentUrl: "portal-attachment:a1", notes: null, requirementType: { key: "esic", label: "ESIC", sequenceOrder: 2 } }],
  stageEvents: [{ createdAt: d("2026-11-22T11:00:00Z"), statusOption: { label: "In progress" }, createdById: "staff1" }],
};
test("siteView exposes only customer-safe fields", () => {
  const v = siteView(row);
  assert.deepEqual(findForbiddenKeys(v), []);
  assertCustomerSafe({ site: v });
  const json = JSON.stringify(v);
  for (const leak of ["eng1", "v1", "drive", "staff1", "structureDiagramUrl", "createdById"]) assert.ok(!json.includes(leak), leak);
  assert.equal(v.stage.phase, "Installation");
  assert.equal(v.priorityEditable, true);
  assert.equal(v.formalities[0].hasDocument, true);
  assert.equal(v.ratingKva, 250);
});
test("map link only for portal-created sites; priority locked from Installing (seq 8)", () => {
  assert.match(siteView(row).mapUrl!, /google\.com\/maps/);
  assert.equal(siteView({ ...row, source: null }).mapUrl, null);
  assert.equal(siteView({ ...row, currentStage: { ...row.currentStage, sequenceOrder: 8 } }).priorityEditable, false);
});
