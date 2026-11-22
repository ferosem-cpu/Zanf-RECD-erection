/** Customer Portal output guard. Every /portal response is built from explicit allowlisted mappers; this is the
 * last line of defence: it walks the final JSON and THROWS (fail closed -> 500) if any forbidden key appears. */
const FORBIDDEN_KEY = new RegExp(
  [
    "value", "price", "amount", "total", "tax", "gst", "rate", "balance", "invoice", "quotation", "payment", "cost",
    "salesEngineer", "assigned", "engineer", "vendor", "internal", "rootCause", "resolution", "drive", "createdBy",
    "postedBy", "password", "token", "secret", "hash", "opening", "ledger", "credit", "debit",
  ].join("|"),
  "i",
);

/** Keys that merely contain a forbidden substring but are customer-facing and reviewed. */
const ALLOWED_KEYS = new Set(["resolvedAt", "isResolved", "ratingKva", "ratingLabel", "installPriority", "priorityReason", "customerPoNumber", "customerPoDate"]);

export function findForbiddenKeys(value: unknown, path = "$", out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findForbiddenKeys(v, path + "[" + i + "]", out));
  } else if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!ALLOWED_KEYS.has(k) && FORBIDDEN_KEY.test(k)) out.push(path + "." + k);
      findForbiddenKeys(v, path + "." + k, out);
    }
  }
  return out;
}

export function assertCustomerSafe<T>(body: T): T {
  const bad = findForbiddenKeys(body);
  if (bad.length) throw new Error("portal projection: forbidden keys " + bad.slice(0, 5).join(", "));
  return body;
}
