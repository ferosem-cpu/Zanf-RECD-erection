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
function recordPrisma(rows: Record<string, unknown> = {}) {
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
async function run(turn: NonNullable<Awaited<ReturnType<typeof openFor>>["turn"]>, name: string, input: Record<string, unknown>, rows: Record<string, unknown> = {}) {
  const rec = recordPrisma(rows);
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

test("customer: only site/complaint/detail tools; no finance, no work orders", async () => {
  const { decision, turn } = await openFor(user("customer", { customerId: "c1" }));
  assert.ok(decision.ok && decision.group === "customer");
  const names = turn!.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_document_detail", "search_complaints", "search_orders_and_sites", "search_site_status_updates"]);
  for (const f of [...FINANCE, "search_work_orders", "search_customers", "search_vendors"]) assert.equal(turn!.getTool(f), undefined, f);
  for (const d of ["invoice", "quotation", "purchase_order", "expense", "customer", "vendor", "work_order"]) {
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
