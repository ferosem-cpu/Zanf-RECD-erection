import type { AgentLlmProvider } from "@prisma/client";
import type { UnifiedMessage, UnifiedToolSchema, LlmAdapter, SendMessageResult } from "./providers/types";
import { formatProviderFailures, providersToAttempt, recordProviderFailure, type ProviderFailure } from "./providers/providerHealth";
import { createAdapterForRow } from "./providers/factory";
import { httpStatusOf } from "./providers/types";
import type { AgentDeadline } from "./timeouts";
import { sendCleaned } from "./assistantText";

/** HTTP 413: the request (prompt + tools) is too large for this provider/model. It is handled like
 * any other failure (the next provider/backup model is tried), and since the history only grows
 * within a request, the provider is also skipped for the rest of this request, like a timeout. */
export function isPayloadTooLarge(err: unknown): boolean {
  return httpStatusOf(err) === 413 || httpStatusOf((err as { cause?: unknown } | null)?.cause) === 413;
}

function isTimeoutError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  return /timeout|timed out/i.test(`${e?.name ?? ""} ${e?.message ?? ""}`);
}

export async function sendWithFallback(
  providers: AgentLlmProvider[],
  adapters: Map<string, LlmAdapter>,
  params: { systemPrompt: string; messages: UnifiedMessage[]; tools: UnifiedToolSchema[] },
  deadline: AgentDeadline,
  /** Providers that timed out (or returned 413) earlier in this same request; later rounds go straight past them. */
  timedOut: Set<string> = new Set(),
  /** Called with the provider row that produced the returned answer. */
  onProvider?: (row: AgentLlmProvider) => void,
): Promise<SendMessageResult> {
  const failures: ProviderFailure[] = [];
  const primaryId = providers[0]?.id;
  // Re-evaluated on every call, so a provider that 410s on tool turn 1 isn't retried on turns 2..8.
  const { attempt: healthy, skipped } = providersToAttempt(providers);
  const preferred = healthy.filter((p) => !timedOut.has(p.id));
  const attempt = preferred.length > 0 ? preferred : healthy;
  for (let i = 0; i < attempt.length; i++) {
    const providerRow = attempt[i];
    const hasFallback = i < attempt.length - 1;
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
      const send = () => adapter!.sendMessage({ ...params, timeoutMs: deadline.attemptTimeoutMs(hasFallback) });
      const result = await sendCleaned(send, () => !deadline.expired());
      onProvider?.(providerRow);
      return result;
    } catch (err) {
      if (isTimeoutError(err) || isPayloadTooLarge(err)) timedOut.add(providerRow.id);
      failures.push(recordProviderFailure(providerRow, err, "chat", { primary }));
    }
  }
  throw new Error(`All configured LLM providers failed:\n${formatProviderFailures(failures, skipped)}`);
}
