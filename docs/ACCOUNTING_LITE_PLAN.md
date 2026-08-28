# Zan-APP Accounting-Lite Module — Implementation Plan

> **Audience:** an AI coding agent (Claude Sonnet session) implementing this end-to-end.
> Read this plus `docs/HANDOVER.md` (Part B — Quick facts, Known gotchas, deploy dance)
> and `docs/FINANCE_MODULE_PLAN.md` (the existing finance module's design; its house
> rules in §1–§2 all still apply) before writing any code.

---

## 0. Context & verdict (why this scope, not a full GL)

Zan-APP already has: Quotations, Invoices (proforma + tax, gap-free per-FY GST
numbering via `DocumentSequence`, issue/cancel/edit-with-`InvoiceEditLog`),
`PaymentReceived` (incl. TDS as a payment method), Purchase Orders, vendor
bills/invoices, Customer Purchase Orders, Expenses, and a Finance dashboard with
receivables/payables aging + GST summary reports.

**Decision (final, don't re-litigate): NO double-entry general ledger.** Statutory
books stay in Tally/with the CA. This module makes the app the operational source of
truth by adding the five things the current finance module can't answer:

1. **Party ledger statements** — "show me everything with customer X / supplier Y and
   their running balance" (currently requires opening several pages and a calculator).
2. **Credit Notes / Debit Notes** — GST-compliant, currently impossible; an issued tax
   invoice with a mistake today can only be cancelled, which is wrong once reported.
3. **Payment allocation + customer advances** — a payment today MUST target exactly one
   invoice; real customers pay lump sums covering several invoices, or pay advances
   before any invoice exists.
4. **TDS tracking** — TDS is a payment *method* today, so TDS-deducted receipts distort
   the "received" figures and there's no TDS-receivable ledger to reconcile against 26AS.
5. **GST return exports** — GSTR-1 (outward) and a GSTR-3B summary as CSV, generated
   from issued tax invoices + credit notes (output) and vendor bills (input), so the CA
   stops re-keying.

Build in the phase order of §8 — Phase A is read-only and shippable alone.

---

## 1. House rules (inherited — violating these breaks production)

- **"Data, not code":** statuses/kinds are `String` columns + const objects in
  `packages/shared/src/constants.ts`, never Prisma enums.
- **Rebuild shared after every edit:** `npm run build --workspace=packages/shared`
  (consumers read `dist/`, not `src/`). Then restart the API dev server.
- **Money:** `Decimal @db.Decimal(12, 2)`. Never Float. Server recomputes all totals
  from line items; never trust client totals.
- **Every route:** `authenticate` + `requirePermission(...)`, and the same permission
  gates nav/route client-side.
- **Gap-free numbering:** anything with a statutory number (credit notes here) uses
  `nextDocumentNumber()` / `DocumentSequence`, assigned at **issue** time (drafts show
  `DRAFT-<id>`), and issued docs are never hard-deleted — only cancelled.
- **Migrations:** production schema history has drifted from local `prisma/migrations/`
  (see HANDOVER "Known gotchas"). Before writing the migration, **diff actual production
  columns via `information_schema.columns`** against `schema.prisma`; apply to
  production via the Supabase MCP `apply_migration` (project `idqzupopsuusoihpmoqc`),
  same established pattern.
- **Deploy ordering:** backend (`zan-app-api` manual deploy dance, see HANDOVER) must be
  deployed and confirmed live (`/health` → 200) **before** pushing any dependent
  `admin-web` commit. Never one commit spanning both when the frontend reads new fields
  — this caused a real production outage (2026-08-20).
- **List pages** use the shared `DataTable` component (column config + `accessorList`
  for multi-value columns); print via the existing `ReportChrome` / `.print-table`
  letterhead infrastructure — do not build new print plumbing.
- Frontend must degrade gracefully (optional chaining + fallbacks) for any field the
  currently-deployed API might not return yet.

---

## 2. Database schema additions (`apps/api/prisma/schema.prisma`)

One migration, suggested name `add_accounting_lite`. Match existing style (cuid ids,
`createdAt`, doc comments). **Check current model/field names in the live schema file
first — the models below reference existing models whose exact field names must be
confirmed in the repo, not assumed from this doc.**

```prisma
/// GST Credit Note (customer side) — reduces an issued tax invoice's effective value.
/// Own gap-free sequence: CRN/2026-27/0001 (DocumentSequence docType "credit_note").
model CreditNote {
  id            String    @id @default(cuid())
  noteNumber    String    @unique            // DRAFT-<id> until issued
  /// draft | issued | cancelled  (CREDIT_NOTE_STATUS in shared)
  status        String    @default("draft")
  customerId    String
  customer      Customer  @relation(fields: [customerId], references: [id])
  invoiceId     String                       // required: a CN always references an invoice (GST rule)
  invoice       Invoice   @relation(fields: [invoiceId], references: [id])
  /// return | rate_difference | deficiency | post_sale_discount | other  (CREDIT_NOTE_REASON)
  reason        String
  reasonNotes   String?
  issueDate     DateTime
  placeOfSupply String?
  subtotal      Decimal   @db.Decimal(12, 2)
  cgstAmount    Decimal   @db.Decimal(12, 2) @default(0)
  sgstAmount    Decimal   @db.Decimal(12, 2) @default(0)
  igstAmount    Decimal   @db.Decimal(12, 2) @default(0)
  total         Decimal   @db.Decimal(12, 2)
  createdById   String
  createdBy     User      @relation("CreditNoteCreator", fields: [createdById], references: [id])
  cancelledAt   DateTime?
  cancelReason  String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  lineItems CreditNoteLineItem[]
}

model CreditNoteLineItem {
  id           String     @id @default(cuid())
  creditNoteId String
  creditNote   CreditNote @relation(fields: [creditNoteId], references: [id], onDelete: Cascade)
  productId    String?
  product      Product?   @relation(fields: [productId], references: [id])
  description  String
  hsnCode      String                        // mandatory, same as every other line item
  quantity     Decimal    @db.Decimal(10, 2)
  unitPrice    Decimal    @db.Decimal(12, 2)
  taxRatePct   Decimal    @db.Decimal(5, 2)  @default(18)
  lineTotal    Decimal    @db.Decimal(12, 2)
  sortOrder    Int        @default(0)
}

/// Supplier-side debit note (we debit a supplier against their bill).
/// Internal record, supplier's numbering isn't ours — no DocumentSequence,
/// number is free text. Mirror CreditNote's shape minus statutory rules.
/// (Reference the vendor-bill model by its ACTUAL name in schema.prisma.)
model DebitNote {
  id           String   @id @default(cuid())
  noteNumber   String                        // internal ref, e.g. DN-0001; not statutory
  supplierId   String                        // FK to whatever the bill's party model is
  billId       String?                       // FK to the vendor bill model
  reason       String
  noteDate     DateTime
  subtotal     Decimal  @db.Decimal(12, 2)
  taxAmount    Decimal  @db.Decimal(12, 2) @default(0)
  total        Decimal  @db.Decimal(12, 2)
  notes        String?
  recordedById String
  createdAt    DateTime @default(now())
}

/// Allocation of one PaymentReceived across one or more invoices.
/// A payment with zero allocations is an on-account customer advance.
model PaymentAllocation {
  id        String          @id @default(cuid())
  paymentId String
  payment   PaymentReceived @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  invoiceId String
  invoice   Invoice         @relation(fields: [invoiceId], references: [id])
  amount    Decimal         @db.Decimal(12, 2)
  createdAt DateTime        @default(now())

  @@unique([paymentId, invoiceId])
}
```

**Modify existing models** (confirm exact current shapes first):

- `PaymentReceived`:
  - make `invoiceId` **optional** (advances have none),
  - add `customerId String` + relation (required going forward — backfill from the
    linked invoice for existing rows in the migration),
  - add `tdsAmount Decimal @db.Decimal(12,2) @default(0)` and
    `tdsCertificateRef String?` — a receipt of ₹98,000 with ₹2,000 TDS is recorded as
    amount 98000 + tdsAmount 2000, and settles ₹100,000 of invoice value.
    Keep the existing `method: "tds"` value working (legacy rows) but remove it from
    the UI's method picker; new entries express TDS via `tdsAmount` on a real method.
- `Customer`: add `openingBalance Decimal @db.Decimal(12,2) @default(0)`,
  `openingBalanceDate DateTime?` (receivable if positive). Same two fields on the
  supplier/vendor-bill party model. These anchor ledger statements without needing
  historical data entry.
- `Invoice`: back-relations (`creditNotes`, `allocations`).

**Migration data step (same migration or an immediately-following script):** for every
existing `PaymentReceived` row, create one `PaymentAllocation` for its full `amount`
against its `invoiceId`, and set `customerId` from that invoice. After this, invoice
paid-status must be computed from allocations, not from payments directly.

---

## 3. Shared package (`packages/shared/src/`)

- `constants.ts`: `CREDIT_NOTE_STATUS`, `CREDIT_NOTE_REASON`, new permission keys (§4),
  add `"credit_note"` to the finance doc-type/sequence-prefix map (`CRN`).
- `schemas.ts`: `creditNoteCreateSchema` (line items reuse the existing mandatory-HSN
  `lineItemSchema`), `debitNoteCreateSchema`,
  `paymentReceivedCreateSchema` updated: `{ customerId, amount > 0, tdsAmount ≥ 0,
  method, reference?, receivedDate, allocations: [{ invoiceId, amount > 0 }] }` with a
  refinement `sum(allocations) ≤ amount + tdsAmount`.
- Rebuild the workspace after editing.

## 4. Permissions

Reuse existing keys where natural; add only what's genuinely new. Seed idempotently:

| Key | Grants | Roles |
|---|---|---|
| `manage_credit_notes` | CRUD/issue/cancel credit & debit notes | Finance, Management, Super Admin |
| `view_ledgers` | Party ledger statements + TDS report + GST exports | Finance, Management, Super Admin |

Payment allocation changes ride on the existing `record_payments`.

---

## 5. Services (`apps/api/src/lib/` — extend, don't duplicate)

### 5.1 Invoice settlement recomputation
One exported function `recomputeInvoiceSettlement(tx, invoiceId)`:
`settled = sum(allocations.amount) + (allocated share of tdsAmount — simplest correct
rule: TDS on a payment is allocated pro-rata across that payment's allocations)`;
set `paid` / `partially_paid` accordingly. Called inside the same transaction after
every payment create/update/delete, allocation change, and credit-note issue/cancel.
An **issued credit note reduces the invoice's outstanding** (effective receivable =
`invoice.total − issued CN totals − settled`); reject allocations/CNs that would push
outstanding below zero (400).

