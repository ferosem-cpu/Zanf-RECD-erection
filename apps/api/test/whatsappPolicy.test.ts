import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupForRole, isToolAllowed, isDetailDocAllowed, resolveSender, sanitizeNonFinance, looksLikeFinanceDoc,
  TOOL_ALLOWLIST, type MappingRow, type SenderStore, type WaUserContext, type WaGroup,
} from "../src/agent/whatsapp/policy";
import { allTools } from "../src/agent/tools/registry";

const FINANCE_TOOLS = [
  "search_quotations", "search_invoices", "search_purchase_orders", "search_expenses", "get_customer_ledger",
  "search_credit_notes", "get_customer_advances", "search_payments", "get_payables", "search_vendor_bills",
  "get_receivables", "get_revenue_summary", "search_suppliers",
];
const NEVER = [
  "search_documents", "list_documents", "get_document_content", "search_saved_items", "get_customer_pricing", "search_products",
  "create_expense", "create_purchase_order", "create_quotation", "create_invoice", "create_complaint", "create_saved_item",
  "create_site_status_update", "create_vendor_invoice", "create_customer_po",
];
const SITE = ["search_orders_and_sites", "search_site_status_updates"];
const WORK = ["search_work_orders", "search_complaints"];

// Expected allowlist per group (table-driven; independent of the implementation's constants).
const EXPECT: Record<WaGroup, string[]> = {
  admin: [...SITE, ...WORK, ...FINANCE_TOOLS, "search_customers", "search_vendors", "get_document_detail"],
  finance: [...SITE, ...FINANCE_TOOLS, "get_document_detail"],
  sales: [...SITE, "search_customers", "get_document_detail"],
  ops: [...SITE, ...WORK, "get_document_detail"],
  engineer: [...SITE, ...WORK, "get_document_detail"],
};

test("every registered tool x every group matches the allowlist table (deny by default)", () => {
  for (const group of Object.keys(EXPECT) as WaGroup[]) {
    for (const tool of allTools) {
      assert.equal(isToolAllowed(group, tool.name), EXPECT[group].includes(tool.name), `${group} / ${tool.name}`);
    }
    assert.deepEqual([...TOOL_ALLOWLIST[group]].sort(), [...EXPECT[group]].sort(), group);
  }
});

test("no group gets Drive, saved items, pricing, products or any write tool", () => {
  for (const group of Object.keys(EXPECT) as WaGroup[]) {
    for (const n of NEVER) assert.equal(isToolAllowed(group, n), false, `${group} / ${n}`);
  }
  const toolNames = new Set(allTools.map((t) => t.name));
  for (const n of NEVER) assert.ok(toolNames.has(n), `registry still has ${n} (test list is current)`);
});

test("finance tools are reachable only by admin and finance groups", () => {
  for (const group of ["sales", "ops", "engineer"] as WaGroup[]) {
    for (const n of FINANCE_TOOLS) assert.equal(isToolAllowed(group, n), false, `${group} / ${n}`);
  }
  for (const group of ["admin", "finance"] as WaGroup[]) {
    for (const n of FINANCE_TOOLS) assert.equal(isToolAllowed(group, n), true, `${group} / ${n}`);
  }
});

test("forbidden get_document_detail doc types are denied per group", () => {
  const ALL = ["customer", "vendor", "quotation", "invoice", "purchase_order", "expense", "order", "work_order", "complaint", "product"];
  const allowed: Record<WaGroup, string[]> = {
    admin: ALL,
    finance: ["quotation", "invoice", "purchase_order", "expense"],
    sales: ["order"],
    ops: ["work_order", "order"],
    engineer: ["work_order", "complaint"],
  };
  for (const group of Object.keys(allowed) as WaGroup[]) {
    for (const t of ALL) assert.equal(isDetailDocAllowed(group, t), allowed[group].includes(t), `${group} / ${t}`);
    assert.equal(isDetailDocAllowed(group, "settings"), false);
    assert.equal(isDetailDocAllowed(group, undefined), false);
  }
  // Sales: no quotations and no customer-finance (customer detail embeds quotations/invoices).
  assert.equal(isDetailDocAllowed("sales", "quotation"), false);
  assert.equal(isDetailDocAllowed("sales", "customer"), false);
});

test("roles map to groups; customers and unknown roles have none", () => {
  const map: Record<string, WaGroup | null> = {
    super_admin: "admin", owner_admin: "admin", management: "admin", finance: "finance", sales: "sales",
    operations_pm: "ops", erection_engineer: "engineer", commissioning_engineer: "engineer", service_team: "engineer",
    customer: null, "": null, constructor: null, __proto__: null, toString: null, made_up_role: null,
  };
  for (const [role, g] of Object.entries(map)) assert.equal(groupForRole(role), g, role);
  assert.equal(groupForRole(undefined), null);
});

