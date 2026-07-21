# Zan-APP Finance Module — Implementation Plan

> **Audience:** an AI coding agent (or developer) implementing this module end-to-end.
> This document is self-contained: read it plus the referenced files and you can build
> the whole module without any other context. Read `docs/HANDOVER.md` §20 for project
> background (Zan-APP is a fork of the Platino RECD tracker; §1–§19 there describe the
> inherited codebase, not this project's roadmap).

---

## 0. TL;DR of what you are building

A **finance module** for an Indian RECD (emission-control device) supply-and-erection
business, covering the full commercial document chain plus light accounting:

1. **Quotation** → sent to customer, convertible to an Order
2. **Proforma Invoice** → for collecting advance payment before dispatch
3. **Tax Invoice** (GST-compliant) → issued on dispatch/completion
4. **Payments Received** → recorded against invoices; receivables + aging
5. **Purchase Orders** → issued to suppliers/subcontractors
6. **Supplier Bills + Payments Made** → payables tracking
7. **Expenses** → simple expense book (non-PO spend)
8. **Finance dashboard + reports** → receivables, payables, GST summary
9. **Print-ready document views** → browser print-to-PDF for quotation/proforma/invoice/PO

**Explicitly OUT of scope (deferred, but keys/design must not block it):**
double-entry general ledger, bank reconciliation, e-invoicing (IRN/e-way bill APIs),
multi-currency, inventory/stock, payroll, TDS. Phase-2 candidates are listed in §11.

---

## 1. Codebase orientation (read these files first)

Repo: `D:\Projects\Zan-APP` — Turborepo monorepo, npm workspaces, TypeScript end-to-end.

| Path | What it is |
|---|---|
| `apps/api` | Express 5 + Prisma + JWT REST API |
| `apps/admin-web` | Next.js 14 App Router + Tailwind staff/customer console |
| `packages/shared` | Zod schemas, constants, DTO types shared by both |
| `apps/api/prisma/schema.prisma` | Data model |
| `apps/api/prisma/seed.ts` | Idempotent seed (roles, permissions, lookups, demo data) |
| `apps/api/src/middleware/auth.ts` | `authenticate` + `requirePermission(key)` middleware |
| `apps/api/src/index.ts` | Route mounting |
| `apps/admin-web/src/components/{Nav,AuthGuard,AuthContext}.tsx` | Permission-gated shell |
| `apps/admin-web/src/app/globals.css` | Shared responsive/UI primitives (see §8) |
| `packages/shared/src/constants.ts` | `PERMISSION_KEY`, `ROLE_KEY`, status constants |

**House rules you MUST follow:**

- **"Data, not code":** anything that might grow new values later (expense categories,
  payment methods) is a seeded lookup row or a shared string constant — never a Prisma
  enum. Statuses follow the existing pattern: plain `String` columns + a `..._STATUS`
  const object in `packages/shared/src/constants.ts` (see `COMPLAINT_STATUS`).
- **After editing `packages/shared`, rebuild it:** `npm run build --workspace=packages/shared`.
  The API and web read the compiled `dist/` output; forgetting this makes new constants
  read as `undefined` at runtime.
- **Every API route** is guarded by `authenticate` + `requirePermission(...)`; the web UI
  additionally gates nav items and routes by the same permission keys. Both layers, always.
- **Money:** `Decimal @db.Decimal(12, 2)` (same as `Order.value`). Never `Float`.
- **Ports (local dev):** API `:4011` (`apps/api/.env` `PORT=4011`), web `next dev -p 6011` (`apps/admin-web/package.json`). Deliberately different from `4001`/`6001` to avoid colliding with the Platino RECD tracker repo's identically-ported dev servers - see `docs/HANDOVER.md` §25. Use `preview_start(name: "zan-api")` / `preview_start(name: "zan-admin-web")`, never the bare `"api"`/`"admin-web"` launch configs.
- **Windows note:** if `prisma generate` fails with `EPERM` on the query engine DLL,
  stop the dev servers first (a running node process holds the DLL).

**Prerequisite — this project has no database yet.** Zan-APP must NOT point at
Platino's Supabase project. Before migrating, ensure `apps/api/.env` has a
`DATABASE_URL`/`DIRECT_URL` for a Zan-APP-owned Postgres (new Supabase project or
local Postgres 16). If none exists, set up local Postgres, run
`prisma migrate dev`, and seed. Flag this to the user if credentials are needed.

---

## 2. Decided scope & rationale (decisions are final; don't re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Proforma vs Tax Invoice | One `Invoice` model with `docType: "proforma" \| "tax_invoice"`, **separate number sequences** | Identical structure; GST law requires tax-invoice numbers to be their own consecutive series |
| Document numbering | New `DocumentSequence` table, atomic per-fiscal-year counters (Indian FY, Apr–Mar), e.g. `INV/2026-27/0001` | The existing `Math.random()` order-number pattern is collision-prone and illegal for GST invoices, which must be sequential |
| Tax model | GST line-level rates; document stores CGST/SGST vs IGST split, chosen by comparing company state vs customer `placeOfSupply` state | Standard Indian B2B requirement; no external API needed |
| PDF generation | **Print-optimized HTML route** (`/print` pages, `@media print` CSS, browser print-to-PDF) | Zero new dependencies, works on Vercel serverless, good enough for Phase 1 |
| Suppliers | New `Supplier` model, separate from `Vendor` | `Vendor` carries an erection-specific approval workflow; a supplier of steel/pipes shouldn't go through vendor approval. Optional `Supplier.vendorId` links a supplier record to an erection vendor for subcontract POs |
| Accounting depth | Documents + payments + expense book + computed reports. **No double-entry ledger** in Phase 1 | Delivers 90 % of the business value; a GL can be layered on later because every money movement is already a typed row |
| Payments | `PaymentReceived` requires an `invoiceId` (advances are taken against a proforma); `PaymentMade` goes against a `Bill` or standalone to a supplier | Keeps allocation logic trivial in Phase 1 |
| Customer-facing | Customer portal gets a read-only "My invoices" section showing issued invoices + payment status | Cheap win reusing the existing portal auth |
| Permissions | Six new granular permission keys (§4) | Matches existing granularity (`manage_orders`, `manage_vendors`, …); finally gives the seeded-but-empty **Finance** role its modules |

---

## 3. Database schema (add to `apps/api/prisma/schema.prisma`)

One migration, name suggestion: `add_finance_module`. Models below are specifications —
match existing schema style (cuid ids, `createdAt`, relation naming, doc comments).

```prisma
// ---------------------------------------------------------------------------
// Finance module
// ---------------------------------------------------------------------------

/// Atomic per-fiscal-year number sequences for finance documents.
/// docType: "quotation" | "proforma" | "tax_invoice" | "purchase_order"
/// fiscalYear: "2026-27" (Indian FY, April–March)
model DocumentSequence {
  id         String @id @default(cuid())
  docType    String
  fiscalYear String
  lastNumber Int    @default(0)

  @@unique([docType, fiscalYear])
}

/// Material/service supplier (steel, piping, transport, subcontract labour).
/// Distinct from Vendor (erection subcontractors with an approval workflow);
/// vendorId optionally links a supplier record to an approved Vendor so POs
/// can be raised for subcontracted erection work.
model Supplier {
  id           String   @id @default(cuid())
  name         String
  gstin        String?
  state        String?
  address      String?
  contactName  String?
  contactEmail String?
  contactPhone String?
  vendorId     String?  @unique
  vendor       Vendor?  @relation(fields: [vendorId], references: [id])
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())

  purchaseOrders PurchaseOrder[]
  bills          Bill[]
  paymentsMade   PaymentMade[]
}

model Quotation {
  id             String    @id @default(cuid())
  quoteNumber    String    @unique          // QTN/2026-27/0001
  customerId     String
  customer       Customer  @relation(fields: [customerId], references: [id])
  /// draft | sent | accepted | rejected | expired | converted  (QUOTATION_STATUS in shared)
  status         String    @default("draft")
  issueDate      DateTime
  validUntil     DateTime?
  placeOfSupply  String?                    // customer state; drives CGST/SGST vs IGST
  subtotal       Decimal   @db.Decimal(12, 2)
  discountAmount Decimal   @db.Decimal(12, 2) @default(0)
  cgstAmount     Decimal   @db.Decimal(12, 2) @default(0)
  sgstAmount     Decimal   @db.Decimal(12, 2) @default(0)
  igstAmount     Decimal   @db.Decimal(12, 2) @default(0)
  total          Decimal   @db.Decimal(12, 2)
  notes          String?
  terms          String?
  createdById    String
  createdBy      User      @relation("QuotationCreator", fields: [createdById], references: [id])
  /// Set when "Convert to order" is used; links the resulting Order.
  convertedOrderId String? @unique
  convertedOrder   Order?  @relation(fields: [convertedOrderId], references: [id])
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  lineItems QuotationLineItem[]
  invoices  Invoice[]
}

model QuotationLineItem {
  id           String    @id @default(cuid())
  quotationId  String
  quotation    Quotation @relation(fields: [quotationId], references: [id], onDelete: Cascade)
  productId    String?
  product      Product?  @relation(fields: [productId], references: [id])
  description  String
  hsnCode      String?
  quantity     Decimal   @db.Decimal(10, 2)
  unitPrice    Decimal   @db.Decimal(12, 2)
  discountPct  Decimal   @db.Decimal(5, 2)  @default(0)
  taxRatePct   Decimal   @db.Decimal(5, 2)  @default(18)
  lineTotal    Decimal   @db.Decimal(12, 2) // qty * unitPrice * (1-disc%) — pre-tax
  sortOrder    Int       @default(0)
}

model Invoice {
  id             String    @id @default(cuid())
  invoiceNumber  String    @unique          // PI/2026-27/0001 or INV/2026-27/0001
  /// "proforma" | "tax_invoice"  (INVOICE_DOC_TYPE in shared)
  docType        String
  customerId     String
  customer       Customer  @relation(fields: [customerId], references: [id])
  orderId        String?
  order          Order?    @relation(fields: [orderId], references: [id])
  quotationId    String?
  quotation      Quotation? @relation(fields: [quotationId], references: [id])
  /// draft | issued | partially_paid | paid | cancelled  (INVOICE_STATUS in shared;
  /// "overdue" is computed at read time from dueDate + status, never stored)
  status         String    @default("draft")
  issueDate      DateTime
  dueDate        DateTime?
  placeOfSupply  String?
  subtotal       Decimal   @db.Decimal(12, 2)
  discountAmount Decimal   @db.Decimal(12, 2) @default(0)
  cgstAmount     Decimal   @db.Decimal(12, 2) @default(0)
  sgstAmount     Decimal   @db.Decimal(12, 2) @default(0)
  igstAmount     Decimal   @db.Decimal(12, 2) @default(0)
  total          Decimal   @db.Decimal(12, 2)
  notes          String?
  terms          String?
  createdById    String
  createdBy      User      @relation("InvoiceCreator", fields: [createdById], references: [id])
  cancelledAt    DateTime?
  cancelReason   String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  lineItems InvoiceLineItem[]
  payments  PaymentReceived[]
}

model InvoiceLineItem {
  id          String  @id @default(cuid())
  invoiceId   String
  invoice     Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  productId   String?
  product     Product? @relation(fields: [productId], references: [id])
  description String
  hsnCode     String?
  quantity    Decimal @db.Decimal(10, 2)
  unitPrice   Decimal @db.Decimal(12, 2)
  discountPct Decimal @db.Decimal(5, 2)  @default(0)
  taxRatePct  Decimal @db.Decimal(5, 2)  @default(18)
  lineTotal   Decimal @db.Decimal(12, 2)
  sortOrder   Int     @default(0)
}

model PaymentReceived {
  id           String   @id @default(cuid())
  invoiceId    String
  invoice      Invoice  @relation(fields: [invoiceId], references: [id])
  amount       Decimal  @db.Decimal(12, 2)
  /// bank_transfer | upi | cheque | cash | other  (PAYMENT_METHOD in shared)
  method       String
  reference    String?  // UTR / cheque no / UPI ref
  receivedDate DateTime
  notes        String?
  recordedById String
  recordedBy   User     @relation("PaymentReceivedRecorder", fields: [recordedById], references: [id])
  createdAt    DateTime @default(now())
}

model PurchaseOrder {
  id           String   @id @default(cuid())
  poNumber     String   @unique             // PO/2026-27/0001
  supplierId   String
  supplier     Supplier @relation(fields: [supplierId], references: [id])
  /// draft | issued | partially_received | received | cancelled | closed  (PO_STATUS in shared)
  status       String   @default("draft")
  orderDate    DateTime
  expectedDate DateTime?
  /// Optional job-costing links: which customer order / site this spend is for.
  orderId      String?
  order        Order?   @relation(fields: [orderId], references: [id])
  siteId       String?
  site         Site?    @relation(fields: [siteId], references: [id])
  subtotal     Decimal  @db.Decimal(12, 2)
  cgstAmount   Decimal  @db.Decimal(12, 2) @default(0)
  sgstAmount   Decimal  @db.Decimal(12, 2) @default(0)
  igstAmount   Decimal  @db.Decimal(12, 2) @default(0)
  total        Decimal  @db.Decimal(12, 2)
  notes        String?
  terms        String?
  createdById  String
  createdBy    User     @relation("PurchaseOrderCreator", fields: [createdById], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  lineItems PurchaseOrderLineItem[]
  bills     Bill[]
}

model PurchaseOrderLineItem {
  id              String        @id @default(cuid())
  purchaseOrderId String
  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  description     String
  hsnCode         String?
  quantity        Decimal       @db.Decimal(10, 2)
  unitPrice       Decimal       @db.Decimal(12, 2)
  taxRatePct      Decimal       @db.Decimal(5, 2)  @default(18)
  lineTotal       Decimal       @db.Decimal(12, 2)
  sortOrder       Int           @default(0)
}

/// A bill received FROM a supplier (their invoice to us). billNumber is the
/// supplier's own number — unique per supplier, not globally.
model Bill {
  id              String         @id @default(cuid())
  billNumber      String
  supplierId      String
  supplier        Supplier       @relation(fields: [supplierId], references: [id])
  purchaseOrderId String?
  purchaseOrder   PurchaseOrder? @relation(fields: [purchaseOrderId], references: [id])
  /// unpaid | partially_paid | paid | cancelled  (BILL_STATUS in shared)
  status          String         @default("unpaid")
  billDate        DateTime
  dueDate         DateTime?
  subtotal        Decimal        @db.Decimal(12, 2)
  taxAmount       Decimal        @db.Decimal(12, 2) @default(0)
  total           Decimal        @db.Decimal(12, 2)
  notes           String?
  recordedById    String
  recordedBy      User           @relation("BillRecorder", fields: [recordedById], references: [id])
  createdAt       DateTime       @default(now())

  payments PaymentMade[]

  @@unique([supplierId, billNumber])
}

model PaymentMade {
  id           String    @id @default(cuid())
  billId       String?
  bill         Bill?     @relation(fields: [billId], references: [id])
  supplierId   String
  supplier     Supplier  @relation(fields: [supplierId], references: [id])
  amount       Decimal   @db.Decimal(12, 2)
  method       String
  reference    String?
  paidDate     DateTime
  notes        String?
  recordedById String
  recordedBy   User      @relation("PaymentMadeRecorder", fields: [recordedById], references: [id])
  createdAt    DateTime  @default(now())
}

/// Lookup table (data-not-code): expense categories are seeded rows so new
/// categories are a DB insert, not a code change.
model ExpenseCategory {
  id            String   @id @default(cuid())
  key           String   @unique
  label         String
  sequenceOrder Int
  createdAt     DateTime @default(now())

  expenses Expense[]
}

/// Simple expense book for non-PO spend (fuel, travel, site consumables, misc).
model Expense {
  id           String          @id @default(cuid())
  categoryId   String
  category     ExpenseCategory @relation(fields: [categoryId], references: [id])
  description  String
  amount       Decimal         @db.Decimal(12, 2)
  expenseDate  DateTime
  method       String          // PAYMENT_METHOD keys
  siteId       String?
  site         Site?           @relation(fields: [siteId], references: [id])
  receiptUrl   String?         // base64 data-URL, same convention as SitePhoto
  recordedById String
  recordedBy   User            @relation("ExpenseRecorder", fields: [recordedById], references: [id])
  createdAt    DateTime        @default(now())
}
```

**Also modify existing models** (add the back-relations Prisma requires, plus):

- `Customer`: add `gstin String?`, `state String?`, `billingAddress String?`
  (+ relations `quotations Quotation[]`, `invoices Invoice[]`).
- `Order`: add `customerPoNumber String?`, `customerPoDate DateTime?`
  (customers issue their own PO to us — record it), + back-relations.
- `CompanySettings`: add `legalName String?`, `address String?`, `state String?`,
  `gstin String?`, `pan String?`, `bankName String?`, `bankAccountNumber String?`,
  `bankIfsc String?`, `bankBranch String?`, `invoiceTerms String?`,
  `quotationTerms String?`, `defaultTaxRatePct Decimal? @db.Decimal(5,2)`.
  These print on documents; the Settings page gets a "Company & Tax details" section
  (Super Admin only, existing `manage_settings`).
- `User`, `Product`, `Site`, `Vendor`: back-relation fields only.

---

## 4. Permissions & roles (seed + shared constants)

Add to `PERMISSION_KEY` in `packages/shared/src/constants.ts` and seed as `Permission`
rows (follow existing seed upsert style in `apps/api/prisma/seed.ts`):

| Key | Grants | Granted to |
|---|---|---|
| `manage_quotations` | CRUD quotations, send, convert to order | Finance, Sales, Management, Super Admin |
| `manage_invoices` | CRUD invoices (proforma + tax), issue, cancel | Finance, Management, Super Admin |
| `record_payments` | Record payments received/made | Finance, Management, Super Admin |
| `manage_purchase_orders` | CRUD suppliers, POs, bills | Finance, Management, Super Admin |
| `manage_expenses` | CRUD expense book | Finance, Management, Super Admin |
| `view_finance_dashboard` | Finance dashboard + reports | Finance, Management, Super Admin |

Also add new shared constants: `QUOTATION_STATUS`, `INVOICE_DOC_TYPE`, `INVOICE_STATUS`,
`PO_STATUS`, `BILL_STATUS`, `PAYMENT_METHOD`, `FINANCE_DOC_TYPE` (sequence keys), and
`EXPENSE_CATEGORY_KEY` (seed categories: `material`, `transport`, `site_labour`,
`travel`, `office`, `misc`).

The **seed must be idempotent** (upserts) — it will be re-run on the existing DB.
Granting these to the Finance role finally replaces its "No modules enabled yet" screen.

---

## 5. Core services (`apps/api/src/lib/` or `src/services/`)

### 5.1 `documentNumber.ts`
```
nextDocumentNumber(tx, docType): Promise<string>
```
- Fiscal year: April–March → for a date in Jan 2027 the FY is `"2026-27"`.
- Inside the caller's `prisma.$transaction`, `upsert` the `DocumentSequence` row and
  increment `lastNumber` atomically (use `update ... { lastNumber: { increment: 1 } }`
  after upsert, reading the returned value — safe under the transaction pooler).
- Format: `QTN/2026-27/0001`, `PI/2026-27/0001`, `INV/2026-27/0001`, `PO/2026-27/0001`
  (zero-padded to 4). Prefix map lives with the service.
- **Never** use the `Math.random()` pattern found in `orders.ts` — GST invoice numbers
  must be consecutive and collision-free.

### 5.2 `taxCalc.ts`
Pure functions, unit-testable:
- `computeLineTotal(qty, unitPrice, discountPct)` — pre-tax.
- `computeDocumentTotals(lines, companyState, placeOfSupply)` → `{ subtotal,
  discountAmount, cgstAmount, sgstAmount, igstAmount, total }`.
  - Same state (or either state missing) → split each line's tax into CGST + SGST halves.
  - Different states → all tax is IGST.
  - Round to 2 decimals per line, sum, and round the grand total to 2 decimals.
- **Server recomputes all totals from line items on every create/update** — never trust
  client-sent totals. Zod schemas accept line items only; totals are derived.

### 5.3 Status derivation
- Invoice `status` transitions: `draft → issued → (partially_paid) → paid`;
  `cancelled` allowed from `draft`/`issued` (tax invoices are cancelled, never deleted).
  After each `PaymentReceived` insert (same transaction), recompute
  `sum(payments)` vs `total` and set `partially_paid`/`paid`. Reject payments that
  would exceed the outstanding balance (400).
- "Overdue" is **computed at read time** (`status in (issued, partially_paid) &&
  dueDate < now`) and returned as a boolean/derived field, never stored.
- Bill status mirrors invoice status from `PaymentMade` rows.
- Editing line items is only allowed in `draft`. Issued documents are immutable except
  status transitions (matches Indian audit expectations).

---

## 6. API routes

New routers in `apps/api/src/routes/`, mounted in `src/index.ts`
(follow the existing router-per-resource pattern; every handler behind
`authenticate` + `requirePermission`):

### `quotations.ts` → `/quotations` (`manage_quotations`)
- `GET /` list (filter: status, customerId; include customer name, total)
- `POST /` create draft (Zod-validated line items; server computes numbers/totals)
- `GET /:id` detail with line items + customer + linked invoices/order
- `PUT /:id` update (draft only)
- `POST /:id/status` transition (`sent`, `accepted`, `rejected`, `expired`)
- `POST /:id/convert-to-order` — requires status `accepted`; creates an `Order`
  (reuse the existing order-creation logic in `orders.ts`, including the
  auto-created `Site` if that's what `POST /orders` does — mirror it exactly),
  sets `convertedOrderId`, status `converted`. Product line required: at least one
  line with a `productId` becomes the order's product/quantity/value.
- `POST /:id/create-invoice` — body `{ docType }`; copies lines into a new draft
  Invoice linked via `quotationId`.

### `invoices.ts` → `/invoices` (`manage_invoices`; payments sub-route `record_payments`)
- `GET /` list (filter: docType, status, customerId, overdue)
- `POST /`, `GET /:id`, `PUT /:id` (draft only)
- `POST /:id/issue` — assigns the real invoice number **at issue time** (draft docs get
  a temporary id-based display, e.g. `DRAFT-<id>`; number sequences must have no gaps
  from deleted drafts), sets `issued`
- `POST /:id/cancel` — body `{ reason }`; only from draft/issued with zero payments
- `POST /:id/payments` (`record_payments`) — records a `PaymentReceived`, updates status
- `GET /:id/payments`

### `purchase-orders.ts` → `/purchase-orders` (`manage_purchase_orders`)
- Suppliers CRUD: `GET|POST /suppliers`, `PUT /suppliers/:id` (deactivate, not delete)
- `GET /`, `POST /`, `GET /:id`, `PUT /:id` (draft only), `POST /:id/status`
- Bills: `GET|POST /bills` (`POST` validates supplier/PO linkage), `GET /bills/:id`
- `POST /bills/:id/payments` (`record_payments`) — `PaymentMade`, updates bill status

### `expenses.ts` → `/expenses` (`manage_expenses`)
- `GET /` (filter: category, siteId, date range), `POST /`, `PUT /:id`, `DELETE /:id`
  (expenses are the one place hard-delete is fine — they're internal records)

### `financeDashboard.ts` → `/finance` (`view_finance_dashboard`)
- `GET /finance/summary` — totals: outstanding receivables, outstanding payables,
  received this month, overdue invoice count/value, expenses this month
- `GET /finance/reports/receivables` — per-customer outstanding with aging buckets
  (0–30 / 31–60 / 61–90 / 90+, bucketed on `dueDate`, falling back to `issueDate`)
- `GET /finance/reports/payables` — same shape for bills
- `GET /finance/reports/gst-summary?from=&to=` — output tax (issued tax invoices) and
  input tax (bills) grouped by month: taxable value, CGST, SGST, IGST
- `GET /finance/reports/monthly-revenue?months=12` — for the dashboard chart

### Customer portal (existing customer JWT auth — study how `complaints.ts`/`orders.ts`
scope customer reads)
- `GET /portal/invoices` (or extend the existing portal data route): the customer's own
  **issued** invoices (never drafts) with paid/outstanding amounts. Enforce
  `customerId === req.auth.customerId` exactly like the §16-audit complaint fix.

### `lookups.ts` additions
Expose expense categories + payment methods via the existing `/meta` lookups route.

---

## 7. Shared contracts (`packages/shared/src/`)

- `constants.ts`: everything in §4.
- `schemas.ts`: Zod schemas — `quotationCreateSchema`, `invoiceCreateSchema`,
  `lineItemSchema` (description 1–500 chars, quantity > 0, unitPrice ≥ 0,
  discountPct 0–100, taxRatePct 0–28), `paymentCreateSchema` (amount > 0),
  `purchaseOrderCreateSchema`, `billCreateSchema`, `expenseCreateSchema`,
  `supplierCreateSchema`. API validates request bodies with these; web reuses them
  for form typing.
- `types.ts`: DTO types for list/detail responses (follow existing DTO style).
- **Rebuild the package after editing** (§1 house rules).

---

## 8. Admin-web UI

Follow the existing screens as templates — `orders/page.tsx` is the best reference for
a list + create-modal screen; `sites/[id]/page.tsx` for a detail screen. Use the shared
primitives from `globals.css`: `.table-desktop` + `.table-scroll` (desktop),
`.cards-mobile` + `.data-card`/`.data-card-row` (mobile), `.modal-panel`, `.field`,
`.status-pill status-pill-{success,warning,error}`, `.kpi-tile`. Every screen must be
responsive 320 px → desktop, same as the rest of the app (see HANDOVER §14).

**Nav (`components/Nav.tsx`):** add a "Finance" group gated by the new permissions —
Finance Dashboard (`view_finance_dashboard`), Quotations (`manage_quotations`),
Invoices (`manage_invoices`), Purchase Orders (`manage_purchase_orders`),
Expenses (`manage_expenses`). Follow the exact pattern used for existing gated links
(each item hidden without its permission; route-level guard too via `AuthGuard`).

**Pages under `apps/admin-web/src/app/`:**

| Route | Contents |
|---|---|
| `/finance` | KPI tiles (receivables, payables, overdue, this-month revenue + expenses), monthly-revenue bar chart (chart.js is already a dependency), receivables-aging table |
| `/quotations` | List (number, customer, date, total, status pill) + "New quotation" |
| `/quotations/new`, `/quotations/[id]` | Line-item editor (add/remove rows; product picker that prefills description/price from `Product`, or free-text line), live totals computed with the same shared logic, status actions, "Convert to order", "Create proforma/invoice", "Print" |
| `/invoices` | List with docType + status filters, overdue highlighted |
| `/invoices/new`, `/invoices/[id]` | Same editor; detail shows payment history + "Record payment" modal + outstanding balance; Issue / Cancel actions |
| `/purchase-orders` (+ `/new`, `/[id]`) | Supplier picker (inline "new supplier" like the inline new-customer pattern in the New Order modal), line items, status actions, linked bills, "Record bill" + "Record payment" |
| `/expenses` | Single list page with filter bar + add/edit modal |
| `/settings` | Extend with "Company & Tax details" section (fields from §3 CompanySettings) — existing `manage_settings` gating |
| `/quotations/[id]/print`, `/invoices/[id]/print`, `/purchase-orders/[id]/print` | Print view: company block (logo + CompanySettings legal/GST/bank details), customer/supplier block, line-item table with HSN + per-rate GST summary, totals in words (write a small `numberToIndianWords` util — lakh/crore grouping), terms, signature area. `@media print` hides app chrome; a "Download PDF" button calls `window.print()` |

**Customer portal:** add an "Invoices" card/section to the existing portal page —
issued invoices with number, date, total, paid, balance, status pill.

---

## 9. Notifications (reuse existing `NotificationService`)

The codebase has a single `NotificationService.send()` with in-app + email live and
other channels stubbed (find it in `apps/api/src/` — grep `NotificationService`).
Add template keys and fire best-effort (never fail the request on notification errors,
matching existing behavior):

- `invoice_issued` → customer contacts (email + in-app) when a tax invoice/proforma is issued
- `payment_received` → customer contacts, confirmation with amount + balance
- `quotation_sent` → customer contacts when a quotation is marked sent

Overdue-invoice reminder crons: **Phase 2** (see §11) — note that Platino later built an
AMC-reminder cron pattern, but it is not in this fork; don't try to copy it.

---

## 10. Implementation order & verification

Work in this order; keep each step compiling (`tsc --noEmit` in both apps must stay clean):

1. **Shared package**: constants + Zod schemas + types → rebuild workspace.
2. **Schema + migration + seed**: models, modified models, permissions, expense
   categories, `DocumentSequence` untouched (created lazily), 1–2 demo suppliers, and a
   demo quotation/invoice for dev convenience. Run migrate + seed against the Zan DB.
3. **Services**: `documentNumber.ts`, `taxCalc.ts` (+ a few inline assertions or a tiny
   test script for the tax math — intra-state vs inter-state, rounding).
4. **API routes** (§6), mounted in `index.ts`.
5. **API smoke test** via curl/PowerShell as `finance@…` login: create supplier →
   quotation (draft → sent → accepted) → convert to order → create proforma → issue →
   record part-payment (status `partially_paid`) → record rest (`paid`) → overpay
   attempt (400) → PO → bill → payment made → expense → all three reports return sane
   numbers. Also verify 403s: `sales@…` can reach `/quotations` but not `/invoices`;
   `erection@…` gets 403 on all finance routes; a customer sees only their own invoices.
6. **Web UI** (§8), screen by screen, verifying in the browser against the live API.
7. **Print views** + totals-in-words util.
8. **Portal invoice section.**
9. **Final sweep**: `npm run build` for both apps; mobile-width visual check (375 px)
   on every new screen; update `docs/HANDOVER.md` with a new §21 describing what was
   built (follow the existing handover-section style).

**Definition of done:** the §10.5 end-to-end flow works through the **UI** (not just
API), both builds are clean, every new route 403s without its permission, the Finance
login lands on a real dashboard instead of "No modules enabled yet", and an issued tax
invoice prints with correct sequential numbering and a correct CGST/SGST vs IGST split.

---

## 11. Phase 2 backlog (do NOT build now; don't block it either)

- Double-entry ledger (chart of accounts, journal entries auto-posted from documents)
- Overdue-invoice reminder cron + escalation
- Credit notes / debit notes; invoice revisions
- E-invoicing (IRN, QR) and e-way bill integration
- Payment allocation across multiple invoices; customer advances as on-account credits
- Bank statement import/reconciliation; TDS tracking
- Real PDF rendering + emailing documents as attachments
- Per-site job costing report (PO + expenses vs order value → site margin)

---

## 12. Known repo gotchas (inherited; will bite you if ignored)

- `packages/shared` compiles to **CommonJS** — don't change its tsconfig module settings.
- The API deploys to Vercel via `apps/api/vercel.json` + precompiled `dist/` — don't add
  a `builds` array to that file (HANDOVER §9 explains why).
- Prisma uses the pooler URLs (`DATABASE_URL` pgbouncer for runtime, `DIRECT_URL`
  session pooler for migrations) once a Supabase project exists for Zan-APP.
- The repo still carries Platino branding/seed emails; that rebrand is a separate task —
  don't mix it into this module beyond the new CompanySettings fields.
