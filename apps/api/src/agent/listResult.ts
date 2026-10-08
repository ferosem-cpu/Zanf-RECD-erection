/** Wraps list-shaped tool results before they go back to the model. Kept out of llm.ts (which
 * pulls in the whole tool registry and Prisma) so it can be unit-tested on its own. Only the
 * LLM-facing copy is changed - tool handlers are only ever called from llm.ts.
 */

/** Most rows any search tool lists. Counts and totals always cover the full filtered set. */
export const LIST_LIMIT = 15;

export const EMPTY_LIST_NOTE =
  "No rows matched these exact filters. This does not prove nothing exists - check the filter values (status values are listed in the tool description) and try a broader query or another relevant tool before telling the user nothing was found.";

export function truncatedListNote(returnedCount: number, totalCount: number): string {
  return (
    `Only ${returnedCount} of ${totalCount} matching rows are listed. totalCount and every total/summary ` +
    `field cover ALL ${totalCount} rows - quote those for 'how many'/'how much' and never add up the listed rows yourself. ` +
    `Narrow the query if the user needs to see the other rows.`
  );
}

export interface ListMeta {
  /** True when every matching row is in this result. */
  complete: boolean;
  /** Exact number of rows matching the filters (from a count query, not the listed rows). */
  totalCount: number;
  returnedCount: number;
}

/** Completeness from a real count, so exactly LIST_LIMIT rows that are all there is reads as complete. */
export function listMeta(returnedCount: number, totalCount: number): ListMeta {
  // A row inserted between the page query and the count query can't make total < listed.
  const total = Math.max(totalCount, returnedCount);
  return { complete: returnedCount >= total, totalCount: total, returnedCount };
}

export function listPage<T>(rows: T[], totalCount: number): ListMeta & { results: T[] } {
  return { ...listMeta(rows.length, totalCount), results: rows };
}

function isListMeta(value: unknown): value is ListMeta & Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.complete === "boolean" && typeof v.totalCount === "number" && typeof v.returnedCount === "number";
}

/** Bare arrays give the model no way to tell "15 of 200" from "exactly 15", or an empty
 * list from a wrong filter - the cause of wrong counts and "couldn't find any" answers.
 * Bare arrays come from tools that never cap (they are complete by construction); list
 * results built with listMeta get a note when empty or truncated. */
export function annotateListResult(value: unknown): unknown {
  if (Array.isArray(value)) {
    const page = listPage(value, value.length);
    return value.length === 0 ? { ...page, note: EMPTY_LIST_NOTE } : page;
  }
  if (isListMeta(value)) {
    if (value.totalCount === 0) return { ...value, note: EMPTY_LIST_NOTE };
    if (!value.complete) return { ...value, note: truncatedListNote(value.returnedCount, value.totalCount) };
  }
  return value;
}
