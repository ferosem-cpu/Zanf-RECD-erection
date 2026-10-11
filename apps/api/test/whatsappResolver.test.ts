import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWhatsappTurn, type WhatsappTurnDeps } from "../src/agent/whatsapp/resolver";
import { resolveSender, type MappingRow, type SenderStore, type WaUserContext } from "../src/agent/whatsapp/policy";
import { executeToolCalls } from "../src/agent/toolExecution";
import { allTools, isWriteTool } from "../src/agent/tools/registry";
import type { AgentAuthContext, AgentTool } from "../src/agent/tools/types";

// ---------- fakes ----------
const seen: Array<{ tool: string; auth: AgentAuthContext }> = [];
function fakeTool(name: string, result: unknown = { ok: true }): AgentTool {
  return {
    name, description: name, inputSchema: { type: "object", properties: {} },
    handler: async (_input, auth) => { seen.push({ tool: name, auth }); return typeof result === "function" ? (result as () => unknown)() : result; },
  };
}
const ALL_NAMES = allTools.map((t) => t.name);
const FAKES = ALL_NAMES.map((n) => fakeTool(n));

function ctx(over: Partial<WaUserContext> = {}): WaUserContext {
  return { userId: "u1", roleKey: "sales", isActive: true, customerId: null, vendorId: null, vendorBlocked: false, permissions: new Set(["view_orders"]), ...over };
}
function mapping(over: Partial<MappingRow> = {}): MappingRow {
  return { id: "m1", userId: "u1", phoneE164: "+919876543210", lid: null, enabled: true, aiPaused: false, ...over };
}
function setup(opts: { user?: () => WaUserContext | null; row?: () => MappingRow | null; tools?: AgentTool[]; sites?: Record<string, { assignedEngineerId: string | null; vendorId: string | null }> } = {}) {
  const store: SenderStore = {
    findByPhone: async () => [mapping()],
    findByLid: async () => [],
    findById: async () => (opts.row ? opts.row() : mapping()),
    loadUser: async () => (opts.user ? opts.user() : ctx()),
  };
  const deps: WhatsappTurnDeps = {
    store, tools: opts.tools ?? FAKES, isWriteTool,
    siteLookup: async (id) => opts.sites?.[id] ?? null,
  };
  return { store, deps };
}
async function open(opts: Parameters<typeof setup>[0] = {}) {
  const { store, deps } = setup(opts);
  const d = await resolveSender({ phoneE164: "+919876543210" }, store);
  assert.ok(d.ok);
  return createWhatsappTurn(d as Extract<typeof d, { ok: true }>, deps);
}
const run = (turn: Awaited<ReturnType<typeof open>>, name: string, input: Record<string, unknown> = {}) =>
  executeToolCalls({
    calls: [{ id: "c1", name, input }], auth: { userId: "ignored", roleKey: "ignored", permissions: new Set(["manage_settings"]) },
    getTool: turn.getTool, isWriteTool: turn.isWriteTool,
  }).then((r) => JSON.parse(r[0].content));

// ---------- tests ----------
test("only allowed schemas reach the model: schema list equals the policy list per group", async () => {
  const expected: Record<string, string[]> = {
    sales: ["search_orders_and_sites", "search_site_status_updates", "search_customers", "get_document_detail"],
    erection_engineer: ["search_orders_and_sites", "search_site_status_updates", "search_work_orders", "search_complaints", "get_document_detail"],
  };
  for (const [role, names] of Object.entries(expected)) {
    const turn = await open({ user: () => ctx({ roleKey: role }) });
    assert.deepEqual(turn.tools.map((t) => t.name).sort(), [...names].sort(), role);
  }
  const fin = await open({ user: () => ctx({ roleKey: "finance" }) });
  assert.ok(fin.tools.some((t) => t.name === "get_receivables"));
  assert.ok(!fin.tools.some((t) => t.name.startsWith("create_") || t.name.endsWith("_documents") || t.name === "get_document_content"));
});

test("hallucinated, disallowed, write, Drive and settings tool names are rejected without running anything", async () => {
  seen.length = 0;
  const turn = await open({ user: () => ctx({ roleKey: "erection_engineer" }) });
  for (const name of ["get_receivables", "create_invoice", "search_documents", "update_settings", "made_up_tool", "", "constructor", "__proto__"]) {
    assert.equal(turn.getTool(name), undefined, name);
    const out = await run(turn, name);
    assert.match(out.error, /Unknown tool/);
  }
  assert.equal(seen.length, 0);
});

