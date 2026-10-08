import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../src/lib/prisma";
import { summarizeExpenses, zanAppReadTools } from "../src/agent/tools/zanAppReadTools";

test("expense totals and per-category breakdown cover every expense, in whole paise", () => {
  const rows = [
    ...Array.from({ length: 16 }, () => ({ amount: 100.1, category: "Fuel" })),
    { amount: 2500, category: "Travel" },
    { amount: 0.2, category: "Travel" },
  ];
  const out = summarizeExpenses(rows);
  assert.equal(out.count, 18);
  assert.equal(out.totalAmount, 4101.8);
  assert.deepEqual(out.byCategory, { Fuel: { count: 16, amount: 1601.6 }, Travel: { count: 2, amount: 2500.2 } });
});

test("search_expenses 'this month': IST date range in the where, server total over all 16 rows", async (t) => {
  const tool = zanAppReadTools.find((x) => x.name === "search_expenses")!;
  const auth = { userId: "u1", roleKey: "finance", permissions: new Set([PERMISSION_KEY.MANAGE_EXPENSES]) };
  const original = Object.getOwnPropertyDescriptor(prisma, "expense");
  t.after(() => {
    if (original) Object.defineProperty(prisma, "expense", original);
    else Reflect.deleteProperty(prisma, "expense");
  });
  const calls: any[] = [];
  const all = Array.from({ length: 16 }, (_, i) => ({ amount: 1000, category: { label: i < 10 ? "Fuel" : "Travel" } }));
  Object.defineProperty(prisma, "expense", {
    configurable: true,
    value: { findMany: async (args: any) => { calls.push(args); return args.take ? [] : all; } },
  });

  const out: any = await tool.handler({ from: "2026-10-01", to: "2026-10-08" }, auth);
  assert.equal(out.totals.totalAmount, 16000);
  assert.equal(out.totals.count, 16);
  assert.deepEqual(out.totals.byCategory.Travel, { count: 6, amount: 6000 });
  assert.deepEqual(out.period, { from: "2026-10-01", to: "2026-10-08", timezone: "IST" });
  for (const c of calls) {
    assert.equal(c.where.expenseDate.gte.toISOString(), "2026-09-30T18:30:00.000Z"); // 01 Oct 00:00 IST
    assert.equal(c.where.expenseDate.lt.toISOString(), "2026-10-08T18:30:00.000Z"); // 09 Oct 00:00 IST
  }

  assert.match((await tool.handler({ from: "Oct 2026" }, auth) as any).error, /YYYY-MM-DD/);
  const sales = { userId: "s", roleKey: "sales", permissions: new Set<string>() };
  assert.match((await tool.handler({}, sales) as any).error, /permission/);
});
