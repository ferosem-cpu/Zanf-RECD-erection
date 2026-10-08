import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { buildStatement, type RawMovement } from "../src/services/ledger";

const dec = (n: number | string) => new Prisma.Decimal(String(n));
const day = (s: string) => new Date(`${s}T00:00:00Z`);

function invoice(id: string, date: string, amount: number): RawMovement {
  return { date: day(date), type: "invoice", refNumber: id, refId: id, debit: dec(amount), credit: dec(0) };
}
function payment(id: string, date: string, amount: number): RawMovement {
  return { date: day(date), type: "payment", refNumber: id, refId: id, debit: dec(0), credit: dec(amount) };
}

const movements = [payment("p1", "2026-05-02", 300), invoice("i1", "2026-04-10", 1000)];

test("ledger: undated opening balance is shown on the first movement's date, never 1970", () => {
  const s = buildStatement("c1", "C1", dec(500), null, movements);
  const opening = s.entries[0];
  assert.equal(opening.type, "opening_balance");
  assert.equal(opening.date?.toISOString(), day("2026-04-10").toISOString());
  assert.ok(s.entries.every((e) => e.date === null || e.date.getUTCFullYear() > 1970));
  // Still sorts first and carries the balance.
  assert.deepEqual(s.entries.map((e) => [e.type, e.runningBalance.toString()]), [
    ["opening_balance", "500"],
    ["invoice", "1500"],
    ["payment", "1200"],
  ]);
  assert.equal(s.closingBalance.toString(), "1200");
});

test("ledger: undated opening balance with no movements has no date", () => {
  const s = buildStatement("c1", "C1", dec(750), null, []);
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].date, null);
  assert.equal(s.closingBalance.toString(), "750");
});

test("ledger: recorded openingBalanceDate is kept", () => {
  const s = buildStatement("c1", "C1", dec(500), day("2026-03-31"), movements);
  assert.equal(s.entries[0].date?.toISOString(), day("2026-03-31").toISOString());
});

test("ledger: undated opening balance is carried into a period starting before the first movement", () => {
  // Period opens 01 Apr; the first invoice is 10 Apr. The opening balance must still be carried in
  // (the range math treats an undated opening as before everything).
  const s = buildStatement("c1", "C1", dec(500), null, movements, day("2026-04-01"), day("2026-04-30"));
  assert.equal(s.openingBalance.toString(), "500");
  assert.deepEqual(s.entries.map((e) => e.refId), ["i1"]);
  assert.equal(s.closingBalance.toString(), "1500");
});

test("ledger: supplier-style negative opening balance is a credit row on the first movement date", () => {
  const s = buildStatement("s1", "S1", dec(-200), null, [invoice("b1", "2026-06-01", 100)]);
  assert.equal(s.entries[0].credit.toString(), "200");
  assert.equal(s.entries[0].date?.toISOString(), day("2026-06-01").toISOString());
  assert.equal(s.closingBalance.toString(), "-100");
});
