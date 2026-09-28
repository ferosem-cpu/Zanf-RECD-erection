const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("recd_token");
}

export function setToken(token: string) {
  window.localStorage.setItem("recd_token", token);
}

export function clearToken() {
  window.localStorage.removeItem("recd_token");
}

/** Thrown by `api()` when the server answered with a non-2xx status. A network failure (server
 * unreachable, request blocked, connection reset) is NOT an ApiError - fetch rejects with a
 * TypeError ("Failed to fetch") instead - so callers can tell "the server said no" apart from
 * "we couldn't reach the server". The message format is unchanged from before. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}



/** Thrown by `api()` when the request never got an HTTP answer: offline, DNS/TLS/connection
 * failure, CORS block, or our own timeout. Deliberately has no `status`, so session code keeps
 * treating it as transient (see sessionRetry.ts), and carries a readable message instead of the
 * browser's bare "Failed to fetch". */
export class NetworkError extends Error {
  readonly timedOut: boolean;
  constructor(message: string, options: { timedOut?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = "NetworkError";
    this.timedOut = !!options.timedOut;
    (this as { cause?: unknown }).cause = options.cause;
  }
}

export interface ApiOptions extends RequestInit {
  /** Abort and throw a NetworkError (timedOut) after this many ms. */
  timeoutMs?: number;
  /** Retry this many times on a network-level failure (never on an HTTP error response).
   * Defaults to 1 for GET/HEAD, 0 otherwise - only opt a non-GET in when repeating it is
   * harmless (e.g. a password login). */
  networkRetries?: number;
}

/** Zod `flatten()` payloads -> "field: message; field: message"; anything else as before. */
function errorMessageFrom(body: { error?: unknown }, status: number): string {
  const err = body.error;
  if (err && typeof err === "object") {
    const e = err as { formErrors?: unknown; fieldErrors?: Record<string, unknown> };
    if (Array.isArray(e.formErrors) || (e.fieldErrors && typeof e.fieldErrors === "object")) {
      const parts: string[] = [];
      if (Array.isArray(e.formErrors)) parts.push(...e.formErrors.map(String));
      for (const [field, msgs] of Object.entries(e.fieldErrors ?? {})) {
        if (Array.isArray(msgs) && msgs.length) parts.push(`${field}: ${msgs.map(String).join(", ")}`);
      }
      if (parts.length) return parts.join("; ");
    }
  }
  return err ? JSON.stringify(err) : `Request failed: ${status}`;
}

async function fetchOnce(url: string, init: RequestInit, timeoutMs: number | undefined): Promise<Response> {
  const controller = new AbortController();
  const outer = init.signal;
  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", onOuterAbort, { once: true });
  }
  let timedOut = false;
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) {
      throw new NetworkError(`The server took too long to respond (over ${Math.round((timeoutMs ?? 0) / 1000)}s). Please try again.`, { timedOut: true, cause: err });
    }
    if (outer?.aborted) throw err; // caller cancelled - pass the AbortError through untouched
    throw new NetworkError("Couldn't reach the Zan-APP server (network error). Check your connection and try again.", { cause: err });
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { timeoutMs, networkRetries, ...init } = options;
  const token = getToken();
  const method = (init.method ?? "GET").toUpperCase();
  const retries = networkRetries ?? (method === "GET" || method === "HEAD" ? 1 : 0);
  const requestInit: RequestInit = {
    ...init,
    // API data is per-user and changes constantly: never serve it from the browser's HTTP
    // cache or revalidate it with ETags (see the 2026-09-28 "Failed to fetch" fix).
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  };

  let res: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetchOnce(`${API_URL}${path}`, requestInit, timeoutMs);
      break;
    } catch (err) {
      const retryable = err instanceof NetworkError && !err.timedOut && attempt < retries;
      if (!retryable) throw err;
      // A dropped connection (stale keep-alive socket, flaky network, cold start) usually
      // succeeds straight away on a fresh attempt.
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }

  if (!res.ok) {
    // An expired/invalid token anywhere in the app means the session is dead - clear it and
    // bounce to login (unless we're already there, e.g. a failed sign-in or OTP attempt).
    if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
      clearToken();
      window.location.href = "/login";
    }
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errorMessageFrom(body, res.status));
  }
  // 204 No Content (every DELETE route in this app responds this way) has no body for
  // res.json() to parse - it throws "Unexpected end of JSON input" otherwise, even though
  // the request itself succeeded. No caller reads the resolved value of a DELETE call.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Fire-and-forget request that wakes a cold API function (used on the login page so the
 * first sign-in doesn't pay the cold start). Never throws. */
export function warmUpApi(): void {
  if (typeof window === "undefined") return;
  fetch(`${API_URL}/health`, { cache: "no-store" }).catch(() => {});
}

// Like `api()` above, but for an endpoint that responds with a file (Content-Disposition:
// attachment) rather than a JSON envelope - e.g. POST /backup/run. Triggers a normal browser
// download via a Blob, same mechanism as lib/csvExport.ts's downloadCsv.
export async function downloadFileFromApi(path: string, options: RequestInit = {}): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `Request failed: ${res.status}`);
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : "download";
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
