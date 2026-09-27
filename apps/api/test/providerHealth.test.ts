import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RETIRED_SKIP_MS,
  formatProviderFailures,
  isMarkedRetired,
  providersToAttempt,
  recordProviderFailure,
} from "../src/agent/providers/providerHealth";
import { ProviderCallError } from "../src/agent/providers/types";

const gemini = { id: "g", name: "Gemini", model: "gemini-2.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", priority: 1, updatedAt: new Date(1) };
const nvidia = { id: "n", name: "NVIDIA", model: "old/model", baseUrl: "https://integrate.api.nvidia.com/v1", priority: 2, updatedAt: new Date(1) };

// Silence the intentional console.error logging during tests.
console.error = () => {};

test("ProviderCallError picks the HTTP status up from an SDK-style cause", () => {
  const err = new ProviderCallError("boom", "NVIDIA", Object.assign(new Error("410 Gone"), { status: 410 }));
  assert.equal(err.status, 410);
  assert.equal(new ProviderCallError("x", "p", undefined, 429).status, 429);
  assert.equal(new ProviderCallError("x", "p").status, undefined);
});

test("a 410 marks the provider retired and it is skipped until the TTL expires", () => {
  const now = 1_000_000;
  const f = recordProviderFailure(nvidia, new ProviderCallError("gone", "NVIDIA", undefined, 410), "test", { primary: false, now });
  assert.equal(f.status, 410);
  assert.equal(isMarkedRetired(nvidia, now + 1), true);
  assert.deepEqual(providersToAttempt([gemini, nvidia], now + 1).attempt.map((p) => p.id), ["g"]);
  assert.equal(isMarkedRetired(nvidia, now + RETIRED_SKIP_MS + 1), false);
});

test("editing the provider (new model / updatedAt) clears the skip immediately", () => {
  const now = 2_000_000;
  recordProviderFailure(nvidia, new ProviderCallError("gone", "NVIDIA", undefined, 410), "test", { primary: false, now });
  assert.equal(isMarkedRetired({ ...nvidia, model: "nvidia/new-model", updatedAt: new Date(2) }, now + 1), false);
});

test("non-410 failures are not skipped", () => {
  const now = 3_000_000;
  const other = { ...nvidia, id: "other" };
  recordProviderFailure(other, new ProviderCallError("rate limited", "NVIDIA", undefined, 429), "test", { primary: false, now });
  assert.equal(isMarkedRetired(other, now + 1), false);
});

test("if every provider is marked retired, all are still attempted", () => {
  const now = 4_000_000;
  const only = { ...nvidia, id: "only" };
  recordProviderFailure(only, new ProviderCallError("gone", "NVIDIA", undefined, 410), "test", { primary: true, now });
  const { attempt, skipped } = providersToAttempt([only], now + 1);
  assert.deepEqual(attempt.map((p) => p.id), ["only"]);
  assert.equal(skipped.length, 0);
});

test("the primary provider's error is listed first and labelled, even if recorded last", () => {
  const text = formatProviderFailures(
    [
      { providerName: "NVIDIA", priority: 2, primary: false, status: 410, message: "gone" },
      { providerName: "Gemini", priority: 1, primary: true, status: 503, message: "overloaded" },
    ],
    [],
  );
  const lines = text.split("\n");
  assert.match(lines[0], /^Primary Gemini \[HTTP 503\]: overloaded$/);
  assert.match(lines[1], /^Fallback NVIDIA \[HTTP 410\]: gone$/);
});
