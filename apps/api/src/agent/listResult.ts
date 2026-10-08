/** Wraps list-shaped tool results before they go back to the model. Kept out of llm.ts (which
 * pulls in the whole tool registry and Prisma) so it can be unit-tested on its own. Only the
 * LLM-facing copy is changed - tool handlers still return bare arrays to every other caller.
 */

/** Search tools cap their lists (RESULT_LIMIT = 15 in zanAppReadTools). */
export const LIST_CAP_HINT = 15;

export const EMPTY_LIST_NOTE =
  "No rows matched these exact filters. This does not prove nothing exists - check the filter values (status values are listed in the tool description) and try a broader query or another relevant tool before telling the user nothing was found.";

export const CAPPED_LIST_NOTE =
  "List is capped, so more rows may exist. Do NOT report this count as a total; say 'at least N' or narrow the query.";

/** Bare arrays give the model no way to tell "15 of 200" from "exactly 15", or an empty
 * list from a wrong filter - the cause of wrong counts and "couldn't find any" answers. */
export function annotateListResult(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) {
    return { resultCount: 0, results: [], note: EMPTY_LIST_NOTE };
  }
  if (value.length >= LIST_CAP_HINT) {
    return { resultCount: value.length, possiblyTruncated: true, results: value, note: CAPPED_LIST_NOTE };
  }
  return value;
}
