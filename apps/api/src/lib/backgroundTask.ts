/** Keeps work running after the HTTP response on Vercel (same mechanism as @vercel/functions waitUntil,
 * without the dependency); elsewhere it just runs detached. Errors are swallowed: the poll backstop retries. */
export function runInBackground(work: Promise<unknown>): void {
  const settled = work.catch(() => undefined);
  const ctx = (globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] as
    | { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined }
    | undefined;
  const waitUntil = ctx?.get?.()?.waitUntil;
  if (waitUntil) waitUntil(settled);
}