test("nested money, allocations, expenses, POs and cost totals are stripped at every level", () => {
  const input = {
    totalCount: 2,
    totals: { count: 2, totalValue: 500, openValue: 100, ordersWithoutValue: 1, totalUnits: 3, byStage: { A: 1 } },
    orders: [
      {
        id: "o1", orderNumber: "SO-1", quantity: 2, value: 1000, orderDate: new Date("2026-01-01"),
        additionalLineItems: [{ product: "X", quantity: 1, unitPrice: 5, amount: 5 }],
        customer: { name: "ACME", openingBalance: 10, gstin: "GST1" },
        site: {
          id: "s1", siteName: "BPCL", expenses: [{ amount: 1 }], purchaseOrders: [{ total: 2 }],
          costs: { total: 9 }, paymentAllocations: [{ amount: 1 }], billAllocations: [{ amount: 2 }],
          nested: { deeper: [{ taxAmount: 1, grandTotal: 2, subtotal: 3, balance: 4, quantity: 7, label: "keep" }] },
        },
      },
    ],
  };
  const out = sanitizeNonFinance(input) as any;
  assert.equal(out.totalCount, 2);
  assert.deepEqual(out.totals, { count: 2, totalUnits: 3, byStage: { A: 1 } });
  const o = out.orders[0];
  assert.equal("value" in o, false);
  assert.ok(o.orderDate instanceof Date);
  assert.deepEqual(o.additionalLineItems, [{ product: "X", quantity: 1 }]);
  assert.deepEqual(o.customer, { name: "ACME", gstin: "GST1" });
  for (const k of ["expenses", "purchaseOrders", "costs", "paymentAllocations", "billAllocations"]) assert.equal(k in o.site, false, k);
  assert.deepEqual(o.site.nested.deeper, [{ quantity: 7, label: "keep" }]);
  assert.equal(JSON.stringify(out).includes("1000"), false);
});

test("finance-document payloads are recognised", () => {
  assert.equal(looksLikeFinanceDoc({ id: "1", quoteNumber: "Q-1" }), true);
  assert.equal(looksLikeFinanceDoc({ id: "1", invoiceNumber: "I-1" }), true);
  assert.equal(looksLikeFinanceDoc({ id: "1", workOrderNumber: "WO-1" }), false);
  assert.equal(looksLikeFinanceDoc(null), false);
});

// ---------- sender resolution ----------

function user(over: Partial<WaUserContext> = {}): WaUserContext {
  return { userId: "u1", roleKey: "erection_engineer", isActive: true, customerId: null, vendorId: null, vendorBlocked: false, permissions: new Set(), ...over };
}
function row(over: Partial<MappingRow> = {}): MappingRow {
  return { id: "m1", userId: "u1", phoneE164: "+919876543210", lid: null, enabled: true, aiPaused: false, ...over };
}
function store(rows: MappingRow[], u: WaUserContext | null = user()): SenderStore {
  return {
    findByPhone: async (p) => rows.filter((r) => r.phoneE164 === p),
    findByLid: async (l) => rows.filter((r) => r.lid === l),
    findById: async (id) => rows.find((r) => r.id === id) ?? null,
    loadUser: async () => u,
  };
}
const PHONE = { phoneE164: "+919876543210" };

test("an enabled mapping to an active staff user resolves to the group of the CURRENT role", async () => {
  const d = await resolveSender(PHONE, store([row()]));
  assert.ok(d.ok && d.group === "engineer" && d.user.userId === "u1");
  const f = await resolveSender(PHONE, store([row()], user({ roleKey: "finance" })));
  assert.ok(f.ok && f.group === "finance");
});

test("unknown, disabled, paused, ambiguous, inactive, blocked, customer and failing lookups -> no access", async () => {
  const cases: Array<[string, Promise<unknown>, string]> = [
    ["unknown phone", resolveSender({ phoneE164: "+911111111111" }, store([row()])), "unknown"],
    ["no identity", resolveSender({}, store([row()])), "unknown"],
    ["disabled", resolveSender(PHONE, store([row({ enabled: false })])), "disabled"],
    ["paused", resolveSender(PHONE, store([row({ aiPaused: true })])), "paused"],
    ["two rows for one phone", resolveSender(PHONE, store([row(), row({ id: "m2", userId: "u2" })])), "ambiguous"],
    ["phone and lid -> different rows", resolveSender({ ...PHONE, lid: "999999" }, store([row(), row({ id: "m2", userId: "u2", phoneE164: "+919000000000", lid: "999999" })])), "ambiguous"],
    ["lid matches a row with another phone", resolveSender({ ...PHONE, lid: "999999" }, store([row({ id: "m2", phoneE164: "+919000000000", lid: "999999" })])), "ambiguous"],
    ["lid changed behind the phone", resolveSender({ ...PHONE, lid: "222222" }, store([row({ lid: "111111" })])), "ambiguous"],
    ["user missing", resolveSender(PHONE, store([row()], null)), "user_missing"],
    ["inactive user", resolveSender(PHONE, store([row()], user({ isActive: false }))), "inactive_user"],
    ["blocked vendor", resolveSender(PHONE, store([row()], user({ vendorBlocked: true }))), "vendor_blocked"],
    ["customer role", resolveSender(PHONE, store([row()], user({ roleKey: "customer" }))), "no_group"],
    ["customerId set", resolveSender(PHONE, store([row()], user({ roleKey: "sales", customerId: "c1" }))), "no_group"],
    ["unknown role", resolveSender(PHONE, store([row()], user({ roleKey: "intern" }))), "no_group"],
    ["store throws", resolveSender(PHONE, { ...store([row()]), findByPhone: async () => { throw new Error("db down"); } }), "lookup_error"],
  ];
  for (const [name, p, reason] of cases) {
    const d = (await p) as { ok: boolean; reason?: string };
    assert.equal(d.ok, false, name);
    assert.equal(d.reason, reason, name);
  }
});

test("a verified lid matches when the phone agrees", async () => {
  const d = await resolveSender({ lid: "111111" }, store([row({ lid: "111111" })]));
  assert.ok(d.ok);
  const both = await resolveSender({ ...PHONE, lid: "111111" }, store([row({ lid: "111111" })]));
  assert.ok(both.ok);
});
