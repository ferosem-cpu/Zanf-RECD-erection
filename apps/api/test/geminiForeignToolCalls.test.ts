import { test } from "node:test";
import assert from "node:assert/strict";
import { toOpenAIMessages, GEMINI_FOREIGN_THOUGHT_SIGNATURE } from "../src/agent/providers/openaiCompatibleAdapter";
import type { UnifiedMessage } from "../src/agent/providers/types";

// Regression: FreeLLM answered the early tool rounds, timed out on a later one, and the
// fallback to Gemini got a history of tool calls with no thought_signature -> bare HTTP 400.

const history: UnifiedMessage[] = [
  { role: "user", content: "Create a proforma for Ethen" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call_1", name: "search_orders_and_sites", input: { q: "bostik" } }],
  },
  { role: "tool", toolCallId: "call_1", content: "{}" },
] as UnifiedMessage[];

function firstToolCall(msgs: ReturnType<typeof toOpenAIMessages>): Record<string, unknown> {
  const a = msgs.find((m) => m.role === "assistant") as unknown as { tool_calls: Record<string, unknown>[] };
  return a.tool_calls[0];
}

test("Gemini: tool calls from another provider get the placeholder signature", () => {
  const tc = firstToolCall(toOpenAIMessages("sys", history, { geminiCompat: true }));
  assert.deepEqual(tc.extra_content, { google: { thought_signature: GEMINI_FOREIGN_THOUGHT_SIGNATURE } });
});

test("Gemini: a real stored signature is echoed back verbatim, not replaced", () => {
  const withMeta = structuredClone(history) as UnifiedMessage[];
  (withMeta[1] as { toolCalls: { providerMetadata?: unknown }[] }).toolCalls[0].providerMetadata = {
    extra_content: { google: { thought_signature: "REAL" } },
  };
  const tc = firstToolCall(toOpenAIMessages("sys", withMeta, { geminiCompat: true }));
  assert.deepEqual(tc.extra_content, { google: { thought_signature: "REAL" } });
});

test("Non-Gemini providers never receive the placeholder", () => {
  const tc = firstToolCall(toOpenAIMessages("sys", history));
  assert.equal(tc.extra_content, undefined);
});
