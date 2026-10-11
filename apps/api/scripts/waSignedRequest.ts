/** Sends one signed WhatsApp-bridge request (no WhatsApp needed). Never prints the secret.
 * Env: WA_BASE_URL, WA_KEY_ID, WA_KEY_SECRET, optional VERCEL_BYPASS_SECRET (Deployment Protection).
 * Usage: npx tsx scripts/waSignedRequest.ts METHOD /wa/path?query [bodyJson] [--sign-path /other] [--idem KEY]
 * --sign-path signs a different path than the one requested (expect 401). */
import crypto from "node:crypto";
import { BRIDGE_HEADERS, sha256Hex, signBridgeRequest } from "../src/services/whatsappBridgeAuth";

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    return args.splice(i, 2)[1];
  };
  const signPath = opt("--sign-path");
  const idem = opt("--idem");
  const [method = "GET", path = "/wa/outbox?limit=5", body = ""] = args;
  const { WA_BASE_URL, WA_KEY_ID, WA_KEY_SECRET, VERCEL_BYPASS_SECRET } = process.env;
  if (!WA_BASE_URL || !WA_KEY_ID || !WA_KEY_SECRET) throw new Error("Set WA_BASE_URL, WA_KEY_ID, WA_KEY_SECRET");
  const bodySha = sha256Hex(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const signature = signBridgeRequest(WA_KEY_SECRET, method.toUpperCase(), signPath ?? path, ts, nonce, bodySha);
  const headers: Record<string, string> = {
    Accept: "application/json",
    [BRIDGE_HEADERS.keyId]: WA_KEY_ID,
    [BRIDGE_HEADERS.timestamp]: ts,
    [BRIDGE_HEADERS.nonce]: nonce,
    [BRIDGE_HEADERS.bodySha]: bodySha,
    [BRIDGE_HEADERS.signature]: signature,
  };
  if (body) headers["Content-Type"] = "application/json";
  if (idem) headers["Idempotency-Key"] = idem;
  if (VERCEL_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = VERCEL_BYPASS_SECRET;
  const res = await fetch(WA_BASE_URL.replace(/\/$/, "") + path, { method, headers, body: body || undefined });
  console.log(res.status, await res.text());
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
