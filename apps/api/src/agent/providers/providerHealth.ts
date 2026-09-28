/** Fallback-chain bookkeeping shared by the agent chat loop (llm.ts) and the document
 * extraction helpers (bill / customer-PO / generic document extraction).
 *
 * Why this exists: the configured NVIDIA fallback (priority 2) started answering every call
 * with HTTP 410 Gone. A 410 is not transient - it means the endpoint/model has been retired,
 * or (very commonly for integrate.api.nvidia.com in 2026) that the API key's organisation
 * lacks NVIDIA's "Public API Endpoints" entitlement - so retrying it on every tool turn of
 * every request just adds latency and noise. Providers that return 410 are therefore:
 *   - logged loudly (console.error, which lands in Vercel runtime logs) with what to do, and
 *   - skipped for RETIRED_SKIP_MS in this server instance, keyed on id + model + baseUrl +
 *     updatedAt, so editing the provider under Settings > Agent providers (new model id, new
 *     key) takes effect immediately without waiting for the skip to expire.
 * If every active provider is currently marked retired we still try them all (fail open on
 * the skip, never on the error), so the caller gets a real error message rather than nothing.
 *
 * Every failure is also logged individually and the final "all providers failed" error lists
 * the primary (first-priority) provider's error first and labels it, so a broken fallback
 * can never hide why the primary (Gemini) actually failed.
 */
import type { AgentLlmProvider } from "@prisma/client";
import { httpStatusOf } from "./types";

export const RETIRED_SKIP_MS = 60 * 60 * 1000;
/** A 429 that says the account is out of credits/quota (not a momentary rate limit) is just
 * as hopeless as a 410 until someone tops up the account, so it is skipped too, for a shorter
 * window. Seen 2026-09-28: the OpenAI primary answered every call with "429 You have no
 * credits remaining", and every tool turn of every chat paid for that (plus SDK retries)
 * before falling back - one of the reasons the chat sat on "Thinking…". */
export const QUOTA_SKIP_MS = 15 * 60 * 1000;

type ProviderIdentity = Pick<AgentLlmProvider, "id" | "name" | "model" | "baseUrl" | "priority"> & {
  updatedAt?: Date | null;
};

const retiredUntil = new Map<string, number>();

function providerKey(row: ProviderIdentity): string {
  return [row.id, row.model, row.baseUrl ?? "", row.updatedAt ? new Date(row.updatedAt).getTime() : ""].join("|");
}

/** HTTP 410 Gone: the provider says this resource is permanently gone. */
export function isRetiredStatus(status: number | undefined): boolean {
  return status === 410;
}

/** HTTP 429 whose message says the quota/credits are exhausted (vs. a transient rate limit). */
export function isQuotaExhausted(status: number | undefined, message: string): boolean {
  return status === 429 && /insufficient_quota|no credits|credit balance|quota|billing/i.test(message);
}

export function isMarkedRetired(row: ProviderIdentity, now = Date.now()): boolean {
  const key = providerKey(row);
  const until = retiredUntil.get(key);
  if (until === undefined) return false;
  if (until <= now) {
    retiredUntil.delete(key);
    return false;
  }
  return true;
}

/** Providers to attempt, in priority order, minus any currently marked retired (410). Falls
 * back to the full list if that would leave nothing to try. `skipped` is for logging/errors. */
export function providersToAttempt<T extends ProviderIdentity>(providers: T[], now = Date.now()): { attempt: T[]; skipped: T[] } {
  const skipped = providers.filter((p) => isMarkedRetired(p, now));
  const attempt = providers.filter((p) => !skipped.includes(p));
  if (attempt.length === 0) return { attempt: providers, skipped: [] };
  return { attempt, skipped };
}

export interface ProviderFailure {
  providerName: string;
  priority: number;
  /** True for the highest-priority active provider - its error is the one that matters most. */
  primary: boolean;
  status?: number;
  message: string;
}

/** Log a provider failure and, for a 410, mark the provider as retired for RETIRED_SKIP_MS. */
export function recordProviderFailure(
  row: ProviderIdentity,
  err: unknown,
  context: string,
  opts: { primary: boolean; now?: number },
): ProviderFailure {
  const status = httpStatusOf(err);
  const message = err instanceof Error ? err.message : String(err);
  const label = `[agent:${context}] provider "${row.name}" (priority ${row.priority}, model "${row.model}"${opts.primary ? ", PRIMARY" : ", fallback"})`;
  if (isRetiredStatus(status)) {
    retiredUntil.set(providerKey(row), (opts.now ?? Date.now()) + RETIRED_SKIP_MS);
    console.error(
      `${label} returned HTTP 410 Gone - the model/endpoint is retired or the API key's account ` +
        `is not entitled to it (NVIDIA: "Public API Endpoints"). Skipping this provider for ` +
        `${RETIRED_SKIP_MS / 60000} min on this instance. Fix: update its model id or key under ` +
        `Settings > Agent providers, or deactivate it. Detail: ${message}`,
    );
  } else if (isQuotaExhausted(status, message)) {
    retiredUntil.set(providerKey(row), (opts.now ?? Date.now()) + QUOTA_SKIP_MS);
    console.error(
      `${label} is out of credits/quota (HTTP 429). Skipping this provider for ${QUOTA_SKIP_MS / 60000} min ` +
        `on this instance. Fix: top up the account, or deactivate/reorder it under Settings > Agent providers. ` +
        `Detail: ${message}`,
    );
  } else {
    console.error(`${label} failed${status ? ` (HTTP ${status})` : ""}: ${message}`);
  }
  return { providerName: row.name, priority: row.priority, primary: opts.primary, status, message };
}

/** Build a non-HTTP failure entry (e.g. "does not support document extraction", bad JSON). */
export function simpleFailure(row: ProviderIdentity, message: string, primary: boolean, context: string): ProviderFailure {
  console.error(`[agent:${context}] provider "${row.name}" (priority ${row.priority}${primary ? ", PRIMARY" : ", fallback"}): ${message}`);
  return { providerName: row.name, priority: row.priority, primary, message };
}

/** Human-readable summary with the primary provider's error first and clearly labelled. */
export function formatProviderFailures(failures: ProviderFailure[], skipped: ProviderIdentity[] = []): string {
  const ordered = [...failures].sort((a, b) => Number(b.primary) - Number(a.primary));
  const lines = ordered.map(
    (f) => `${f.primary ? "Primary" : "Fallback"} ${f.providerName}${f.status ? ` [HTTP ${f.status}]` : ""}: ${f.message}`,
  );
  for (const s of skipped) {
    lines.push(`Skipped ${s.name}: recently returned HTTP 410 Gone or "out of credits" (429) - fix, top up or deactivate it in Settings > Agent providers`);
  }
  return lines.join("\n");
}
