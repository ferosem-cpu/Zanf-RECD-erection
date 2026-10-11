/** Phone / LID normalisation for WhatsApp sender mapping. Pure; no I/O.
 * Ambiguous or invalid input is rejected (returns null), never guessed. */

const INDIA_MOBILE = /^[6-9]\d{9}$/;

/** Returns "+<digits>" (E.164) or null when the input is invalid or ambiguous. */
export function normalizePhoneE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || !/^\+?[\d\s\-().]+$/.test(s)) return null;
  const explicitPlus = s.startsWith("+");
  let digits = s.replace(/\D/g, "");
  if (!digits) return null;

  if (!explicitPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
    return finishInternational(digits);
  }
  if (explicitPlus) return finishInternational(digits);

  if (digits.length === 10) return INDIA_MOBILE.test(digits) ? `+91${digits}` : null;
  if (digits.length === 11 && digits.startsWith("0")) {
    const n = digits.slice(1);
    return INDIA_MOBILE.test(n) ? `+91${n}` : null;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    const n = digits.slice(2);
    return INDIA_MOBILE.test(n) ? `+91${n}` : null;
  }
  return null;
}

function finishInternational(digits: string): string | null {
  if (digits.startsWith("0") || digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith("91")) return INDIA_MOBILE.test(digits.slice(2)) && digits.length === 12 ? `+${digits}` : null;
  return `+${digits}`;
}

/** WhatsApp LID: digits only (an optional "@lid" suffix is accepted). */
export function normalizeLid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/@lid$/i, "");
  return /^\d{5,30}$/.test(s) ? s : null;
}
