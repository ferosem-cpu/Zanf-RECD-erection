import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalisePhone, last10, matchProduct, siteInputSchema, submissionSchema, canReopen, composeAddress, orderNumberFor, siteDisplayName, expandedSiteCount, looksLikeEmail } from "../src/services/portalDomain";
import { findForbiddenKeys, assertCustomerSafe } from "../src/lib/portalProjection";
import { detectFileType } from "../src/lib/portalFiles";
import { isCustomerWebBlocked } from "../src/lib/authPolicy";

const baseSite = { name: "Plant 1", line: "12 Main Rd", city: "Chennai", state: "Tamil Nadu", pincode: "600001", contacts: [{ name: "Raj", phone: "98765 43210" }], ratingKva: 250 };

test("phone normalisation", () => {
  assert.equal(normalisePhone("98765 43210"), "+919876543210");
  assert.equal(normalisePhone("+91-98765-43210"), "+919876543210");
  assert.equal(normalisePhone("09876543210"), "+919876543210");
  assert.equal(normalisePhone("12345"), null);
  assert.equal(normalisePhone("1234567890"), null);
  assert.equal(last10("+91 98765 43210"), "9876543210");
  assert.ok(looksLikeEmail("a@b.co") && !looksLikeEmail("a@b"));
});
test("kVA matching: exact, nearest, ties round up", () => {
  const p = [{ id: "a", model: "R-125", capacityKva: 125 }, { id: "b", model: "R-250", capacityKva: 250 }, { id: "c", model: "R-500", capacityKva: 500 }];
  assert.deepEqual(matchProduct(p, 250), { product: p[1], exact: true });
  assert.equal(matchProduct(p, 300)!.product.id, "b");
  assert.equal(matchProduct(p, 375)!.product.id, "c");
  assert.equal(matchProduct(p, 187.5)!.product.id, "b");
  assert.equal(matchProduct(p, 300)!.exact, false);
  assert.equal(matchProduct([], 100), null);
});
test("priority rules: critical/high need reason; critical needs completion date", () => {
  assert.equal(siteInputSchema.safeParse({ ...baseSite, priority: "critical" }).success, false);
  assert.equal(siteInputSchema.safeParse({ ...baseSite, priority: "critical", priorityReason: "Board notice" }).success, false);
  assert.equal(siteInputSchema.safeParse({ ...baseSite, priority: "critical", priorityReason: "Board notice", completeBy: "2026-12-31" }).success, true);
  assert.equal(siteInputSchema.safeParse({ ...baseSite, priority: "high" }).success, false);
  assert.equal(siteInputSchema.safeParse({ ...baseSite, priority: "high", priorityReason: "Audit" }).success, true);
  assert.equal(siteInputSchema.safeParse({ ...baseSite }).success, true);
  assert.equal(siteInputSchema.safeParse({ ...baseSite, startBy: "2026-12-10", completeBy: "2026-12-01" }).success, false);
});
test("site field validation: pincode, state, phone", () => {
  assert.equal(siteInputSchema.safeParse({ ...baseSite, pincode: "6000" }).success, false);
  assert.equal(siteInputSchema.safeParse({ ...baseSite, state: "Atlantis" }).success, false);
  assert.equal(siteInputSchema.safeParse({ ...baseSite, contacts: [{ name: "R", phone: "123" }] }).success, false);
  assert.equal(siteInputSchema.safeParse({ ...baseSite, contacts: [] }).success, false);
});
test("submission caps rows at 200 and needs a key", () => {
  const s = siteInputSchema.parse(baseSite);
  assert.equal(submissionSchema.safeParse({ submissionKey: "abcdefgh12", sites: Array(200).fill(s) }).success, true);
  assert.equal(submissionSchema.safeParse({ submissionKey: "abcdefgh12", sites: Array(201).fill(s) }).success, false);
  assert.equal(submissionSchema.safeParse({ submissionKey: "x", sites: [s] }).success, false);
  assert.equal(expandedSiteCount([{ dgs: [1, 2, 3] }, { dgs: [1] }]), 4);
  assert.equal(siteDisplayName("Plant", 2, 3), "Plant - DG 2");
  assert.equal(siteDisplayName("Plant", 1, 1), "Plant");
});
test("address and order number formats", () => {
  assert.equal(composeAddress({ line: "1 A St", area: "", city: "Chennai", state: "Tamil Nadu", pincode: "600001" }), "1 A St, Chennai, Tamil Nadu, 600001");
  assert.match(orderNumberFor(2026, 0.5), /^ORD-2026-\d{4}$/);
  assert.equal(orderNumberFor(2026, 0.9999999), "ORD-2026-9999");
});
test("reopen only within 15 days of closing", () => {
  const now = new Date("2026-12-20T00:00:00Z");
  assert.equal(canReopen("closed", new Date("2026-12-10T00:00:00Z"), now), true);
  assert.equal(canReopen("closed", new Date("2026-12-01T00:00:00Z"), now), false);
  assert.equal(canReopen("open", new Date("2026-12-19T00:00:00Z"), now), false);
  assert.equal(canReopen("closed", null, now), false);
});
test("forbidden-key guard catches money/staff/internal fields at any depth and passes safe ones", () => {
  assert.ok(findForbiddenKeys({ a: { value: 1 } }).length);
  assert.ok(findForbiddenKeys({ list: [{ salesEngineer: "x" }] }).length);
  assert.ok(findForbiddenKeys({ totalAmount: 1 }).length);
  assert.ok(findForbiddenKeys({ assignedToId: "x" }).length);
  assert.ok(findForbiddenKeys({ rootCause: "x" }).length);
  assert.ok(findForbiddenKeys({ photosDriveFolderUrl: "x" }).length);
  assert.ok(findForbiddenKeys({ invoiceNumber: "x" }).length);
  assert.throws(() => assertCustomerSafe({ price: 1 }));
  assert.deepEqual(findForbiddenKeys({ id: 1, name: "x", ratingKva: 250, stage: { label: "a" }, sites: [{ countByKva: { "250": 1 } }], installPriority: "high", customerPoNumber: "P1" }), []);
});
test("upload type detection by signature, not extension", () => {
  const pad = Buffer.alloc(16);
  assert.equal(detectFileType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad]))!.mime, "image/jpeg");
  assert.equal(detectFileType(Buffer.concat([Buffer.from("%PDF-1.7"), pad]))!.mime, "application/pdf");
  assert.equal(detectFileType(Buffer.concat([Buffer.from("MZ"), pad])), null);
  assert.equal(detectFileType(Buffer.concat([Buffer.from("<html><script>"), pad])), null);
});
test("customer web block: off until PORTAL_ENABLED; then customers blocked, staff not", () => {
  const cust = { customerId: "c1", role: { key: "customer" } };
  const staff = { customerId: null, role: { key: "super_admin" } };
  assert.equal(isCustomerWebBlocked(cust, {} as any), false);
  assert.equal(isCustomerWebBlocked(cust, { PORTAL_ENABLED: "true" } as any), true);
  assert.equal(isCustomerWebBlocked({ role: { key: "customer" } }, { PORTAL_ENABLED: "true" } as any), true);
  assert.equal(isCustomerWebBlocked(staff, { PORTAL_ENABLED: "true" } as any), false);
});

