const PRODUCTION_HOSTS = new Set(["zan-app-api.vercel.app"]);

/** Returns null when the base URL is an allowed non-production target, else the refusal reason. */
export function checkWaBaseUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "WA_BASE_URL is not a valid URL";
  }
  const host = u.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.has(host)) return `refusing production host ${host}`;
  if (u.protocol === "http:" && (host === "localhost" || host === "127.0.0.1")) return null;
  if (u.protocol === "https:" && host.endsWith(".vercel.app")) return null;
  return `refusing ${u.protocol}//${host}: only http://localhost, http://127.0.0.1 and https://*.vercel.app preview hosts are allowed`;
}
