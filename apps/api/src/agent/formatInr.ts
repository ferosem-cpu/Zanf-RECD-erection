const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rupees in Indian grouping with paise: 1253514 -> "₹12,53,514.00", 12500000.5 -> "₹1,25,00,000.50". */
export function formatInr(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return "₹0.00";
  const rounded = Math.round(Math.abs(n) * 100) / 100;
  return `${n < 0 && rounded > 0 ? "-" : ""}₹${INR.format(rounded)}`;
}

/** Formatted copies of the named numeric fields: { totalAmount: "₹1,00,000.00", ... }. */
export function formatInrFields<T extends object>(obj: T, keys: Array<keyof T & string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") out[k] = formatInr(v);
  }
  return out;
}
