/** Core agent loop: sends a conversation through a chain of configured LLM providers (tried
 * in priority order, falling back to the next on failure), executes any tool calls the model
 * makes, feeds the results back, and repeats until the model returns a plain text answer (or
 * a turn limit is hit, as a safety valve against infinite tool loops).
 */
import type { AgentLlmProvider } from "@prisma/client";
import type { AgentTool, AgentAuthContext } from "./tools/types";
import { getToolByName, isWriteTool } from "./tools/registry";
import type { UnifiedMessage, UnifiedToolSchema, LlmAdapter, SendMessageResult } from "./providers/types";
import { formatProviderFailures, providersToAttempt, recordProviderFailure, type ProviderFailure } from "./providers/providerHealth";
import { createAdapterForRow, loadActiveProvidersInOrder } from "./providers/factory";
import { AgentDeadline, LLM_CALL_TIMEOUT_MS } from "./timeouts";
import { executeToolCalls } from "./toolExecution";
import { createTurnTimer } from "./turnTiming";
import { sendCleaned, sanitizeHistory } from "./assistantText";

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

async function sendWithFallback(
  providers: AgentLlmProvider[],
  adapters: Map<string, LlmAdapter>,
  params: { systemPrompt: string; messages: UnifiedMessage[]; tools: UnifiedToolSchema[] },
  deadline: AgentDeadline,
): Promise<SendMessageResult> {
  const failures: ProviderFailure[] = [];
  const primaryId = providers[0]?.id;
  // Re-evaluated on every call, so a provider that 410s on tool turn 1 isn't retried on turns 2..8.
  const { attempt, skipped } = providersToAttempt(providers);
  for (const providerRow of attempt) {
    const primary = providerRow.id === primaryId;
    if (deadline.expired()) {
      failures.push({ providerName: providerRow.name, priority: providerRow.priority, primary, message: "not tried - out of time for this request" });
      break;
    }
    try {
      // Adapter creation (key decryption) is inside the try on purpose: previously a broken
      // fallback row threw from here straight out of the loop and replaced the primary
      // provider's real error with an unrelated decrypt/config error.
      let adapter = adapters.get(providerRow.id);
      if (!adapter) {
        adapter = createAdapterForRow(providerRow);
        adapters.set(providerRow.id, adapter);
      }
      // An empty / special-token-only reply (e.g. literal "<EOS_TOKEN>") is retried once on the
      // same provider, then treated as that provider failing so the next one is tried.
      const send = () => adapter!.sendMessage({ ...params, timeoutMs: deadline.callTimeoutMs(LLM_CALL_TIMEOUT_MS) });
      return await sendCleaned(send, () => !deadline.expired());
    } catch (err) {
      failures.push(recordProviderFailure(providerRow, err, "chat", { primary }));
    }
  }
  throw new Error(`All configured LLM providers failed:\n${formatProviderFailures(failures, skipped)}`);
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
      response = await sendWithFallback(providers, adapters, { systemPrompt, messages: history, tools: unifiedTools }, deadline);
      timer.llm(Date.now() - llmStarted);
    } catch (err) {
      timer.llm(Date.now() - llmStarted);
      timer.log("llm_error");
      // First call failed: nothing useful happened yet, surface the real error (route -> 500).
      if (turn === 0) throw err;
      // A later call failed after tools already ran (possibly creating a pending confirm
      // card): keep that history rather than throwing it away with a 500.
      const reply = `Sorry - I couldn't finish that: the AI provider stopped responding part-way through. ${(err as Error).message}`;
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
