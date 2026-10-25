/** Role scoping on the WhatsApp path, end to end through the SAME code the bridge uses:
 * resolveSender -> createWhatsappTurn (policy wrapper) -> the real agent tools (allTools), with Prisma models
 * replaced by recorders so the effective row scope (Prisma `where`) of every query can be asserted.
 * Permissions come from the real ROLE_DEFINITIONS. */
import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { ROLE_DEFINITIONS } from "../prisma/roleDefinitions";
import { createWhatsappTurn } from "../src/agent/whatsapp/resolver";
import { resolveSender, groupForUser, checkUserAccess, type MappingRow, type SenderStore, type WaUserContext } from "../src/agent/whatsapp/policy";
import { allTools, isWriteTool } from "../src/agent/tools/registry";

const FINANCE = ["search_quotations", "search_invoices", "search_purchase_orders", "search_expenses", "get_customer_ledger",
  "search_credit_notes", "get_customer_advances", "search_payments", "get_payables", "search_vendor_bills", "get_receivables",
  "get_revenue_summary", "search_suppliers"];

function user(roleKey: keyof typeof ROLE_DEFINITIONS, over: Partial<WaUserContext> = {}): WaUserContext {
  return { userId: "me", roleKey, isActive: true, customerId: null, vendorId: null, vendorBlocked: false,
    permissions: new Set<string>(ROLE_DEFINITIONS[roleKey].permissions), ...over };
}
const mapping: MappingRow = { id: "m1", userId: "me", phoneE164: "+919876543210", lid: null, enabled: true, aiPaused: false };

async function openFor(u: WaUserContext, sites: Record<string, { assignedEngineerId: string | null; vendorId: string | null }> = {}) {
  const store: SenderStore = { findByPhone: async () => [mapping], findByLid: async () => [], findById: async () => mapping, loadUser: async () => u };
  const decision = await resolveSender({ phoneE164: mapping.phoneE164 }, store);
  if (!decision.ok) return { decision, turn: null };
  return { decision, turn: createWhatsappTurn(decision, { store, tools: allTools, isWriteTool, siteLookup: async (id) => sites[id] ?? null }) };
}

/** Records every Prisma call; findUnique answers come from `rows[model]`. */
function recordPrisma(rows: Record<string, unknown> = {}, lists: Record<string, unknown[]> = {}) {
  const calls: Array<{ model: string; op: string; args: any }> = [];
  const models = ["order", "site", "workOrder", "complaint", "stageDefinition", "statusOption", "siteStageEvent", "invoice",
    "quotation", "purchaseOrder", "expense", "customer", "vendor", "payment", "companySettings"];
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const m of models) {
    saved.set(m, Object.getOwnPropertyDescriptor(prisma, m));
    const model = new Proxy({}, {
      get: (_t, op: string) => async (args: any) => {
        calls.push({ model: m, op, args });
        if (op === "findUnique" || op === "findFirst") return rows[m] ?? null;
        if (op === "findMany" && lists[m]) return lists[m];
        if (op === "count") return 0;
        if (op === "aggregate") return { _sum: {}, _count: { _all: 0 } };
        return [];
      },
    });
    Object.defineProperty(prisma, m, { configurable: true, value: model });
  }
  const restore = () => { for (const [m, d] of saved) d ? Object.defineProperty(prisma, m, d) : Reflect.deleteProperty(prisma, m); };
  return { calls, restore };
}
async function run(turn: NonNullable<Awaited<ReturnType<typeof openFor>>["turn"]>, name: string, input: Record<string, unknown>, rows: Record<string, unknown> = {}, lists: Record<string, unknown[]> = {}) {
  const rec = recordPrisma(rows, lists);
  try {
    const t = turn.getTool(name);
    const out = t ? await t.handler(input, {} as never) : "NO_TOOL";
    return { out: out as any, calls: rec.calls };
  } finally { rec.restore(); }
}
const json = (v: unknown) => JSON.stringify(v);

