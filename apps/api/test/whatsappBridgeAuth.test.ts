import "./_testEnv";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createBridgeAuth, parseBridgeKeys, sha256Hex, signBridgeRequest, type NonceStore } from "../src/services/whatsappBridgeAuth";

const SECRET = "current-secret-0123456789";
const OLD = "previous-secret-0123456789";
let now = 1_800_000_000_000;
const seen = new Set<string>();
const nonces: NonceStore = { claim: async (k, n) => (seen.has(`${k}|${n}`) ? false : (seen.add(`${k}|${n}`), true)) };
let server: Server;
let base = "";

before(async () => {
  const app = express();
  app.use("/wa", express.raw({ type: () => true, limit: "64kb" }), createBridgeAuth({ nonces, now: () => now, keys: () => parseBridgeKeys(`k2:${SECRET},k1:${OLD}`) }));
  app.use("/wa", (_req, res) => res.json({ ok: true }));
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); });

function signed(method: string, path: string, body = "", over: Record<string, string> = {}, secret = SECRET) {
  const ts = String(Math.floor(now / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const sha = sha256Hex(body);
  const headers: Record<string, string> = {
    "x-zan-key-id": "k2", "x-zan-timestamp": ts, "x-zan-nonce": nonce, "x-zan-body-sha256": sha,
    "x-zan-signature": signBridgeRequest(secret, method, path, ts, nonce, sha),
    "content-type": "application/json", ...over,
  };
  return fetch(base + path, { method, headers, body: method === "GET" ? undefined : body });
}

test("parseBridgeKeys: list and JSON forms, short secrets and bad ids skipped", () => {
  assert.deepEqual([...parseBridgeKeys(`a:${SECRET},b:${OLD}`).keys()], ["a", "b"]);
  assert.deepEqual([...parseBridgeKeys(JSON.stringify({ a: SECRET })).keys()], ["a"]);
  assert.equal(parseBridgeKeys("a:short").size, 0);
  assert.equal(parseBridgeKeys("bad id:" + SECRET).size, 0);
  assert.equal(parseBridgeKeys("{broken").size, 0);
  assert.equal(parseBridgeKeys(undefined).size, 0);
});

test("valid signed POST and GET (with query) pass", async () => {
  assert.equal((await signed("POST", "/wa/ingest", '{"a":1}')).status, 200);
  assert.equal((await signed("GET", "/wa/outbox?limit=5")).status, 200);
});

test("previous key still verifies during rotation; unknown key id and wrong secret do not", async () => {
  const sha = sha256Hex("{}");
  const mk = (keyId: string, secret: string) => {
    const nonce = crypto.randomBytes(16).toString("hex");
    const ts = String(Math.floor(now / 1000));
    return signed("POST", "/wa/ingest", "{}", { "x-zan-key-id": keyId, "x-zan-nonce": nonce, "x-zan-signature": signBridgeRequest(secret, "POST", "/wa/ingest", ts, nonce, sha) });
  };
  assert.equal((await mk("k1", OLD)).status, 200);
  assert.equal((await mk("k3", SECRET)).status, 401);
  assert.equal((await mk("k2", OLD)).status, 401);
});

test("bad signature, tampered path, stale or future timestamp, body-hash mismatch, bad header shape -> 401", async () => {
  assert.equal((await signed("POST", "/wa/ingest", "{}", { "x-zan-signature": "0".repeat(64) })).status, 401);
  assert.equal((await signed("POST", "/wa/ingest", "{}", { "x-zan-signature": "zz" })).status, 401);
  const stale = String(Math.floor(now / 1000) - 301);
  const future = String(Math.floor(now / 1000) + 301);
  for (const ts of [stale, future]) {
    const nonce = crypto.randomBytes(16).toString("hex");
    const sha = sha256Hex("{}");
    const r = await signed("POST", "/wa/ingest", "{}", { "x-zan-timestamp": ts, "x-zan-nonce": nonce, "x-zan-signature": signBridgeRequest(SECRET, "POST", "/wa/ingest", ts, nonce, sha) });
    assert.equal(r.status, 401, ts);
  }
  // Header claims the hash of a different body: recomputed hash must not match.
  assert.equal((await signed("POST", "/wa/ingest", '{"a":1}', { "x-zan-body-sha256": sha256Hex("{}") })).status, 401);
  // Signed over one body, sent with another (header hash matches the signature, not the bytes).
  const ts = String(Math.floor(now / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const sha = sha256Hex('{"a":1}');
  const tampered = await fetch(base + "/wa/ingest", { method: "POST", body: '{"a":2}', headers: { "x-zan-key-id": "k2", "x-zan-timestamp": ts, "x-zan-nonce": nonce, "x-zan-body-sha256": sha, "x-zan-signature": signBridgeRequest(SECRET, "POST", "/wa/ingest", ts, nonce, sha) } });
  assert.equal(tampered.status, 401);
  assert.equal((await fetch(base + "/wa/outbox?limit=5")).status, 401);
});

test("reused nonce -> 401 (same key id); the request itself was authentic", async () => {
  const ts = String(Math.floor(now / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const sha = sha256Hex("{}");
  const over = { "x-zan-nonce": nonce, "x-zan-signature": signBridgeRequest(SECRET, "POST", "/wa/ingest", ts, nonce, sha) };
  assert.equal((await signed("POST", "/wa/ingest", "{}", over)).status, 200);
  assert.equal((await signed("POST", "/wa/ingest", "{}", over)).status, 401);
});

test("a signed query tampered in flight fails", async () => {
  const ts = String(Math.floor(now / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const sha = sha256Hex("");
  const r = await fetch(base + "/wa/outbox?limit=50", { headers: { "x-zan-key-id": "k2", "x-zan-timestamp": ts, "x-zan-nonce": nonce, "x-zan-body-sha256": sha, "x-zan-signature": signBridgeRequest(SECRET, "GET", "/wa/outbox?limit=5", ts, nonce, sha) } });
  assert.equal(r.status, 401);
});

test("signature is verified over req.originalUrl (public path incl. query, even though the router is mounted at /wa)", async () => {
  assert.equal((await signed("GET", "/wa/outbox?limit=5")).status, 200);
  const sign = (signPath: string, reqPath: string) => {
    const ts = String(Math.floor(now / 1000));
    const nonce = crypto.randomBytes(16).toString("hex");
    const sha = sha256Hex("");
    return fetch(base + reqPath, { method: "GET", headers: { "x-zan-key-id": "k2", "x-zan-timestamp": ts, "x-zan-nonce": nonce, "x-zan-body-sha256": sha, "x-zan-signature": signBridgeRequest(SECRET, "GET", signPath, ts, nonce, sha) } });
  };
  assert.equal((await sign("/wa/outbox?limit=5", "/wa/outbox?limit=5")).status, 200);
  assert.equal((await sign("/wa/outbox?limit=5", "/wa/outbox?limit=9")).status, 401, "different query");
  assert.equal((await sign("/wa/outbox", "/wa/outbox?limit=5")).status, 401, "query not signed");
  assert.equal((await sign("/outbox?limit=5", "/wa/outbox?limit=5")).status, 401, "mount-relative path is not what is signed");
  assert.equal((await sign("/wa/ack", "/wa/outbox?limit=5")).status, 401, "different path");
});
