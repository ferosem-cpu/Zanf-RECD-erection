import "./_testEnv";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPortalAuth, PORTAL_HEADERS } from "../src/services/portalAuth";
import { parseBridgeKeys, sha256Hex, signBridgeRequest, type NonceStore } from "../src/services/whatsappBridgeAuth";

const SECRET = "portal-secret-0123456789";
let now = 1_800_000_000_000;
const seen = new Set<string>();
const nonces: NonceStore = { claim: async (k, n) => (seen.has(k + "|" + n) ? false : (seen.add(k + "|" + n), true)) };
const users: Record<string, any> = {
  good: { id: "good", isActive: true, name: "A", email: "a@x.in", phone: null, customerId: "cust1", role: { key: "customer" } },
  inactive: { id: "inactive", isActive: false, name: "B", email: null, phone: null, customerId: "cust1", role: { key: "customer" } },
  nocust: { id: "nocust", isActive: true, name: "C", email: null, phone: null, customerId: null, role: { key: "customer" } },
  staff: { id: "staff", isActive: true, name: "D", email: null, phone: null, customerId: "cust1", role: { key: "management" } },
};
const fakePrisma: any = { user: { findUnique: async ({ where }: any) => users[where.id] ?? null } };
let server: Server;
let base = "";

before(async () => {
  process.env.PORTAL_ENABLED = "true";
  const app = express();
  app.use("/portal", express.raw({ type: () => true, limit: "64kb" }), createPortalAuth({ nonces, prisma: fakePrisma, now: () => now, keys: () => parseBridgeKeys("p1:" + SECRET) }));
  app.use("/portal", (req, res) => res.json({ ok: true, uid: req.portal?.userId, customerId: req.portal?.customerId }));
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(() => { server.close(); });

function call(method: string, pathQuery: string, body = "", over: Record<string, string> = {}, signPath = pathQuery) {
  const ts = String(Math.floor(now / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const headers: Record<string, string> = {
    [PORTAL_HEADERS.keyId]: "p1", [PORTAL_HEADERS.timestamp]: ts, [PORTAL_HEADERS.nonce]: nonce,
    [PORTAL_HEADERS.signature]: signBridgeRequest(SECRET, method, signPath, ts, nonce, sha256Hex(body)), "content-type": "application/json", ...over,
  };
  return fetch(base + pathQuery, { method, headers, body: method === "GET" ? undefined : body });
}

test("valid signed call as an active customer passes; customerId comes from the DB row", async () => {
  const r = await call("GET", "/portal/me?uid=good");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, uid: "good", customerId: "cust1" });
});
test("bad signature, unknown key, old timestamp -> 401", async () => {
  assert.equal((await call("GET", "/portal/me?uid=good", "", { [PORTAL_HEADERS.signature]: "0".repeat(64) })).status, 401);
  assert.equal((await call("GET", "/portal/me?uid=good", "", { [PORTAL_HEADERS.keyId]: "nope" })).status, 401);
  const old = String(Math.floor(now / 1000) - 1000);
  const nonce = crypto.randomBytes(16).toString("hex");
  const r = await fetch(base + "/portal/me?uid=good", { headers: { [PORTAL_HEADERS.keyId]: "p1", [PORTAL_HEADERS.timestamp]: old, [PORTAL_HEADERS.nonce]: nonce, [PORTAL_HEADERS.signature]: signBridgeRequest(SECRET, "GET", "/portal/me?uid=good", old, nonce, sha256Hex("")) } });
  assert.equal(r.status, 401);
});
test("replayed nonce -> 401", async () => {
  const ts = String(Math.floor(now / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const headers = { [PORTAL_HEADERS.keyId]: "p1", [PORTAL_HEADERS.timestamp]: ts, [PORTAL_HEADERS.nonce]: nonce, [PORTAL_HEADERS.signature]: signBridgeRequest(SECRET, "GET", "/portal/me?uid=good", ts, nonce, sha256Hex("")) };
  assert.equal((await fetch(base + "/portal/me?uid=good", { headers })).status, 200);
  assert.equal((await fetch(base + "/portal/me?uid=good", { headers })).status, 401);
});
test("changing uid after signing (identity swap) -> 401; tampered body -> 401", async () => {
  assert.equal((await call("GET", "/portal/me?uid=staff", "", {}, "/portal/me?uid=good")).status, 401);
  const ts = String(Math.floor(now / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const r = await fetch(base + "/portal/x?uid=good", { method: "POST", body: '{"a":2}', headers: { [PORTAL_HEADERS.keyId]: "p1", [PORTAL_HEADERS.timestamp]: ts, [PORTAL_HEADERS.nonce]: nonce, [PORTAL_HEADERS.signature]: signBridgeRequest(SECRET, "POST", "/portal/x?uid=good", ts, nonce, sha256Hex('{"a":1}')) } });
  assert.equal(r.status, 401);
});
test("inactive user, customer without customerId, non-customer role, unknown user, missing uid -> 403", async () => {
  for (const uid of ["inactive", "nocust", "staff", "ghost"]) assert.equal((await call("GET", "/portal/me?uid=" + uid)).status, 403, uid);
  assert.equal((await call("GET", "/portal/me")).status, 403);
});
test("unsigned request -> 401; PORTAL_ENABLED=false -> 503", async () => {
  assert.equal((await fetch(base + "/portal/me?uid=good")).status, 401);
  process.env.PORTAL_ENABLED = "false";
  assert.equal((await call("GET", "/portal/me?uid=good")).status, 503);
  process.env.PORTAL_ENABLED = "true";
});
test("anonymous lookup path needs a valid signature but no uid", async () => {
  assert.equal((await call("POST", "/portal/auth/lookup", "{}")).status, 200);
  assert.equal((await fetch(base + "/portal/auth/lookup", { method: "POST", body: "{}" })).status, 401);
});
