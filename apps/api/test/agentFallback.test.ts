import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentLlmProvider } from "@prisma/client";
import { sendWithFallback } from "../src/agent/sendWithFallback";
import { AgentDeadline, LLM_ATTEMPT_CAP_MS, FALLBACK_RESERVE_MS } from "../src/agent/timeouts";
import { agentErrorBody, AGENT_FRIENDLY_ERROR } from "../src/agent/friendlyError";
import type { LlmAdapter } from "../src/agent/providers/types";

console.error = () => {};

const row = (id: string, name: string, priority: number) =>
  ({ id, name, priority, model: "m", baseUrl: null, updatedAt: new Date(1) }) as unknown as AgentLlmProvider;
const params = { systemPrompt: "s", messages: [], tools: [] };

function fake(behaviour: "timeout" | "ok", seen: number[]): LlmAdapter {
  return {
    async sendMessage(p) {
      seen.push(p.timeoutMs ?? -1);
      if (behaviour === "timeout") throw new Error("Request timed out.");
      return { text: "answer", toolCalls: [] };
    },
  } as LlmAdapter;
}

test("hanging primary is capped and the fallback answers, order unchanged", async () => {
  const providers = [row("a", "Primary", 0), row("b", "Fallback", 1)];
  const seenA: number[] = [];
  const seenB: number[] = [];
  const adapters = new Map<string, LlmAdapter>([["a", fake("timeout", seenA)], ["b", fake("ok", seenB)]]);
  const deadline = new AgentDeadline(55_000, () => 0);
  const res = await sendWithFallback(providers, adapters, params, deadline);
  assert.equal(res.text, "answer");
  assert.equal(seenA[0], LLM_ATTEMPT_CAP_MS);
  assert.ok(seenB[0] >= FALLBACK_RESERVE_MS);
  assert.equal(providers.map((p) => p.name).join(), "Primary,Fallback");
});

test("primary cap shrinks so the fallback reserve is kept", async () => {
  let now = 0;
  const deadline = new AgentDeadline(55_000, () => now);
  now = 30_000; // 25 s left
  assert.equal(deadline.attemptTimeoutMs(true), 5_000);
  assert.equal(deadline.attemptTimeoutMs(false), 25_000);
});

test("slow primary within the cap is used; fallback untouched", async () => {
  const seenA: number[] = [];
  const seenB: number[] = [];
  const adapters = new Map<string, LlmAdapter>([["a", fake("ok", seenA)], ["b", fake("ok", seenB)]]);
  await sendWithFallback([row("a", "P", 0), row("b", "F", 1)], adapters, params, new AgentDeadline(55_000, () => 0));
  assert.equal(seenA.length, 1);
  assert.equal(seenB.length, 0);
});

test("a provider that timed out is skipped on later rounds of the same request", async () => {
  const seenA: number[] = [];
  const seenB: number[] = [];
  const adapters = new Map<string, LlmAdapter>([["a", fake("timeout", seenA)], ["b", fake("ok", seenB)]]);
  const providers = [row("a", "P", 0), row("b", "F", 1)];
  const timedOut = new Set<string>();
  const d = new AgentDeadline(55_000, () => 0);
  await sendWithFallback(providers, adapters, params, d, timedOut);
  await sendWithFallback(providers, adapters, params, d, timedOut);
  assert.equal(seenA.length, 1);
  assert.equal(seenB.length, 2);
});

test("error response body has no provider names or internals", () => {
  const body = agentErrorBody(new Error('provider "Free LLM API" (priority 0, model "auto", PRIMARY) failed: Request timed out.\nFallback OpenAI: x'));
  assert.equal(body.error, AGENT_FRIENDLY_ERROR);
  assert.match(body.errorId, /^[0-9a-f]{8}$/);
  assert.ok(!/Free LLM|OpenAI|provider|\n/.test(JSON.stringify(body)));
});

test("every provider failing: the thrown error becomes only the friendly bubble text plus an error id", async () => {
  const providers = [row("a", "Free LLM API", 0), row("b", "OpenAI", 1)];
  const adapters = new Map<string, LlmAdapter>([["a", fake("timeout", [])], ["b", fake("timeout", [])]]);
  let thrown: unknown;
  try {
    await sendWithFallback(providers, adapters, params, new AgentDeadline(55_000, () => 0), new Set());
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof Error, "sendWithFallback must throw when all providers fail");
  const body = agentErrorBody(thrown);
  assert.deepEqual(Object.keys(body).sort(), ["error", "errorId"]);
  assert.equal(body.error, AGENT_FRIENDLY_ERROR);
  assert.match(body.errorId, /^[0-9a-f]{8}$/);
  assert.ok(!/Free LLM|OpenAI|timed out/i.test(JSON.stringify(body)));
});
