import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../src/lib/prisma";
import { buildAgentSystemPrompt } from "../src/agent/systemPrompt";
import {
  resolveLookupFilter, latestStatusBySite, summarizeOrders, normalizeLabel, validValuesList,
  UPDATE_STATUS_SYNONYMS, STAGE_SYNONYMS, NO_UPDATES_LABEL, zanAppReadTools,
} from "../src/agent/tools/zanAppReadTools";

// Seeded rows (prisma/seed.ts seedStatusOptions / seedStages).
const STATUS_OPTIONS = [
  { key: "pending", label: "Pending" },
  { key: "postpone_to_tomorrow", label: "Postpone to tomorrow" },
  { key: "material_not_arrived", label: "Material not arrived (RECD unit)" },
  { key: "awaiting_scaffolding_materials", label: "Awaiting materials for the scaffolding" },
  { key: "done", label: "Done" },
];
const STAGES = [
  { key: "installing", label: "Installing" },
  { key: "commissioned", label: "Commissioned" },
  { key: "customer_signoff", label: "Customer sign-off" },
];

test("'done' in any case / as 'completed' maps to the Done status option", () => {
  for (const v of ["done", "Done", "DONE", " done ", "completed", "Completed", "finished"]) {
    assert.deepEqual(resolveLookupFilter(v, STATUS_OPTIONS, UPDATE_STATUS_SYNONYMS), { keys: ["done"], unknown: [] }, v);
  }
  assert.deepEqual(resolveLookupFilter("Postpone To Tomorrow", STATUS_OPTIONS).keys, ["postpone_to_tomorrow"]);
  assert.deepEqual(resolveLookupFilter("material not arrived", STATUS_OPTIONS).keys, ["material_not_arrived"]);
  assert.deepEqual(resolveLookupFilter("done, pending", STATUS_OPTIONS).keys, ["done", "pending"]);
  assert.deepEqual(resolveLookupFilter(["Done", "done"], STATUS_OPTIONS).keys, ["done"]);
});

test("unknown filter values are reported (never silently dropped) with the valid list", () => {
  const out = resolveLookupFilter("dispatched, done", STATUS_OPTIONS, UPDATE_STATUS_SYNONYMS);
  assert.deepEqual(out, { keys: ["done"], unknown: ["dispatched"] });
  assert.deepEqual(validValuesList(STATUS_OPTIONS).at(-1), 'done ("Done")');
});

test("stages match by key or label, any case, plus common synonyms", () => {
  assert.deepEqual(resolveLookupFilter("Customer Sign-Off", STAGES).keys, ["customer_signoff"]);
  assert.deepEqual(resolveLookupFilter("customer_signoff", STAGES).keys, ["customer_signoff"]);
  assert.deepEqual(resolveLookupFilter("signed off", STAGES, STAGE_SYNONYMS).keys, ["customer_signoff"]);
  assert.deepEqual(resolveLookupFilter("COMMISSIONED", STAGES).keys, ["commissioned"]);
  assert.deepEqual(resolveLookupFilter("done", STAGES, STAGE_SYNONYMS).unknown, ["done"]);
  assert.equal(normalizeLabel("Customer_Sign-off "), "customer sign off");
});

test("latest status per site is the newest event", () => {
  const latest = latestStatusBySite([
    { siteId: "a", key: "done" },
    { siteId: "b", key: "pending" },
    { siteId: "a", key: "pending" },
  ]);
  assert.equal(latest.get("a")!.key, "done");
  assert.equal(latest.get("b")!.key, "pending");
  assert.equal(latest.size, 2);
});

test("byUpdateStatus counts every site (orders without a site are excluded)", () => {
  const row = (updateStatus: string | null, hasSite = true) => ({
    value: 1, quantity: 1, product: "P", lineItems: [], updateStatus,
    stage: hasSite ? { label: "Installing", sequenceOrder: 8 } : null,
  });
  const out = summarizeOrders([row("Done"), row("Done"), row("Pending"), row(null), row(null, false)], 11);
  assert.deepEqual(out.byUpdateStatus, [
    { updateStatus: "Done", count: 2 },
    { updateStatus: NO_UPDATES_LABEL, count: 1 },
    { updateStatus: "Pending", count: 1 },
  ]);
});

