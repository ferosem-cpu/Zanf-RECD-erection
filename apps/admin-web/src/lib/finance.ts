// Shared finance UI helpers used across admin-web finance screens.

export const QUOTATION_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  converted: "Converted",
};

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partially Paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

export const PO_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_received: "Partially Received",
  received: "Received",
  cancelled: "Cancelled",
  closed: "Closed",
};

export const BILL_STATUS_LABEL: Record<string, string> = {
  unpaid: "Unpaid",
  partially_paid: "Partially Paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  upi: "UPI",
  cheque: "Cheque",
  cash: "Cash",
  other: "Other",
};

/** Tailwind status-pill modifier class for a given status key. */
export function statusPillClass(status: string): string {
  const paid = ["paid", "received", "accepted", "converted", "closed"];
  const warn = ["partially_paid", "partially_received", "issued", "sent"];
  const err = ["cancelled", "rejected", "expired", "draft", "unpaid"];
  if (paid.includes(status)) return "status-pill status-pill-success";
  if (warn.includes(status)) return "status-pill status-pill-warning";
  if (err.includes(status)) return "status-pill status-pill-error";
  return "status-pill";
}

export function formatINR(n: string | number | { toString(): string }): string {
  const num = typeof n === "object" ? parseFloat(n.toString()) : typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "₹0.00";
  return "₹" + num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Convert a number to Indian-rupee words with lakh/crore grouping.
 * e.g. 1234567 -> "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees".
 */
export function numberToIndianWords(amount: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function twoDigits(n: number): string {
    if (n < 20) return ones[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o ? `${tens[t]} ${ones[o]}` : tens[t];
  }
  function threeDigits(n: number): string {
    if (n === 0) return "";
    const h = Math.floor(n / 100);
    const r = n % 100;
    let out = h ? `${ones[h]} Hundred` : "";
    if (r) out += (out ? " " : "") + twoDigits(r);
    return out;
  }

  const rounded = Math.round(amount);
  if (rounded === 0) return "Zero Rupees";
  if (rounded < 0) return "Minus " + numberToIndianWords(-rounded);

  const crore = Math.floor(rounded / 10000000);
  const lakh = Math.floor((rounded % 10000000) / 100000);
  const thousand = Math.floor((rounded % 100000) / 1000);
  const remainder = rounded % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (remainder) parts.push(threeDigits(remainder));

  return `${parts.join(" ")} Rupees Only`;
}
