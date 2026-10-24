import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../src/lib/prisma";

process.env.JWT_SECRET ||= "vendor-payments-test-only-secret";

// Endpoint tests for the vendor payment TDS + attachment routes in routes/bills.ts, against a fake
// Prisma (no DB). $transaction runs its callback with the same fake, so writes are recorded below.

const D = (n: number | string) => new Prisma.Decimal(String(n));
const PNG = "data:image/png;base64,iVBORw0KGgo=";

function replace(t: any, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(prisma, key);
  Object.defineProperty(prisma, key, { configurable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(prisma, key, original);
    else Reflect.deleteProperty(prisma, key);
  });
}

interface World {
  permissions: string[];
  bill?: { id: string; supplierId: string; status: string; total: Prisma.Decimal; payments: { id: string; amount: Prisma.Decimal; tdsAmount: Prisma.Decimal | null }[] };
  payment?: Record<string, any>;
  attachment?: Record<string, any>;
}

function fakePrisma(t: any, w: World) {
  const calls: Record<string, any[]> = {};
  const log = (k: string, args: any) => { (calls[k] ??= []).push(args); };
  let seq = 0;
  replace(t, "user", {
    findUnique: async () => ({
      id: "u1", isActive: true, customerId: null, vendorId: null, vendor: null,
      role: { key: "accounts", permissions: w.permissions.map((key) => ({ permission: { key } })) },
    }),
  });
  replace(t, "supplier", { findUnique: async () => ({ id: "s1" }) });
  replace(t, "order", { findMany: async () => [] });
  replace(t, "bill", {
    findUnique: async () => w.bill ?? null,
    update: async (args: any) => { log("bill.update", args); return { ...w.bill, ...args.data }; },
  });
  replace(t, "billAuditLog", { create: async (args: any) => { log("billAuditLog.create", args); return {}; } });
  replace(t, "paymentMade", {
    create: async (args: any) => { log("paymentMade.create", args); return { id: `pm${++seq}`, ...args.data }; },
    findMany: async (args: any) => { log("paymentMade.findMany", args); return [{ id: "pm1", amount: D(900), tdsAmount: D(100), attachments: [{ id: "a1", fileName: "utr.png", mimeType: "image/png", sizeBytes: 9 }] }]; },
    findUnique: async (args: any) => { log("paymentMade.findUnique", args); return w.payment ?? null; },
    update: async (args: any) => { log("paymentMade.update", args); return { ...w.payment, ...args.data }; },
  });
  replace(t, "paymentMadeAttachment", {
    findUnique: async (args: any) => { log("paymentMadeAttachment.findUnique", args); return w.attachment ?? null; },
    createMany: async (args: any) => { log("paymentMadeAttachment.createMany", args); return { count: args.data.length }; },
    deleteMany: async (args: any) => { log("paymentMadeAttachment.deleteMany", args); return { count: w.attachment ? 1 : 0 }; },
  });
  replace(t, "$transaction", async (fn: any) => fn(prisma));
  return calls;
}

