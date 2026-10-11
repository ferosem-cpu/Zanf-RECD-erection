import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { zanAppReadTools } from "../src/agent/tools/zanAppReadTools";
import { waSiteWhere, waOrderWhere, waSiteVisible } from "../src/agent/whatsapp/siteScope";
import type { AgentAuthContext, AgentTool } from "../src/agent/tools/types";

const tool = (name: string): AgentTool => zanAppReadTools.find((t) => t.name === name)!;
type Calls = Record<string, unknown[]>;

async function withPrisma<T>(fakes: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const saved: Array<[string, PropertyDescriptor | undefined]> = [];
  for (const [k, v] of Object.entries(fakes)) {
    saved.push([k, Object.getOwnPropertyDescriptor(prisma, k)]);
    Object.defineProperty(prisma, k, { configurable: true, value: v });
  }
  try {
    return await fn();
  } finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(prisma, k, d);
      else Reflect.deleteProperty(prisma, k);
    }
  }
}

function recorder(calls: Calls, key: string, result: unknown) {
  return async (args: unknown) => { (calls[key] ??= []).push(args); return result; };
}

function orderFakes(calls: Calls, site: unknown = null) {
  return {
    stageDefinition: { findFirst: recorder(calls, "stageFirst", { label: "Commissioned", sequenceOrder: 11 }), findMany: recorder(calls, "stageMany", []) },
    statusOption: { findMany: recorder(calls, "statusMany", []) },
    siteStageEvent: { findMany: recorder(calls, "events", []) },
    order: { findMany: recorder(calls, "orders", []) },
    site: { findUnique: recorder(calls, "site", site) },
    workOrder: { findMany: recorder(calls, "wo", []), groupBy: recorder(calls, "woGroup", []) },
    complaint: { findMany: recorder(calls, "cmp", []), groupBy: recorder(calls, "cmpGroup", []) },
  };
}

const eng = (over: Partial<AgentAuthContext> = {}): AgentAuthContext => ({
  userId: "u1", roleKey: "erection_engineer", permissions: new Set(["view_site_status", "act_assigned_work_orders", "act_assigned_complaints"]), waGroup: "engineer", ...over,
});

test("siteScope helpers: undefined in-app, engineer = assigned (+ vendor), others unrestricted", () => {
  assert.equal(waSiteWhere({ userId: "u1" }), undefined);
  assert.equal(waOrderWhere({ userId: "u1" }), undefined);
  assert.deepEqual(waSiteWhere({ waGroup: "engineer", userId: "u1" }), { assignedEngineerId: "u1" });
  assert.deepEqual(waSiteWhere({ waGroup: "engineer", userId: "u1", vendorId: "v1" }), { assignedEngineerId: "u1", vendorId: "v1" });
  assert.deepEqual(waOrderWhere({ waGroup: "engineer", userId: "u1" }), { site: { is: { assignedEngineerId: "u1" } } });
  for (const g of ["admin", "finance", "sales", "ops"] as const) {
    assert.deepEqual(waSiteWhere({ waGroup: g, userId: "u1" }), {});
    assert.equal(waOrderWhere({ waGroup: g, userId: "u1" }), undefined);
  }
  assert.equal(waSiteVisible({ waGroup: "engineer", userId: "u1" }, { assignedEngineerId: "u1", vendorId: null }), true);
  assert.equal(waSiteVisible({ waGroup: "engineer", userId: "u1" }, { assignedEngineerId: "u2", vendorId: null }), false);
  assert.equal(waSiteVisible({ waGroup: "engineer", userId: "u1" }, null), false);
  assert.equal(waSiteVisible({ waGroup: "engineer", userId: "u1", vendorId: "v1" }, { assignedEngineerId: "u1", vendorId: "v2" }), false);
  assert.equal(waSiteVisible({ userId: "u1" }, null), true);
});

test("engineer on WhatsApp: order search is scoped to assigned sites in the list, the counts and the latest-update map", async () => {
  const calls: Calls = {};
  await withPrisma(orderFakes(calls), async () => {
    const out = (await tool("search_orders_and_sites").handler({ query: "BPCL" }, eng())) as Record<string, unknown>;
    assert.equal(out.error, undefined);
  });
  const scope = { site: { is: { assignedEngineerId: "u1" } } };
  const whereOf = (c: unknown) => JSON.stringify((c as { where: unknown }).where);
  assert.ok(calls.orders.length >= 3, "list, totals and whole-set queries");
  for (const c of calls.orders) assert.ok(whereOf(c).includes(JSON.stringify(scope).slice(1, -1)), `order query scoped: ${whereOf(c)}`);
  assert.ok(whereOf(calls.events[0]).includes('"assignedEngineerId":"u1"'), "latest updates scoped");
});

