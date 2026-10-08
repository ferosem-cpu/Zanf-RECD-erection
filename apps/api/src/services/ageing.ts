/** Ageing buckets shared by the Finance reports (receivables/payables ageing) and the agent's
 * receivables/payables tools, so the agent's buckets always match the Finance pages. The anchor
 * is the due date (or the document date when there is none); "current" = not yet due. */
export type AgeingBucket = "current" | "days0_30" | "days31_60" | "days61_90" | "days90Plus";

export const AGEING_BUCKETS: AgeingBucket[] = ["current", "days0_30", "days31_60", "days61_90", "days90Plus"];

const DAY_MS = 86_400_000;

export function ageingBucket(anchor: Date, now: Date): { bucket: AgeingBucket; daysPastDue: number } {
  const days = Math.floor((now.getTime() - anchor.getTime()) / DAY_MS);
  const bucket: AgeingBucket = days <= 0 ? "current" : days <= 30 ? "days0_30" : days <= 60 ? "days31_60" : days <= 90 ? "days61_90" : "days90Plus";
  return { bucket, daysPastDue: Math.max(days, 0) };
}

export function emptyAgeing(): Record<AgeingBucket, number> {
  return { current: 0, days0_30: 0, days31_60: 0, days61_90: 0, days90Plus: 0 };
}
