import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { createPortalSubmission } from "../src/services/portalOrders";
import { submissionSchema, siteInputSchema } from "../src/services/portalDomain";

function fakeDb() {
  const subs: any[] = [], orders: any[] = [], links: any[] = [];
  const db: any = {
    portalSubmission: {
      findUnique: async ({ where }: any) => subs.find((s) => s.submissionKey === where.submissionKey) ?? null,
      findUniqueOrThrow: async ({ where }: any) => subs.find((s) => s.submissionKey === where.submissionKey),
      create: async ({ data }: any) => {
        if (subs.some((s) => s.submissionKey === data.submissionKey)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
        const s = { id: "sub" + (subs.length + 1), ...data }; subs.push(s); return s;
      },
    },
    stageDefinition: { findUniqueOrThrow: async () => ({ id: "stage1" }) },
    product: { findMany: async () => [{ id: "p125", model: "R125", capacityKva: 125 }, { id: "p250", model: "R250", capacityKva: 250 }] },
    documentRequirementType: { findMany: async () => [{ id: "d1", key: "police_verification", label: "Police verification" }, { id: "d2", key: "esic", label: "ESIC" }] },
    portalAttachment: { findMany: async () => [], updateMany: async (a: any) => { links.push(a); return { count: 1 }; } },
    order: {
      findUnique: async ({ where }: any) => orders.find((o) => o.orderNumber === where.orderNumber) ?? null,
      findMany: async ({ where }: any) => orders.filter((o) => o.portalSubmissionId === where.portalSubmissionId),
      create: async ({ data }: any) => { const o = { id: "o" + (orders.length + 1), ...data, site: { id: "s" + (orders.length + 1), companyName: data.site.create.companyName, dgCapacityKva: data.site.create.dgCapacityKva, createData: data.site.create } }; orders.push(o); return o; },
    },
    $transaction: async (fn: any) => fn(db),
  };
  return { db, subs, orders, links };
}
const site = (o: any = {}) => siteInputSchema.parse({ name: "Plant", line: "1 St", city: "Chennai", state: "Tamil Nadu", pincode: "600001", contacts: [{ name: "Raj", phone: "9876543210" }], ratingKva: 250, ...o });
const who = { userId: "u1", customerId: "c1" };

test("one Order+Site per DG set, never OrderLineItems, customer-pinned, no price, portal flags", async () => {
  const { db, orders, subs } = fakeDb();
  const input = submissionSchema.parse({ submissionKey: "key-abcdefgh", customerPoNumber: "PO1", sites: [site({ dgSets: 3 }), site({ name: "B", ratingKva: 130, priority: "critical", priorityReason: "Notice", completeBy: "2026-12-30", formalities: { esic: true } })] });
  const r = await createPortalSubmission(db, who, input);
  assert.equal(r.replay, false);
  assert.equal(orders.length, 4);
  assert.equal(subs.length, 1);
  assert.deepEqual(r.orders.map((o) => o.siteName), ["Plant - DG 1", "Plant - DG 2", "Plant - DG 3", "B"]);
  assert.deepEqual(r.countByKva, { "250": 3, "130": 1 });
  for (const o of orders) {
    assert.equal(o.customerId, "c1"); assert.equal(o.quantity, 1); assert.equal(o.requestedByCustomer, true);
    assert.equal(o.value, undefined); assert.equal(o.lineItems, undefined); assert.equal(o.portalSubmissionId, "sub1");
    assert.equal(o.site.createData.source, "portal"); assert.equal(o.site.createData.currentStageId, "stage1");
    assert.equal(o.site.createData.documentRequirements.create.length, 2);
  }
  assert.equal(new Set(orders.map((o) => o.orderNumber)).size, 4);
  assert.equal(orders[3].productId, "p125");
  assert.match(orders[3].customerNotes, /nearest RECD R125/);
  assert.equal(orders[3].site.createData.documentRequirements.create.find((d: any) => d.requirementTypeId === "d2").required, true);
  assert.equal(orders[3].site.createData.installPriority, "critical");
});
test("double submit with the same key returns the same records and creates nothing new", async () => {
  const { db, orders } = fakeDb();
  const input = submissionSchema.parse({ submissionKey: "key-dupe1234", sites: [site(), site({ name: "Two" })] });
  const a = await createPortalSubmission(db, who, input);
  const b = await createPortalSubmission(db, who, input);
  assert.equal(b.replay, true);
  assert.equal(orders.length, 2);
  assert.deepEqual(b.orders.map((o) => o.orderNumber), a.orders.map((o) => o.orderNumber));
  assert.equal(a.submission.id, b.submission.id);
});
test("a submission key used by another customer is refused", async () => {
  const { db } = fakeDb();
  const input = submissionSchema.parse({ submissionKey: "key-other123", sites: [site()] });
  await createPortalSubmission(db, who, input);
  await assert.rejects(createPortalSubmission(db, { userId: "u2", customerId: "c2" }, input), /already used/);
});

test("a site with DGs of different ratings, models and locations becomes one Order+Site per DG under one submission", async () => {
  const { db, orders, subs } = fakeDb();
  const input = submissionSchema.parse({ submissionKey: "key-multidg1", sites: [siteInputSchema.parse({ name: "Mill", line: "1 St", city: "Chennai", state: "Tamil Nadu", pincode: "600001", contacts: [{ name: "Raj", phone: "9876543210" }],
    dgs: [{ ratingKva: 250, dgModel: "Cummins C250", dgLocation: "Outdoor" }, { ratingKva: 125, dgModel: "Kirloskar K125", dgLocation: "Rooftop" }, { ratingKva: 130, ratingUnsure: true }] })] });
  const r = await createPortalSubmission(db, who, input);
  assert.equal(subs.length, 1); assert.equal(orders.length, 3);
  assert.deepEqual(r.orders.map((o) => o.siteName), ["Mill - DG 1", "Mill - DG 2", "Mill - DG 3"]);
  assert.deepEqual(orders.map((o) => o.productId), ["p250", "p125", "p125"]);
  assert.deepEqual(orders.map((o) => o.site.createData.dgCapacityKva), [250, 125, 130]);
  assert.deepEqual(orders.map((o) => o.site.createData.dgModel), ["Cummins C250", "Kirloskar K125", undefined]);
  assert.deepEqual(orders.map((o) => o.site.createData.dgLocation), ["Outdoor", "Rooftop", undefined]);
  assert.deepEqual(r.countByKva, { "250": 1, "125": 1, "130": 1 });
  assert.deepEqual(r.confirmation.map((c) => c.ratingKva), [250, 125, 130]);
  assert.match(orders[2].customerNotes, /130 kVA \(not sure\)/);
  assert.ok(orders.every((o) => o.portalSubmissionId === "sub1"));
});
test("a single-DG site keeps its plain name", async () => {
  const { db } = fakeDb();
  const r = await createPortalSubmission(db, who, submissionSchema.parse({ submissionKey: "key-singledg", sites: [site()] }));
  assert.deepEqual(r.orders.map((o) => o.siteName), ["Plant"]);
});

test("each DG's photos are linked to that DG's own Order+Site", async () => {
  const { db, orders, links } = fakeDb();
  db.portalAttachment.findMany = async ({ where }: any) => where.id.in.map((id: string) => ({ id }));
  const input = submissionSchema.parse({ submissionKey: "key-dgphotos", sites: [siteInputSchema.parse({ name: "Mill", line: "1 St", city: "Chennai", state: "Tamil Nadu", pincode: "600001", contacts: [{ name: "Raj", phone: "9876543210" }],
    dgs: [{ ratingKva: 250, photoIds: ["a1", "a2"] }, { ratingKva: 125, photoIds: ["b1"] }] })] });
  await createPortalSubmission(db, who, input);
  const byOrder = links.filter((l: any) => l.data.orderId).map((l: any) => [l.data.orderId, l.where.id.in]);
  assert.deepEqual(byOrder, [[orders[0].id, ["a1", "a2"]], [orders[1].id, ["b1"]]]);
});
test("a photo that is not the customer's (or already used) is refused", async () => {
  const { db } = fakeDb();
  db.portalAttachment.findMany = async () => [];
  const input = submissionSchema.parse({ submissionKey: "key-badphoto", sites: [siteInputSchema.parse({ name: "Mill", line: "1 St", city: "Chennai", state: "Tamil Nadu", pincode: "600001", contacts: [{ name: "Raj", phone: "9876543210" }], dgs: [{ ratingKva: 250, photoIds: ["x"] }] })] });
  await assert.rejects(createPortalSubmission(db, who, input), /could not be found/);
});
