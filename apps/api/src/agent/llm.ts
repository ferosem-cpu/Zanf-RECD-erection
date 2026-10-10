/** Core agent loop: sends a conversation through a chain of configured LLM providers (tried
 * in priority order, falling back to the next on failure), executes any tool calls the model
 * makes, feeds the results back, and repeats until the model returns a plain text answer (or
 * a turn limit is hit, as a safety valve against infinite tool loops).
 */
import type { AgentLlmProvider } from "@prisma/client";
import type { AgentTool, AgentAuthContext } from "./tools/types";
import { getToolByName, isWriteTool } from "./tools/registry";
import type { UnifiedMessage, UnifiedToolSchema, LlmAdapter, SendMessageResult } from "./providers/types";
import { sendWithFallback } from "./sendWithFallback";
import { loadActiveProvidersInOrder } from "./providers/factory";
import { AgentDeadline } from "./timeouts";
import { AGENT_FRIENDLY_ERROR } from "./friendlyError";
import { executeToolCalls } from "./toolExecution";
import { createTurnTimer } from "./turnTiming";
import { sanitizeHistory } from "./assistantText";

const MAX_TOOL_TURNS = 8;

export const TIMEOUT_REPLY =
  "Sorry - this is taking longer than I'm allowed to spend on one message, so I stopped here. " +
  "Anything I already prepared is shown above. Please try again, or split the request into smaller steps.";

export type AgentMessage = UnifiedMessage;

export interface RunAgentTurnParams {
  systemPrompt: string;
  history: UnifiedMessage[];
  tools: AgentTool[];
  auth: AgentAuthContext;
  /** Called for each tool the model wants to run, before it executes - lets a caller
   * short-circuit (e.g. reject) a write-tool call by returning a replacement result instead
   * of letting handler() run. Not yet used by any tool (all current tools are read-only). */
  onToolCall?: (toolName: string, input: Record<string, unknown>) => Promise<{ intercepted: true; result: unknown } | { intercepted: false }>;
  /** Overall time budget for this request (shared with any attachment extraction the caller
   * already did). Defaults to a fresh AGENT_REQUEST_BUDGET_MS budget. */
  deadline?: AgentDeadline;
}

export interface RunAgentTurnResult {
  reply: string;
  history: UnifiedMessage[];
}

function toUnifiedTools(tools: AgentTool[]): UnifiedToolSchema[] {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

export async function runAgentTurn(params: RunAgentTurnParams): Promise<RunAgentTurnResult> {
  const { systemPrompt, tools, onToolCall } = params;
  const unifiedTools = toUnifiedTools(tools);

  const providers = await loadActiveProvidersInOrder();
  if (providers.length === 0) {
    throw new Error(
      "No LLM provider is configured for the agent yet. Add one under Settings > Agent providers.",
    );
  }
  const adapters = new Map<string, LlmAdapter>();

  // Old assistant turns are replayed sanitised (a stored "<EOS_TOKEN>" reply must not re-prime the model).
  let history = sanitizeHistory<UnifiedMessage>(params.history);
  const deadline = params.deadline ?? new AgentDeadline();
  const timer = createTurnTimer();
  const timedOut = new Set<string>();

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    if (deadline.expired()) {
      // Answer (and let the caller persist whatever tool results / pending confirm cards
      // were already produced) instead of letting the request run until the platform kills it.
      timer.log("deadline");
      return { reply: TIMEOUT_REPLY, history: [...history, { role: "assistant", content: TIMEOUT_REPLY }] };
    }
    let response: SendMessageResult;
    const llmStarted = Date.now();
    try {
      response = await sendWithFallback(providers, adapters, { systemPrompt, messages: history, tools: unifiedTools }, deadline, timedOut);
      timer.llm(Date.now() - llmStarted);
    } catch (err) {
      timer.llm(Date.now() - llmStarted);
      timer.log("llm_error");
      // First call failed: nothing useful happened yet, surface the real error (route -> 500).
      if (turn === 0) throw err;
      // A later call failed after tools already ran (possibly creating a pending confirm
      // card): keep that history rather than throwing it away with a 500.
      console.error(`[agent:error] later round failed: ${(err as Error).message}`);
      const reply = `${AGENT_FRIENDLY_ERROR}. Anything I already prepared is shown above.`;
      return { reply, history: [...history, { role: "assistant", content: reply }] };
    }

    history = [...history, { role: "assistant", content: response.text, toolCalls: response.toolCalls }];

    if (response.toolCalls.length === 0) {
      timer.log("reply");
      return { reply: response.text, history };
    }

    // Read-only calls in one step run concurrently; any write tool keeps the step sequential.
    const results = await executeToolCalls({
      calls: response.toolCalls,
      auth: params.auth,
      getTool: getToolByName,
      isWriteTool,
      onToolCall,
      deadline,
      onTiming: timer.tools,
    });
    history = [...history, ...results];
  }

  timer.log("max_steps");
  return {
    reply: "I wasn't able to finish that within the allowed number of steps - could you rephrase or simplify the request?",
    history,
  };
}
