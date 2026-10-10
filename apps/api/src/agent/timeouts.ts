/** Time limits for the in-app agent.
 *
 * Why: the 2026-09-28 "stuck on Thinking…" report. Nothing bounded an agent request - the
 * openai / @anthropic-ai/sdk clients default to a 10-minute timeout with 2 automatic retries
 * per call, a turn can make up to MAX_TOOL_TURNS LLM calls, each call first tries the (dead)
 * primary provider before falling back, and attachment extraction (native Gemini fetch) had
 * no timeout at all. One slow or quota-exhausted provider could therefore keep a request open
 * for minutes, long past the point where the browser / Vercel gives up, and the chat bubble
 * just kept spinning. Every agent request now has a hard overall budget, and each individual
 * provider call a per-call timeout that never exceeds what is left of that budget.
 *
 * All values can be overridden with env vars (milliseconds) without a code change.
 */
function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Max time for one LLM chat call (one provider, one tool turn). */
export const LLM_CALL_TIMEOUT_MS = envMs("AGENT_LLM_CALL_TIMEOUT_MS", 30_000);
/** Max time for one document-extraction call (PDF/image read). */
export const EXTRACTION_TIMEOUT_MS = envMs("AGENT_EXTRACTION_TIMEOUT_MS", 40_000);
/** Overall budget for one chat request (attachment extraction + every tool turn). Kept well
 * under the API function's max duration so the server always answers with JSON (reply or
 * error) instead of the platform killing the request. */
export const AGENT_REQUEST_BUDGET_MS = envMs("AGENT_REQUEST_BUDGET_MS", 55_000);
/** Don't start another LLM call with less than this left - it would only time out. */
export const MIN_CALL_WINDOW_MS = 4_000;
/** Max time one round may spend on a provider that still has a fallback behind it. */
export const LLM_ATTEMPT_CAP_MS = envMs("AGENT_LLM_ATTEMPT_CAP_MS", 25_000);
/** Budget always kept back for a fallback attempt while a provider ahead of it is running. */
export const FALLBACK_RESERVE_MS = envMs("AGENT_FALLBACK_RESERVE_MS", 20_000);

/** SDK retries per call. The fallback chain already covers a failing provider, so SDK-level
 * retries only add latency (a 429 "no credits" was being retried twice per tool turn). */
export const SDK_MAX_RETRIES = 1;

export class AgentDeadline {
  private readonly endsAt: number;
  constructor(budgetMs = AGENT_REQUEST_BUDGET_MS, private readonly now: () => number = Date.now) {
    this.endsAt = now() + budgetMs;
  }
  remainingMs(): number {
    return Math.max(0, this.endsAt - this.now());
  }
  expired(minWindowMs = MIN_CALL_WINDOW_MS): boolean {
    return this.remainingMs() < minWindowMs;
  }
  /** Per-call timeout: the configured cap, clipped to what's left of the overall budget. */
  callTimeoutMs(capMs: number): number {
    return Math.max(1_000, Math.min(capMs, this.remainingMs()));
  }
  /** Timeout for one provider attempt. The last provider gets the normal call cap; one with a
   * fallback behind it gets at most LLM_ATTEMPT_CAP_MS and never eats the fallback's reserve. */
  attemptTimeoutMs(hasFallback: boolean): number {
    if (!hasFallback) return this.callTimeoutMs(LLM_CALL_TIMEOUT_MS);
    const room = Math.max(MIN_CALL_WINDOW_MS, this.remainingMs() - FALLBACK_RESERVE_MS);
    return this.callTimeoutMs(Math.min(LLM_ATTEMPT_CAP_MS, room));
  }
}

export class AgentTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTimeoutError";
  }
}
