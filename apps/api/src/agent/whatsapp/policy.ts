/** WhatsApp read-only policy (DISCOVERY 4.2.1). Pure: no DB, no tool imports.
 * Deny by default: a tool or document type not listed for the sender's group is refused.
 * The group always comes from the user's CURRENT role, never from message text. */

export type WaGroup = "admin" | "finance" | "sales" | "ops" | "engineer";

const ROLE_GROUP: Record<string, WaGroup> = {
  super_admin: "admin",
  owner_admin: "admin",
  management: "admin",
  finance: "finance",
  sales: "sales",
  operations_pm: "ops",
  erection_engineer: "engineer",
  commissioning_engineer: "engineer",
  service_team: "engineer",
};

/** null = no WhatsApp access (customers, unknown or future roles): silence. */
export function groupForRole(roleKey: string | null | undefined): WaGroup | null {
  return (roleKey && Object.prototype.hasOwnProperty.call(ROLE_GROUP, roleKey) ? ROLE_GROUP[roleKey] : null);
}

export const FINANCE_GROUPS: ReadonlySet<WaGroup> = new Set<WaGroup>(["admin", "finance"]);
export function isFinanceGroup(g: WaGroup): boolean {
  return FINANCE_GROUPS.has(g);
}

const SITE_TOOLS = ["search_orders_and_sites", "search_site_status_updates"];
const WORK_TOOLS = ["search_work_orders", "search_complaints"];
const FINANCE_TOOLS = [
  "search_quotations", "search_invoices", "search_purchase_orders", "search_expenses",
  "get_customer_ledger", "search_credit_notes", "get_customer_advances", "search_payments",
  "get_payables", "search_vendor_bills", "get_receivables", "get_revenue_summary", "search_suppliers",
];

/** Tools per group. Absent everywhere: Drive (3), saved items, customer pricing, products,
 * all create_* writes. */
export const TOOL_ALLOWLIST: Record<WaGroup, ReadonlySet<string>> = {
  admin: new Set([...SITE_TOOLS, ...WORK_TOOLS, ...FINANCE_TOOLS, "search_customers", "search_vendors", "get_document_detail"]),
  finance: new Set([...SITE_TOOLS, ...FINANCE_TOOLS, "get_document_detail"]),
  sales: new Set([...SITE_TOOLS, "search_customers", "get_document_detail"]),
  ops: new Set([...SITE_TOOLS, ...WORK_TOOLS, "get_document_detail"]),
  engineer: new Set([...SITE_TOOLS, ...WORK_TOOLS, "get_document_detail"]),
};

const ALL_DOC_TYPES = ["customer", "vendor", "quotation", "invoice", "purchase_order", "expense", "order", "work_order", "complaint", "product"];

/** get_document_detail docType per group. */
export const DETAIL_DOC_TYPES: Record<WaGroup, ReadonlySet<string>> = {
  admin: new Set(ALL_DOC_TYPES),
  finance: new Set(["quotation", "invoice", "purchase_order", "expense"]),
  sales: new Set(["order"]),
  ops: new Set(["work_order", "order"]),
  engineer: new Set(["work_order", "complaint"]),
};

export function isToolAllowed(group: WaGroup, toolName: string): boolean {
  return TOOL_ALLOWLIST[group].has(toolName);
}

export function isDetailDocAllowed(group: WaGroup, docType: unknown): boolean {
  return typeof docType === "string" && DETAIL_DOC_TYPES[group].has(docType);
}

// ---------- money / finance stripping for non-finance groups ----------

/** Keys removed (with their whole subtree) at every nesting level. */
const STRIP_EXACT = new Set([
  "total", "subtotal", "grandtotal", "paid", "due", "rate", "unitrate", "cost", "costs",
  "balance", "outstanding", "tds", "discount",
  "allocations", "allocation", "paymentallocations", "billallocations", "paymentordertags",
  "expenses", "purchaseorders", "payments", "invoices", "quotations", "bills", "creditnotes",
  "customerpurchaseorders", "customerprices", "saveditemprices",
]);

/** Any key containing one of these fragments is also removed (case-insensitive). Note
 * "totalCount", "totals" and "quantity" are deliberately NOT matched, so counts survive. */
const STRIP_FRAGMENTS = ["value", "amount", "price", "balance", "outstanding", "revenue", "payable", "receivable", "gst", "tax"];

