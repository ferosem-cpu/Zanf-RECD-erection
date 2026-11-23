import "./_testEnv";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DB, installFakePrisma, mkAttachment, mkComplaint, mkCustomer, mkEvent, mkLocation, mkPending, mkSite, mkUser, resetDb, match } from "./_portalFake";
import { PORTAL_HEADERS } from "../src/services/portalAuth";
import { sha256Hex, signBridgeRequest } from "../src/services/whatsappBridgeAuth";
import { setDriveApiOverride, type DriveApi } from "../src/lib/portalDrive";
import { attachmentWhere, complaintWhere, filterFrom, orderWhere, resolveSubmissionLocation, scopeOf, siteWhere } from "../src/services/portalScope";

const SECRET = "portal-secret-0123456789";
let server: Server; let base = "";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);

before(async () => {
  process.env.PORTAL_ENABLED = "true"; process.env.PORTAL_BRIDGE_KEYS = "p1:" + SECRET;
  installFakePrisma();
  seed();
  setDriveApiOverride({ rootFolderId: () => "ROOT", download: async (id: string) => Buffer.from("bytes-of-" + id), remove: async () => undefined } as unknown as DriveApi);
  const { portalRouter } = await import("../src/routes/portal/index");
  const app = express(); app.use("/portal", portalRouter);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(() => { server.close(); setDriveApiOverride(null); });

// ---- data: Deccan (C1) with Bangalore + Mangalore + a deactivated Mysore, and an unrelated customer (C2) ----
function seed() {
  resetDb();
  mkCustomer("C1", "Deccan"); mkCustomer("C2", "Other Co");
  mkLocation("L_blr", "C1", "Bangalore"); mkLocation("L_mng", "C1", "Mangalore"); mkLocation("L_old", "C1", "Mysore", false); mkLocation("L_x", "C2", "Pune");
  mkUser("uAdmin", "C1", null); mkUser("uLegacy", "C1", null); mkUser("uBlr", "C1", "L_blr"); mkUser("uMng", "C1", "L_mng"); mkUser("uOld", "C1", "L_old"); mkUser("uOther", "C2", null); mkUser("uPune", "C2", "L_x");
  mkUser("uStaff", null, null, { role: { key: "management" } }); mkUser("uOff", "C1", null, { isActive: false });
  mkSite("s_blr", "C1", "L_blr"); mkSite("s_mng", "C1", "L_mng"); mkSite("s_none", "C1", null); mkSite("s_oth", "C2", null); mkSite("s_pune", "C2", "L_x");
  mkComplaint("cp_blr", "C1", "s_blr"); mkComplaint("cp_mng", "C1", "s_mng"); mkComplaint("cp_none", "C1", null); mkComplaint("cp_oth", "C2", "s_oth", { status: "closed", closedAt: new Date() });
  mkPending("pa_blr", "s_blr"); mkPending("pa_mng", "s_mng"); mkPending("pa_none", "s_none"); mkPending("pa_oth", "s_oth");
  mkEvent("ev_blr", "s_blr"); mkEvent("ev_mng", "s_mng"); mkEvent("ev_none", "s_none");
  mkAttachment("a_blr_photo", "C1", { siteId: "s_blr", orderId: "o_s_blr" }); mkAttachment("a_mng_photo", "C1", { siteId: "s_mng", orderId: "o_s_mng" });
  mkAttachment("a_blr_po", "C1", { kind: "po", orderId: "o_s_blr" }); mkAttachment("a_mng_po", "C1", { kind: "po", orderId: "o_s_mng" });
  mkAttachment("a_blr_cp", "C1", { kind: "complaint_photo", complaintId: "cp_blr" }); mkAttachment("a_mng_cp", "C1", { kind: "complaint_photo", complaintId: "cp_mng" }); mkAttachment("a_none_cp", "C1", { kind: "complaint_photo", complaintId: "cp_none" });
  mkAttachment("a_none_photo", "C1", { siteId: "s_none", orderId: "o_s_none" });
  mkAttachment("a_draft_blr", "C1", { draftId: "draft-blr-1", uploadedByUserId: "uBlr" }); mkAttachment("a_draft_admin", "C1", { draftId: "draft-adm-1", uploadedByUserId: "uAdmin" });
  mkAttachment("a_oth", "C2", { siteId: "s_oth", orderId: "o_s_oth" });
}

function call(uid: string, method: string, path: string, body?: unknown, raw?: Buffer) {
  const pathQuery = path + (path.includes("?") ? "&" : "?") + "uid=" + uid;
  const payload = raw ?? (body === undefined ? "" : JSON.stringify(body));
  const ts = String(Math.floor(Date.now() / 1000)); const nonce = crypto.randomBytes(16).toString("hex");
  return fetch(base + "/portal" + pathQuery, {
    method, body: method === "GET" ? undefined : (payload as BodyInit),
    headers: { [PORTAL_HEADERS.keyId]: "p1", [PORTAL_HEADERS.timestamp]: ts, [PORTAL_HEADERS.nonce]: nonce, [PORTAL_HEADERS.signature]: signBridgeRequest(SECRET, method, "/portal" + pathQuery, ts, nonce, sha256Hex(payload)), "content-type": raw ? "application/octet-stream" : "application/json" },
  });
}
const get = async (uid: string, path: string) => { const r = await call(uid, "GET", path); return { status: r.status, body: await r.json().catch(() => null) as any }; };
const send = async (uid: string, method: string, path: string, body?: unknown) => { const r = await call(uid, method, path, body); return { status: r.status, body: await r.json().catch(() => null) as any }; };
const ids = (xs: any[], k = "id") => xs.map((x) => x[k]).sort();
const orderRef = (siteId: string) => "ORD-" + siteId;
const siteNames = async (uid: string) => { const r = await get(uid, "/orders"); return r.body.orders.flatMap((o: any) => o.orderNumbers).sort(); };

test("scope builders: admin sees the whole customer, a location user only that location, filters never widen a location user", () => {
  const admin = scopeOf({ userId: "u", customerId: "C1", customerLocationId: null }), blr = scopeOf({ userId: "u", customerId: "C1", customerLocationId: "L_blr" });
  assert.deepEqual(siteWhere(admin), { order: { customerId: "C1" } });
  assert.deepEqual(siteWhere(blr), { order: { customerId: "C1" }, customerLocationId: "L_blr" });
  assert.deepEqual(siteWhere(admin, "L_mng"), { order: { customerId: "C1" }, customerLocationId: "L_mng" });
  assert.deepEqual(siteWhere(admin, "none"), { order: { customerId: "C1" }, customerLocationId: null });
  assert.deepEqual(siteWhere(blr, "L_mng"), siteWhere(blr)); // filter cannot move a location user
  assert.equal(filterFrom(blr, "L_mng"), undefined); assert.equal(filterFrom(admin, "L_mng"), "L_mng"); assert.equal(filterFrom(admin, "x; drop"), undefined); assert.equal(filterFrom(admin, undefined), undefined);
  assert.deepEqual(orderWhere(blr), { customerId: "C1", site: { customerLocationId: "L_blr" } });
  assert.deepEqual(complaintWhere(admin), { customerId: "C1" });
  assert.deepEqual(complaintWhere(blr), { customerId: "C1", site: { customerLocationId: "L_blr" } });
  assert.deepEqual(attachmentWhere(admin), { customerId: "C1" });
  assert.ok(JSON.stringify(attachmentWhere(blr)).includes('"uploadedByUserId":"u"'));
  assert.ok(match("site", DB.sites[0], siteWhere(blr)) && !match("site", DB.sites[1], siteWhere(blr)));
});

test("identity: legacy (no location) users are customer admins; deactivated location, inactive user and staff are refused", async () => {
  for (const u of ["uAdmin", "uLegacy", "uBlr", "uMng", "uOther"]) assert.equal((await get(u, "/me")).status, 200, u);
  for (const u of ["uOld", "uOff", "uStaff", "ghost"]) assert.equal((await get(u, "/me")).status, 403, u);
  const me = (await get("uBlr", "/me")).body; assert.equal(me.location.name, "Bangalore"); assert.equal(me.isAdmin, false); assert.equal(me.company, "Deccan");
  const adm = (await get("uAdmin", "/me")).body; assert.equal(adm.location, null); assert.equal(adm.isAdmin, true);
  const l1 = (await get("uBlr", "/locations")).body.locations, l2 = (await get("uAdmin", "/locations")).body.locations;
  assert.deepEqual(ids(l1), ["L_blr"]); assert.deepEqual(ids(l2), ["L_blr", "L_mng", "L_old"]);
});

test("orders and submissions: isolation between locations and between customers, admin sees all, filters work for admins only", async () => {
  assert.deepEqual(await siteNames("uAdmin"), [orderRef("s_blr"), orderRef("s_mng"), orderRef("s_none")]);
  assert.deepEqual(await siteNames("uLegacy"), await siteNames("uAdmin"));
  assert.deepEqual(await siteNames("uBlr"), [orderRef("s_blr")]);
  assert.deepEqual(await siteNames("uMng"), [orderRef("s_mng")]);
  assert.deepEqual(await siteNames("uOther"), [orderRef("s_oth"), orderRef("s_pune")]);
  assert.deepEqual(await siteNames("uPune"), [orderRef("s_pune")]);
  const f = async (u: string, q: string) => { const r = await get(u, "/orders?location=" + q); return r.body.orders.flatMap((o: any) => o.orderNumbers).sort(); };
  assert.deepEqual(await f("uAdmin", "L_blr"), [orderRef("s_blr")]);
  assert.deepEqual(await f("uAdmin", "none"), [orderRef("s_none")]);
  assert.deepEqual(await f("uAdmin", "L_x"), []); // another customer's location id shows nothing
  assert.deepEqual(await f("uBlr", "L_mng"), [orderRef("s_blr")]); // a location user cannot switch location
  assert.deepEqual(await f("uBlr", "none"), [orderRef("s_blr")]);
  // order detail
  assert.equal((await get("uBlr", "/orders/o_o_s_blr")).status, 200);
  for (const [u, id] of [["uBlr", "o_o_s_mng"], ["uBlr", "o_o_s_none"], ["uBlr", "o_o_s_oth"], ["uMng", "o_o_s_blr"], ["uOther", "o_o_s_blr"], ["uAdmin", "o_o_s_oth"]]) assert.equal((await get(u, "/orders/" + id)).status, 404, u + " " + id);
  assert.equal((await get("uAdmin", "/orders/o_o_s_none")).status, 200);
});

test("sites, timeline, updates: only the user's scope", async () => {
  const can: Record<string, string[]> = { uAdmin: ["s_blr", "s_mng", "s_none"], uLegacy: ["s_blr", "s_mng", "s_none"], uBlr: ["s_blr"], uMng: ["s_mng"], uOther: ["s_oth", "s_pune"], uPune: ["s_pune"] };
  const all = ["s_blr", "s_mng", "s_none", "s_oth", "s_pune"];
  for (const [u, ok] of Object.entries(can)) for (const s of all) {
    const want = ok.includes(s) ? 200 : 404;
    assert.equal((await get(u, "/sites/" + s)).status, want, u + " site " + s);
    assert.equal((await get(u, "/sites/" + s + "/timeline")).status, want, u + " timeline " + s);
    assert.equal((await send(u, "PATCH", "/sites/" + s + "/access-notes", { version: "x", accessNotes: "n" })).status === 404, want === 404, u + " patch " + s);
  }
  const up = async (u: string, q = "") => ids((await get(u, "/updates" + q)).body.updates, "siteId");
  assert.deepEqual(await up("uAdmin"), ["s_blr", "s_mng", "s_none"]); assert.deepEqual(await up("uBlr"), ["s_blr"]); assert.deepEqual(await up("uBlr", "?location=L_mng"), ["s_blr"]); assert.deepEqual(await up("uAdmin", "?location=L_mng"), ["s_mng"]);
  assert.equal((await get("uBlr", "/sites/s_blr")).body.site.location, "Bangalore");
});

test("site writes: a location user can update only their own site; nothing changes on a refused attempt", async () => {
  const s = DB.sites.find((x) => x.id === "s_blr")!, m = DB.sites.find((x) => x.id === "s_mng")!;
  const ver = s.updatedAt.toISOString();
  assert.equal((await send("uMng", "PATCH", "/sites/s_blr/access-notes", { version: ver, accessNotes: "hacked" })).status, 404);
  assert.equal(s.accessNotes, null);
  assert.equal((await send("uBlr", "PATCH", "/sites/s_mng/access-notes", { version: m.updatedAt.toISOString(), accessNotes: "hacked" })).status, 404);
  assert.equal(m.accessNotes, null);
  assert.equal((await send("uBlr", "PATCH", "/sites/s_blr/access-notes", { version: ver, accessNotes: "Gate B" })).status, 200);
  assert.equal(s.accessNotes, "Gate B");
  for (const u of ["uMng", "uOther"]) { assert.equal((await send(u, "PATCH", "/sites/s_blr/contacts", { version: ver, contacts: [{ name: "X", phone: "9876543210" }] })).status, 404); assert.equal((await send(u, "PATCH", "/sites/s_blr/priority", { version: ver, priority: "high", reason: "r" })).status, 404); }
});

test("pending actions: list and respond are scoped", async () => {
  const list = async (u: string, q = "") => ids((await get(u, "/pending-actions" + q)).body.actions);
  assert.deepEqual(await list("uAdmin"), ["pa_blr", "pa_mng", "pa_none"]); assert.deepEqual(await list("uBlr"), ["pa_blr"]); assert.deepEqual(await list("uMng"), ["pa_mng"]); assert.deepEqual(await list("uOther"), ["pa_oth"]);
  assert.deepEqual(await list("uAdmin", "?location=none"), ["pa_none"]); assert.deepEqual(await list("uBlr", "?location=L_mng"), ["pa_blr"]);
  assert.equal((await send("uBlr", "POST", "/pending-actions/pa_mng/respond", { response: "ok" })).status, 404);
  assert.equal(DB.pending.find((p) => p.id === "pa_mng")!.status, "open");
  assert.equal((await send("uBlr", "POST", "/pending-actions/pa_blr/respond", { response: "ok" })).status, 200);
  assert.equal(DB.pending.find((p) => p.id === "pa_blr")!.status, "resolved");
});

test("complaints: list, detail, comments, reopen, and raising are scoped; site-less complaints are admin-only", async () => {
  const list = async (u: string, q = "") => ids((await get(u, "/complaints" + q)).body.complaints);
  assert.deepEqual(await list("uAdmin"), ["cp_blr", "cp_mng", "cp_none"]); assert.deepEqual(await list("uLegacy"), ["cp_blr", "cp_mng", "cp_none"]);
  assert.deepEqual(await list("uBlr"), ["cp_blr"]); assert.deepEqual(await list("uMng"), ["cp_mng"]); assert.deepEqual(await list("uOther"), ["cp_oth"]);
  assert.deepEqual(await list("uAdmin", "?location=none"), ["cp_none"]); assert.deepEqual(await list("uAdmin", "?location=L_blr"), ["cp_blr"]); assert.deepEqual(await list("uBlr", "?location=L_mng"), ["cp_blr"]);
  for (const [u, id, want] of [["uBlr", "cp_blr", 200], ["uBlr", "cp_mng", 404], ["uBlr", "cp_none", 404], ["uBlr", "cp_oth", 404], ["uAdmin", "cp_none", 200], ["uAdmin", "cp_oth", 404], ["uOther", "cp_oth", 200]] as const)
    assert.equal((await get(u, "/complaints/" + id)).status, want, u + " " + id);
  assert.equal((await send("uMng", "POST", "/complaints/cp_blr/comments", { body: "hi" })).status, 404);
  assert.equal(DB.comments.length, 0);
  assert.equal((await send("uBlr", "POST", "/complaints/cp_blr/comments", { body: "hi" })).status, 201);
  assert.equal((await send("uBlr", "POST", "/complaints/cp_mng/comments", { body: "hi" })).status, 404);
  assert.equal((await send("uBlr", "POST", "/complaints/cp_none/reopen", { reason: "again" })).status, 404);
  assert.equal((await send("uOther", "POST", "/complaints/cp_oth/reopen", { reason: "again" })).status, 200);
  // raising: only on sites of your own scope
  const mk = (siteId: string) => ({ siteId, category: "delivery", urgency: "normal", description: "Not delivered yet" });
  for (const [u, s] of [["uBlr", "s_mng"], ["uBlr", "s_none"], ["uBlr", "s_oth"], ["uMng", "s_blr"], ["uOther", "s_blr"], ["uAdmin", "s_oth"]] as const) assert.equal((await send(u, "POST", "/complaints", mk(s))).status, 404, u + " raise on " + s);
  assert.equal(DB.complaints.length, 4);
});

test("files: every attachment route is scoped (photos incl. the Drive routes, PO files, complaint photos, drafts)", async () => {
  const content = async (u: string, id: string) => (await call(u, "GET", "/uploads/" + id + "/content")).status;
  const mine: Record<string, string[]> = {
    uBlr: ["a_blr_photo", "a_blr_po", "a_blr_cp", "a_draft_blr"], uMng: ["a_mng_photo", "a_mng_po", "a_mng_cp"],
    uAdmin: ["a_blr_photo", "a_mng_photo", "a_blr_po", "a_mng_po", "a_blr_cp", "a_mng_cp", "a_none_cp", "a_none_photo", "a_draft_blr", "a_draft_admin"], uOther: ["a_oth"],
  };
  mine.uLegacy = mine.uAdmin;
  const every = DB.attachments.map((a) => a.id);
  for (const [u, ok] of Object.entries(mine)) for (const id of every) assert.equal(await content(u, id), ok.includes(id) ? 200 : 404, u + " " + id);
  const r = await call("uBlr", "GET", "/uploads/a_blr_photo/content"); assert.equal(Buffer.from(await r.arrayBuffer()).toString(), "bytes-of-drive:a_blr_photo".replace("drive:", "")); // streamed from Drive by file id
  // deleting a draft upload: only your own
  assert.equal((await send("uAdmin", "DELETE", "/uploads/a_draft_blr")).status, 404);
  assert.equal((await send("uBlr", "DELETE", "/uploads/a_draft_admin")).status, 404);
  assert.ok(DB.attachments.some((a) => a.id === "a_draft_blr") && DB.attachments.some((a) => a.id === "a_draft_admin"));
  assert.equal((await send("uBlr", "DELETE", "/uploads/a_draft_blr")).status, 200);
  assert.equal(DB.attachments.some((a) => a.id === "a_draft_blr"), false);
  // uploading onto another location's site or complaint is refused before any storage call
  for (const [u, q] of [["uBlr", "siteId=s_mng"], ["uBlr", "siteId=s_none"], ["uMng", "siteId=s_blr"], ["uOther", "siteId=s_blr"], ["uBlr", "complaintId=cp_mng"], ["uBlr", "complaintId=cp_none"]] as const) {
    const kind = q.startsWith("site") ? "site_photo" : "complaint_photo";
    assert.equal((await call(u, "POST", "/uploads?kind=" + kind + "&" + q, undefined, JPEG)).status, 404, u + " " + q);
  }
  // site document routes
  for (const [u, s] of [["uBlr", "s_mng"], ["uMng", "s_blr"], ["uOther", "s_blr"]] as const) {
    assert.equal((await call(u, "GET", "/sites/" + s + "/documents/esic/content")).status, 404);
    assert.equal((await call(u, "POST", "/sites/" + s + "/documents/esic", undefined, JPEG)).status, 404);
  }
});

test("new orders: location users are stamped with their own location; admins may pick an active location of their own customer only", async () => {
  const db = { customerLocation: { findFirst: async (a: any) => DB.locations.find((l) => match("customerLocation", l, a.where)) ?? null } } as any;
  const blr = scopeOf({ userId: "u", customerId: "C1", customerLocationId: "L_blr" }), admin = scopeOf({ userId: "u", customerId: "C1", customerLocationId: null });
  assert.deepEqual(await resolveSubmissionLocation(db, blr, "Bangalore", "L_mng"), { ok: true, locationId: "L_blr", locationName: "Bangalore" }); // request is ignored
  assert.deepEqual(await resolveSubmissionLocation(db, blr, "Bangalore"), { ok: true, locationId: "L_blr", locationName: "Bangalore" });
  assert.deepEqual(await resolveSubmissionLocation(db, admin, null), { ok: true, locationId: null, locationName: null });
  assert.deepEqual(await resolveSubmissionLocation(db, admin, null, "L_mng"), { ok: true, locationId: "L_mng", locationName: "Mangalore" });
  assert.deepEqual(await resolveSubmissionLocation(db, admin, null, "L_old"), { ok: false }); // deactivated
  assert.deepEqual(await resolveSubmissionLocation(db, admin, null, "L_x"), { ok: false }); // another customer's
  assert.deepEqual(await resolveSubmissionLocation(db, admin, null, "nope"), { ok: false });
  // the route refuses a foreign or deactivated location with 422 before creating anything
  const site = { name: "P", line: "1 St", city: "Chennai", state: "Tamil Nadu", pincode: "600001", contacts: [{ name: "R", phone: "9876543210" }], dgs: [{ ratingKva: 250 }] };
  for (const loc of ["L_x", "L_old", "nope"]) {
    const r = await send("uAdmin", "POST", "/orders", { submissionKey: "key-abcdefgh", sites: [site], customerLocationId: loc });
    assert.equal(r.status, 422, loc); assert.equal(r.body.field, "customerLocationId");
  }
});

test("sign-in lookup: a user whose location is deactivated gets no code; legacy and active-location users do", async () => {
  const { prisma } = await import("../src/lib/prisma");
  const real = (prisma as any).user.findMany;
  (prisma as any).user.findMany = async (a: any) => DB.users.filter((u) => match("user", u, a.where)).map((u) => ({ ...u, role: { key: "customer" }, customerLocation: u.customerLocation }));
  try {
    const look = async (email: string) => { const r = await call("x", "POST", "/auth/lookup", { identifier: email }); return (await r.json() as any).found; };
    assert.equal(await look("uOld@example.test"), false);
    assert.equal(await look("uBlr@example.test"), true);
    assert.equal(await look("uLegacy@example.test"), true);
  } finally { (prisma as any).user.findMany = real; }
});
