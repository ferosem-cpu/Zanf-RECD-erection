import { test } from "node:test";
import assert from "node:assert/strict";
import { executeToolCalls, canRunInParallel, type ToolCallLike } from "../src/agent/toolExecution";
import { AgentDeadline } from "../src/agent/timeouts";
import type { AgentTool } from "../src/agent/tools/types";

const auth = { userId: "u", roleKey: "management", permissions: new Set<string>() };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fake tools that record start/end order and concurrency. */
function harness() {
  let running = 0;
  let maxRunning = 0;
  const log: string[] = [];
  const tool = (name: string, ms: number, behaviour: "ok" | "throw" | "hang" = "ok"): AgentTool => ({
    name,
    description: name,
    inputSchema: { type: "object", properties: {} },
    handler: async (input) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      log.push(`start ${name}`);
      try {
        if (behaviour === "hang") await new Promise(() => {});
        await sleep(ms);
        if (behaviour === "throw") throw new Error(`${name} failed`);
        return { tool: name, input };
      } finally {
        running -= 1;
        log.push(`end ${name}`);
      }
    },
  });
  const tools = new Map<string, AgentTool>([
    ["search_a", tool("search_a", 120)],
    ["search_b", tool("search_b", 30)],
    ["search_c", tool("search_c", 60)],
    ["search_fail", tool("search_fail", 10, "throw")],
    ["search_hang", tool("search_hang", 0, "hang")],
    ["create_x", tool("create_x", 40)],
  ]);
  return { tools, log, maxRunning: () => maxRunning, getTool: (n: string) => tools.get(n), isWriteTool: (n: string) => n.startsWith("create_") };
}

const calls = (...names: string[]): ToolCallLike[] => names.map((name, i) => ({ id: `call_${i}`, name, input: { i } }));

test("read-only calls run concurrently and results keep tool_call order and ids", async () => {
  const h = harness();
  const started = Date.now();
  const results = await executeToolCalls({ calls: calls("search_a", "search_b", "search_c"), auth, getTool: h.getTool, isWriteTool: h.isWriteTool });
  const elapsed = Date.now() - started;
  assert.equal(h.maxRunning(), 3);
  assert.ok(elapsed < 200, `took ${elapsed}ms - sequential would be ~210ms`);
  assert.deepEqual(results.map((r) => [r.toolCallId, r.toolName]), [["call_0", "search_a"], ["call_1", "search_b"], ["call_2", "search_c"]]);
  assert.deepEqual(JSON.parse(results[0].content), { tool: "search_a", input: { i: 0 } });
});

test("any write tool in the step keeps the whole step sequential", async () => {
  const h = harness();
  const results = await executeToolCalls({ calls: calls("search_b", "create_x", "search_c"), auth, getTool: h.getTool, isWriteTool: h.isWriteTool });
  assert.equal(h.maxRunning(), 1);
  assert.deepEqual(h.log, ["start search_b", "end search_b", "start create_x", "end create_x", "start search_c", "end search_c"]);
  assert.deepEqual(results.map((r) => r.toolName), ["search_b", "create_x", "search_c"]);
  assert.equal(canRunInParallel(calls("search_a"), h.isWriteTool), false); // single call: nothing to parallelise
  assert.equal(canRunInParallel(calls("search_a", "search_b"), h.isWriteTool), true);
});

test("one failing, unknown or hanging tool only errors its own result", async () => {
  const h = harness();
  const results = await executeToolCalls({
    calls: calls("search_b", "search_fail", "no_such_tool", "search_hang", "search_c"),
    auth, getTool: h.getTool, isWriteTool: h.isWriteTool, toolTimeoutMs: 150,
  });
  const parsed = results.map((r) => JSON.parse(r.content));
  assert.equal(parsed[0].tool, "search_b");
  assert.equal(parsed[1].error, "search_fail failed");
  assert.equal(parsed[2].error, "Unknown tool: no_such_tool");
  assert.match(parsed[3].error, /search_hang took longer than/);
  assert.equal(parsed[4].tool, "search_c");
  assert.deepEqual(results.map((r) => r.toolCallId), ["call_0", "call_1", "call_2", "call_3", "call_4"]);
});

test("tool timeout never exceeds what is left of the request deadline", async () => {
  const h = harness();
  const deadline = new AgentDeadline(1_200);
  const started = Date.now();
  const [res] = await executeToolCalls({ calls: calls("search_hang", "search_b"), auth, getTool: h.getTool, isWriteTool: h.isWriteTool, deadline, toolTimeoutMs: 60_000 });
  assert.match(JSON.parse(res.content).error, /took longer than/);
  assert.ok(Date.now() - started < 3_000);
});

test("an intercepted call returns the replacement result without running the tool", async () => {
  const h = harness();
  const results = await executeToolCalls({
    calls: calls("search_a", "search_b"), auth, getTool: h.getTool, isWriteTool: h.isWriteTool,
    onToolCall: async (name) => (name === "search_a" ? { intercepted: true, result: { replaced: true } } : { intercepted: false }),
  });
  assert.deepEqual(JSON.parse(results[0].content), { replaced: true });
  assert.ok(!h.log.includes("start search_a"));
});

test("dates in tool results reach the model in IST: 2026-09-27T18:30:00Z is 2026-09-28", async () => {
  const { Prisma } = await import("@prisma/client");
  const tool: AgentTool = {
    name: "po_dates", description: "", inputSchema: { type: "object", properties: {} },
    handler: async () => ({
      poDate: new Date("2026-09-27T18:30:00Z"), // saved as IST midnight
      dueDate: new Date("2026-09-28T00:00:00Z"), // saved as UTC midnight (date-only column)
      rows: [{ createdAt: new Date("2026-09-27T20:15:00Z"), amount: new Prisma.Decimal("10.50") }],
      note: "2026-09-27",
    }),
  };
  const [res] = await executeToolCalls({
    calls: [{ id: "c1", name: "po_dates", input: {} }], auth, getTool: () => tool, isWriteTool: () => false,
  });
  const out = JSON.parse(res.content);
  assert.equal(out.poDate, "2026-09-28");
  assert.equal(out.dueDate, "2026-09-28");
  assert.equal(out.rows[0].createdAt, "2026-09-28 01:45 IST");
  assert.equal(out.rows[0].amount, "10.5"); // Decimal untouched (its own toJSON)
  assert.equal(out.note, "2026-09-27");
});