test("groups: role decides; a customer needs the customer role AND a customerId", () => {
  assert.equal(groupForUser({ roleKey: "super_admin" }), "admin");
  assert.equal(groupForUser({ roleKey: "management" }), "admin");
  assert.equal(groupForUser({ roleKey: "erection_engineer" }), "engineer");
  assert.equal(groupForUser({ roleKey: "customer", customerId: "c1" }), "customer");
  assert.equal(groupForUser({ roleKey: "customer", customerId: null }), null);
  assert.equal(groupForUser({ roleKey: "management", customerId: "c1" }), null);
  assert.equal(groupForUser({ roleKey: "nobody" }), null);
  assert.equal(checkUserAccess(user("customer", { customerId: "c1", isActive: false })).ok, false);
});

test("management: every finance tool and all work/complaint tools are offered, nothing row-scoped", async () => {
  const { turn } = await openFor(user("management"));
  const names = turn!.tools.map((t) => t.name);
  for (const f of FINANCE) assert.ok(names.includes(f), f);
  for (const n of ["search_work_orders", "search_complaints", "search_orders_and_sites", "search_customers"]) assert.ok(names.includes(n), n);
  assert.ok(!names.some((n) => isWriteTool(n)), "no write tools on WhatsApp");
  const wo = await run(turn!, "search_work_orders", {});
  assert.deepEqual(wo.calls.find((c) => c.model === "workOrder" && c.op === "findMany")!.args.where, {});
  const cp = await run(turn!, "search_complaints", {});
  assert.deepEqual(cp.calls.find((c) => c.model === "complaint" && c.op === "findMany")!.args.where, {});
});

test("management 'my work orders': assignedToMe narrows to the asking user only", async () => {
  const { turn } = await openFor(user("management"));
  const wo = await run(turn!, "search_work_orders", { assignedToMe: true });
  assert.deepEqual(wo.calls.find((c) => c.op === "findMany")!.args.where, { assignedToId: "me" });
  assert.equal(wo.out.scope, "assigned_to_you");
});

test("erection engineer: no finance tools; work orders and complaints limited to own + assigned sites", async () => {
  const { turn } = await openFor(user("erection_engineer"));
  const names = turn!.tools.map((t) => t.name);
  for (const f of FINANCE) { assert.ok(!names.includes(f), f); assert.equal(turn!.getTool(f), undefined); }
  const wo = await run(turn!, "search_work_orders", {});
  const w = wo.calls.find((c) => c.model === "workOrder" && c.op === "findMany")!.args.where;
  assert.equal(w.assignedToId, "me");
  assert.deepEqual(w.site, { is: { assignedEngineerId: "me" } });
  const cp = await run(turn!, "search_complaints", { assignedToMe: false });
  const c = cp.calls.find((x) => x.model === "complaint" && x.op === "findMany")!.args.where;
  assert.equal(c.assignedToId, "me");
  assert.deepEqual(c.site, { is: { assignedEngineerId: "me" } });
});

