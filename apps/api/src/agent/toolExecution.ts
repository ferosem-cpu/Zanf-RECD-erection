/** Runs the tool calls of one model step. Kept out of llm.ts (which pulls in the providers and
 * the whole tool registry) so it can be unit-tested with fake tools.
 *
 * When a step has several calls and ALL of them are read-only, they run concurrently - a
 * finance question often fans out to 3-4 searches and they used to run one after another.
 * Any write (confirm-gated) tool in the step makes the whole step sequential, exactly as
 * before. Results always come back in the model's tool_call order with their own ids, and one
 * failing or slow tool only turns ITS result into an error.
 */
import type { AgentTool, AgentAuthContext } from "./tools/types";
import type { AgentDeadline } from "./timeouts";
import { annotateListResult } from "./listResult";
import { datesToIST } from "./istDates";

export interface ToolCallLike {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  toolName: string;
  content: string;
}

export type OnToolCall = (toolName: string, input: Record<string, unknown>) => Promise<{ intercepted: true; result: unknown } | { intercepted: false }>;

function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Max time for one read-only tool call (DB query / Drive search), clipped to the request budget. */
export const TOOL_CALL_TIMEOUT_MS = envMs("AGENT_TOOL_CALL_TIMEOUT_MS", 25_000);

export interface ExecuteToolCallsParams {
  calls: ToolCallLike[];
  auth: AgentAuthContext;
  getTool: (name: string) => AgentTool | undefined;
  /** True for confirm-gated write tools - they never run concurrently and are never timed out
   * (a write that outlived its timeout could still create a pending action behind our back). */
  isWriteTool: (name: string) => boolean;
  onToolCall?: OnToolCall;
  deadline?: AgentDeadline;
  toolTimeoutMs?: number;
}

export function canRunInParallel(calls: ToolCallLike[], isWriteTool: (name: string) => boolean): boolean {
  return calls.length > 1 && calls.every((c) => !isWriteTool(c.name));
}

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} took longer than ${Math.round(ms / 1000)}s and was stopped. Try a narrower query.`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function runOne(call: ToolCallLike, p: ExecuteToolCallsParams): Promise<ToolResultMessage> {
  let resultValue: unknown;
  try {
    const intercepted = await p.onToolCall?.(call.name, call.input);
    if (intercepted?.intercepted) {
      resultValue = intercepted.result;
    } else {
      const tool = p.getTool(call.name);
      if (!tool) {
        resultValue = { error: `Unknown tool: ${call.name}` };
      } else if (p.isWriteTool(call.name)) {
        resultValue = annotateListResult(await tool.handler(call.input, p.auth));
      } else {
        const cap = p.toolTimeoutMs ?? TOOL_CALL_TIMEOUT_MS;
        const ms = p.deadline ? Math.max(1_000, Math.min(cap, p.deadline.remainingMs())) : cap;
        resultValue = annotateListResult(await withTimeout(tool.handler(call.input, p.auth), ms, call.name));
      }
    }
  } catch (err) {
    resultValue = { error: (err as Error).message };
  }
  // Dates go to the model in IST (as admin-web shows them), never as UTC ISO strings.
  return { role: "tool", toolCallId: call.id, toolName: call.name, content: JSON.stringify(datesToIST(resultValue)) };
}

export async function executeToolCalls(p: ExecuteToolCallsParams): Promise<ToolResultMessage[]> {
  if (canRunInParallel(p.calls, p.isWriteTool)) {
    // Promise.all keeps input order; runOne never rejects (errors become results).
    return Promise.all(p.calls.map((call) => runOne(call, p)));
  }
  const out: ToolResultMessage[] = [];
  for (const call of p.calls) out.push(await runOne(call, p));
  return out;
}
