import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentDeadline, MIN_CALL_WINDOW_MS } from "../src/agent/timeouts";
import { isMarkedRetired, isQuotaExhausted, providersToAttempt, recordProviderFailure, QUOTA_SKIP_MS } from "../src/agent/providers/providerHealth";
import { ProviderCallError } from "../src/agent/providers/types";

console.error = () => {};

test("AgentDeadline clips per-call timeouts to the remaining budget and expires", () => {
  let now = 0;
  const d = new AgentDeadline(55_000, () => now);
  assert.equal(d.callTimeoutMs(30_000), 30_000);
  now = 40_000;
  assert.equal(d.callTimeoutMs(30_000), 15_000);
  assert.equal(d.expired(), false);
  now = 55_000 - MIN_CALL_WINDOW_MS + 1;
  assert.equal(d.expired(), true);
  now = 60_000;
  assert.equal(d.remainingMs(), 0);
  assert.equal(d.callTimeoutMs(30_000), 1_000); // never 0 / negative
});

test("a 429 'no credits' is treated as quota exhaustion, a plain rate limit is not", () => {
  assert.equal(isQuotaExhausted(429, "429 You have no credits remaining. Add credits to continue"), true);
  assert.equal(isQuotaExhausted(429, "You exceeded your current quota (insufficient_quota)"), true);
  assert.equal(isQuotaExhausted(429, "rate limited, retry in 2s"), false);
  assert.equal(isQuotaExhausted(500, "quota"), false);
});

test("a quota-exhausted primary is skipped on later tool turns until the window passes", () => {
  const now = 10_000_000;
  const openai = { id: "o", name: "Open AI", model: "gpt", baseUrl: null, priority: 1, updatedAt: new Date(1) };
  const gemini = { id: "g", name: "Gemini", model: "gemini", baseUrl: null, priority: 2, updatedAt: new Date(1) };
  recordProviderFailure(openai, new ProviderCallError("429 You have no credits remaining", "Open AI", undefined, 429), "test", { primary: true, now });
  assert.equal(isMarkedRetired(openai, now + 1), true);
  assert.deepEqual(providersToAttempt([openai, gemini], now + 1).attempt.map((p) => p.id), ["g"]);
  assert.equal(isMarkedRetired(openai, now + QUOTA_SKIP_MS + 1), false);
});
