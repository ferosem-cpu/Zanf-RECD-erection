import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const requestOtpSchema = z.object({
  phone: z.string().min(8),
});

export const verifyOtpSchema = z.object({
  phone: z.string().min(8),
  code: z.string().length(6),
});

export const createOrderSchema = z.object({
  customerId: z.string(),
  productId: z.string(),
  quantity: z.number().int().positive(),
  value: z.number().nonnegative(),
  orderDate: z.string().datetime(),
  promisedDeliveryDate: z.string().datetime().optional(),
  plannedExhaustHookupType: z.string().optional(),
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

export const createProductSchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  ratingSpec: z.string().optional(),
  capacityKva: z.number().optional(),
  warrantyMonths: z.number().int().optional(),
});

export const registerVendorSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().min(1),
  // Email is the vendor contact's login once approved, so it must be unique + valid.
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
  address: z.string().optional(),
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
  hsnCode: z.string().max(20).optional(),
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

export const paymentCreateSchema = z.object({
  amount: z.number().positive("Amount must be > 0"),
  method: z.enum(["bank_transfer", "upi", "cheque", "cash", "other"]),
  reference: z.string().max(200).optional(),
  receivedDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

export const supplierCreateSchema = z.object({
  name: z.string().min(1),
  gstin: z.string().max(20).optional(),
  state: z.string().max(100).optional(),
  address: z.string().max(1000).optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(20).optional(),
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

export const billCreateSchema = z.object({
  billNumber: z.string().min(1).max(100),
  supplierId: z.string().min(1),
  purchaseOrderId: z.string().optional(),
  billDate: z.string().datetime(),
  dueDate: z.string().datetime().optional(),
  subtotal: z.number().nonnegative(),
  taxAmount: z.number().nonnegative().default(0),
  total: z.number().nonnegative(),
  notes: z.string().max(2000).optional(),
});

export const paymentMadeCreateSchema = z.object({
  billId: z.string().optional(),
  amount: z.number().positive("Amount must be > 0"),
  method: z.enum(["bank_transfer", "upi", "cheque", "cash", "other"]),
  reference: z.string().max(200).optional(),
  paidDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

export const expenseCreateSchema = z.object({
  categoryId: z.string().min(1),
  description: z.string().min(1).max(500),
  amount: z.number().positive("Amount must be > 0"),
  expenseDate: z.string().datetime(),
  method: z.enum(["bank_transfer", "upi", "cheque", "cash", "other"]),
  siteId: z.string().optional(),
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
