import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { zanAppReadTools, istDayRange } from "../src/agent/tools/zanAppReadTools";
import type { AgentAuthContext, AgentTool } from "../src/agent/tools/types";

const tool = (name: string): AgentTool => zanAppReadTools.find((t) => t.name === name)!;
type Row = { assignedToId: string | null; scheduledDate: Date | null; status: string };

/** Tiny in-memory evaluator for the where-clauses these two tools build. */
function matches(r: Row, where: Record<string, any>): boolean {
  if ("assignedToId" in where && r.assignedToId !== where.assignedToId) return false;
  if (where.scheduledDate) {
    const { gte, lt } = where.scheduledDate;
    if (!r.scheduledDate) return false;
    if (gte && r.scheduledDate < gte) return false;
    if (lt && r.scheduledDate >= lt) return false;
  }
  if (where.status && r.status !== where.status) return false;
  return true;
}

function fakeModel(rows: Row[], calls: any[]) {
  return {
    findMany: async (args: any) => { calls.push(args.where); return rows.filter((r) => matches(r, args.where)).map((r, i) => ({ ...r, id: `x${i}`, site: { order: { customer: { name: "C" } } }, customer: { name: "C" }, assignedTo: null })); },
    groupBy: async (args: any) => {
      const m = new Map<string, number>();
      for (const r of rows.filter((r) => matches(r, args.where))) m.set(r.status, (m.get(r.status) ?? 0) + 1);
      return [...m].map(([status, n]) => ({ status, _count: { _all: n } }));
    },
  };
}

async function withModel<T>(key: string, model: unknown, fn: () => Promise<T>): Promise<T> {
  const d = Object.getOwnPropertyDescriptor(prisma, key);
  Object.defineProperty(prisma, key, { configurable: true, value: model });
  try { return await fn(); } finally { if (d) Object.defineProperty(prisma, key, d); else Reflect.deleteProperty(prisma, key); }
}

const manager: AgentAuthContext = {
  userId: "me", roleKey: "management",
  permissions: new Set(["manage_work_orders", "manage_complaints", "view_complaints_overview"]),
};
const engineer: AgentAuthContext = { userId: "me", roleKey: "erection_engineer", permissions: new Set(["act_assigned_work_orders", "act_assigned_complaints"]) };

const today = new Date("2026-10-24T10:00:00+05:30");
const woRows: Row[] = [
  { assignedToId: "other", scheduledDate: today, status: "assigned" },
  { assignedToId: "other", scheduledDate: today, status: "assigned" },
  { assignedToId: "other2", scheduledDate: new Date("2026-10-24T00:00:00+05:30"), status: "in_progress" },
  { assignedToId: "other2", scheduledDate: new Date("2026-10-24T23:59:00+05:30"), status: "assigned" },
  { assignedToId: "me", scheduledDate: new Date("2026-10-25T00:00:00+05:30"), status: "assigned" }, // tomorrow
  { assignedToId: "me", scheduledDate: new Date("2026-10-23T23:59:00+05:30"), status: "assigned" }, // yesterday
];

test("manager: 'my work orders today' with 0 assigned today gets 0, scope assigned_to_you", async () => {
  const calls: any[] = [];
  const out: any = await withModel("workOrder", fakeModel(woRows, calls), () =>
    tool("search_work_orders").handler({ assignedToMe: true, scheduledFrom: "2026-10-24", scheduledTo: "2026-10-24" }, manager));
  assert.equal(out.scope, "assigned_to_you");
  assert.equal(out.totalCount, 0);
  assert.equal(calls[0].assignedToId, "me");
});

test("manager without the flag still gets all (4 scheduled today), scope all", async () => {
  const calls: any[] = [];
  const out: any = await withModel("workOrder", fakeModel(woRows, calls), () =>
    tool("search_work_orders").handler({ scheduledFrom: "2026-10-24", scheduledTo: "2026-10-24" }, manager));
  assert.equal(out.scope, "all");
  assert.equal(out.totalCount, 4);
  assert.equal("assignedToId" in calls[0], false);
});

test("engineer is always scoped to self, even without the flag", async () => {
  const calls: any[] = [];
  const out: any = await withModel("workOrder", fakeModel(woRows, calls), () => tool("search_work_orders").handler({}, engineer));
  assert.equal(out.scope, "assigned_to_you");
  assert.equal(out.totalCount, 2);
});

test("bad scheduled date is an error, not an unfiltered list", async () => {
  const out: any = await withModel("workOrder", fakeModel(woRows, []), () =>
    tool("search_work_orders").handler({ assignedToMe: true, scheduledFrom: "24-10-2026" }, manager));
  assert.match(out.error, /scheduledFrom/);
});

test("istDayRange: inclusive IST day bounds", () => {
  const r: any = istDayRange("2026-10-24", "2026-10-24");
  assert.equal(r.range.gte.toISOString(), "2026-10-23T18:30:00.000Z");
  assert.equal(r.range.lt.toISOString(), "2026-10-24T18:30:00.000Z");
  assert.deepEqual(istDayRange(undefined, ""), {});
});

const cmpRows: Row[] = [
  { assignedToId: "other", scheduledDate: null, status: "open" },
  { assignedToId: "other", scheduledDate: null, status: "in_progress" },
  { assignedToId: null, scheduledDate: null, status: "open" },
];

test("complaints: manager 'my complaints' with 0 assigned gets 0; without flag gets all", async () => {
  const c1: any[] = [];
  const mine: any = await withModel("complaint", fakeModel(cmpRows, c1), () => tool("search_complaints").handler({ assignedToMe: true }, manager));
  assert.equal(mine.scope, "assigned_to_you");
  assert.equal(mine.totalCount, 0);
  assert.equal(c1[0].assignedToId, "me");
  const all: any = await withModel("complaint", fakeModel(cmpRows, []), () => tool("search_complaints").handler({}, manager));
  assert.equal(all.scope, "all");
  assert.equal(all.totalCount, 3);
});
