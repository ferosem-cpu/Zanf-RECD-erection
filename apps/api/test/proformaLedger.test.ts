import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { buildCustomerLedger } from "../src/services/ledger";

test("customer ledger excludes proformas and retains advance payments", async (t) => {
  const replace = (key: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { configurable: true, value });
    t.after(() => original ? Object.defineProperty(prisma, key, original) : Reflect.deleteProperty(prisma, key));
  };
  const date = new Date("2026-01-01T00:00:00Z");
  const docs = [
    { id: "pi", invoiceNumber: "PI-1", issueDate: date, total: new Prisma.Decimal(1000), docType: "proforma", status: "issued" },
    { id: "tax", invoiceNumber: "INV-1", issueDate: date, total: new Prisma.Decimal(600), docType: "tax_invoice", status: "issued" },
  ];
  replace("customer", { findUniqueOrThrow: async () => ({ id: "c1", name: "Customer", openingBalance: 0, openingBalanceDate: null }) });
  replace("invoice", { findMany: async ({ where }: any) => docs.filter((d) => d.docType === where.docType && where.status.in.includes(d.status)) });
  replace("paymentReceived", { findMany: async () => [{ id: "p1", amount: new Prisma.Decimal(200), tdsAmount: new Prisma.Decimal(0), receivedDate: date, invoice: null, allocations: [] }] });
  replace("creditNote", { findMany: async () => [] });

  const statement = await buildCustomerLedger("c1");
  assert.deepEqual(statement.entries.filter((e) => e.type === "invoice").map((e) => e.refNumber), ["INV-1"]);
  assert.equal(statement.entries.find((e) => e.type === "payment")?.refNumber, "Advance");
  assert.equal(statement.closingBalance.toString(), "400");
});
