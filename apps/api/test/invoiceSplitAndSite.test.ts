import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPercentSplits } from "../src/agent/lineSplit";
import { invoiceSiteInfo, siteFromLineDescription } from "../src/agent/invoiceSite";
import { summarizeReceivables } from "../src/agent/tools/zanAppFinanceTools";

// Regression: the model split 65000 by 63.85/10.77/6.15/19.23 % and got 41,155 / 6,995 / 4,015 /
// 12,535 instead of the exact figures, which the user fixed by hand. The app now does the maths.

const pcts = [63.85, 10.77, 6.15, 19.23];

test("percentage split gives exact amounts that add up to the total (65000)", () => {
  const lines = pcts.map((splitPct) => ({ splitTotal: 65000, splitPct }) as any);
  const r = applyPercentSplits(lines);
  assert.ok("notes" in r);
  assert.deepEqual(lines.map((l) => l.unitPrice), [41502.5, 7000.5, 3997.5, 12499.5]);
  assert.equal(lines.reduce((s, l) => s + l.unitPrice, 0), 65000);
  assert.ok(lines.every((l) => l.quantity === 1));
});

test("two groups with different totals are split independently (380 and 500 KVA)", () => {
  const lines = [...pcts.map((splitPct) => ({ splitTotal: 65000, splitPct })), ...pcts.map((splitPct) => ({ splitTotal: 100000, splitPct }))] as any[];
  applyPercentSplits(lines);
  assert.deepEqual(lines.slice(4).map((l) => l.unitPrice), [63850, 10770, 6150, 19230]);
  assert.equal(lines.slice(0, 4).reduce((s, l) => s + l.unitPrice, 0), 65000);
});

test("rounding is absorbed by the last line so a 100% split is exact", () => {
  const lines = [33.33, 33.33, 33.34].map((splitPct) => ({ splitTotal: 100, splitPct })) as any[];
  applyPercentSplits(lines);
  assert.equal(Math.round(lines.reduce((s, l) => s + l.unitPrice, 0) * 100) / 100, 100);
  const odd = [1, 1, 1].map(() => ({ splitTotal: 100, splitPct: 100 / 3 })) as any[];
  applyPercentSplits(odd);
  assert.equal(Math.round(odd.reduce((s, l) => s + l.unitPrice, 0) * 100) / 100, 100);
});

test("percentages that do not add to 100 are flagged, not hidden", () => {
  const lines = [60, 30].map((splitPct) => ({ splitTotal: 1000, splitPct })) as any[];
  const r = applyPercentSplits(lines) as { notes: string[] };
  assert.deepEqual(lines.map((l) => l.unitPrice), [600, 300]);
  assert.match(r.notes[0], /90%/);
});

test("splitTotal without splitPct (or the reverse) is an error; plain lines are untouched", () => {
  assert.ok("error" in applyPercentSplits([{ splitTotal: 100 }] as any));
  assert.ok("error" in applyPercentSplits([{ splitPct: 10 }] as any));
  assert.ok("error" in applyPercentSplits([{ splitTotal: 100, splitPct: 150 }] as any));
  const plain = [{ quantity: 2, unitPrice: 50 }];
  assert.deepEqual(applyPercentSplits(plain), { notes: [] });
  assert.deepEqual(plain, [{ quantity: 2, unitPrice: 50 }]);
});

// Regression: receivables had no site, so the model repeated one invented site on every row.

test("siteFromLineDescription takes the text after the service name and drops the KVA tag", () => {
  assert.equal(siteFromLineDescription("Dismantling & Mechanical Fabrication - BOSTIK, Bommasandra Industrial Area, Bangalore (380 KVA)"), "BOSTIK, Bommasandra Industrial Area, Bangalore");
  assert.equal(siteFromLineDescription("Thermal Insulation & Painting – VRL, Hubli"), "VRL, Hubli");
  assert.equal(siteFromLineDescription("Transportation charges"), null);
  assert.equal(siteFromLineDescription(undefined), null);
});

test("invoiceSiteInfo prefers the linked order's site, else the line description, else nothing", () => {
  const lines = [{ description: "Panel board fixing - BOSTIK, Bangalore" }];
  const withOrder = invoiceSiteInfo({ order: { orderNumber: "ORD-1", site: { id: "s1", companyName: "VRL", address: "Hubli" } }, lineItems: lines });
  assert.equal(withOrder.siteSource, "order");
  assert.deepEqual(withOrder.site, { id: "s1", siteName: "VRL", address: "Hubli" });
  const noOrder = invoiceSiteInfo({ order: null, lineItems: lines }) as any;
  assert.equal(noOrder.siteSource, "line_description");
  assert.equal(noOrder.siteFromLineDescription, "BOSTIK, Bangalore");
  assert.equal(invoiceSiteInfo({ order: null, lineItems: [] }).siteSource, null);
});

test("each receivable row keeps its own site", () => {
  const row = (id: string, siteName: string) => ({
    id, invoiceNumber: id, docType: "proforma", customerId: "c", customer: "Ethen",
    issueDate: new Date("2026-10-01"), dueDate: new Date("2026-10-30"), subtotal: 100, total: 118, creditNoteTotal: 0, settled: 0,
    orderNumber: null, site: { id: `site-${siteName}`, siteName, address: null }, siteSource: "order" as const,
  });
  const out = summarizeReceivables([row("PI-1", "BPCL"), row("PI-2", "VRL")], new Date("2026-10-16")) as any;
  const bySite = Object.fromEntries(out.invoices.map((i: any) => [i.invoiceNumber, i.site.siteName]));
  assert.deepEqual(bySite, { "PI-1": "BPCL", "PI-2": "VRL" });
});
