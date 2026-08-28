import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const requestOtpSchema = z.object({
  phone: z.string().min(8),
});

/**
 * Email+OTP login for customers/vendors, as an alternative identifier to phone
 * (customer) or password (vendor). Same OTP mechanics as requestOtpSchema/verifyOtpSchema,
 * just keyed by email instead of phone - see auth.ts's /auth/email-otp/* routes.
 */
export const requestEmailOtpSchema = z.object({
  email: z.string().email(),
});

export const verifyEmailOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

export const googleLoginSchema = z.object({
  /** The ID token returned by Google Identity Services' credential callback (a signed JWT). */
  credential: z.string().min(1),
});

export const verifyOtpSchema = z.object({
  phone: z.string().min(8),
  code: z.string().length(6),
});

export const createOrderSchema = z.object({
  customerId: z.string(),
  productId: z.string(),
  quantity: z.number().int().positive(),
  // Optional: a sales-created order should still set these, but they're nullable on the
  // model to support operational orders created without commercial figures yet (e.g. a
  // site added before pricing is finalized) - filled in later via the order edit flow.
  value: z.number().nonnegative().optional(),
  orderDate: z.string().datetime().optional(),
  promisedDeliveryDate: z.string().datetime().optional(),
  plannedExhaustHookupType: z.string().optional(),
});

/** Adds another RECD product to an existing order/site (same order, multiple units). */
export const addOrderLineItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
});

/**
 * Creates a sibling Order+Site for another RECD delivered to the same physical location -
 * same address/companyName/vendor as the source site, reset to the first stage, but its
 * own orderNumber so it's tracked (and, later, invoiced/dispatched) independently.
 */
export const cloneOrderForSiteSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
});

export const createStageEventSchema = z.object({
  stageDefinitionId: z.string(),
  statusOptionId: z.string(),
  comment: z.string().min(1, "Comment is required"),
  photoUrl: z.string().url().optional(),
});

export const confirmExhaustHookupSchema = z.object({
  confirmedExhaustHookupType: z.string(),
  matchesPlan: z.boolean(),
});

export const uploadSitePhotoSchema = z.object({
  checkpointId: z.string(),
  photoUrl: z.string().url(),
  caption: z.string().optional(),
});

export const updateSiteLocationSchema = z.object({
  address: z.string().optional(),
  gpsLat: z.number().min(-90).max(90).nullable().optional(),
  gpsLng: z.number().min(-180).max(180).nullable().optional(),
});

/** Site's own identity fields - end-client/site-owner name and address, editable independent of location capture. */
export const updateSiteDetailsSchema = z.object({
  companyName: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});

export const createSiteContactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  role: z.string().optional(),
});

export const updateSiteContactSchema = createSiteContactSchema.partial();

/** Bulk-set all document requirements for a site in one call (the UI presents them as a table). */
export const setSiteDocumentRequirementsSchema = z.object({
  requirements: z.array(
    z.object({
      requirementTypeId: z.string(),
      required: z.boolean(),
      status: z.string().optional(),
      documentUrl: z.string().url().optional(),
      notes: z.string().optional(),
    }),
  ),
});

export const upsertRecdDeliverySchema = z.object({
  productId: z.string().nullable().optional(),
  quantity: z.number().int().positive().nullable().optional(),
  deliveryStatus: z.string().optional(),
  statusNote: z.string().nullable().optional(),
  priority: z.number().int().nullable().optional(),
  expectedDate: z.string().datetime().nullable().optional(),
  actualDate: z.string().datetime().nullable().optional(),
});

export const createComplaintSchema = z.object({
  siteId: z.string(),
  category: z.string(),
  description: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
});

export const updateComplaintStatusSchema = z.object({
  status: z.string(),
  rootCause: z.string().optional(),
  resolutionNotes: z.string().optional(),
  /** Only complaint managers (service team / management) may (re)assign; field engineers cannot. */
  assignedToId: z.string().nullable().optional(),
});

export const createWorkOrderSchema = z.object({
  siteId: z.string(),
  taskType: z.string(),
  title: z.string().min(1),
  instructions: z.string().optional(),
  scheduledDate: z.string().datetime().optional(),
  assignedToId: z.string().optional(),
  productIds: z.array(z.string()).optional(),
});

