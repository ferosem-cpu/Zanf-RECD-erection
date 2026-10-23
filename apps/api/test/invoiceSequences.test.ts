import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY, FINANCE_DOC_TYPE } from "@recd/shared";
import { prisma } from "../src/lib/prisma";
import { nextDocumentNumber, SEQUENCE_KEY } from "../src/services/documentNumber";

process.env.JWT_SECRET ||= "invoice-sequences-test-only-secret";

const D = (n: number | string) => new Prisma.Decimal(String(n));

// ---- counter split -------------------------------------------------------------------------
function fakeSeqTx(start: Record<string, number>) {
  const rows = { ...start };
  return {
    rows,
    tx: {
      documentSequence: {
        upsert: async ({ where, create }: any) => {
          const k = `${where.docType_fiscalYear.docType}|${where.docType_fiscalYear.fiscalYear}`;
          rows[k] = rows[k] === undefined ? create.lastNumber : rows[k] + 1;
          return { lastNumber: rows[k] };
        },
      },
    } as any,
  };
}

test("proforma and tax invoice use separate counters", () => {
  assert.equal(SEQUENCE_KEY[FINANCE_DOC_TYPE.PROFORMA], "proforma");
  assert.equal(SEQUENCE_KEY[FINANCE_DOC_TYPE.TAX_INVOICE], "tax_invoice");
  assert.notEqual(SEQUENCE_KEY[FINANCE_DOC_TYPE.PROFORMA], SEQUENCE_KEY[FINANCE_DOC_TYPE.TAX_INVOICE]);
});

test("tax invoice continues from 0004 regardless of proformas issued (seeded counters)", async () => {
  const { tx, rows } = fakeSeqTx({ "tax_invoice|2026-27": 4, "proforma|2026-27": 17, "invoice|2026-27": 18 });
  const day = new Date("2026-10-23T10:00:00Z");
  assert.equal(await nextDocumentNumber(tx, FINANCE_DOC_TYPE.PROFORMA, day), "PI/2026-27/0018");
  assert.equal(await nextDocumentNumber(tx, FINANCE_DOC_TYPE.TAX_INVOICE, day), "INV/2026-27/0005");
  assert.equal(await nextDocumentNumber(tx, FINANCE_DOC_TYPE.PROFORMA, day), "PI/2026-27/0019");
  assert.equal(await nextDocumentNumber(tx, FINANCE_DOC_TYPE.TAX_INVOICE, day), "INV/2026-27/0006");
  assert.equal(rows["invoice|2026-27"], 18, "legacy shared row untouched");
});

test("new fiscal year starts each series at 0001", async () => {
  const { tx } = fakeSeqTx({});
  const d = new Date("2027-04-02T10:00:00Z");
  assert.equal(await nextDocumentNumber(tx, FINANCE_DOC_TYPE.TAX_INVOICE, d), "INV/2027-28/0001");
  assert.equal(await nextDocumentNumber(tx, FINANCE_DOC_TYPE.PROFORMA, d), "PI/2027-28/0001");
});

// ---- convert endpoint ----------------------------------------------------------------------
function replace(t: any, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(prisma, key);
  Object.defineProperty(prisma, key, { configurable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(prisma, key, original);
    else Reflect.deleteProperty(prisma, key);
  });
}

function proforma(over: Record<string, any> = {}) {
  return {
    id: "pi16", invoiceNumber: "PI/2026-27/0016", docType: "proforma", status: "issued", cancelledAt: null,
    customerId: "c1", orderId: "o1", quotationId: "q1", placeOfSupply: "Tamil Nadu",
    issueDate: new Date("2026-10-14T18:47:00Z"), dueDate: null,
    subtotal: D(100000), discountAmount: D(0), cgstAmount: D(9000), sgstAmount: D(9000), igstAmount: D(0), total: D(118000),
    notes: "Site: Plot 7", terms: "50% advance",
    lineItems: [{ productId: "p1", description: "RECD erection", hsnCode: "998719", quantity: D(1), unitPrice: D(100000), discountPct: D(0), taxRatePct: D(18), lineTotal: D(100000), sortOrder: 0 }],
    convertedTo: null,
    ...over,
  };
}

function fakePrisma(t: any, src: any) {
  const created: any[] = [];
  replace(t, "user", {
    findUnique: async () => ({
      id: "u1", isActive: true, customerId: null, vendorId: null, vendor: null,
      role: { key: "accounts", permissions: [{ permission: { key: PERMISSION_KEY.MANAGE_INVOICES } }] },
    }),
  });
  replace(t, "invoice", {
    findUnique: async () => src,
    create: async (args: any) => { created.push(args.data); return { id: "new1", ...args.data }; },
  });
  replace(t, "$transaction", async (fn: any) => fn(prisma));
  return created;
}