test("handlers run with the freshly loaded user, never the caller-supplied auth", async () => {
  seen.length = 0;
  const turn = await open({ user: () => ctx({ userId: "u1", roleKey: "sales", permissions: new Set(["view_orders"]) }) });
  await run(turn, "search_orders_and_sites");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].auth.userId, "u1");
  assert.equal(seen[0].auth.waGroup, "sales");
  assert.deepEqual([...seen[0].auth.permissions], ["view_orders"]);
});

test("permission reload revokes mid-turn: role change, deactivation, disable and pause stop later calls and flag an abort", async () => {
  const scenarios: Array<[string, (s: { u: WaUserContext; m: MappingRow }) => void]> = [
    ["deactivated", (s) => { s.u = ctx({ isActive: false }); }],
    ["vendor blocked", (s) => { s.u = ctx({ vendorBlocked: true }); }],
    ["became customer", (s) => { s.u = ctx({ roleKey: "customer" }); }],
    ["mapping disabled", (s) => { s.m = mapping({ enabled: false }); }],
    ["mapping paused", (s) => { s.m = mapping({ aiPaused: true }); }],
    ["mapping re-pointed", (s) => { s.m = mapping({ userId: "u2" }); }],
  ];
  for (const [name, change] of scenarios) {
    seen.length = 0;
    const state = { u: ctx(), m: mapping() };
    const turn = await open({ user: () => state.u, row: () => state.m });
    assert.equal((await run(turn, "search_orders_and_sites")).ok, true, `${name}: first call allowed`);
    assert.equal(turn.shouldAbort(), false);
    change(state);
    const out = await run(turn, "search_orders_and_sites");
    assert.ok(out.error, `${name}: second call denied`);
    assert.equal(seen.length, 1, `${name}: handler not run again`);
    assert.equal(turn.shouldAbort(), true, name);
    assert.ok(turn.revokedReason());
  }
});

test("a role downgrade mid-turn removes tools the new group no longer has (finance -> sales)", async () => {
  seen.length = 0;
  const state = { u: ctx({ roleKey: "finance" }) };
  const turn = await open({ user: () => state.u });
  assert.equal((await run(turn, "get_receivables")).ok, true);
  state.u = ctx({ roleKey: "sales" });
  assert.ok((await run(turn, "get_receivables")).error);
  assert.equal(seen.length, 1);
});

test("get_document_detail: requested doc type is checked per group before the handler runs", async () => {
  seen.length = 0;
  const sales = await open({ user: () => ctx({ roleKey: "sales" }) });
  for (const docType of ["quotation", "customer", "invoice", "purchase_order", "expense", "vendor", "product", "work_order", "complaint", "bogus"]) {
    assert.ok((await run(sales, "get_document_detail", { docType, id: "x" })).error, docType);
  }
  assert.equal(seen.length, 0);
  const fin = await open({ user: () => ctx({ roleKey: "finance" }) });
  for (const docType of ["order", "work_order", "complaint", "customer", "vendor", "product"]) {
    assert.ok((await run(fin, "get_document_detail", { docType, id: "x" })).error, docType);
  }
  assert.equal(seen.length, 0);
  assert.equal((await run(fin, "get_document_detail", { docType: "invoice", id: "x" })).ok, true);
});

test("get_document_detail: output is checked too (finance document under a non-finance doc type is blocked)", async () => {
  const leaky = [fakeTool("get_document_detail", { id: "o1", quoteNumber: "Q-9", total: 5 })];
  const turn = await open({ user: () => ctx({ roleKey: "sales" }), tools: leaky });
  assert.ok((await run(turn, "get_document_detail", { docType: "order", id: "o1" })).error);
});

test("order detail for Sales/Ops: money stripped at every level and customer reduced to its name", async () => {
  const order = {
    id: "o1", orderNumber: "SO-1", value: 900, quantity: 1,
    customer: { id: "c1", name: "ACME", gstin: "G", openingBalance: 5, address: "x" },
    lineItems: [{ quantity: 1, product: { name: "R", model: "M" }, unitPrice: 3 }],
    site: { id: "s1", address: "A", expenses: [{ amount: 1 }], purchaseOrders: [{ total: 2 }], currentStage: { label: "Installing" } },
  };
  const turn = await open({ user: () => ctx({ roleKey: "sales" }), tools: [fakeTool("get_document_detail", order)] });
  const out = await run(turn, "get_document_detail", { docType: "order", id: "o1" });
  assert.deepEqual(out.customer, { name: "ACME" });
  assert.equal(out.value, undefined);
  assert.equal(out.lineItems[0].unitPrice, undefined);
  assert.equal(out.site.expenses, undefined);
  assert.equal(out.site.purchaseOrders, undefined);
  assert.equal(out.site.currentStage.label, "Installing");
});