export const updateWorkOrderSchema = z.object({
  status: z.string().optional(),
  title: z.string().min(1).optional(),
  instructions: z.string().optional(),
  taskType: z.string().optional(),
  scheduledDate: z.string().datetime().nullable().optional(),
  /** Only work-order managers may (re)assign; field engineers cannot. */
  assignedToId: z.string().nullable().optional(),
  completionNotes: z.string().optional(),
  completionPhotoUrl: z.string().url().optional(),
});

export const resolvePendingActionSchema = z.object({
  resolution: z.string(),
  notes: z.string().optional(),
});

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  roleKey: z.string(),
  phone: z.string().optional(),
  title: z.string().optional(),
  /** Required when adding an erection engineer who belongs to an approved vendor. */
  vendorId: z.string().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  roleKey: z.string().optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
});

export const notificationPreferenceSchema = z.object({
  channels: z.array(z.enum(["in_app", "email", "sms", "whatsapp", "telegram"])),
});

export const createCustomerSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  contactName: z.string().min(1),
  // Phone is the customer's login credential (Order ID + phone -> OTP), so it is required.
  contactPhone: z.string().min(6),
  contactEmail: z.string().email().optional(),
});

export const updateCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  gstin: z.string().optional(),
  state: z.string().optional(),
  contactName: z.string().min(1).optional(),
  contactPhone: z.string().min(6).optional(),
  contactEmail: z.string().email().optional(),
  openingBalance: z.number().optional(),
  openingBalanceDate: z.string().optional(),
});

export const createProductSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  ratingSpec: z.string().optional(),
  capacityKva: z.number().optional(),
  warrantyMonths: z.number().int().optional(),
  shape: z.enum(["cylinder", "triangle", "rectangle"]).optional(),
  dimensions: z.string().optional(),
  weightKg: z.number().optional(),
  silencerType: z.union([z.literal(1), z.literal(2)]).optional(),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  ratingSpec: z.string().optional(),
  capacityKva: z.number().optional(),
  warrantyMonths: z.number().int().optional(),
  shape: z.enum(["cylinder", "triangle", "rectangle"]).optional(),
  dimensions: z.string().optional(),
  weightKg: z.number().optional(),
  silencerType: z.union([z.literal(1), z.literal(2)]).optional(),
});

export const upsertCustomerProductPriceSchema = z.object({
  customerId: z.string().min(1),
  productId: z.string().min(1),
  price: z.number().nonnegative(),
});

export const upsertCustomerSavedItemPriceSchema = z.object({
  customerId: z.string().min(1),
  savedItemId: z.string().min(1),
  price: z.number().nonnegative(),
});

export const createSavedLineItemSchema = z.object({
  name: z.string().min(1),
  hsnCode: z.string().optional(),
  standardPrice: z.number().nonnegative(),
  taxRatePct: z.number().nonnegative().optional(),
});

export const updateSavedLineItemSchema = z.object({
  name: z.string().min(1).optional(),
  hsnCode: z.string().optional(),
  standardPrice: z.number().nonnegative().optional(),
  taxRatePct: z.number().nonnegative().optional(),
  active: z.boolean().optional(),
});

export const registerVendorSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().min(1),
  // Email is the vendor contact's login once approved, so it must be unique + valid.
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
  address: z.string().optional(),
});

/** Optional: move this vendor's currently-assigned sites to another approved vendor before
 * archiving, so ongoing erection work doesn't stall. Omit to leave sites pointed at the
 * archived vendor (fine for work that's already finished). */
export const archiveVendorSchema = z.object({
  reassignSitesToVendorId: z.string().optional(),
});

