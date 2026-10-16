import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../src/lib/prisma";
import { coreDescription } from "../src/agent/hsnLookup";

// The agent used to refuse any invoice line without an HSN/SAC. Earlier invoices already bill
// each service under one code, so a missing code is now filled from them (never invented).

test("coreDescription strips the '- site' suffix (hyphen and en dash)", () => {
  assert.equal(coreDescription("Panel board fixing, connection testing, logistics - VRL Belgaum"), "Panel board fixing, connection testing, logistics");
  assert.equal(coreDescription("Dismantling & Mechanical Fabrication – VRL Hubli 750 KVA"), "Dismantling & Mechanical Fabrication");
  assert.equal(coreDescription("  Thermal   Insulation & Painting "), "Thermal Insulation & Painting");
  // A hyphen inside a word is not a separator.
  assert.equal(coreDescription("Pre-fabricated shed"), "Pre-fabricated shed");
});

async function setup(t: import("node:test").TestContext, past: { description: string; hsnCode: string }[], saved: any[] = []) {
  process.env.JWT_SECRET ||= "document-regression-test-only-secret";
  const { zanAppWriteTools } = await import("../src/agent/tools/zanAppWriteTools");
  const tool = zanAppWriteTools.find((x) => x.name === "create_invoice")!;
  const pending: any[] = [];
  const replace = (key: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(prisma, key, original);
      else Reflect.deleteProperty(prisma, key);
    });
  };
  replace("customer", { findUnique: async () => ({ id: "c1", name: "Ethen", state: "Karnataka" }) });
  replace("companySettings", { findUnique: async () => ({ state: "Tamil Nadu" }) });
  replace("agentPendingAction", { create: async (a: any) => { pending.push(a.data); return { id: "action1" }; } });
  replace("savedLineItem", { findMany: async () => saved });
  replace("invoiceLineItem", {
    // newest first, like the real orderBy
    findMany: async () => past,
    groupBy: async () => {
      const m = new Map<string, any>();
      for (const p of past) {
        const k = `${p.description}|${p.hsnCode}`;
        const g = m.get(k) ?? { description: p.description, hsnCode: p.hsnCode, _count: { _all: 0 } };
        g._count._all++;
        m.set(k, g);
      }
      return [...m.values()];
    },
  });
  const auth = { userId: "u1", roleKey: "finance", permissions: new Set([PERMISSION_KEY.MANAGE_INVOICES]), conversationId: "chat1" };
  return { tool, pending, auth };
}

const base = { docType: "proforma", customerId: "c1", issueDate: "2026-10-16" };

test("missing HSN is reused from earlier invoices and the user is told", async (t) => {
  const { tool, pending, auth } = await setup(t, [
    { description: "Panel board fixing, connection testing, logistics - VRL Belgaum", hsnCode: "998346" },
    { description: "Panel board fixing, connection testing, logistics – VRL Bijapur", hsnCode: "998346" },
  ]);
  const result: any = await tool.handler(
    { ...base, lineItems: [{ description: "Panel board fixing, connection testing, logistics - Bostik", quantity: 1, unitPrice: 5000 }] },
    auth,
  );
  assert.equal(result.status, "pending_confirmation");
  assert.equal(pending[0].input.lineItems[0].hsnCode, "998346");
  assert.match(result.note, /998346/);
  assert.match(result.note, /reused from 2 earlier invoice line/);
});

test("an HSN the user supplied is never overridden", async (t) => {
  const { tool, pending, auth } = await setup(t, [{ description: "Thermal Insulation & Painting - X", hsnCode: "995473" }]);
  const result: any = await tool.handler(
    { ...base, lineItems: [{ description: "Thermal Insulation & Painting - Y", hsnCode: "123456", quantity: 1, unitPrice: 100 }] },
    auth,
  );
  assert.equal(result.status, "pending_confirmation");
  assert.equal(pending[0].input.lineItems[0].hsnCode, "123456");
  assert.doesNotMatch(result.note, /reused from/);
});

test("a saved billing item wins over invoice history", async (t) => {
  const { tool, pending, auth } = await setup(
    t,
    [{ description: "Crane hire - X", hsnCode: "111111" }],
    [{ name: "Crane hire", hsnCode: "997319" }],
  );
  const result: any = await tool.handler({ ...base, lineItems: [{ description: "Crane hire", quantity: 1, unitPrice: 100 }] }, auth);
  assert.equal(result.status, "pending_confirmation");
  assert.equal(pending[0].input.lineItems[0].hsnCode, "997319");
  assert.match(result.note, /saved billing item "Crane hire"/);
});

test("the most-used earlier code wins over a one-off", async (t) => {
  const { tool, pending, auth } = await setup(t, [
    { description: "Transportation charges - A", hsnCode: "996599" }, // newest, one-off
    { description: "Transportation charges - B", hsnCode: "996511" },
    { description: "Transportation charges - C", hsnCode: "996511" },
  ]);
  await tool.handler({ ...base, lineItems: [{ description: "Transportation charges", quantity: 1, unitPrice: 100 }] }, auth);
  assert.equal(pending[0].input.lineItems[0].hsnCode, "996511");
});

test("no match: refuses, lists earlier codes as options, and writes nothing", async (t) => {
  const { tool, pending, auth } = await setup(t, [
    { description: "Panel board fixing, connection testing, logistics - VRL Belgaum", hsnCode: "998346" },
  ]);
  const result: any = await tool.handler(
    { ...base, lineItems: [{ description: "Extra work – DG Acoustic removal and refixing", quantity: 1, unitPrice: 15000 }] },
    auth,
  );
  assert.equal(result.status, undefined);
  assert.match(result.error, /Line item 1/);
  assert.match(result.error, /998346 = Panel board fixing, connection testing, logistics/);
  assert.match(result.error, /Never invent a code/);
  assert.equal(pending.length, 0);
});

test("a line that does not exactly share the service name is not matched by accident", async (t) => {
  const { tool, pending, auth } = await setup(t, [{ description: "Extra for crane and unloading - INTERGLOBE", hsnCode: "998346" }]);
  const result: any = await tool.handler({ ...base, lineItems: [{ description: "Extra", quantity: 1, unitPrice: 1 }] }, auth);
  assert.ok(result.error);
  assert.equal(pending.length, 0);
});
