import test from "node:test";
import assert from "node:assert/strict";
import { checkWaBaseUrl } from "../scripts/waHostGuard";

test("allows localhost and vercel preview hosts", () => {
  assert.equal(checkWaBaseUrl("http://localhost:4000"), null);
  assert.equal(checkWaBaseUrl("http://127.0.0.1:4000"), null);
  assert.equal(checkWaBaseUrl("https://zan-app-api-git-wa-ferosem-1321.vercel.app"), null);
});

test("refuses production, custom domains, plain http remote, garbage", () => {
  assert.ok(checkWaBaseUrl("https://zan-app-api.vercel.app"));
  assert.ok(checkWaBaseUrl("https://ZAN-APP-API.vercel.app/"));
  assert.ok(checkWaBaseUrl("https://api.example.com"));
  assert.ok(checkWaBaseUrl("http://evil.vercel.app"));
  assert.ok(checkWaBaseUrl("https://localhost"));
  assert.ok(checkWaBaseUrl("https://x.vercel.app.evil.com"));
  assert.ok(checkWaBaseUrl("not a url"));
});