### 5.2 Ledger statement builder (`ledger.ts`)
Pure query composition, no new tables. For a customer and date range, produce a
date-ordered entry list from existing rows:

| Source | Debit (they owe more) | Credit (they owe less) |
|---|---|---|
| Opening balance | as sign | |
| Issued tax invoice / proforma-turned… (issued docs only, never drafts) | total | |
| PaymentReceived (amount + tdsAmount) | | amount (+ TDS shown as its own line) |
| Issued CreditNote | | total |

Return `{ openingBalance, entries: [{ date, type, refNumber, refId, debit, credit, runningBalance }], closingBalance }`.
Supplier side mirrors it from POs are **not** ledger entries — only bills, payments
made, and debit notes are (a PO is a commitment, not a liability).

### 5.3 GST export builder (`gstExport.ts`)
- **GSTR-1 (B2B) CSV** for a month/quarter: one row per issued tax-invoice line-item
  group — GSTIN, party name, invoice no/date, invoice value, place of supply, rate,
  taxable value, CGST/SGST/IGST — plus a CDNR section for issued credit notes.
- **GSTR-3B summary JSON/CSV**: output tax (3.1a) from tax invoices minus credit
  notes; eligible ITC (4A) from vendor bills in the period.
- Reuse `lib/csvExport`-style dependency-free CSV generation (a client-side helper
  exists in admin-web; the API needs its own tiny server-side equivalent).

