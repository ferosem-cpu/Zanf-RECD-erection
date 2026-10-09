/** Ageing buckets shared by the Finance reports (receivables/payables ageing) and the agent's
 * receivables/payables tools, so the agent's buckets always match the Finance pages. The anchor
 * is the due date (or the document date when there is none); "current" = not yet due. */
export type AgeingBucket = "current" | "days0_30" | "days31_60" | "days61_90" | "days90Plus";

export const AGEING_BUCKETS: AgeingBucket[] = ["current", "days0_30", "days31_60", "days61_90", "days90Plus"];

const DAY_MS = 86_400_000;
/** Asia/Kolkata is UTC+05:30 all year (no DST). */
const IST_OFFSET_MS = 330 * 60_000;

/** Days since 1970-01-01 of the IST (Asia/Kolkata) calendar date of an instant. */
export function istDayNumber(d: Date): number {
  return Math.floor((d.getTime() + IST_OFFSET_MS) / DAY_MS);
}

/** Days past due = difference of IST calendar dates (as the pages show them), not elapsed
 * 24-hour periods: due 29 Sep, today 9 Oct IST = 10 days whatever the time of day. */
export function ageingBucket(anchor: Date, now: Date): { bucket: AgeingBucket; daysPastDue: number } {
  const days = istDayNumber(now) - istDayNumber(anchor);
  const bucket: AgeingBucket = days <= 0 ? "current" : days <= 30 ? "days0_30" : days <= 60 ? "days31_60" : days <= 90 ? "days61_90" : "days90Plus";
  return { bucket, daysPastDue: Math.max(days, 0) };
}

/** Start of the IST calendar day containing `now`, as an instant (for Prisma `dueDate < today`). */
export function istStartOfDay(now: Date): Date {
  return new Date(istDayNumber(now) * DAY_MS - IST_OFFSET_MS);
}

/** THE overdue rule for customer invoices and vendor bills: a due date is set and its IST
 * calendar date is before today's. No due date = never overdue. */
export function isPastDue(dueDate: Date | null | undefined, now: Date): boolean {
  return !!dueDate && istDayNumber(dueDate) < istDayNumber(now);
}

export type DueStatus = "overdue" | "not_due" | "no_due_date";
export const AGED_BY_DOC_DATE_LABEL = "aged by bill date (no due date)";

/** Due status + ageing of one document. With a due date: overdue only when past it, daysPastDue
 * counted from it. Without one: status "no_due_date", never overdue, daysPastDue null; the
 * ageing bucket comes from the document (bill/issue) date and is labelled as such. */
export function documentAgeing(dueDate: Date | null | undefined, docDate: Date, now: Date, docDateLabel = "bill date") {
  if (!dueDate) {
    const { bucket, daysPastDue: ageDays } = ageingBucket(docDate, now);
    return {
      dueStatus: "no_due_date" as DueStatus, overdue: false, daysPastDue: null as number | null, bucket, ageDays,
      ageingBasis: docDateLabel === "bill date" ? AGED_BY_DOC_DATE_LABEL : `aged by ${docDateLabel} (no due date)`,
    };
  }
  const { bucket, daysPastDue } = ageingBucket(dueDate, now);
  const overdue = isPastDue(dueDate, now);
  return { dueStatus: (overdue ? "overdue" : "not_due") as DueStatus, overdue, daysPastDue: daysPastDue as number | null, bucket, ageDays: daysPastDue, ageingBasis: "due date" };
}

export function emptyAgeing(): Record<AgeingBucket, number> {
  return { current: 0, days0_30: 0, days31_60: 0, days61_90: 0, days90Plus: 0 };
}