test("search_orders_and_sites: updateStatus='Done' filters by each site's latest update; unknown values list the valid ones", async (t) => {
  const tool = zanAppReadTools.find((x) => x.name === "search_orders_and_sites")!;
  const auth = { userId: "u1", roleKey: "management", permissions: new Set([PERMISSION_KEY.MANAGE_ORDERS]) };
  const replace = (key: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(prisma, key, original);
      else Reflect.deleteProperty(prisma, key);
    });
  };
  replace("stageDefinition", {
    findFirst: async () => ({ label: "Commissioned", sequenceOrder: 11 }),
    findMany: async () => STAGES,
  });
  replace("statusOption", { findMany: async () => STATUS_OPTIONS });
  // s1's latest update is Done; s2 was Done earlier but its latest is Pending.
  replace("siteStageEvent", {
    findMany: async () => [
      { siteId: "s1", statusOption: { key: "done" } },
      { siteId: "s2", statusOption: { key: "pending" } },
      { siteId: "s2", statusOption: { key: "done" } },
    ],
  });
  const wheres: any[] = [];
  replace("order", { findMany: async (args: any) => { wheres.push(args.where); return []; } });

  const ok: any = await tool.handler({ updateStatus: "Done" }, auth);
  assert.equal(ok.error, undefined);
  assert.deepEqual(wheres[0].AND.at(-1), { site: { is: { id: { in: ["s1"] } } } });
  assert.match(ok.updateStatusDefinition, /MOST RECENT SITC status update/);

  const bad: any = await tool.handler({ updateStatus: "closed" }, auth);
  assert.match(bad.error, /Unknown update status "closed"/);
  assert.ok(bad.validUpdateStatuses.includes('done ("Done")'));

  const badStage: any = await tool.handler({ stageKey: "done" }, auth);
  assert.match(badStage.error, /Unknown SITC stage "done"/);
  assert.match(badStage.hint, /update status/);

  wheres.length = 0;
  await tool.handler({ stageKey: "Customer Sign-off" }, auth);
  assert.deepEqual(wheres[0].AND.at(-1), { site: { is: { currentStage: { key: { in: ["customer_signoff"] } } } } });
});

test("search_orders_and_sites: 'which ones are installing' filters server-side before the 15-row cut", async (t) => {
  const tool = zanAppReadTools.find((x) => x.name === "search_orders_and_sites")!;
  const auth = { userId: "u1", roleKey: "management", permissions: new Set([PERMISSION_KEY.MANAGE_ORDERS]) };
  const replace = (key: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(prisma, key, original);
      else Reflect.deleteProperty(prisma, key);
    });
  };
  replace("stageDefinition", {
    findFirst: async () => ({ label: "Commissioned", sequenceOrder: 11 }),
    findMany: async () => STAGES,
  });
  replace("statusOption", { findMany: async () => STATUS_OPTIONS });
  replace("siteStageEvent", { findMany: async () => [] });
  const calls: any[] = [];
  replace("order", { findMany: async (args: any) => { calls.push(args); return []; } });

  const out: any = await tool.handler({ stageKey: "installing", query: "Chennai" }, auth);
  assert.equal(out.error, undefined);
  // Both the listed page (take 15) and the totals query use the same filtered where; the third
  // (whole-set counts) has no user filters at all.
  assert.equal(calls.length, 3);
  const listed = calls.find((c) => c.take != null);
  const totals = calls.find((c) => c.take == null && c.where.AND);
  assert.ok(listed && totals);
  assert.deepEqual(calls.find((c) => !c.where.AND).where, {});
  assert.deepEqual(listed.where, totals.where);
  assert.deepEqual(listed.where.AND.at(-1), { site: { is: { currentStage: { key: { in: ["installing"] } } } } });
  assert.ok(listed.where.AND.some((f: any) => Array.isArray(f.OR)), "query filter is in the where too");
});

test("filtered order/site queries also return whole-set counts (allOrders) that ignore the filters", async (t) => {
  const tools = Object.fromEntries(zanAppReadTools.map((x) => [x.name, x]));
  const auth = { userId: "u1", roleKey: "management", permissions: new Set([PERMISSION_KEY.MANAGE_ORDERS, PERMISSION_KEY.VIEW_SITE_STATUS]) };
  const replace = (key: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(prisma, key, original);
      else Reflect.deleteProperty(prisma, key);
    });
  };
  replace("stageDefinition", {
    findFirst: async () => ({ label: "Commissioned", sequenceOrder: 11 }),
    findMany: async () => STAGES,
  });
  replace("statusOption", { findMany: async () => STATUS_OPTIONS });
  // Latest update per site comes from ONE siteStageEvent query, joined by site id.
  const events: any[] = [];
  const site = (label: string, sequenceOrder: number, status = "Done") => {
    const id = `s${events.length + 1}`;
    events.push({ siteId: id, createdAt: new Date("2026-10-01T05:00:00Z"), statusOption: { key: status.toLowerCase(), label: status }, stageDefinition: { label } });
    return { id, currentStage: { label, sequenceOrder } };
  };
  // Whole set: 9 Commissioned, 2 Installing, 1 Dispatched, 1 without a site.
  const all = [
    ...Array.from({ length: 9 }, () => site("Commissioned", 11)),
    site("Installing", 8, "Pending"), site("Installing", 8), site("Dispatched", 5, "Pending"), null,
  ].map((s) => ({ value: null, quantity: 1, product: { name: "RECD", model: "R" }, lineItems: [], site: s }));
  const wheres: any[] = [];
  replace("order", {
    findMany: async (args: any) => {
      wheres.push(args.where);
      if (args.take != null) return [];
      // The filtered call (openOnly) only sees the open ones.
      return args.where.AND ? all.filter((o) => !o.site || o.site.currentStage.sequenceOrder < 11) : all;
    },
  });
  replace("site", { findUnique: async () => ({ id: "s1", vendorId: null, companyName: "BPCL", address: "x", order: { customerId: "c1", orderNumber: "O1" } }) });
  replace("siteStageEvent", { findMany: async (args: any) => (args.distinct ? events : []) });

  const out: any = await tools.search_orders_and_sites.handler({ openOnly: true }, auth);
  assert.equal(out.totals.count, 4);
  assert.equal(out.totals.completedCount, 0);
  assert.deepEqual(
    [out.allOrders.total, out.allOrders.open, out.allOrders.closed],
    [13, 4, 9],
  );
  assert.deepEqual(out.allOrders.byStage.find((s: any) => s.stage === "Commissioned"), { stage: "Commissioned", count: 9 });
  assert.deepEqual(out.allOrders.byUpdateStatus[0], { updateStatus: "Done", count: 10 });
  assert.match(out.allOrders.note, /WHOLE SET, ignores filters/);
  assert.ok(wheres.some((w) => JSON.stringify(w) === "{}"), "whole-set query has no user filters");

  const upd: any = await tools.search_site_status_updates.handler({ siteId: "s1", status: "done" }, auth);
  assert.equal(upd.error, undefined);
  assert.deepEqual([upd.allOrders.total, upd.allOrders.closed], [13, 9]);

  // A customer's whole set is still scoped to their own orders.
  wheres.length = 0;
  const customer = { userId: "c", roleKey: "customer", customerId: "c1", permissions: new Set([PERMISSION_KEY.VIEW_SITE_STATUS]) };
  await tools.search_orders_and_sites.handler({ stageKey: "installing" }, customer);
  assert.ok(wheres.some((w) => JSON.stringify(w) === JSON.stringify({ customerId: "c1" })));
});