async function serve(t: any) {
  const { billsRouter } = await import("../src/routes/bills");
  const { signToken } = await import("../src/lib/jwt");
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/bills", billsRouter);
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = signToken({ userId: "u1", roleKey: "accounts" });
  return (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
}

const approvedBill = (payments: NonNullable<World["bill"]>["payments"] = []) => ({ id: "b1", supplierId: "s1", status: "approved", total: D(1000), payments });
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

test("POST /bills/payments: cash + TDS settles the bill exactly; TDS stored on the bill row", async (t) => {
  const calls = fakePrisma(t, { permissions: [PERMISSION_KEY.RECORD_PAYMENTS], bill: approvedBill() });
  const req = await serve(t);
  const res = await req("/bills/payments", post({ supplierId: "s1", billId: "b1", amount: 900, tdsAmount: 100, tdsCertificateRef: "16A-7", method: "bank_transfer" }));
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.equal(out.status, "paid");
  assert.equal(Number(out.advanceAmount), 0);
  assert.equal(out.paymentId, "pm1");
  assert.equal(calls["paymentMade.create"].length, 1);
  const row = calls["paymentMade.create"][0].data;
  assert.equal([row.billId, row.amount.toString(), row.tdsAmount.toString(), row.tdsCertificateRef].join("|"), "b1|900|100|16A-7");
  assert.match(calls["billAuditLog.create"][0].data.summary, /\+ TDS Rs 100\.00/);
});

test("POST /bills/payments: excess cash beyond (outstanding - TDS) becomes a TDS-free advance", async (t) => {
  const calls = fakePrisma(t, { permissions: [PERMISSION_KEY.RECORD_PAYMENTS], bill: approvedBill([{ id: "old", amount: D(400), tdsAmount: D(0) }]) });
  const req = await serve(t);
  const res = await req("/bills/payments", post({ supplierId: "s1", billId: "b1", amount: 600, tdsAmount: 50, method: "upi", attachments: [{ fileName: "utr.png", mimeType: "image/png", dataUrl: PNG }] }));
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.equal(Number(out.advanceAmount), 50);
  const [billRow, advance] = calls["paymentMade.create"].map((c) => c.data);
  assert.equal(billRow.amount.toString(), "550");
  assert.equal(billRow.tdsAmount.toString(), "50");
  assert.equal(billRow.attachments.create[0].sizeBytes, 9, "documents go on the bill row");
  assert.equal(advance.billId, undefined);
  assert.equal(advance.amount.toString(), "50");
  assert.equal(advance.tdsAmount, undefined, "advance carries no TDS");
  assert.equal(advance.attachments, undefined);
  assert.equal(calls["bill.update"][0].data.status, "paid");
});

test("POST /bills/payments: TDS over the outstanding balance, or on an advance, is a 400", async (t) => {
  const calls = fakePrisma(t, { permissions: [PERMISSION_KEY.RECORD_PAYMENTS], bill: approvedBill([{ id: "old", amount: D(950), tdsAmount: null }]) });
  const req = await serve(t);
  const over = await req("/bills/payments", post({ supplierId: "s1", billId: "b1", amount: 10, tdsAmount: 60, method: "upi" }));
  assert.equal(over.status, 400);
  assert.match((await over.json()).error, /exceeds the bill's outstanding balance/);
  const advance = await req("/bills/payments", post({ supplierId: "s1", amount: 10, tdsAmount: 1, method: "upi" }));
  assert.equal(advance.status, 400);
  const badFile = await req("/bills/payments", post({ supplierId: "s1", amount: 10, method: "upi", attachments: [{ fileName: "x.png", mimeType: "application/pdf", dataUrl: PNG }] }));
  assert.equal(badFile.status, 400);
  assert.equal(calls["paymentMade.create"], undefined, "nothing written");
});

test("POST /bills/:id/payments (strict): cash + TDS may not exceed the balance", async (t) => {
  fakePrisma(t, { permissions: [PERMISSION_KEY.RECORD_PAYMENTS], bill: approvedBill() });
  const req = await serve(t);
  assert.equal((await req("/bills/b1/payments", post({ amount: 950, tdsAmount: 100, method: "cheque" }))).status, 400);
  assert.equal((await req("/bills/b1/payments", post({ amount: 900, tdsAmount: 100, method: "cheque" }))).status, 201);
});

test("POST /bills/:id/payments with TDS: stores TDS, ref and files on the payment, settles the bill, returns paymentId", async (t) => {
  const calls = fakePrisma(t, { permissions: [PERMISSION_KEY.RECORD_PAYMENTS], bill: approvedBill([{ id: "old", amount: D(300), tdsAmount: null }]) });
  const req = await serve(t);
  const res = await req("/bills/b1/payments", post({
    amount: 630, tdsAmount: 70, tdsCertificateRef: "16A-9", method: "bank_transfer", reference: "UTR1",
    attachments: [{ fileName: "advice.png", mimeType: "image/png", dataUrl: PNG }],
  }));
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.equal(out.status, "paid");
  assert.equal(out.paymentId, "pm1");
  const row = calls["paymentMade.create"][0].data;
  assert.equal([row.billId, row.amount.toString(), row.tdsAmount.toString(), row.tdsCertificateRef].join("|"), "b1|630|70|16A-9");
  assert.equal(row.attachments.create.length, 1);
  assert.equal(calls["bill.update"][0].data.status, "paid");
  assert.match(calls["billAuditLog.create"][0].data.summary, /\+ TDS Rs 70\.00/);
});

test("POST /bills/:id/payments with TDS: excess is refused and nothing is written", async (t) => {
  const calls = fakePrisma(t, { permissions: [PERMISSION_KEY.RECORD_PAYMENTS], bill: approvedBill([{ id: "old", amount: D(300), tdsAmount: D(100) }]) });
  const req = await serve(t);
  const cashPlusTds = await req("/bills/b1/payments", post({ amount: 601, tdsAmount: 0, method: "upi" }));
  assert.equal(cashPlusTds.status, 400);
  assert.match((await cashPlusTds.json()).error, /exceeds the outstanding balance/);
  const tdsOnly = await req("/bills/b1/payments", post({ amount: 1, tdsAmount: 601, method: "upi" }));
  assert.equal(tdsOnly.status, 400);
  assert.match((await tdsOnly.json()).error, /TDS .* exceeds the bill's outstanding balance/);
  const both = await req("/bills/b1/payments", post({ amount: 550, tdsAmount: 51, method: "upi" }));
  assert.equal(both.status, 400);
  assert.equal(calls["paymentMade.create"], undefined, "nothing written");
  assert.equal(calls["bill.update"], undefined);
});

test("GET /bills/payments lists attachment metadata only - never the file bytes", async (t) => {
  const calls = fakePrisma(t, { permissions: [PERMISSION_KEY.VIEW_LEDGERS] });
  const req = await serve(t);
  const res = await req("/bills/payments");
  assert.equal(res.status, 200);
  const select = calls["paymentMade.findMany"][0].include.attachments.select;
  assert.equal(select.dataUrl, undefined);
  assert.deepEqual(Object.keys(select).sort(), ["createdAt", "fileName", "id", "mimeType", "sizeBytes"]);
  const [row] = await res.json();
  assert.equal(row.tdsAmount, "100");
  assert.equal("dataUrl" in row.attachments[0], false);
  // and the bytes are omitted globally, like the company logo
  const src = readFileSync(join(__dirname, "../src/lib/prisma.ts"), "utf8");
  assert.match(src, /paymentMadeAttachment:\s*\{\s*dataUrl:\s*true\s*\}/);
});

test("GET attachment download: only route that reads bytes; scoped to its payment", async (t) => {
  const calls = fakePrisma(t, {
    permissions: [PERMISSION_KEY.APPROVE_VENDOR_INVOICE],
    attachment: { id: "a1", paymentMadeId: "pm1", fileName: "utr.png", mimeType: "image/png", dataUrl: PNG },
  });
  const req = await serve(t);
  const res = await req("/bills/payments/pm1/attachments/a1?download=1");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.match(res.headers.get("content-disposition")!, /^attachment; filename="utr.png"/);
  assert.equal(Buffer.from(await res.arrayBuffer()).length, 8);
  assert.deepEqual(calls["paymentMadeAttachment.findUnique"][0].omit, { dataUrl: false });
  assert.match((await req("/bills/payments/pm1/attachments/a1")).headers.get("content-disposition")!, /^inline;/);
  assert.equal((await req("/bills/payments/OTHER/attachments/a1")).status, 404);
});

test("PATCH /bills/payments/:id: TDS edit re-validated, bill status re-derived and audited", async (t) => {
  const bill = { id: "b1", supplierId: "s1", status: "partially_paid", total: D(1000), payments: [{ id: "other", amount: D(500), tdsAmount: D(0) }, { id: "pm1", amount: D(400), tdsAmount: D(0) }] };
  const w: World = { permissions: [PERMISSION_KEY.RECORD_PAYMENTS], payment: { id: "pm1", amount: D(400), tdsAmount: D(0), billId: "b1", bill, attachments: [{ id: "a1" }] } };
  const calls = fakePrisma(t, w);
  const req = await serve(t);
  const patch = (body: unknown) => req("/bills/payments/pm1", { method: "PATCH", body: JSON.stringify(body) });

  const tooMuch = await patch({ tdsAmount: 101 });
  assert.equal(tooMuch.status, 400);
  assert.match((await tooMuch.json()).error, /more than the bill total/);

  const ok = await patch({ tdsAmount: 100, tdsCertificateRef: "16A-9", removeAttachmentIds: ["a1", "not-mine"], attachments: [{ fileName: "16a.pdf", mimeType: "application/pdf", dataUrl: "data:application/pdf;base64,JVBERi0=" }] });
  assert.equal(ok.status, 200);
  const upd = calls["paymentMade.update"][0].data;
  assert.equal(upd.tdsAmount.toString(), "100");
  assert.equal(upd.tdsCertificateRef, "16A-9");
  assert.equal(upd.amount, undefined, "cash amount is not editable");
  assert.equal(upd.attachments.create[0].fileName, "16a.pdf");
  assert.deepEqual(calls["paymentMadeAttachment.deleteMany"][0].where, { id: { in: ["a1"] }, paymentMadeId: "pm1" });
  assert.equal(calls["bill.update"][0].data.status, "paid");
  assert.match(calls["billAuditLog.create"][0].data.summary, /TDS Rs 0\.00 -> Rs 100\.00; Status: partially_paid -> paid/);
});

test("PATCH: TDS on an advance is refused; notes-only edit does not touch the bill", async (t) => {
  const w: World = { permissions: [PERMISSION_KEY.RECORD_PAYMENTS], payment: { id: "pm2", amount: D(300), tdsAmount: null, billId: null, bill: null, attachments: [] } };
  const calls = fakePrisma(t, w);
  const req = await serve(t);
  assert.equal((await req("/bills/payments/pm2", { method: "PATCH", body: JSON.stringify({ tdsAmount: 5 }) })).status, 400);
  assert.equal((await req("/bills/payments/pm2", { method: "PATCH", body: JSON.stringify({ notes: "UTR fixed" }) })).status, 200);
  assert.equal(calls["bill.update"], undefined);
  assert.equal(calls["billAuditLog.create"], undefined);
});

test("permissions mirror the existing vendor payment routes: viewers cannot write", async (t) => {
  fakePrisma(t, { permissions: [PERMISSION_KEY.VIEW_LEDGERS], payment: { id: "pm1", amount: D(1), tdsAmount: null, bill: null, attachments: [] } });
  const req = await serve(t);
  assert.equal((await req("/bills/payments")).status, 200);
  assert.equal((await req("/bills/payments/pm1", { method: "PATCH", body: JSON.stringify({ notes: "x" }) })).status, 403);
  assert.equal((await req("/bills/payments", post({ supplierId: "s1", amount: 10, method: "upi" }))).status, 403);
  assert.equal((await req("/bills/payments/pm1/attachments", post({ attachments: [{ fileName: "a.png", mimeType: "image/png", dataUrl: PNG }] }))).status, 403);
  assert.equal((await req("/bills/payments/pm1/attachments/a1", { method: "DELETE" })).status, 403);
});

test("POST/DELETE attachments on an existing payment", async (t) => {
  const calls = fakePrisma(t, { permissions: [PERMISSION_KEY.RECORD_PAYMENTS], payment: { id: "pm1", _count: { attachments: 4 } }, attachment: { id: "a1" } });
  const req = await serve(t);
  const add = (n: number) => req("/bills/payments/pm1/attachments", post({ attachments: Array.from({ length: n }, (_, i) => ({ fileName: `f${i}.png`, mimeType: "image/png", dataUrl: PNG })) }));
  assert.equal((await add(2)).status, 400, "would exceed 5 per payment");
  assert.equal((await add(1)).status, 201);
  assert.equal(calls["paymentMadeAttachment.createMany"][0].data[0].paymentMadeId, "pm1");
  assert.equal((await req("/bills/payments/pm1/attachments/a1", { method: "DELETE" })).status, 204);
});
