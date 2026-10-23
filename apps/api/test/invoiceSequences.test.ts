import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY, FINANCE_DOC_TYPE } from "@recd/shared";
import { prisma } from "../src/lib/prisma";
import { nextDocumentNumber, SEQUENCE_KEY, fiscalYearFor, istDateString } from "../src/services/documentNumber";

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

// ---- issue step: user-chosen date, validation, atomic claim -------------------------------
const todayIst = () => istDateString(new Date());
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function fakeIssue(t: any, opts: { sourceProforma?: { invoiceNumber: string; issueDate: Date } } = {}) {
  const state = { status: "draft", counter: 4, upserts: 0, updates: [] as any[] };
  const draft = () => ({ id: "d1", docType: "tax_invoice", status: "draft", invoiceNumber: "DRAFT-x", sourceProformaId: opts.sourceProforma ? "pi16" : null });
  fakePrisma(t, null);
  const inv = (prisma as any).invoice;
  // findUnique always sees the draft (simulates two requests racing past the pre-check)
  inv.findUnique = async (a: any) => (a.where.id === "pi16" ? opts.sourceProforma ?? null : draft());
  inv.updateMany = async (a: any) => {
    await new Promise((r) => setTimeout(r, 5));
    if (state.status !== a.where.status) return { count: 0 };
    state.status = a.data.status;
    return { count: 1 };
  };
  inv.update = async (a: any) => { state.updates.push(a.data); return { id: "d1", ...a.data, customer: { contacts: [] } }; };
  replace(t, "documentSequence", { upsert: async (a: any) => { state.upserts++; state.counter++; (state as any).lastWhere = a.where; return { lastNumber: state.counter }; } });
  return state;
}
async function issuer(t: any) {
  const { invoicesRouter } = await import("../src/routes/invoices");
  const { signToken } = await import("../src/lib/jwt");
  const app = express(); app.use(express.json()); app.use("/invoices", invoicesRouter);
  const server = app.listen(0); t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/invoices/d1/issue`;
  const auth = `Bearer ${signToken({ userId: "u1", roleKey: "accounts" })}`;
  return (body?: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: auth }, body: body === undefined ? undefined : JSON.stringify(body) });
}

test("issue: chosen issueDate (today IST) kept; number from the tax_invoice counter", async (t) => {
  const st = fakeIssue(t);
  const res = await (await issuer(t))({ issueDate: todayIst() });
  assert.equal(res.status, 200);
  assert.equal((st as any).lastWhere.docType_fiscalYear.docType, "tax_invoice");
  assert.equal(st.updates[0].invoiceNumber, `INV/${fiscalYearFor(new Date())}/0005`);
  assert.equal(istDateString(st.updates[0].issueDate), todayIst());
});

test("issue: no issueDate defaults to now", async (t) => {
  const st = fakeIssue(t);
  const before = Date.now();
  assert.equal((await (await issuer(t))()).status, 200);
  assert.ok(Math.abs(st.updates[0].issueDate.getTime() - before) < 60_000);
});

test("issue: two concurrent issues -> one 200, one 409, counter used once (no gap)", async (t) => {
  const st = fakeIssue(t);
  const req = await issuer(t);
  const [a, b] = await Promise.all([req(), req()]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(st.upserts, 1);
  assert.equal(st.counter, 5);
  assert.equal((await req()).status, 409, "issuing again later is also 409");
  assert.equal(st.upserts, 1);
});

test("issue: bad format, impossible date, future date, previous FY (2025-26) are 400 and burn nothing", async (t) => {
  const st = fakeIssue(t);
  const req = await issuer(t);
  for (const issueDate of ["23-10-2026", "2026-10-23T00:00:00Z", 20261023, "2026-02-30", addDays(todayIst(), 1), "2026-03-31", "2025-10-23"]) {
    assert.equal((await req({ issueDate })).status, 400, String(issueDate));
  }
  assert.equal(st.upserts, 0);
  assert.equal(st.status, "draft");
});

test("issue: date before the source proforma's IST issue date is rejected; same IST day passes", async (t) => {
  // proforma issued at 01:07 UTC = 06:37 IST today -> its IST date is today
  const piIssued = new Date(`${todayIst()}T01:07:19.870Z`);
  const st = fakeIssue(t, { sourceProforma: { invoiceNumber: "PI/2026-27/0016", issueDate: piIssued } });
  const req = await issuer(t);
  const y = addDays(todayIst(), -1);
  if (fiscalYearFor(new Date(`${y}T00:00:00Z`)) === fiscalYearFor(new Date())) {
    const early = await req({ issueDate: y });
    assert.equal(early.status, 400);
    assert.match((await early.json()).error, /before proforma PI\/2026-27\/0016/);
  }
  assert.equal((await req({ issueDate: todayIst() })).status, 200);
  assert.equal(st.upserts, 1);
});

test("IST boundaries: fiscal year and calendar date follow Asia/Kolkata, not UTC", () => {
  assert.equal(fiscalYearFor(new Date("2026-03-31T18:29:59Z")), "2025-26"); // 23:59:59 IST 31 Mar
  assert.equal(fiscalYearFor(new Date("2026-03-31T18:30:00Z")), "2026-27"); // 00:00 IST 1 Apr
  assert.equal(istDateString(new Date("2026-10-14T19:00:00Z")), "2026-10-15");
  assert.equal(istDateString(new Date("2026-10-15T01:07:19Z")), "2026-10-15"); // PI/0016 issue time
});
