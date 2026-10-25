import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgentTurn, isNoToolsRefusal, NO_TOOLS_NUDGE } from "../src/agent/llm";
import { AgentDeadline } from "../src/agent/timeouts";
import type { AgentTool } from "../src/agent/tools/types";

const LIVE = "I'm sorry, but I currently don't have the tools to access that information for you. If you have any other questions or need assistance with something else, feel free to ask!";

test("isNoToolsRefusal: the live 24 Oct reply and variants match; normal answers do not", () => {
  assert.equal(isNoToolsRefusal(LIVE), true);
  assert.equal(isNoToolsRefusal("I don’t have access to that information."), true);
  assert.equal(isNoToolsRefusal("I'm unable to access your work orders right now."), true);
  assert.equal(isNoToolsRefusal("You have no work orders assigned to you for today."), false);
  assert.equal(isNoToolsRefusal("You don't have permission to view invoices."), false);
});

const woTool: AgentTool = {
  name: "search_work_orders", description: "wo", inputSchema: { type: "object", properties: {} },
  handler: async () => ({ scope: "assigned_to_you", totalCount: 0, results: [] }),
} as unknown as AgentTool;
const provider = { id: "p1", name: "Free LLM API ", model: "codestral-latest", priority: 0 } as never;

function scripted(replies: Array<{ text: string; toolCalls?: unknown[] }>, seen: unknown[][]) {
  return (async (_p: unknown, _a: unknown, params: { messages: unknown[] }, _d: unknown, _t: unknown, onProvider?: (r: never) => void) => {
    seen.push(params.messages);
    onProvider?.(provider);
    const r = replies.shift()!;
    return { text: r.text, toolCalls: r.toolCalls ?? [] };
  }) as never;
}

const base = (send: never) => ({
  systemPrompt: "sys", history: [{ role: "user" as const, content: "What's my pending work for today" }],
  tools: [woTool], getTool: (n: string) => (n === woTool.name ? woTool : undefined), isWriteTool: () => false,
  auth: { userId: "me", roleKey: "management", permissions: new Set<string>() },
  deadline: new AgentDeadline(), _deps: { loadProviders: async () => [provider], send },
});

test("a no-tools refusal is retried once with a nudge, the refusal is not stored, and the tool runs", async () => {
  const seen: unknown[][] = [];
  const send = scripted([
    { text: LIVE },
    { text: "", toolCalls: [{ id: "c1", name: "search_work_orders", input: { assignedToMe: true } }] },
    { text: "You have no work orders assigned to you for today." },
  ], seen);
  const out = await runAgentTurn(base(send) as never);
  assert.equal(out.reply, "You have no work orders assigned to you for today.");
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[1][seen[1].length - 1], NO_TOOLS_NUDGE);
  assert.ok(!JSON.stringify(out.history).includes("don't have the tools"));
  assert.ok(!JSON.stringify(out.history).includes("System note"));
  assert.ok(JSON.stringify(out.history).includes("search_work_orders"));
});

test("only one retry: a second refusal is returned as-is", async () => {
  const seen: unknown[][] = [];
  const out = await runAgentTurn(base(scripted([{ text: LIVE }, { text: LIVE }], seen)) as never);
  assert.equal(seen.length, 2);
  assert.equal(out.reply, LIVE);
});

test("no retry when no tools were offered", async () => {
  const seen: unknown[][] = [];
  const p = { ...base(scripted([{ text: LIVE }], seen)), tools: [] };
  const out = await runAgentTurn(p as never);
  assert.equal(seen.length, 1);
  assert.equal(out.reply, LIVE);
});

test("no retry when a tool already ran this turn (e.g. a forbidden result, then 'you don't have access')", async () => {
  const seen: unknown[][] = [];
  const denied = "You don't have access to invoices, so I can't show that.";
  const send = scripted([
    { text: "", toolCalls: [{ id: "c1", name: "search_work_orders", input: {} }] },
    { text: denied },
  ], seen);
  const out = await runAgentTurn(base(send) as never);
  assert.equal(isNoToolsRefusal(denied), true); // would have matched without the guard
  assert.equal(seen.length, 2);
  assert.equal(out.reply, denied);
  assert.ok(!JSON.stringify(seen).includes("System note"));
});