async function serve(t: any) {
  const { invoicesRouter } = await import("../src/routes/invoices");
  const { signToken } = await import("../src/lib/jwt");
  const app = express();
  app.use(express.json());
  app.use("/invoices", invoicesRouter);
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = signToken({ userId: "u1", roleKey: "accounts" });
  return (path: string) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } });
}

test("convert-to-tax: issued proforma -> DRAFT tax invoice copying everything, with reference", async (t) => {
  const created = fakePrisma(t, proforma());
  const res = await (await serve(t))("/invoices/pi16/convert-to-tax");
  assert.equal(res.status, 201);
  assert.equal(created.length, 1);
  const d = created[0];
  assert.equal(d.docType, "tax_invoice");
  assert.equal(d.status, "draft");
  assert.match(d.invoiceNumber, /^DRAFT-/, "no real number until Issue");
  assert.equal(d.sourceProformaId, "pi16");
  assert.equal([d.customerId, d.orderId, d.quotationId, d.placeOfSupply, d.terms].join("|"), "c1|o1|q1|Tamil Nadu|50% advance");
  assert.equal([d.subtotal, d.discountAmount, d.cgstAmount, d.sgstAmount, d.igstAmount, d.total].map(String).join("|"), "100000|0|9000|9000|0|118000");
  assert.equal(d.notes, "Against Proforma Invoice PI/2026-27/0016 dated 15 Oct 2026\n\nSite: Plot 7");
  assert.equal(d.lineItems.create.length, 1);
  assert.equal(d.lineItems.create[0].hsnCode, "998719");
});

test("convert-to-tax: notes is just the reference when the proforma has none", async (t) => {
  const created = fakePrisma(t, proforma({ notes: null }));
  assert.equal((await (await serve(t))("/invoices/pi16/convert-to-tax")).status, 201);
  assert.equal(created[0].notes, "Against Proforma Invoice PI/2026-27/0016 dated 15 Oct 2026");
});

test("convert-to-tax: already converted proforma is rejected (409)", async (t) => {
  const created = fakePrisma(t, proforma({ convertedTo: { id: "tx1" } }));
  assert.equal((await (await serve(t))("/invoices/pi16/convert-to-tax")).status, 409);
  assert.equal(created.length, 0);
});

test("convert-to-tax: cancelled, draft, or tax-invoice sources are rejected (400), missing is 404", async (t) => {
  for (const over of [{ status: "cancelled", cancelledAt: new Date() }, { status: "draft" }, { docType: "tax_invoice" }]) {
    const created = fakePrisma(t, proforma(over));
    assert.equal((await (await serve(t))("/invoices/pi16/convert-to-tax")).status, 400, JSON.stringify(over));
    assert.equal(created.length, 0);
  }
  fakePrisma(t, null);
  assert.equal((await (await serve(t))("/invoices/x/convert-to-tax")).status, 404);
});

// ---- issue step keeps a user-chosen date -------------------------------------------------
function fakeIssue(t: any) {
  const calls: any = { upsert: [], update: [] };
  fakePrisma(t, { id: "d1", docType: "tax_invoice", status: "draft", invoiceNumber: "DRAFT-x" });
  replace(t, "documentSequence", { upsert: async (a: any) => { calls.upsert.push(a); return { lastNumber: 5 }; } });
  const inv = (prisma as any).invoice;
  inv.update = async (a: any) => { calls.update.push(a.data); return { id: "d1", ...a.data, customer: { contacts: [] } }; };
  return calls;
}
const issue = async (t: any, body?: unknown) => {
  const { invoicesRouter } = await import("../src/routes/invoices");
  const { signToken } = await import("../src/lib/jwt");
  const app = express(); app.use(express.json()); app.use("/invoices", invoicesRouter);
  const server = app.listen(0); t.after(() => server.close());
  return fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/invoices/d1/issue`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${signToken({ userId: "u1", roleKey: "accounts" })}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

test("issue: user-chosen issueDate is kept; number still from the tax_invoice counter", async (t) => {
  const calls = fakeIssue(t);
  const res = await issue(t, { issueDate: "2026-10-20" });
  assert.equal(res.status, 200);
  assert.equal(calls.upsert[0].where.docType_fiscalYear.docType, "tax_invoice");
  assert.equal(calls.upsert[0].where.docType_fiscalYear.fiscalYear, "2026-27");
  assert.equal(calls.update[0].invoiceNumber, "INV/2026-27/0005");
  assert.equal(calls.update[0].issueDate.toISOString().slice(0, 10), "2026-10-20");
});

test("issue: no issueDate defaults to now; invalid date is 400", async (t) => {
  const calls = fakeIssue(t);
  const before = Date.now();
  assert.equal((await issue(t)).status, 200);
  assert.ok(Math.abs(calls.update[0].issueDate.getTime() - before) < 60_000);
  assert.equal((await issue(t, { issueDate: "not-a-date" })).status, 400);
});