/** Assign (or clear) the external vendor responsible for a site, and optionally its engineer. */
export const assignSiteVendorSchema = z.object({
  vendorId: z.string().nullable(),
  assignedEngineerId: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Finance module schemas (see docs/FINANCE_MODULE_PLAN.md)
// Totals are always derived server-side; clients send line items only.
// ---------------------------------------------------------------------------

export const lineItemSchema = z.object({
  productId: z.string().optional(),
  description: z.string().min(1).max(500),
  hsnCode: z.string().min(1, "HSN/SAC code is required").max(20),
  quantity: z.number().positive("Quantity must be > 0"),
  unitPrice: z.number().nonnegative("Unit price cannot be negative"),
  discountPct: z.number().min(0).max(100).default(0),
  taxRatePct: z.number().min(0).max(28).default(18),
});

export const quotationCreateSchema = z.object({
  customerId: z.string().min(1),
  issueDate: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  placeOfSupply: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  terms: z.string().max(2000).optional(),
  lineItems: z.array(lineItemSchema).min(1, "At least one line item is required"),
});

export const quotationUpdateSchema = quotationCreateSchema.partial().extend({
  lineItems: z.array(lineItemSchema).min(1).optional(),
});

export const quotationStatusSchema = z.object({
  status: z.enum(["sent", "accepted", "rejected", "expired"]),
});

export const createInvoiceFromQuotationSchema = z.object({
  docType: z.enum(["proforma", "tax_invoice"]),
});

export const invoiceCreateSchema = z.object({
  docType: z.enum(["proforma", "tax_invoice"]),
  customerId: z.string().min(1),
  orderId: z.string().optional(),
  quotationId: z.string().optional(),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  placeOfSupply: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  terms: z.string().max(2000).optional(),
  lineItems: z.array(lineItemSchema).min(1, "At least one line item is required"),
});

export const invoiceUpdateSchema = invoiceCreateSchema.partial().extend({
  lineItems: z.array(lineItemSchema).min(1).optional(),
});

export const invoiceCancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const creditNoteCreateSchema = z.object({
  invoiceId: z.string().min(1),
  reason: z.enum(["return", "rate_difference", "deficiency", "post_sale_discount", "other"]),
  issueDate: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  lineItems: z.array(lineItemSchema).min(1, "At least one line item is required"),
});

export const creditNoteUpdateSchema = creditNoteCreateSchema.partial().extend({
  lineItems: z.array(lineItemSchema).min(1).optional(),
});

export const creditNoteCancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const debitNoteCreateSchema = z.object({
  supplierId: z.string().min(1),
  billId: z.string().optional(),
  noteNumber: z.string().min(1).max(100),
  reason: z.string().min(1).max(500),
  noteDate: z.string().datetime().optional(),
  amount: z.number().positive("Amount must be > 0"),
  notes: z.string().max(1000).optional(),
});

export const debitNoteUpdateSchema = debitNoteCreateSchema.partial();

export const paymentCreateSchema = z.object({
  amount: z.number().positive("Amount must be > 0"),
  method: z.enum(["bank_transfer", "upi", "cheque", "cash", "tds", "other"]),
  reference: z.string().max(200).optional(),
  receivedDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
  tdsAmount: z.number().nonnegative().optional(),
  tdsCertificateRef: z.string().max(200).optional(),
});

export const paymentUpdateSchema = paymentCreateSchema.partial();

/// A payment recorded against a customer directly (not sugared onto one invoice) -
/// the general Phase C entry point: allocate the CASH amount across zero or more
/// invoices, with any remainder sitting as an unallocated advance. Each allocation's
/// `amount` is the cash portion sent to that invoice; the payment's tdsAmount is added
/// on top, pro-rated across allocations by their share of `amount`, when computing how
/// much of each invoice's value this settles (see services/settlement.ts) - so
/// allocations must sum to at most the cash `amount`, never amount + tdsAmount.
export const paymentAllocationInputSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive("Allocation amount must be > 0"),
});

export const paymentReceivedCreateSchema = z
  .object({
    customerId: z.string().min(1),
    amount: z.number().positive("Amount must be > 0"),
    tdsAmount: z.number().nonnegative().default(0),
    tdsCertificateRef: z.string().max(200).optional(),
    method: z.enum(["bank_transfer", "upi", "cheque", "cash", "other"]),
    reference: z.string().max(200).optional(),
    receivedDate: z.string().datetime().optional(),
    notes: z.string().max(1000).optional(),
    allocations: z.array(paymentAllocationInputSchema).default([]),
  })
  .refine((d) => d.allocations.reduce((s, a) => s + a.amount, 0) <= d.amount + 0.01, {
    message: "Allocations cannot exceed the cash amount received",
    path: ["allocations"],
  })
  .refine((d) => d.allocations.length > 0 || d.tdsAmount === 0, {
    message: "TDS must be tied to at least one invoice allocation",
    path: ["tdsAmount"],
  });

