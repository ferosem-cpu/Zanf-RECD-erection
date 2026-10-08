import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../src/lib/prisma";
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
  const calls: any[] = [];
  replace("order", { findMany: async (args: any) => { calls.push(args); return []; } });

  const out: any = await tool.handler({ stageKey: "installing", query: "Chennai" }, auth);
  assert.equal(out.error, undefined);
  // Both the listed page (take 15) and the totals query use the same filtered where.
  assert.equal(calls.length, 2);
  const listed = calls.find((c) => c.take != null);
  const totals = calls.find((c) => c.take == null);
  assert.ok(listed && totals);
  assert.deepEqual(listed.where, totals.where);
  assert.deepEqual(listed.where.AND.at(-1), { site: { is: { currentStage: { key: { in: ["installing"] } } } } });
  assert.ok(listed.where.AND.some((f: any) => Array.isArray(f.OR)), "query filter is in the where too");
});
