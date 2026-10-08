import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../src/lib/prisma";

test("create_invoice retains validation, permissions, totals and pending-only writes", async (t) => {
  // Importing route helpers requires a JWT secret; this is a local test value only.
  process.env.JWT_SECRET ||= "document-regression-test-only-secret";
  const { zanAppWriteTools } = await import("../src/agent/tools/zanAppWriteTools");
  const tool = zanAppWriteTools.find((tool) => tool.name === "create_invoice")!;
  const auth = { userId: "u1", roleKey: "finance", permissions: new Set([PERMISSION_KEY.MANAGE_INVOICES]), conversationId: "chat1" };
  const line = { description: "RECD", hsnCode: "8421", quantity: 2, unitPrice: 1000 };
  const input = { docType: "proforma", customerId: "c1", lineItems: [line], issueDate: "2026-10-01" };
  const pending: any[] = [];
  // Prisma delegates are proxies, so replace the delegates rather than mock their
  // virtual method descriptors. No database connection is made by this test.
  const replace = (key: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(prisma, key, original);
      else Reflect.deleteProperty(prisma, key);
    });
  };
  replace("customer", { findUnique: async () => ({ id: "c1", name: "Acme", state: "Tamil Nadu" }) });
  replace("companySettings", { findUnique: async () => ({ state: "Tamil Nadu" }) });
  replace("agentPendingAction", { create: async (args: any) => { pending.push(args.data); return { id: "action1" }; } });
  const invoiceWrite = t.mock.fn(async () => { throw new Error("Must not create before confirmation"); });
  replace("invoice", { create: invoiceWrite });

  assert.match((await tool.handler(input, { ...auth, permissions: new Set() }) as any).error, /permission/);
  assert.match((await tool.handler(input, { ...auth, conversationId: undefined }) as any).error, /No active conversation/);
  for (const invalid of [
    { ...input, docType: "unknown" },
    { ...input, lineItems: [] },
    { ...input, lineItems: [{ ...line, hsnCode: "" }] },
    { ...input, lineItems: [{ ...line, quantity: 0 }] },
    { ...input, lineItems: [{ ...line, unitPrice: -1 }] },
  ]) assert.ok((await tool.handler(invalid, auth) as any).error);
  assert.equal(pending.length, 0);

  for (const docType of ["proforma", "tax_invoice"]) {
    const result: any = await tool.handler({ ...input, docType }, auth);
    assert.equal(result.status, "pending_confirmation");
    assert.equal(result.actionId, "action1");
    assert.equal(result.preview.subtotal, 2000);
    assert.equal(result.preview.cgst, 180);
    assert.equal(result.preview.sgst, 180);
    assert.equal(result.preview.igst, 0);
    assert.equal(result.preview.total, 2360);
    assert.match(result.note, /DRAFT only \(no invoice number\)/);
    const data = pending.at(-1);
    assert.equal(data.toolName, "create_invoice");
    assert.equal(data.conversationId, "chat1");
    assert.equal(data.createdById, "u1");
    assert.equal(data.input.docType, docType);
    assert.equal(data.input.lineItems[0].taxRatePct, 18);
    assert.equal(data.input.lineItems[0].discountPct, 0);
    assert.equal(data.input.issueDate, "2026-10-01");
    assert.equal(data.input.placeOfSupply, "Tamil Nadu");
    assert.equal(data.input.invoiceNumber, undefined);
  }
  assert.equal(pending.length, 2);
  assert.equal(invoiceWrite.mock.callCount(), 0);
});
