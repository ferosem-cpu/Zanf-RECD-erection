import { test } from "node:test";
import assert from "node:assert/strict";
import { apiAssetUrl, fitWithin, waitForImages } from "../src/lib/images";

test("fitWithin scales the longest side down and never up", () => {
  assert.deepEqual(fitWithin(1200, 600, 600), { width: 600, height: 300 });
  assert.deepEqual(fitWithin(300, 900, 600), { width: 200, height: 600 });
  assert.deepEqual(fitWithin(100, 50, 600), { width: 100, height: 50 });
});

test("apiAssetUrl prefixes API paths and passes through absolute/data URLs", () => {
  assert.equal(apiAssetUrl(null), null);
  assert.match(apiAssetUrl("/settings/logo?v=abc")!, /^https?:\/\/.+\/settings\/logo\?v=abc$/);
  assert.equal(apiAssetUrl("data:image/png;base64,AA"), "data:image/png;base64,AA");
});

test("waitForImages waits for decode, ignores failures, and gives up after the timeout", async () => {
  let done = false;
  await waitForImages([{ decode: async () => { done = true; } }, { decode: async () => { throw new Error("broken"); } }], 1000);
  assert.equal(done, true);
  const started = Date.now();
  await waitForImages([{ decode: () => new Promise<void>(() => {}) }], 50);
  assert.ok(Date.now() - started >= 40 && Date.now() - started < 1000);
});