test("engineer detail by id: a work order / complaint on a site not assigned to them looks like a miss", async () => {
  const sites = { mine: { assignedEngineerId: "u1", vendorId: null }, theirs: { assignedEngineerId: "u9", vendorId: null }, vendorMismatch: { assignedEngineerId: "u1", vendorId: "v2" } };
  const doc = (siteId: string | null) => [fakeTool("get_document_detail", { id: "w1", siteId, title: "T", site: { order: { value: 5 } } })];
  const base = { user: () => ctx({ roleKey: "erection_engineer", vendorId: "v1" }), sites };
  const mine = await open({ ...base, user: () => ctx({ roleKey: "erection_engineer" }), tools: doc("mine") });
  const ok = await run(mine, "get_document_detail", { docType: "work_order", id: "w1" });
  assert.equal(ok.title, "T");
  assert.equal(ok.site.order.value, undefined, "nested value stripped");
  for (const [siteId, who] of [["theirs", "other engineer"], [null, "no site"], ["gone", "unknown site"]] as const) {
    const t = await open({ ...base, user: () => ctx({ roleKey: "erection_engineer" }), tools: doc(siteId) });
    assert.match((await run(t, "get_document_detail", { docType: "complaint", id: "w1" })).error, /No complaint found/, who);
  }
  const vendor = await open({ ...base, tools: doc("vendorMismatch") });
  assert.match((await run(vendor, "get_document_detail", { docType: "work_order", id: "w1" })).error, /No work_order found/);
});

test("non-finance groups get no money from allowed list tools (nested, every level)", async () => {
  const payload = {
    totalCount: 1, totals: { count: 1, totalValue: 10, openValue: 4 },
    orders: [{ id: "o", value: 10, site: { id: "s", siteCosts: { total: 3 }, expenses: [{ amount: 2 }], purchaseOrders: [{ total: 1 }], paymentAllocations: [{ amount: 1 }] } }],
  };
  for (const role of ["sales", "operations_pm", "erection_engineer", "commissioning_engineer", "service_team"]) {
    const turn = await open({ user: () => ctx({ roleKey: role }), tools: [fakeTool("search_orders_and_sites", payload)] });
    const out = await run(turn, "search_orders_and_sites");
    const text = JSON.stringify(out);
    for (const k of ["value", "Value", "total\"", "expenses", "purchaseOrders", "paymentAllocations", "amount", "siteCosts"]) {
      assert.equal(text.includes(k), false, `${role}: ${k}`);
    }
    assert.equal(out.totalCount, 1);
  }
  // Finance and admin keep money.
  for (const role of ["finance", "management", "super_admin"]) {
    const turn = await open({ user: () => ctx({ roleKey: role }), tools: [fakeTool("search_orders_and_sites", payload)] });
    assert.equal((await run(turn, "search_orders_and_sites")).orders[0].value, 10, role);
  }
});

test("site-cost, allocation, expense and PO sources are not reachable for non-finance groups", async () => {
  const sourceTools = ["search_expenses", "search_purchase_orders", "get_payables", "search_vendor_bills", "get_customer_ledger", "search_payments", "get_customer_advances", "search_credit_notes"];
  for (const role of ["sales", "operations_pm", "erection_engineer", "commissioning_engineer", "service_team"]) {
    const turn = await open({ user: () => ctx({ roleKey: role }) });
    for (const t of sourceTools) assert.equal(turn.getTool(t), undefined, `${role} / ${t}`);
    for (const docType of ["expense", "purchase_order", "invoice", "quotation", "customer"]) {
      assert.ok((await run(turn, "get_document_detail", { docType, id: "x" })).error, `${role} / ${docType}`);
    }
  }
});

test("a tool handler that throws becomes an error result, not a crash or a leak", async () => {
  const turn = await open({ tools: [fakeTool("search_customers", () => { throw new Error("boom"); })] });
  assert.equal((await run(turn, "search_customers")).error, "boom");
});
