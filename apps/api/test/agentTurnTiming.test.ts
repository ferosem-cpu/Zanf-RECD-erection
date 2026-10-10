import { test } from "node:test";
import assert from "node:assert/strict";
import { createTurnTimer } from "../src/agent/turnTiming";
import { executeToolCalls } from "../src/agent/toolExecution";

test("turn timer: one structured line with rounds, per-round LLM ms, per-tool ms and total; no inputs", () => {
  let t = 1000;
  const lines: string[] = [];
  const timer = createTurnTimer(() => t, (l) => lines.push(l));
  t += 1200; timer.llm(1200);
  timer.tools([{ tool: "get_receivables", ms: 340, error: false }, { tool: "search_vendor_bills", ms: 90, error: true }]);
  t += 430;
  t += 2000; timer.llm(2000);
  timer.log("reply");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^agent_turn_timing \{/);
  const s = JSON.parse(lines[0].slice("agent_turn_timing ".length));
  assert.deepEqual([s.rounds, s.llmMs, s.llmTotalMs, s.toolCalls, s.toolTotalMs, s.totalMs, s.outcome], [2, [1200, 2000], 3200, 2, 430, 3630, "reply"]);
  assert.deepEqual(s.tools, ["get_receivables:340", "search_vendor_bills:90:err"]);
});

test("executeToolCalls reports per-tool timings, errors flagged", async () => {
  const tools = {
    ok: { name: "ok", handler: async () => ({ fine: 1 }) },
    bad: { name: "bad", handler: async () => ({ error: "nope" }) },
  } as any;
  let seen: { tool: string; ms: number; error: boolean }[] = [];
  const out = await executeToolCalls({
    calls: [{ id: "1", name: "ok", input: {} }, { id: "2", name: "bad", input: {} }],
    auth: { userId: "u", roleKey: "r", permissions: new Set() } as any,
    getTool: (n) => tools[n],
    isWriteTool: () => false,
    onTiming: (t) => (seen = t),
  });
  assert.equal(out.length, 2);
  assert.deepEqual(seen.map((s) => [s.tool, s.error]), [["ok", false], ["bad", true]]);
  assert.ok(seen.every((s) => s.ms >= 0));
});
