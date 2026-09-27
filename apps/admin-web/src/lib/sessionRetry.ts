// Pure helpers for AuthContext's session check, kept separate so they can be unit-tested.

/** True only when the server actually rejected the session (HTTP 401). Anything else - a network
 * failure ("Failed to fetch"), a 5xx, a timeout - is treated as transient: the token is kept and
 * the check is retried, instead of silently logging the user out (the 2026-09-27 bug where one
 * dropped request bounced users to /login). Duck-typed on `status` so it doesn't depend on the
 * exact error class. */
export function isSessionRejected(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: unknown }).status === 401;
}

export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 30000;

/** Exponential backoff: 1s, 2s, 4s, 8s, 16s, then 30s forever. `attempt` starts at 0. */
export function retryDelayMs(attempt: number): number {
  const safe = Math.max(0, Math.floor(attempt));
  return Math.min(RETRY_BASE_MS * 2 ** Math.min(safe, 16), RETRY_MAX_MS);
}