export const paymentAllocationCreateSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive("Allocation amount must be > 0"),
});

export const supplierCreateSchema = z.object({
  name: z.string().min(1),
  gstin: z.string().max(20).optional(),
  pan: z.string().max(20).optional(),
  state: z.string().max(100).optional(),
  address: z.string().max(1000).optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(20).optional(),
  openingBalance: z.number().optional(),
  openingBalanceDate: z.string().optional(),
});

export const purchaseOrderCreateSchema = z.object({
  supplierId: z.string().min(1),
  orderId: z.string().optional(),
  siteId: z.string().optional(),
  orderDate: z.string().datetime().optional(),
  expectedDate: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  terms: z.string().max(2000).optional(),
  lineItems: z.array(lineItemSchema).min(1, "At least one line item is required"),
});

export const purchaseOrderUpdateSchema = purchaseOrderCreateSchema.partial().extend({
  lineItems: z.array(lineItemSchema).min(1).optional(),
});

export const purchaseOrderStatusSchema = z.object({
  status: z.enum(["issued", "partially_received", "received", "cancelled", "closed"]),
});

/** Line item on a vendor invoice - same shape as PurchaseOrderLineItem's schema, no discount. */
export const billLineItemSchema = z.object({
  description: z.string().min(1).max(500),
  hsnCode: z.string().max(20).optional(),
  quantity: z.number().positive("Quantity must be > 0"),
  unitPrice: z.number().nonnegative("Unit price cannot be negative"),
  taxRatePct: z.number().min(0).max(28).default(18),
});

/** A single allocation row: at least one of siteId/orderId/invoiceId is required (checked in
 * the refine below); the API additionally validates FK existence and the sum-vs-total rule. */
export const billAllocationSchema = z
  .object({
    siteId: z.string().optional(),
    orderId: z.string().optional(),
    invoiceId: z.string().optional(),
    amount: z.number().positive("Allocation amount must be > 0"),
    notes: z.string().max(1000).optional(),
  })
  .refine((a) => !!(a.siteId || a.orderId || a.invoiceId), {
    message: "Each allocation needs at least one of site, order, or linked invoice",
  });