test("vendor engineer on WhatsApp: scoped by vendor AND assigned engineer", async () => {
  const calls: Calls = {};
  await withPrisma(orderFakes(calls), async () => { await tool("search_orders_and_sites").handler({}, eng({ vendorId: "v1" })); });
  for (const c of calls.orders) {
    const w = JSON.stringify((c as { where: unknown }).where);
    assert.ok(w.includes('"assignedEngineerId":"u1"') && w.includes('"vendorId":"v1"'), w);
  }
});

test("WhatsApp gate: view_site_status alone is enough for non-engineers (Ops/PM), no permission still forbidden", async () => {
  const calls: Calls = {};
  await withPrisma(orderFakes(calls), async () => {
    const ops = (await tool("search_orders_and_sites").handler({}, { userId: "u2", roleKey: "operations_pm", permissions: new Set(["view_site_status"]), waGroup: "ops" })) as Record<string, unknown>;
    assert.equal(ops.error, undefined);
    for (const c of calls.orders) assert.deepEqual((c as { where: { AND: unknown[] } }).where.AND.length, 1, "no extra row restriction for ops");
    const none = (await tool("search_orders_and_sites").handler({}, { userId: "u3", roleKey: "x", permissions: new Set(), waGroup: "ops" })) as Record<string, unknown>;
    assert.match(String(none.error), /permission/);
  });
});

test("in-app behaviour unchanged: engineer without manage_orders is still refused and no scope is injected", async () => {
  const calls: Calls = {};
  await withPrisma(orderFakes(calls), async () => {
    const refused = (await tool("search_orders_and_sites").handler({}, { ...eng(), waGroup: undefined })) as Record<string, unknown>;
    assert.match(String(refused.error), /permission/);
    assert.equal(calls.orders, undefined);
    const admin = (await tool("search_orders_and_sites").handler({}, { userId: "a", roleKey: "super_admin", permissions: new Set(["manage_orders"]) })) as Record<string, unknown>;
    assert.equal(admin.error, undefined);
    for (const c of calls.orders) assert.equal(JSON.stringify((c as { where: unknown }).where).includes("assignedEngineerId"), false);
  });
});

test("engineer cannot read the timeline of a site that is not theirs; the reply matches a missing site", async () => {
  const calls: Calls = {};
  const site = (assignedEngineerId: string | null, vendorId: string | null = null) => ({ id: "s1", companyName: "BPCL", address: "x", assignedEngineerId, vendorId, order: { customerId: "c", orderNumber: "SO-1" } });
  await withPrisma(orderFakes(calls, site("u9")), async () => {
    const denied = (await tool("search_site_status_updates").handler({ siteId: "s1" }, eng())) as Record<string, unknown>;
    assert.match(String(denied.error), /No site found with id s1/);
    assert.equal(calls.events, undefined, "no timeline query ran");
  });
  await withPrisma(orderFakes({}, null), async () => {
    const missing = (await tool("search_site_status_updates").handler({ siteId: "s1" }, eng())) as Record<string, unknown>;
    assert.match(String(missing.error), /No site found with id s1/);
  });
  await withPrisma(orderFakes(calls, site("u1")), async () => {
    const ok = (await tool("search_site_status_updates").handler({ siteId: "s1" }, eng())) as Record<string, unknown>;
    assert.equal(ok.error, undefined);
  });
  for (const c of calls.orders ?? []) assert.ok(JSON.stringify((c as { where: unknown }).where).includes("assignedEngineerId"), "company-wide counts are scoped");
});

test("work orders and complaints for WhatsApp engineers are limited to assigned sites on top of existing rules", async () => {
  const calls: Calls = {};
  await withPrisma(orderFakes(calls), async () => {
    await tool("search_work_orders").handler({}, eng());
    await tool("search_complaints").handler({}, eng());
  });
  const w = JSON.stringify((calls.wo[0] as { where: unknown }).where);
  assert.ok(w.includes('"assignedToId":"u1"') && w.includes('"assignedEngineerId":"u1"'), w);
  const c = JSON.stringify((calls.cmp[0] as { where: unknown }).where);
  assert.ok(c.includes('"assignedToId":"u1"') && c.includes('"assignedEngineerId":"u1"'), c);

  const inApp: Calls = {};
  await withPrisma(orderFakes(inApp), async () => {
    await tool("search_work_orders").handler({}, { ...eng(), waGroup: undefined });
  });
  assert.equal(JSON.stringify((inApp.wo[0] as { where: unknown }).where).includes("assignedEngineerId"), false);
});
