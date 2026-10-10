/** One structured log line per agent turn: model rounds, per-round LLM ms, per-tool ms, total ms.
 * Names and durations only - never tool inputs/outputs, amounts or user text. */
export interface TurnTimer {
  llm(ms: number): void;
  tools(timings: { tool: string; ms: number; error: boolean }[]): void;
  summary(outcome: string): Record<string, unknown>;
  log(outcome: string): void;
}

export function createTurnTimer(now: () => number = Date.now, sink: (line: string) => void = (l) => console.log(l)): TurnTimer {
  const start = now();
  const llmMs: number[] = [];
  const toolMs: { tool: string; ms: number; error: boolean }[] = [];
  const summary = (outcome: string) => ({
    rounds: llmMs.length,
    llmMs,
    llmTotalMs: llmMs.reduce((a, b) => a + b, 0),
    tools: toolMs.map((t) => `${t.tool}:${t.ms}${t.error ? ":err" : ""}`),
    toolCalls: toolMs.length,
    toolTotalMs: toolMs.reduce((a, b) => a + b.ms, 0),
    totalMs: now() - start,
    outcome,
  });
  return {
    llm: (ms) => void llmMs.push(Math.round(ms)),
    tools: (t) => void toolMs.push(...t.map((x) => ({ ...x, ms: Math.round(x.ms) }))),
    summary,
    log: (outcome) => sink(`agent_turn_timing ${JSON.stringify(summary(outcome))}`),
  };
}
