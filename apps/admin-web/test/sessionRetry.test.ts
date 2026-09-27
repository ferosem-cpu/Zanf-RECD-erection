import { test } from "node:test";
import assert from "node:assert/strict";
import { isSessionRejected, retryDelayMs, RETRY_MAX_MS } from "../src/lib/sessionRetry";
import { ApiError } from "../src/lib/apiClient";

test("only a real 401 counts as a rejected session", () => {
  assert.equal(isSessionRejected(new ApiError(401, '"Invalid or expired token"')), true);
  assert.equal(isSessionRejected(new ApiError(403, '"Forbidden"')), false);
  assert.equal(isSessionRejected(new ApiError(500, "Request failed: 500")), false);
  assert.equal(isSessionRejected(new ApiError(502, "Request failed: 502")), false);
});

test("network failures are transient, not a logout", () => {
  // What fetch throws when the server can't be reached / the request is blocked.
  assert.equal(isSessionRejected(new TypeError("Failed to fetch")), false);
  assert.equal(isSessionRejected(new Error("boom")), false);
  assert.equal(isSessionRejected(undefined), false);
  assert.equal(isSessionRejected(null), false);
});

test("ApiError keeps the old message format and exposes the status", () => {
  const e = new ApiError(404, "Request failed: 404");
  assert.ok(e instanceof Error);
  assert.equal(e.message, "Request failed: 404");
  assert.equal(e.status, 404);
});

test("retry backoff doubles from 1s and caps at 30s", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 50].map(retryDelayMs), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.equal(retryDelayMs(-3), 1000);
  assert.equal(retryDelayMs(1e9), RETRY_MAX_MS);
});
