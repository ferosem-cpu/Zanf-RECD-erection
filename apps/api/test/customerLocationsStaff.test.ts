import "./_testEnv";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { DB, installFakePrisma, mkCustomer, mkLocation, mkSite, mkUser, resetDb } from "./_portalFake";
import { signToken } from "../src/lib/jwt";

let server: Server; let base = "";
const perms = (...keys: string[]) => keys.map((k) => ({ permission: { key: k } }));
function seed() {
  resetDb();
  DB.roles.push({ id: "r_customer", key: "customer" });
  mkCustomer("C1", "Deccan"); mkCustomer("C2", "Other Co");
  mkLocation("L_blr", "C1", "Bangalore"); mkLocation("L_old", "C1", "Mysore", false); mkLocation("L_x", "C2", "Pune");
  mkUser("mgr", null, null, { role: { key: "management", permissions: perms("manage_orders", "view_site_status") }, vendor: null });
  mkUser("viewer", null, null, { role: { key: "ops", permissions: perms("view_site_status") }, vendor: null });
  mkUser("cust", "C1", null, { vendor: null, role: { key: "customer", permissions: perms("manage_orders") } });
  mkUser("c1a", "C1", null); mkUser("c2a", "C2", null, { email: "c2a@example.test" });
  mkSite("s1", "C1", null); mkSite("s2", "C2", null);
}
before(async () => {
  process.env.PORTAL_ENABLED = "false"; // staff API behaviour; the customer web block has its own test below
  installFakePrisma(); seed();
  const { customersRouter } = await import("../src/routes/customers"); const { sitesRouter } = await import("../src/routes/sites");
  const app = express(); app.use(express.json()); app.use("/customers", customersRouter); app.use("/sites", sitesRouter);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(() => server.close());

const tok = (u: string, role: string) => signToken({ userId: u, roleKey: role });
async function req(as: string | null, method: string, p: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (as) headers.authorization = "Bearer " + tok(as, DB.users.find((u) => u.id === as)?.role.key ?? "x");
  const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

test("every location and contact route needs the existing customer-management permission", async () => {
  const calls: [string, string, unknown?][] = [["GET", "/customers/C1/locations"], ["POST", "/customers/C1/locations", { name: "Hubli" }], ["PUT", "/customers/C1/locations/L_blr", { name: "Bengaluru" }],
    ["GET", "/customers/C1/contacts"], ["POST", "/customers/C1/contacts", { name: "A", email: "a@x.in" }], ["PUT", "/customers/C1/contacts/c1a", { name: "B" }], ["PUT", "/sites/s1/location", { customerLocationId: null }]];
  for (const [m, p, b] of calls) {
    assert.equal((await req(null, m, p, b)).status, 401, "no token " + p);
    assert.equal((await req("viewer", m, p, b)).status, 403, "no permission " + p);
  }
  assert.equal(DB.locations.length, 3); assert.equal(DB.users.find((u) => u.id === "c1a")!.name, "User c1a");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "customers.ts"), "utf8");
  for (const route of ['"/:id/locations"', '"/:id/locations/:locId"', '"/:id/contacts"', '"/:id/contacts/:userId"']) assert.match(src, new RegExp(route.replace(/[/:]/g, "\\$&") + ",\\s*requirePermission\\(PERMISSION_KEY\\.MANAGE_ORDERS\\)"), route);
});

test("customer users (web) cannot manage anything: they are blocked at sign-in to the staff API once the portal is on", async () => {
  process.env.PORTAL_ENABLED = "true";
  try { assert.equal((await req("cust", "POST", "/customers/C1/locations", { name: "Hubli" })).status, 403); assert.equal((await req("cust", "PUT", "/sites/s1/location", { customerLocationId: "L_blr" })).status, 403); }
  finally { process.env.PORTAL_ENABLED = "false"; }
});

test("locations: add, reject duplicates (any case), rename, deactivate, list with counts; scoped to the customer", async () => {
  const a = await req("mgr", "POST", "/customers/C1/locations", { name: "  Mangalore " });
  assert.equal(a.status, 201); assert.equal(a.body.name, "Mangalore"); assert.equal(a.body.active, true);
  assert.equal((await req("mgr", "POST", "/customers/C1/locations", { name: "mangalore" })).status, 409);
  assert.equal((await req("mgr", "POST", "/customers/C2/locations", { name: "Mangalore" })).status, 201); // same name is fine for another customer
  for (const bad of [{ name: "" }, { name: "   " }, {}, { name: "x", extra: 1 }]) assert.equal((await req("mgr", "POST", "/customers/C1/locations", bad)).status, 400);
  assert.equal((await req("mgr", "POST", "/customers/NOPE/locations", { name: "x" })).status, 404);
  const id = a.body.id;
  assert.equal((await req("mgr", "PUT", "/customers/C1/locations/" + id, { name: "Bangalore" })).status, 409); // clashes with L_blr
  const ren = await req("mgr", "PUT", "/customers/C1/locations/" + id, { name: "Mangaluru" }); assert.equal(ren.status, 200); assert.equal(ren.body.name, "Mangaluru");
  assert.equal((await req("mgr", "PUT", "/customers/C1/locations/L_x", { name: "Hijack" })).status, 404); // another customer's location
  assert.equal(DB.locations.find((l) => l.id === "L_x")!.name, "Pune");
  assert.equal((await req("mgr", "PUT", "/customers/C1/locations/" + id, {})).status, 400);
  const off = await req("mgr", "PUT", "/customers/C1/locations/" + id, { active: false }); assert.equal(off.status, 200); assert.equal(off.body.active, false);
  const list = await req("mgr", "GET", "/customers/C1/locations"); assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((l: any) => l.name).sort(), ["Bangalore", "Mangaluru", "Mysore"]);
  assert.ok(list.body.every((l: any) => typeof l.userCount === "number" && typeof l.siteCount === "number"));
  await req("mgr", "PUT", "/customers/C1/locations/" + id, { active: true });
});