export const billCreateSchema = z.object({
  billNumber: z.string().min(1).max(100),
  supplierId: z.string().min(1),
  purchaseOrderId: z.string().optional(),
  sourceType: z.enum(["printed", "handwritten", "digital"]).optional(),
  attachmentUrl: z.string().max(6_000_000).optional(),
  attachmentMimeType: z.string().max(100).optional(),
  extractionRaw: z.unknown().optional(),
  billDate: z.string().datetime(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  lineItems: z.array(billLineItemSchema).min(1, "At least one line item is required"),
  allocations: z.array(billAllocationSchema).optional(),
});

export const billUpdateSchema = z.object({
  billNumber: z.string().min(1).max(100).optional(),
  supplierId: z.string().min(1).optional(),
  purchaseOrderId: z.string().nullable().optional(),
  sourceType: z.enum(["printed", "handwritten", "digital"]).optional(),
  attachmentUrl: z.string().max(6_000_000).optional(),
  attachmentMimeType: z.string().max(100).optional(),
  billDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lineItems: z.array(billLineItemSchema).min(1).optional(),
  allocations: z.array(billAllocationSchema).optional(),
});

export const billRejectSchema = z.object({
  reason: z.string().min(1).max(1000),
});

/** POST /bills/extract request: the raw uploaded file, base64-encoded. */
export const billExtractRequestSchema = z.object({
  fileDataUrl: z.string().min(1),
  mimeType: z.string().min(1),
});

export const customerPurchaseOrderLineItemSchema = z.object({
  description: z.string().min(1).max(500),
  hsnCode: z.string().max(20).optional(),
  quantity: z.number().positive("Quantity must be > 0"),
  unitPrice: z.number().nonnegative("Unit price cannot be negative"),
  taxRatePct: z.number().min(0).max(28).default(18),
});

export const customerPurchaseOrderCreateSchema = z.object({
  poNumber: z.string().min(1).max(100),
  poDate: z.string().datetime(),
  customerId: z.string().min(1),
  orderId: z.string().optional(),
  invoiceId: z.string().optional(),
  placeOfSupply: z.string().max(100).optional(),
  workLocation: z.string().max(200).optional(),
  scopeOfWork: z.string().max(1000).optional(),
  paymentDueDate: z.string().datetime().optional(),
  customerRefCode: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  sourceType: z.enum(["printed", "handwritten", "digital"]).optional(),
  attachmentUrl: z.string().max(6_000_000).optional(),
  attachmentMimeType: z.string().max(100).optional(),
  extractionRaw: z.unknown().optional(),
  lineItems: z.array(customerPurchaseOrderLineItemSchema).min(1, "At least one line item is required"),
});

export const customerPurchaseOrderUpdateSchema = z.object({
  poNumber: z.string().min(1).max(100).optional(),
  poDate: z.string().datetime().optional(),
  customerId: z.string().min(1).optional(),
  orderId: z.string().nullable().optional(),
  invoiceId: z.string().nullable().optional(),
  placeOfSupply: z.string().max(100).nullable().optional(),
  workLocation: z.string().max(200).nullable().optional(),
  scopeOfWork: z.string().max(1000).nullable().optional(),
  paymentDueDate: z.string().datetime().nullable().optional(),
  customerRefCode: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  sourceType: z.enum(["printed", "handwritten", "digital"]).optional(),
  attachmentUrl: z.string().max(6_000_000).optional(),
  attachmentMimeType: z.string().max(100).optional(),
  lineItems: z.array(customerPurchaseOrderLineItemSchema).min(1).optional(),
  status: z.enum(["open", "invoiced", "cancelled"]).optional(),
});

/** POST /customer-purchase-orders/extract request: the raw uploaded file, base64-encoded. */
export const customerPurchaseOrderExtractRequestSchema = z.object({
  fileDataUrl: z.string().min(1),
  mimeType: z.string().min(1),
});

export const paymentMadeCreateSchema = z.object({
  billId: z.string().optional(),
  amount: z.number().positive("Amount must be > 0"),
  method: z.enum(["bank_transfer", "upi", "cheque", "cash", "other"]),
  reference: z.string().max(200).optional(),
  paidDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * The general vendor-payment endpoint (mirrors paymentReceivedCreateSchema): supplierId is
 * required (unlike paymentMadeCreateSchema, whose supplier is implied by the bill it's
 * nested under at POST /bills/:id/payments) and billId is optional - omit it entirely to
 * record a pure advance, or pass it with an amount larger than the bill's outstanding
 * balance and the server splits the excess into an advance automatically.
 */
export const paymentMadeGeneralCreateSchema = paymentMadeCreateSchema.extend({
  supplierId: z.string().min(1),
});

/** POST /bills/:id/apply-advance: apply part or all of an existing unallocated PaymentMade
 * (billId still null) to this bill. */
export const advanceApplicationCreateSchema = z.object({
  paymentId: z.string().min(1),
  amount: z.number().positive("Amount must be > 0"),
});

export const expenseCreateSchema = z.object({
  categoryId: z.string().min(1),
  description: z.string().min(1).max(500),
  amount: z.number().positive("Amount must be > 0"),
  expenseDate: z.string().datetime(),
  method: z.enum(["bank_transfer", "upi", "cheque", "cash", "other"]),
  // Nullable (not just optional) so the edit form can explicitly clear a previously-set site
  // via "No site / overhead" - undefined = "leave unchanged" on update, null = "clear it".
  siteId: z.string().nullable().optional(),
  receiptUrl: z.string().max(5000).optional(),
});

export const expenseUpdateSchema = expenseCreateSchema.partial();

export const settingsCompanyUpdateSchema = z.object({
  legalName: z.string().max(200).optional(),
  address: z.string().max(1000).optional(),
  state: z.string().max(100).optional(),
  gstin: z.string().max(20).optional(),
  pan: z.string().max(20).optional(),
  bankName: z.string().max(200).optional(),
  bankAccountNumber: z.string().max(50).optional(),
  bankIfsc: z.string().max(20).optional(),
  bankBranch: z.string().max(200).optional(),
  invoiceTerms: z.string().max(2000).optional(),
  quotationTerms: z.string().max(2000).optional(),
  defaultTaxRatePct: z.number().min(0).max(28).optional(),
});
