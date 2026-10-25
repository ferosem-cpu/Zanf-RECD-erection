/**
 * WhatsApp customer group: output ALLOWLIST for every tool a customer can reach.
 *
 * The staff projection (policy.ts projectDetail) and sanitizeNonFinance are blocklists or staff-shaped; a customer must
 * only ever see fields that are clearly customer-facing. Anything not listed here is dropped, including any field a tool
 * adds later. Internal fields deliberately absent: order value / totals values, salesEngineer, customerNotes,
 * plannedExhaustHookupType, requestedByCustomer, site assignedEngineer / vendor / ids of staff, complaint assignedTo,
 * rootCause, resolutionNotes, status-update postedBy, customer gstin/address/balances, Drive folders, GPS, structure data.
 * A tool with no spec here returns a generic error (fail closed).
 */

type Spec = true | { [key: string]: Spec } | { readonly __map: Spec };

const isMap = (s: Spec): s is { readonly __map: Spec } => typeof s === "object" && "__map" in s;

function isPlain(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function project(value: unknown, spec: Spec): unknown {
  if (Array.isArray(value)) return value.map((v) => project(v, spec)).filter((v) => v !== undefined);
  if (spec === true) return value !== null && typeof value === "object" && !(value instanceof Date) ? undefined : value;
  if (value === null) return null;
  if (!isPlain(value)) return undefined;
  const out: Record<string, unknown> = {};
  if (isMap(spec)) {
    for (const [k, v] of Object.entries(value)) {
      const p = project(v, spec.__map);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
  for (const [k, s] of Object.entries(spec)) {
    if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
    const p = project(value[k], s);
    if (p !== undefined) out[k] = p;
  }
  return out;
}

const PRODUCT = { name: true, model: true } as const;
const LIST_META = { complete: true, totalCount: true, returnedCount: true } as const;
const COUNT_BY = { __map: true } as const; // { label: number }
const STATUS_COUNTS = { __map: { count: true } } as const; // { status: { count } } (no totalValue)

/** Error / validation replies keep only their messages and the lists of valid values. */
const ERROR_SPEC: Spec = { error: true, validStages: true, validUpdateStatuses: true, validStatuses: true, hint: true };

const ORDER_COUNTS: Spec = {
  count: true, totalUnits: true, unitsByProduct: { product: true, units: true }, openCount: true, completedCount: true,
  byStage: { stage: true, count: true }, byUpdateStatus: { updateStatus: true, count: true },
};
const WHOLE_SET: Spec = {
  note: true, total: true, open: true, closed: true,
  byStage: { stage: true, count: true }, byUpdateStatus: { updateStatus: true, count: true },
};

const LIST_SPECS: Record<string, Spec> = {
  search_orders_and_sites: {
    ...LIST_META, openDefinition: true, updateStatusDefinition: true, siteNameRule: true, totalsNote: true,
    totals: ORDER_COUNTS, allOrders: WHOLE_SET,
    orders: {
      id: true, orderNumber: true, customer: true, product: true, quantity: true,
      additionalLineItems: { product: true, quantity: true },
      orderDate: true, promisedDeliveryDate: true, actualDispatchDate: true, open: true,
      site: { id: true, siteName: true, address: true, currentStage: true, updateStatus: true, lastUpdate: { stage: true, postedAt: true } },
    },
  },
  search_site_status_updates: {
    ...LIST_META, site: { id: true, siteName: true, address: true }, siteNameRule: true, orderNumber: true,
    latestStatus: true, byStatus: COUNT_BY, byStage: COUNT_BY, siteCountsNote: true, allOrders: WHOLE_SET,
    // comment is the site update text that is also emailed to the customer contact; postedBy (staff name) is not shown.
    updates: { id: true, stage: true, status: true, comment: true, postedAt: true },
  },
  // Work orders on the customer's own sites: what, when and status only. No assignee/creator, no instructions or
  // completion notes (internal crew text), no task cost fields.
  search_work_orders: {
    scope: true, ...LIST_META, byStatus: STATUS_COUNTS,
    results: { id: true, workOrderNumber: true, title: true, taskType: true, status: true, scheduledDate: true },
  },
  search_complaints: {
    scope: true, ...LIST_META, byStatus: STATUS_COUNTS,
    results: { id: true, ticketNumber: true, customer: true, category: true, severity: true, status: true },
  },
};

const DETAIL_SPECS: Record<string, Spec> = {
  order: {
    id: true, orderNumber: true, quantity: true, orderDate: true, promisedDeliveryDate: true, actualDispatchDate: true,
    customerPoNumber: true, customerPoDate: true, createdAt: true,
    customer: { name: true }, product: PRODUCT,
    lineItems: { quantity: true, product: PRODUCT },
    site: { id: true, address: true, companyName: true, currentStage: { label: true } },
  },
  work_order: {
    id: true, workOrderNumber: true, siteId: true, taskType: true, title: true, status: true,
    scheduledDate: true, startedAt: true, completedAt: true, createdAt: true,
    site: { address: true, companyName: true, order: { orderNumber: true } },
  },
  complaint: {
    id: true, ticketNumber: true, siteId: true, category: true, description: true, severity: true, status: true,
    createdAt: true, closedAt: true, site: { address: true },
  },
};

const UNAVAILABLE = { error: "This information isn't available here." };

/** Project a customer-group tool result to its allowlist. docType is used for get_document_detail. */
export function projectForCustomer(toolName: string, docType: string, result: unknown): unknown {
  if (result && typeof result === "object" && "error" in (result as object)) return project(result, ERROR_SPEC);
  const spec = toolName === "get_document_detail" ? DETAIL_SPECS[docType] : LIST_SPECS[toolName];
  if (!spec) return UNAVAILABLE;
  return project(result, spec);
}

export const CUSTOMER_PROJECTED_TOOLS = Object.keys(LIST_SPECS);
export const CUSTOMER_PROJECTED_DOCS = Object.keys(DETAIL_SPECS);