test("contacts: add portal users with or without a location; assignment is limited to the customer's active locations", async () => {
  const ok = await req("mgr", "POST", "/customers/C1/contacts", { name: "Ravi", email: "Ravi@Deccan.test", phone: "98765 43210", customerLocationId: "L_blr" });
  assert.equal(ok.status, 201); assert.equal(ok.body.email, "ravi@deccan.test"); assert.equal(ok.body.customerLocationId, "L_blr"); assert.equal(ok.body.phone, "+919876543210");
  const row = DB.users.find((u) => u.id === ok.body.id)!; assert.equal(row.customerId, "C1"); assert.equal(row.role.key, "customer"); assert.equal(row.isActive, true);
  const admin = await req("mgr", "POST", "/customers/C1/contacts", { name: "Head Office", email: "head@deccan.test" });
  assert.equal(admin.status, 201); assert.equal(admin.body.customerLocationId, null); // no location = customer admin
  for (const bad of [{ customerLocationId: "L_x" }, { customerLocationId: "L_old" }, { customerLocationId: "nope" }]) assert.equal((await req("mgr", "POST", "/customers/C1/contacts", { name: "Z", email: "z" + Math.random() + "@x.test", ...bad })).status, 400, JSON.stringify(bad));
  assert.equal((await req("mgr", "POST", "/customers/C1/contacts", { name: "Dup", email: "RAVI@deccan.test" })).status, 409);
  assert.equal((await req("mgr", "POST", "/customers/C1/contacts", { name: "Dup", email: "other@deccan.test", phone: "9876543210" })).status, 409);
  for (const bad of [{ name: "", email: "a@b.in" }, { name: "A", email: "not-an-email" }, { name: "A", email: "a@b.in", phone: "12" }, { name: "A", email: "a@b.in", role: "owner" }]) assert.equal((await req("mgr", "POST", "/customers/C1/contacts", bad)).status, 400, JSON.stringify(bad));
  assert.equal((await req("mgr", "POST", "/customers/NOPE/contacts", { name: "A", email: "a@b.in" })).status, 404);
  const id = ok.body.id;
  assert.equal((await req("mgr", "PUT", "/customers/C1/contacts/" + id, { customerLocationId: null })).body.customerLocationId, null); // promoted to customer admin
  assert.equal((await req("mgr", "PUT", "/customers/C1/contacts/" + id, { customerLocationId: "L_blr" })).body.customerLocationId, "L_blr");
  assert.equal((await req("mgr", "PUT", "/customers/C1/contacts/" + id, { customerLocationId: "L_x" })).status, 400);
  assert.equal((await req("mgr", "PUT", "/customers/C1/contacts/" + id, { isActive: false })).body.isActive, false);
  assert.equal((await req("mgr", "PUT", "/customers/C1/contacts/c2a", { name: "Hijack" })).status, 404); // another customer's user
  assert.equal(DB.users.find((u) => u.id === "c2a")!.name, "User c2a");
  assert.equal((await req("mgr", "PUT", "/customers/C1/contacts/mgr", { name: "Hijack" })).status, 404); // staff are not contacts
  assert.equal((await req("mgr", "PUT", "/customers/C1/contacts/" + id, { email: "head@deccan.test" })).status, 409);
  const list = await req("mgr", "GET", "/customers/C1/contacts"); assert.equal(list.status, 200);
  assert.ok(list.body.every((u: any) => !("passwordHash" in u)) && list.body.some((u: any) => u.id === id));
  assert.ok(!list.body.some((u: any) => u.id === "mgr" || u.id === "c2a"));
});

