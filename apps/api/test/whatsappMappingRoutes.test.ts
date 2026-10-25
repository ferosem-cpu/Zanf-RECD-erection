import "./_testEnv";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PERMISSION_KEY } from "@recd/shared";
import { createWhatsappMappingsRouter } from "../src/routes/whatsappMappings";
import type { MappingRecord, MappingStore, MappingUser } from "../src/services/whatsappMapping";

const USERS: Record<string, MappingUser> = {
  eng: { id: "eng", name: "Eng", roleKey: "erection_engineer", isActive: true, customerId: null },
  eng2: { id: "eng2", name: "Eng2", roleKey: "service_team", isActive: true, customerId: null },
  off: { id: "off", name: "Off", roleKey: "sales", isActive: false, customerId: null },
  cust: { id: "cust", name: "Cust", roleKey: "customer", isActive: true, customerId: "c1" },
  mixed: { id: "mixed", name: "Mixed", roleKey: "management", isActive: true, customerId: "c1" },
};

function memoryStore(): MappingStore & { rows: MappingRecord[] } {
  const rows: MappingRecord[] = [];
  let n = 0;
  return {
    rows,
    list: async () => rows.map((r) => ({ ...r, user: null })),
    get: async (id) => rows.find((r) => r.id === id) ?? null,
    findByPhone: async (p) => rows.find((r) => r.phoneE164 === p) ?? null,
    findByLid: async (l) => rows.find((r) => r.lid === l) ?? null,
    findEnabledByUser: async (u) => rows.filter((r) => r.userId === u && r.enabled),
    findUser: async (id) => USERS[id] ?? null,
    create: async (d) => { const r = { ...d, id: `m${++n}`, createdAt: new Date(), updatedAt: new Date() }; rows.push(r); return r; },
    update: async (id, d) => { const r = rows.find((x) => x.id === id)!; Object.assign(r, d); return r; },
    remove: async (id) => { rows.splice(rows.findIndex((r) => r.id === id), 1); },
  };
}

const store = memoryStore();
let server: Server;
let base = "";

before(async () => {
  const app = express();
  app.use(express.json());
  const fakeAuth: express.RequestHandler = (req, res, next) => {
    const role = req.header("x-role");
    if (!role) return void res.status(401).json({ error: "Missing bearer token" });
    // Permissions as seeded: only super_admin holds manage_settings.
    const perms = role === "super_admin" ? [PERMISSION_KEY.MANAGE_SETTINGS, PERMISSION_KEY.MANAGE_USERS] : [PERMISSION_KEY.MANAGE_USERS];
    (req as unknown as { auth: unknown }).auth = { userId: `u-${role}`, roleKey: role, permissions: new Set(perms) };
    next();
  };
  app.use("/whatsapp/mappings", createWhatsappMappingsRouter({ store, authenticate: fakeAuth }));
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/whatsapp/mappings`;
});
after(() => { server.close(); });

const call = (method: string, path: string, role: string | null, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(role ? { "x-role": role } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (res: Response) => (await res.json()) as { mapping: MappingRecord; mappings: MappingRecord[] };

test("mapping endpoints are super-admin only: 401 anonymous, 403 for every other role", async () => {
  assert.equal((await call("GET", "", null)).status, 401);
  const calls: Array<[string, string]> = [["GET", ""], ["POST", ""], ["POST", "/x/enable"], ["POST", "/x/disable"], ["POST", "/x/pause"], ["POST", "/x/unpause"], ["DELETE", "/x"]];
  for (const role of ["finance", "management", "owner_admin", "sales", "operations_pm", "erection_engineer", "customer"]) {
    for (const [m, p] of calls) {
      const res = await call(m, p, role, m === "POST" ? {} : undefined);
      assert.equal(res.status, 403, `${role} ${m} ${p}`);
    }
  }
  assert.equal(store.rows.length, 0);
});

test("super admin: add, enable, pause, unpause, disable, remove with audit fields", async () => {
  let res = await call("POST", "", "super_admin", { userId: "eng", phone: "98765 43210", lid: "111222333444@lid", note: " pilot " });
  assert.equal(res.status, 200);
  const { mapping } = await json(res);
  assert.equal(mapping.phoneE164, "+919876543210");
  assert.equal(mapping.lid, "111222333444");
  assert.equal(mapping.enabled, false);
  assert.equal(mapping.createdById, "u-super_admin");
  assert.equal(mapping.verifiedById, "u-super_admin");
  assert.equal(mapping.note, "pilot");

  res = await call("POST", `/${mapping.id}/enable`, "super_admin");
  assert.equal((await json(res)).mapping.enabled, true);
  res = await call("POST", `/${mapping.id}/pause`, "super_admin");
  assert.equal((await json(res)).mapping.aiPaused, true);
  res = await call("POST", `/${mapping.id}/unpause`, "super_admin");
  assert.equal((await json(res)).mapping.aiPaused, false);
  res = await call("POST", `/${mapping.id}/disable`, "super_admin");
  assert.equal((await json(res)).mapping.enabled, false);
  assert.equal((await json(await call("GET", "", "super_admin"))).mappings.length, 1);
  assert.equal((await call("DELETE", `/${mapping.id}`, "super_admin")).status, 200);
  assert.equal((await call("DELETE", `/${mapping.id}`, "super_admin")).status, 404);
});

test("collisions and invalid input are rejected", async () => {
  assert.equal((await call("POST", "", "super_admin", { userId: "eng", phone: "9876543210", lid: "555666777888" })).status, 200);
  assert.equal((await call("POST", "", "super_admin", { userId: "eng2", phone: "+91 98765 43210" })).status, 409);
  assert.equal((await call("POST", "", "super_admin", { userId: "eng2", phone: "9123456789", lid: "555666777888" })).status, 409);
  assert.equal((await call("POST", "", "super_admin", { userId: "eng2", phone: "12345" })).status, 400);
  assert.equal((await call("POST", "", "super_admin", { userId: "nobody", phone: "9123456789" })).status, 400);
  assert.equal((await call("POST", "", "super_admin", { userId: "off", phone: "9123456780" })).status, 400);
  assert.equal((await call("POST", "", "super_admin", { userId: "mixed", phone: "9123456781" })).status, 400, "customer-linked user without the customer role");
  const custRes = await call("POST", "", "super_admin", { userId: "cust", phone: "9123456782" });
  assert.equal(custRes.status, 200, "customer role + customer link may be mapped");
  assert.equal((await call("DELETE", `/${((await custRes.json()) as { mapping: { id: string } }).mapping.id}`, "super_admin")).status, 200);
  assert.equal((await call("POST", "", "super_admin", { userId: "eng2", phone: "9123456789", lid: "x" })).status, 400);
});

test("a user can have only one enabled mapping", async () => {
  const a = store.rows.find((r) => r.phoneE164 === "+919876543210")!;
  const b = (await json(await call("POST", "", "super_admin", { userId: "eng", phone: "9123456782" }))).mapping;
  assert.equal((await call("POST", `/${a.id}/enable`, "super_admin")).status, 200);
  assert.equal((await call("POST", `/${b.id}/enable`, "super_admin")).status, 409);
  await call("POST", `/${a.id}/disable`, "super_admin");
  assert.equal((await call("POST", `/${b.id}/enable`, "super_admin")).status, 200);
});