/** Documented list of fields removed by sanitizeNonFinance (exact keys + fragments). */
export const MONEY_STRIP_FIELDS = { exact: [...STRIP_EXACT], fragments: STRIP_FRAGMENTS };

function isStrippedKey(key: string): boolean {
  const k = key.toLowerCase();
  if (STRIP_EXACT.has(k)) return true;
  return STRIP_FRAGMENTS.some((f) => k.includes(f));
}

function isPlainContainer(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Recursively removes money / finance fields at every level. Dates and Decimals are leaves. */
export function sanitizeNonFinance<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => sanitizeNonFinance(v)) as unknown as T;
  if (isPlainContainer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isStrippedKey(k)) continue;
      out[k] = sanitizeNonFinance(v);
    }
    return out as T;
  }
  return value;
}

/** Keys that mark a payload as a finance document (quotation, invoice, PO, bill, expense). */
const FINANCE_DOC_MARKERS = ["quotenumber", "invoicenumber", "ponumber", "billnumber", "creditnotenumber", "expensenumber", "paymentallocations", "supplier"];

/** True when a (top-level) detail payload is itself a finance document. */
export function looksLikeFinanceDoc(output: unknown): boolean {
  if (!isPlainContainer(output) && !(output && typeof output === "object")) return false;
  const keys = Object.keys(output as object).map((k) => k.toLowerCase());
  return FINANCE_DOC_MARKERS.some((m) => keys.includes(m));
}

// ---------- sender resolution ----------

export interface MappingRow {
  id: string;
  userId: string;
  phoneE164: string;
  lid: string | null;
  enabled: boolean;
  aiPaused: boolean;
}

export interface WaUserContext {
  userId: string;
  roleKey: string;
  isActive: boolean;
  customerId?: string | null;
  vendorId?: string | null;
  vendorBlocked: boolean;
  permissions: Set<string>;
}

export interface SenderStore {
  findByPhone(phoneE164: string): Promise<MappingRow[]>;
  findByLid(lid: string): Promise<MappingRow[]>;
  loadUser(userId: string): Promise<WaUserContext | null>;
}

export type DenyReason =
  | "unknown" | "disabled" | "paused" | "ambiguous" | "user_missing"
  | "inactive_user" | "vendor_blocked" | "no_group" | "lookup_error";

export type SenderDecision =
  | { ok: true; mapping: MappingRow; user: WaUserContext; group: WaGroup }
  | { ok: false; reason: DenyReason };

/** Unknown, disabled, paused, ambiguous, inactive, blocked, customer or error -> no access. */
export async function resolveSender(
  identity: { phoneE164?: string | null; lid?: string | null },
  store: SenderStore,
): Promise<SenderDecision> {
  try {
    const found: MappingRow[] = [];
    if (identity.phoneE164) found.push(...(await store.findByPhone(identity.phoneE164)));
    if (identity.lid) found.push(...(await store.findByLid(identity.lid)));
    const distinct = new Map(found.map((m) => [m.id, m]));
    if (distinct.size === 0) return { ok: false, reason: "unknown" };
    if (distinct.size > 1) return { ok: false, reason: "ambiguous" };
    const mapping = [...distinct.values()][0];
    // A claimed phone or LID that disagrees with the matched row (number recycled, LID changed) fails closed.
    if (identity.phoneE164 && mapping.phoneE164 !== identity.phoneE164) return { ok: false, reason: "ambiguous" };
    if (identity.lid && mapping.lid && mapping.lid !== identity.lid) return { ok: false, reason: "ambiguous" };
    if (!mapping.enabled) return { ok: false, reason: "disabled" };
    if (mapping.aiPaused) return { ok: false, reason: "paused" };
    const user = await store.loadUser(mapping.userId);
    if (!user) return { ok: false, reason: "user_missing" };
    const check = checkUserAccess(user);
    if (!check.ok) return check;
    return { ok: true, mapping, user, group: check.group };
  } catch {
    return { ok: false, reason: "lookup_error" };
  }
}

export function checkUserAccess(user: WaUserContext): { ok: true; group: WaGroup } | { ok: false; reason: DenyReason } {
  if (!user.isActive) return { ok: false, reason: "inactive_user" };
  if (user.vendorBlocked) return { ok: false, reason: "vendor_blocked" };
  if (user.customerId) return { ok: false, reason: "no_group" };
  const group = groupForRole(user.roleKey);
  if (!group) return { ok: false, reason: "no_group" };
  return { ok: true, group };
}