test("site location: set, clear, and only to an active location of the site's own customer", async () => {
  const s = DB.sites.find((x) => x.id === "s1")!;
  assert.equal((await req("mgr", "PUT", "/sites/s1/location", { customerLocationId: "L_blr" })).status, 200); assert.equal(s.customerLocationId, "L_blr");
  for (const bad of ["L_x", "L_old", "nope"]) { assert.equal((await req("mgr", "PUT", "/sites/s1/location", { customerLocationId: bad })).status, 400, bad); assert.equal(s.customerLocationId, "L_blr"); }
  assert.equal((await req("mgr", "PUT", "/sites/s2/location", { customerLocationId: "L_blr" })).status, 400); // C1's location on C2's site
  assert.equal((await req("mgr", "PUT", "/sites/s1/location", { customerLocationId: null })).status, 200); assert.equal(s.customerLocationId, null);
  assert.equal((await req("mgr", "PUT", "/sites/nope/location", { customerLocationId: null })).status, 404);
  assert.equal((await req("mgr", "PUT", "/sites/s1/location", { customerLocationId: "L_blr", extra: 1 })).status, 400);
  assert.equal((await req("mgr", "PUT", "/sites/s1/location", {})).status, 400);
});

test("contacts: mobile can be set (normalised), changed, cleared; duplicate -> 409; invalid -> 400", async () => {
  const mk = await req("mgr", "POST", "/customers/C1/contacts", { name: "Mob", email: "mob@deccan.test" });
  assert.equal(mk.status, 201); assert.equal(mk.body.phone, null);
  const id = mk.body.id;
  assert.equal((await req("mgr", "PUT", "/customers/C1/contacts/" + id, { phone: "+91 91234-56789" })).body.phone, "+919123456789");
  const other = await req("mgr", "POST", "/customers/C1/contacts", { name: "Oth", email: "oth@deccan.test", phone: "9988776655" });
  assert.equal(other.status, 201);
  assert.equal((await req("mgr", "PUT", "/customers/C1/contacts/" + id, { phone: "99887 76655" })).status, 409);
  assert.equal((await req("mgr", "PUT", "/customers/C1/contacts/" + id, { phone: "123" })).status, 400);
  assert.equal((await req("mgr", "PUT", "/customers/C1/contacts/" + id, { phone: "" })).body.phone, null);
});
