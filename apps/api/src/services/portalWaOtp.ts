/** Queue a portal sign-in code for delivery by the existing WhatsApp bridge (WhatsappOutbox, kind "otp").
 * The recipient number always comes from the user's database row, never from the request. Nothing here logs a code, a text or a number. */
import crypto from "node:crypto";
import { z } from "zod";
import { OTP_GROUP, OTP_TTL_MS, type NewOutbox, type OtpUserLoader } from "./whatsappBridge";

export const PER_PHONE_MAX = 3;
export const PER_PHONE_WINDOW_MS = 15 * 60_000;
export const GLOBAL_MAX = 60;
export const GLOBAL_WINDOW_MS = 60 * 60_000;
/** Same (user, code) inside one bucket is the same request: queued once. */
export const IDEMPOTENCY_BUCKET_MS = 10 * 60_000;

export const waOtpBodySchema = z.object({ userId: z.string().min(1).max(60), code: z.string().regex(/^\d{6}$/) }).strict();

export const waOtpText = (code: string) => "Your Zan-F portal sign-in code is " + code + ". It expires in 5 minutes. Do not share it.";

export interface WaOtpStore {
  /** Number of sign-in code rows created since `since` (for one phone, or all when phone is omitted). */
  countOtp(since: Date, phoneE164?: string): Promise<number>;
  /** Inserts unless the inboundId already exists. */
  insert(row: NewOutbox): Promise<void>;
}
export interface WaOtpDeps { store: WaOtpStore; loadUser: OtpUserLoader; now?: () => Date; key?: () => string }

export type QueueResult = { queued: true } | { queued: false; reason: "not_eligible" | "rate_limited" | "global_limit" };

export function createWaOtpQueue(deps: WaOtpDeps) {
  const now = deps.now ?? (() => new Date());
  const key = deps.key ?? (() => process.env.JWT_SECRET ?? "");
  return async function queueWaOtp(input: { userId: string; code: string }): Promise<QueueResult> {
    const u = await deps.loadUser(input.userId);
    if (!u || !u.isActive || u.roleKey !== "customer" || !u.customerId || !u.phoneE164) return { queued: false, reason: "not_eligible" };
    const t = now();
    if ((await deps.store.countOtp(new Date(t.getTime() - GLOBAL_WINDOW_MS))) >= GLOBAL_MAX) return { queued: false, reason: "global_limit" };
    if ((await deps.store.countOtp(new Date(t.getTime() - PER_PHONE_WINDOW_MS), u.phoneE164)) >= PER_PHONE_MAX) return { queued: false, reason: "rate_limited" };
    const bucket = Math.floor(t.getTime() / IDEMPOTENCY_BUCKET_MS);
    const id = crypto.createHmac("sha256", key()).update(input.userId + "|" + input.code + "|" + bucket).digest("hex").slice(0, 32);
    await deps.store.insert({
      inboundId: "otp:" + id, mappingId: "otp:" + input.userId, waGroup: OTP_GROUP, recipientPhone: u.phoneE164, recipientLid: null,
      text: waOtpText(input.code), expiresAt: new Date(t.getTime() + OTP_TTL_MS),
    });
    return { queued: true };
  };
}