test("site with several DG sets: each DG has its own rating, model and location; legacy shape still works", () => {
  const base = { name: "P", line: "1 St", city: "Chennai", state: "Tamil Nadu", pincode: "600001", contacts: [{ name: "Raj", phone: "9876543210" }] };
  const multi = siteInputSchema.parse({ ...base, dgs: [{ ratingKva: 250, dgModel: "Cummins C250", dgLocation: "Outdoor" }, { ratingKva: 125, dgLocation: "Rooftop" }] });
  assert.deepEqual(multi.dgs.map((d) => d.ratingKva), [250, 125]);
  assert.equal(multi.dgs[0].dgModel, "Cummins C250"); assert.equal(multi.dgs[1].dgModel, undefined);
  const legacy = siteInputSchema.parse({ ...base, ratingKva: 125, dgSets: 3, dgModel: "X", dgLocation: "Indoor" });
  assert.equal(legacy.dgs.length, 3); assert.ok(legacy.dgs.every((d) => d.ratingKva === 125 && d.dgModel === "X" && d.dgLocation === "Indoor"));
  assert.equal(siteInputSchema.safeParse({ ...base, dgs: [] }).success, false);
  assert.equal(siteInputSchema.safeParse({ ...base }).success, false);
  assert.equal(siteInputSchema.safeParse({ ...base, dgs: [{ ratingKva: 0 }] }).success, false);
  assert.equal(siteInputSchema.safeParse({ ...base, dgs: [{ ratingKva: 250, dgLocation: "Moon" }] }).success, false);
  assert.equal(siteInputSchema.safeParse({ ...base, dgs: Array.from({ length: 51 }, () => ({ ratingKva: 250 })) }).success, false);
});
test("one submission is capped at 300 DG sets in total", () => {
  const s = { name: "P", line: "1 St", city: "Chennai", state: "Tamil Nadu", pincode: "600001", contacts: [{ name: "Raj", phone: "9876543210" }], dgs: Array.from({ length: 50 }, () => ({ ratingKva: 250 })) };
  assert.equal(submissionSchema.safeParse({ submissionKey: "key-abcdefgh", sites: Array.from({ length: 6 }, () => s) }).success, true);
  assert.equal(submissionSchema.safeParse({ submissionKey: "key-abcdefgh", sites: Array.from({ length: 7 }, () => s) }).success, false);
});
