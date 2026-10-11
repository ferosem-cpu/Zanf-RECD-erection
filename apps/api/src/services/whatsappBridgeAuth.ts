/** Request authentication for the WhatsApp bridge routes (/wa/*). Contract: DISCOVERY section 7.
 * The bridge signs `METHOD\nPATH?QUERY\nTIMESTAMP\nNONCE\nBODYSHA256` with HMAC-SHA256. Zan keeps
 * the real shared secret (env WHATSAPP_BRIDGE_KEYS, never logged) because a hash cannot verify a MAC. */
import crypto from "node:crypto";

export const MAX_SKEW_SECONDS = 300;
/** Nonces are kept longer than twice the skew window so a replay can never outlive its store entry. */
export const NONCE_TTL_SECONDS = 900;

export const BRIDGE_HEADERS = {
  keyId: "x-zan-key-id",
  timestamp: "x-zan-timestamp",
  nonce: "x-zan-nonce",
  bodySha: "x-zan-body-sha256",
  signature: "x-zan-signature",
} as const;

export interface NonceStore {
  /** Atomically records (keyId, nonce); false when it was already recorded (replay). Throws on store failure. */
  claim(keyId: string, nonce: string, expiresAt: Date): Promise<boolean>;
}

const KEY_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const MIN_SECRET_LEN = 16;

/** WHATSAPP_BRIDGE_KEYS: JSON object {"id":"secret"} or "id:secret,id2:secret2". Several entries
 * are valid at once (current + previous during rotation); removing an entry revokes it. Malformed
 * entries are skipped, so a bad value fails closed. */
export function parseBridgeKeys(raw: string | undefined): Map<string, string> {
  const keys = new Map<string, string>();
  const text = (raw ?? "").trim();
  if (!text) return keys;
  const add = (id: unknown, secret: unknown) => {
    if (typeof id === "string" && typeof secret === "string" && KEY_ID_RE.test(id) && secret.length >= MIN_SECRET_LEN) keys.set(id, secret);
  };
  if (text.startsWith("{")) {
    try {
      for (const [id, secret] of Object.entries(JSON.parse(text) as Record<string, unknown>)) add(id, secret);
    } catch {
      return new Map();
    }
    return keys;
  }
  for (const part of text.split(",")) {
    const i = part.indexOf(":");
    if (i > 0) add(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return keys;
}

export const sha256Hex = (data: Buffer | string) => crypto.createHash("sha256").update(data).digest("hex");

export function canonicalString(method: string, pathQuery: string, timestamp: string, nonce: string, bodySha: string): string {
  return `${method}\n${pathQuery}\n${timestamp}\n${nonce}\n${bodySha}`;
}

export function signBridgeRequest(secret: string, method: string, pathQuery: string, timestamp: string, nonce: string, bodySha: string): string {
  return crypto.createHmac("sha256", secret).update(canonicalString(method, pathQuery, timestamp, nonce, bodySha), "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export interface VerifyInput {
  method: string;
  /** Request URI exactly as received (path + encoded query). */
  pathQuery: string;
  header: (lowerCaseName: string) => string | undefined;
  rawBody: Buffer;
  nowMs: number;
  keys: Map<string, string>;
  nonces: NonceStore;
}

export type VerifyResult = { ok: true; keyId: string } | { ok: false };

/** Never says why it failed (callers answer a uniform 401). Throws only if the nonce store fails. */
export async function verifyBridgeRequest(input: VerifyInput): Promise<VerifyResult> {
  const keyId = input.header(BRIDGE_HEADERS.keyId);
  const timestamp = input.header(BRIDGE_HEADERS.timestamp);
  const nonce = input.header(BRIDGE_HEADERS.nonce);
  const bodySha = input.header(BRIDGE_HEADERS.bodySha);
  const signature = input.header(BRIDGE_HEADERS.signature);
  if (!keyId || !timestamp || !nonce || !bodySha || !signature) return { ok: false };
  const secret = input.keys.get(keyId);
  if (!secret) return { ok: false };
  if (!/^\d{1,12}$/.test(timestamp) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(bodySha) || !/^[0-9a-f]{64}$/.test(signature)) {
    return { ok: false };
  }
  if (Math.abs(input.nowMs / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return { ok: false };
  if (!safeEqualHex(sha256Hex(input.rawBody), bodySha)) return { ok: false };
  const expected = signBridgeRequest(secret, input.method.toUpperCase(), input.pathQuery, timestamp, nonce, bodySha);
  if (!safeEqualHex(expected, signature)) return { ok: false };
  // Only an authentic request may consume a nonce slot (unauthenticated traffic cannot fill the store).
  const fresh = await input.nonces.claim(keyId, nonce, new Date(input.nowMs + NONCE_TTL_SECONDS * 1000));
  return fresh ? { ok: true, keyId } : { ok: false };
}

export interface BridgeAuthDeps {
  nonces: NonceStore;
  keys?: () => Map<string, string>;
  now?: () => number;
}

/** Express middleware: needs the raw body in req.body (express.raw). Sets res.locals.bridgeKeyId. */
export function createBridgeAuth(deps: BridgeAuthDeps): import("express").RequestHandler {
  return async (req, res, next) => {
    try {
      const result = await verifyBridgeRequest({
        method: req.method,
        pathQuery: req.originalUrl,
        header: (name) => {
          const v = req.headers[name];
          return Array.isArray(v) ? undefined : v;
        },
        rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        nowMs: (deps.now ?? Date.now)(),
        keys: (deps.keys ?? (() => parseBridgeKeys(process.env.WHATSAPP_BRIDGE_KEYS)))(),
        nonces: deps.nonces,
      });
      if (!result.ok) return void res.status(401).json({ error: "Unauthorized" });
      res.locals.bridgeKeyId = result.keyId;
      next();
    } catch {
      res.status(503).json({ error: "Temporarily unavailable" });
    }
  };
}