---

## 6. API routes

New/changed routers in `apps/api/src/routes/`, mounted in `index.ts`:

### `credit-notes.ts` → `/credit-notes` (`manage_credit_notes`)
- `GET /` list (filter: status, customerId), `POST /` create draft (server recomputes
  totals via the existing `computeDocumentTotals`, place-of-supply from the invoice),
  `GET /:id`, `PUT /:id` (draft only), `DELETE /:id` (draft only),
  `POST /:id/issue` (assigns `CRN/...` number, recomputes the invoice's settlement),
  `POST /:id/cancel` (body `{reason}`; recompute again).
- Validation: CN's invoice must be an **issued tax invoice** belonging to the same
  customer; total CNs against an invoice can't exceed its total.
- `/debit-notes` sub-resource: plain CRUD, no issue step.

### `payments` changes (inside the existing invoices/payments router)
- `POST /payments` (new, `record_payments`): body per §3 schema — creates the payment
  + allocations in one transaction, recomputes each touched invoice.
- Keep `POST /invoices/:id/payments` working as sugar (single full allocation to that
  invoice) so nothing existing breaks — including the agent's flows if any touch it.
- `GET /customers/:id/advances`: payments with unallocated remainder.
- `POST /payments/:id/allocations` — allocate (part of) an advance to an invoice later.
- Reject: over-allocation, allocating to draft/cancelled invoices, negative amounts.

### `ledgers.ts` → `/ledgers` (`view_ledgers`)
- `GET /ledgers/customer/:id?from=&to=` and `GET /ledgers/supplier/:id?from=&to=` —
  §5.2 output.
- `GET /ledgers/tds?fy=2026-27` — every payment with `tdsAmount > 0`: customer, date,
  invoice(s), gross, TDS, certificate ref; totals per customer. (This is the 26AS
  reconciliation view.)
- `GET /ledgers/gst/gstr1?from=&to=` and `GET /ledgers/gst/gstr3b?from=&to=` —
  return JSON; `?format=csv` streams the CSV.

Existing `/finance/summary` + receivables report must switch to the settlement math of
§5.1 (net of credit notes and allocation-based paid amounts) — verify the dashboard
numbers change consistently, don't leave two competing definitions of "outstanding".

---

## 7. Admin-web UI

Follow existing patterns exactly (`DataTable` for lists, existing modal/field CSS,
`ReportChrome` for printable reports, nav gated by permission):

| Route | Contents |
|---|---|
| `/finance/credit-notes` (+ `/new`, `/[id]`) | DataTable list; new-page pre-fills from a picked invoice (lines copied, editable down); detail with Issue/Cancel + audit-style history; Print page reusing the invoice print letterhead (title "CREDIT NOTE") |
| `/finance/payments` | All payments DataTable (customer, date, method, amount, TDS, allocated/unallocated); "Record payment" modal: pick customer → see their open invoices with outstanding → enter amount + TDS → auto-allocate oldest-first with editable per-invoice split; unallocated remainder clearly labeled "Advance" |
| `/finance/ledgers` | Party picker (customer/supplier toggle) + date range → statement table (date, particulars, ref link, debit, credit, running balance) with Print + Export CSV via the existing report chrome. **This is the highest-daily-value screen — build it first in the UI phase.** |
| `/reports/tds` | TDS register per §6, Print + CSV |
| `/reports/gst-returns` | Month/quarter picker → GSTR-1 and 3B preview tables + "Export CSV" buttons |
| Invoice detail | Show issued credit notes + net outstanding; "Create credit note" button; payment history now shows allocations (a payment row may link several invoices) |
| Customer detail | "Ledger" tab/link into `/finance/ledgers` pre-filtered |

Also: remove "TDS" from the payment-method dropdown (keep rendering legacy rows), add
TDS amount field to every record-payment surface.

**Agent (optional, only if time permits at the end):** a `get_customer_ledger` read
tool mirroring `/ledgers/customer/:id` scoping. No new write tools this phase.

---

## 8. Implementation order (each phase independently shippable)

1. **Phase A — Ledger statements (read-only, zero risk):** opening-balance fields +
   `ledger.ts` + `/ledgers/customer|supplier` + the `/finance/ledgers` page.
   No behavior changes to anything existing. Ship it.
2. **Phase B — Credit/debit notes:** schema, routes, UI, print page; settlement math
   extended to subtract issued CNs; dashboard/receivables updated to match.
3. **Phase C — Payment allocation + advances + TDS fields:** the §2 `PaymentReceived`
   changes + backfill, allocation routes, payments UI, TDS register.
4. **Phase D — GST exports:** builders + reports pages.

Per phase: `tsc --noEmit` clean in both apps, full `next build` clean, migration
diffed against real production columns before applying, backend deployed via the
manual dance and confirmed live (`/health` 200, a new route → 401 not 404, and the §5
build-output grep from HANDOVER for new route files) **before** the frontend push.
Update `docs/HANDOVER.md`'s changelog + open items at the end of each phase.

**Verification (Phase C is the dangerous one):** script an end-to-end check with real
math — invoice ₹1,00,000; payment ₹49,000 + TDS ₹1,000 allocated to it → invoice
`partially_paid`, outstanding ₹50,000; CN issued for ₹10,000 → outstanding ₹40,000;
second payment ₹60,000 (₹40,000 allocated, ₹20,000 advance) → invoice `paid`,
customer advance ₹20,000; ledger closing balance −₹20,000 (we owe them); over-allocate
attempt → 400. Also verify every pre-existing payment still shows correctly after the
backfill (spot-check production rows via the Supabase MCP before and after).

## 9. Explicitly OUT of scope (unchanged Phase-N backlog)

Double-entry GL/chart of accounts, trial balance/P&L/balance sheet, bank statement
import/reconciliation, e-invoicing (IRN/QR)/e-way bill, multi-currency, payroll,
inventory. Design keys so none of these are blocked later (they aren't — every money
movement remains a typed row).
