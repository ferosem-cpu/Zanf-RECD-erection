/** Business dates are Indian time (IST = UTC+5:30, no DST). Kept free of prisma/tool imports so
 * toolExecution.ts stays unit-testable with fake tools. */
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** A date-only value saved as UTC midnight and one saved as IST midnight (18:30Z the day before)
 * both land on the right day. */
export function isoDateIST(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Date-only values (UTC or IST midnight) -> "yyyy-mm-dd"; real timestamps -> "yyyy-mm-dd HH:mm IST". */
export function formatDateIST(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const t = d.getTime();
  if (t % DAY_MS === 0 || (t + IST_OFFSET_MS) % DAY_MS === 0) return isoDateIST(d);
  return `${new Date(t + IST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ")} IST`;
}

/** Replaces every Date in a tool result (plain objects/arrays only, e.g. not Prisma.Decimal) with
 * its IST rendering, so the model never sees a UTC ISO string and shows 27 Sep for a 28 Sep date. */
export function datesToIST(value: unknown): unknown {
  if (value instanceof Date) return formatDateIST(value);
  if (Array.isArray(value)) return value.map(datesToIST);
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, datesToIST(v)]));
  }
  return value;
}