test("erection engineer: orders/sites search is limited to assigned sites; invoice detail denied", async () => {
  const { turn } = await openFor(user("erection_engineer"));
  const os = await run(turn!, "search_orders_and_sites", {});
  const orderWheres = os.calls.filter((c) => c.model === "order" && (c.op === "findMany" || c.op === "count")).map((c) => json(c.args.where));
  assert.ok(orderWheres.length > 0);
  for (const w of orderWheres) assert.match(w, /"assignedEngineerId":"me"/);
  const inv = await run(turn!, "get_document_detail", { docType: "invoice", id: "i1" });
  assert.match(json(inv.out), /isn't available to you over WhatsApp/);
  const wo = await run(turn!, "get_document_detail", { docType: "work_order", id: "w1" },
    { workOrder: { id: "w1", siteId: "s9", title: "x" } });
  assert.match(json(wo.out), /No work_order found/, "work order on someone else's site is hidden");
});

test("customer: only site/complaint/work-order/detail tools; no finance", async () => {
  const { decision, turn } = await openFor(user("customer", { customerId: "c1" }));
  assert.ok(decision.ok && decision.group === "customer");
  const names = turn!.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_document_detail", "search_complaints", "search_orders_and_sites", "search_site_status_updates", "search_work_orders"]);
  for (const f of [...FINANCE, "search_customers", "search_vendors"]) assert.equal(turn!.getTool(f), undefined, f);
  for (const d of ["invoice", "quotation", "purchase_order", "expense", "customer", "vendor"]) {
    assert.match(json((await run(turn!, "get_document_detail", { docType: d, id: "x" })).out), /isn't available to you over WhatsApp/, d);
  }
});

test("customer: orders/sites and complaints are scoped to their own customerId, whatever the input says", async () => {
  const { turn } = await openFor(user("customer", { customerId: "c1" }));
  const os = await run(turn!, "search_orders_and_sites", { query: "BPCL" });
  const ow = os.calls.filter((c) => c.model === "order" && (c.op === "findMany" || c.op === "count")).map((c) => json(c.args.where));
  assert.ok(ow.length > 0);
  for (const w of ow) assert.match(w, /"customerId":"c1"/);
  const cp = await run(turn!, "search_complaints", { assignedToMe: true, query: "x" });
  const cw = cp.calls.find((c) => c.model === "complaint" && c.op === "findMany")!.args.where;
  assert.equal(cw.customerId, "c1");
  assert.equal(cw.assignedToId, undefined);
  assert.equal(cp.out.scope, "your_company");
});

test("customer: another customer's order or complaint detail is refused; own one is shown without money", async () => {
  const { turn } = await openFor(user("customer", { customerId: "c1" }));
  const other = await run(turn!, "get_document_detail", { docType: "order", id: "o2" }, { order: { id: "o2", customerId: "c2", orderNumber: "SO-2" } });
  assert.doesNotMatch(json(other.out), /SO-2/);
  const otherC = await run(turn!, "get_document_detail", { docType: "complaint", id: "k2" }, { complaint: { id: "k2", customerId: "c2", ticketNumber: "T-2" } });
  assert.doesNotMatch(json(otherC.out), /T-2/);
  const own = await run(turn!, "get_document_detail", { docType: "order", id: "o1" },
    { order: { id: "o1", customerId: "c1", orderNumber: "SO-1", value: 999, customer: { name: "Acme" } } });
  assert.match(json(own.out), /SO-1/);
  assert.doesNotMatch(json(own.out), /999/);
});

test("finance results are stripped of money for non-finance groups (engineer, customer)", async () => {
  for (const u of [user("erection_engineer"), user("customer", { customerId: "c1" })]) {
    const { turn } = await openFor(u);
    const own = await run(turn!, "get_document_detail", { docType: u.customerId ? "order" : "work_order", id: "o1" },
      { order: { id: "o1", customerId: "c1", orderNumber: "SO-1", value: 12345 }, workOrder: { id: "o1", siteId: "s1", title: "t", cost: 12345 } });
    assert.doesNotMatch(json(own.out), /12345/);
  }
});

// ---------- customer output allowlist ----------

/** Every internal value seeded below; none of them may reach a customer. */
const SECRET = ["SALES_ENG_NAME", "VENDOR_CO_NAME", "ENGINEER_NAME", "INTERNAL_NOTE", "ROOT_CAUSE_TEXT", "RESOLUTION_TEXT",
  "ASSIGNEE_NAME", "POSTED_BY_NAME", "GSTIN_X", "DRIVE_URL_X", "77777", "88888", "OTHER_CUSTOMER_CO"];
const INTERNAL_KEYS = ["salesEngineer", "vendor", "assignedEngineer", "customerNotes", "rootCause", "resolutionNotes",
  "assignedTo", "postedBy", "value", "totalValue", "openValue", "gstin", "plannedExhaustHookupType", "requestedByCustomer",
  "photosDriveFolderUrl", "gpsLat", "openingBalance"];
function assertClean(out: unknown, label: string) {
  const s = json(out);
  for (const v of SECRET) assert.ok(!s.includes(v), `${label}: leaked ${v}`);
  for (const k of INTERNAL_KEYS) assert.ok(!s.includes(`"${k}"`), `${label}: leaked key ${k}`);
}
const PERSON = (n: string) => ({ name: n });
const richSite = {
  id: "s1", address: "Plot 1", companyName: "BPCL Depot", gpsLat: 12.3, photosDriveFolderUrl: "DRIVE_URL_X",
  currentStage: { label: "Installing", sequenceOrder: 3 }, assignedEngineer: PERSON("ENGINEER_NAME"), vendor: PERSON("VENDOR_CO_NAME"),
  assignedEngineerId: "u9", vendorId: "v9",
};
const richOrder = {
  id: "o1", orderNumber: "SO-1", customerId: "c1", quantity: 1, value: 77777, orderDate: null, promisedDeliveryDate: null,
  actualDispatchDate: null, customerNotes: "INTERNAL_NOTE", salesEngineer: PERSON("SALES_ENG_NAME"), plannedExhaustHookupType: "x",
  requestedByCustomer: false, customerPoNumber: "PO-9",
  customer: { name: "Acme", gstin: "GSTIN_X", openingBalance: 88888 }, product: { name: "RECD", model: "R-500" },
  lineItems: [{ quantity: 1, product: { name: "RECD", model: "R-380" } }], site: richSite,
};
const richComplaint = {
  id: "k1", ticketNumber: "T-1", customerId: "c1", siteId: "s1", category: "delivery_delay", description: "late", severity: "high",
  status: "open", rootCause: "ROOT_CAUSE_TEXT", resolutionNotes: "RESOLUTION_TEXT", assignedTo: PERSON("ASSIGNEE_NAME"),
  customer: { name: "Acme" }, site: { address: "Plot 1" }, createdAt: new Date(0), closedAt: null,
};

test("customer: order/site search output is allowlisted (no value, engineer, vendor, notes)", async () => {
  const { turn } = await openFor(user("customer", { customerId: "c1" }));
  const r = await run(turn!, "search_orders_and_sites", {}, {}, { order: [richOrder] });
  assert.equal(r.out.orders[0].orderNumber, "SO-1");
  assert.equal(r.out.orders[0].site.siteName, "BPCL Depot");
  assert.equal(r.out.orders[0].site.currentStage, "Installing");
  assertClean(r.out, "search_orders_and_sites");
});

test("customer: site status updates hide who posted them", async () => {
  const { turn } = await openFor(user("customer", { customerId: "c1" }));
  const site = { ...richSite, order: { orderNumber: "SO-1", customerId: "c1" } };
  const ev = { id: "e1", comment: "Base done", createdAt: new Date(0), stageDefinition: { label: "Installing" },
    statusOption: { key: "done", label: "Done" }, createdBy: PERSON("POSTED_BY_NAME") };
  const r = await run(turn!, "search_site_status_updates", { siteId: "s1" }, { site }, { siteStageEvent: [ev], order: [richOrder] });
  assert.equal(r.out.error, undefined, JSON.stringify(r.out));
  assert.equal(r.out.updates[0].comment, "Base done");
  assertClean(r.out, "search_site_status_updates");
});

test("customer: complaint search and complaint detail hide assignee, root cause, resolution notes", async () => {
  const { turn } = await openFor(user("customer", { customerId: "c1" }));
  const list = await run(turn!, "search_complaints", {}, {}, { complaint: [richComplaint] });
  assert.equal(list.out.results[0].ticketNumber, "T-1");
  assertClean(list.out, "search_complaints");
  const det = await run(turn!, "get_document_detail", { docType: "complaint", id: "k1" }, { complaint: richComplaint });
  assert.equal(det.out.ticketNumber, "T-1");
  assert.equal(det.out.description, "late");
  assertClean(det.out, "complaint detail");
});

test("customer: order detail is allowlisted (no salesEngineer, vendor, engineer, customerNotes, value, gstin)", async () => {
  const { turn } = await openFor(user("customer", { customerId: "c1" }));
  const det = await run(turn!, "get_document_detail", { docType: "order", id: "o1" }, { order: richOrder });
  assert.equal(det.out.orderNumber, "SO-1");
  assert.equal(det.out.site.currentStage.label, "Installing");
  assertClean(det.out, "order detail");
});

test("staff projection is unchanged: management still sees salesEngineer and complaint rootCause", async () => {
  const { turn } = await openFor(user("management"));
  const det = await run(turn!, "get_document_detail", { docType: "order", id: "o1" }, { order: richOrder });
  assert.match(json(det.out), /SALES_ENG_NAME/);
  const c = await run(turn!, "get_document_detail", { docType: "complaint", id: "k1" }, { complaint: richComplaint });
  assert.match(json(c.out), /ROOT_CAUSE_TEXT/);
});

test("no WhatsApp group: customer role without customerId, or customerId with a non-customer role", async () => {
  for (const u of [user("customer", { customerId: null }), user("management", { customerId: "c1" }), user("erection_engineer", { customerId: "c1" })]) {
    assert.equal(groupForUser(u), null, u.roleKey);
    const { decision, turn } = await openFor(u);
    assert.equal(decision.ok, false, u.roleKey);
    assert.equal(!decision.ok && decision.reason, "no_group", u.roleKey);
    assert.equal(turn, null);
  }
});

// ---------- customer work orders (own sites only) ----------

const richWorkOrder = {
  id: "w1", workOrderNumber: "WO-1", siteId: "s1", taskType: "installation", title: "Install RECD", status: "scheduled",
  scheduledDate: new Date(0), startedAt: null, completedAt: null, createdAt: new Date(0), instructions: "INTERNAL_NOTE",
  completionNotes: "RESOLUTION_TEXT", assignedTo: PERSON("ASSIGNEE_NAME"), createdBy: PERSON("POSTED_BY_NAME"), cost: 77777,
  site: { ...richSite, order: { orderNumber: "SO-1", customerId: "c1", value: 88888, customer: { name: "Acme", gstin: "GSTIN_X" } } },
};

test("customer: work-order search is scoped to their own customerId and ignores assignedToMe", async () => {
  const { turn } = await openFor(user("customer", { customerId: "c1" }));
  const r = await run(turn!, "search_work_orders", { assignedToMe: true, query: "x", customerId: "c2" });
  const ws = r.calls.filter((c) => c.model === "workOrder" && (c.op === "findMany" || c.op === "count" || c.op === "groupBy"));
  assert.ok(ws.length > 0);
  for (const c of ws) {
    assert.equal(c.args.where.site.is.order.customerId, "c1");
    assert.equal(c.args.where.assignedToId, undefined);
  }
  assert.equal(r.out.scope, "your_company");
});

test("customer: work-order search output is allowlisted (no assignee, notes, instructions, money)", async () => {
  const { turn } = await openFor(user("customer", { customerId: "c1" }));
  const r = await run(turn!, "search_work_orders", {}, {}, { workOrder: [richWorkOrder] });
  assert.equal(r.out.error, undefined, JSON.stringify(r.out));
  assert.equal(r.out.results[0].workOrderNumber, "WO-1");
  assert.equal(r.out.results[0].status, "scheduled");
  assertClean(r.out, "search_work_orders");
  for (const k of ["instructions", "completionNotes", "createdBy", "cost"]) assert.ok(!json(r.out).includes(`"${k}"`), k);
});

test("customer: own work-order detail is clean; another customer's is refused", async () => {
  const { turn } = await openFor(user("customer", { customerId: "c1" }));
  const own = await run(turn!, "get_document_detail", { docType: "work_order", id: "w1" }, { workOrder: richWorkOrder });
  assert.match(json(own.out), /WO-1/);
  assertClean(own.out, "work_order detail");
  for (const k of ["instructions", "completionNotes", "createdBy", "cost"]) assert.ok(!json(own.out).includes(`"${k}"`), k);
  const other = await run(turn!, "get_document_detail", { docType: "work_order", id: "w2" },
    { workOrder: { ...richWorkOrder, id: "w2", workOrderNumber: "WO-2", site: { ...richWorkOrder.site, order: { orderNumber: "SO-2", customerId: "c2" } } } });
  assert.doesNotMatch(json(other.out), /WO-2|SO-2/);
});

test("customer: without view_site_status, work orders are refused", async () => {
  const { turn } = await openFor(user("customer", { customerId: "c1", permissions: new Set(["raise_complaint"]) }));
  const r = await run(turn!, "search_work_orders", {}, {}, { workOrder: [richWorkOrder] });
  assert.doesNotMatch(json(r.out), /WO-1/);
  const d = await run(turn!, "get_document_detail", { docType: "work_order", id: "w1" }, { workOrder: richWorkOrder });
  assert.doesNotMatch(json(d.out), /WO-1/);
});
