/** Settings-driven sender allowlist for the WhatsApp bridge (GET /wa/allowlist).
 * The bridge forwards a message only when the sender's phone (or LID) is in this set, so a number
 * that is not enabled in Settings > WhatsApp numbers never leaves the paired phone's bridge.
 * Eligibility is EXACTLY the ingest rule (resolveSender): mapping enabled, AI not paused, user exists and
 * passes checkUserAccess (active, vendor not blocked, role with a WhatsApp group). Entries are salted SHA-256
 * hashes (fresh random salt per response), so the response and any log of it never carry a phone number. */
import crypto from "node:crypto";
import { checkUserAccess, type WaUserContext } from "../agent/whatsapp/policy";

export const ALLOWLIST_VERSION = 1;
/** How long the bridge may keep using a fetched set when later fetches fail; after that it forwards nothing. */
export const ALLOWLIST_TTL_SECONDS = 300;

export interface AllowlistCandidate {
  phoneE164: string;
  lid: string | null;
  enabled: boolean;
  aiPaused: boolean;
  user: WaUserContext | null;
}

export interface AllowlistResponse {
  version: number;
  salt: string;
  ttlSeconds: number;
  phones: string[];
  lids: string[];
}

/** Hash the bridge must reproduce: hex(sha256("<salt>:p:<E.164 digits without +>")) or ":l:<lid digits>". */
export function allowlistHash(salt: string, kind: "p" | "l", value: string): string {
  return crypto.createHash("sha256").update(`${salt}:${kind}:${value}`).digest("hex");
}

export function isAllowlisted(c: AllowlistCandidate): boolean {
  if (!c.enabled || c.aiPaused || !c.user) return false;
  return checkUserAccess(c.user).ok;
}

export function buildAllowlist(rows: AllowlistCandidate[], salt: string = crypto.randomBytes(16).toString("hex")): AllowlistResponse {
  const phones = new Set<string>();
  const lids = new Set<string>();
  for (const r of rows) {
    if (!isAllowlisted(r)) continue;
    const digits = r.phoneE164.replace(/^\+/, "");
    if (/^\d{8,15}$/.test(digits)) phones.add(allowlistHash(salt, "p", digits));
    if (r.lid && /^\d{5,30}$/.test(r.lid)) lids.add(allowlistHash(salt, "l", r.lid));
  }
  return { version: ALLOWLIST_VERSION, salt, ttlSeconds: ALLOWLIST_TTL_SECONDS, phones: [...phones].sort(), lids: [...lids].sort() };
}