test("site names: siteName = the app's 'Site name' (companyName) verbatim, address separate; one event query", async (t) => {
  const tools = Object.fromEntries(zanAppReadTools.map((x) => [x.name, x]));
  const auth = { userId: "u1", roleKey: "management", permissions: new Set([PERMISSION_KEY.MANAGE_ORDERS, PERMISSION_KEY.VIEW_SITE_STATUS]) };
  const replace = (key: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(prisma, key, original);
      else Reflect.deleteProperty(prisma, key);
    });
  };
  replace("stageDefinition", {
    findFirst: async () => ({ label: "Commissioned", sequenceOrder: 11 }),
    findMany: async () => STAGES,
  });
  replace("statusOption", { findMany: async () => STATUS_OPTIONS });
  let eventQueries = 0;
  replace("siteStageEvent", {
    findMany: async (args: any) => {
      if (!args.distinct) return [];
      eventQueries += 1;
      return [{ siteId: "s1", createdAt: new Date("2026-10-08T06:00:00Z"), statusOption: { key: "pending", label: "Pending" }, stageDefinition: { label: "Installing" } }];
    },
  });
  const site = {
    id: "s1", companyName: "BOSTIK", address: "Bommasandra Industrial Area, Bangalore",
    currentStage: { label: "Installing", sequenceOrder: 8 }, assignedEngineer: null, vendor: null,
  };
  const orderCalls: any[] = [];
  replace("order", {
    findMany: async (args: any) => {
      orderCalls.push(args);
      return [{
        id: "o1", orderNumber: "ORD-1", quantity: 1, value: null, orderDate: null, promisedDeliveryDate: null, actualDispatchDate: null,
        customer: { name: "Ethen" }, product: { name: "RECD", model: "R" }, lineItems: [], site,
      }];
    },
  });
  replace("site", { findUnique: async () => ({ ...site, vendorId: null, order: { customerId: "c1", orderNumber: "ORD-1" } }) });

  const out: any = await tools.search_orders_and_sites.handler({}, auth);
  const s = out.orders[0].site;
  assert.equal(s.siteName, "BOSTIK");
  assert.equal(s.address, "Bommasandra Industrial Area, Bangalore");
  assert.equal(s.companyName, undefined, "no ambiguous companyName/end-client field");
  assert.equal(out.orders[0].customer, "Ethen");
  assert.equal(s.updateStatus, "Pending");
  assert.deepEqual(s.lastUpdate, { stage: "Installing", postedAt: "2026-10-08" });
  assert.match(out.siteNameRule, /verbatim/);
  // Unfiltered: list + totals only (the whole set is the totals set), latest updates read once.
  assert.equal(orderCalls.length, 2);
  assert.equal(eventQueries, 1);
  assert.equal(out.allOrders.total, 1);
  assert.ok(orderCalls.every((c) => c.select && !c.include && !JSON.stringify(c.select).includes("stageEvents")));

  const upd: any = await tools.search_site_status_updates.handler({ siteId: "s1" }, auth);
  assert.deepEqual(upd.site, { id: "s1", siteName: "BOSTIK", address: "Bommasandra Industrial Area, Bangalore" });

  const prompt = buildAgentSystemPrompt(false);
  assert.match(prompt, /SITE NAMES: a site's name is the tool's siteName field/);
  assert.match(prompt, /\[siteName\]\(\/sites\/\{site\.id\}\)/);
  assert.doesNotMatch(prompt, /BPCL - Hosakote, Bangalore/);
});
