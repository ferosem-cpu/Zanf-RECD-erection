export interface StageDefinitionDTO {
  id: string;
  key: string;
  label: string;
  phase: string;
  sequenceOrder: number;
}

export interface StatusOptionDTO {
  id: string;
  key: string;
  label: string;
  requiresComment: boolean;
}

export interface PhotoCheckpointDTO {
  id: string;
  key: string;
  label: string;
  sequenceOrder: number;
}

export interface SiteStageEventDTO {
  id: string;
  siteId: string;
  stageDefinition: StageDefinitionDTO;
  statusOption: StatusOptionDTO;
  comment: string;
  photoUrl?: string | null;
  createdByName: string;
  createdAt: string;
}

export interface SitePhotoDTO {
  id: string;
  checkpoint: PhotoCheckpointDTO;
  photoUrl: string;
  caption?: string | null;
  uploadedByName: string;
  uploadedAt: string;
}

export interface SiteSummaryDTO {
  id: string;
  orderId: string;
  customerName: string;
  siteAddress: string;
  currentStage: StageDefinitionDTO;
  assignedEngineerName?: string | null;
  lastUpdatedAt: string;
}

export interface SiteDetailDTO extends SiteSummaryDTO {
  stageHistory: SiteStageEventDTO[];
  photos: SitePhotoDTO[];
  plannedExhaustHookupType?: string | null;
  confirmedExhaustHookupType?: string | null;
}

export interface DashboardCountsDTO {
  sitesByPhase: Record<string, number>;
  complaintsByStatus: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Finance module DTOs (see docs/FINANCE_MODULE_PLAN.md)
// ---------------------------------------------------------------------------

export interface FinanceLineItemDTO {
  id: string;
  description: string;
  hsnCode?: string | null;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxRatePct: string;
  lineTotal: string;
}

export interface QuotationListItemDTO {
  id: string;
  quoteNumber: string;
  status: string;
  issueDate: string;
  validUntil?: string | null;
  placeOfSupply?: string | null;
  total: string;
  customer: { id: string; name: string };
}

export interface QuotationDetailDTO {
  id: string;
  quoteNumber: string;
  status: string;
  issueDate: string;
  validUntil?: string | null;
  placeOfSupply?: string | null;
  subtotal: string;
  discountAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  total: string;
  notes?: string | null;
  terms?: string | null;
  customer: { id: string; name: string; gstin?: string | null; state?: string | null; address?: string | null };
  createdBy: { id: string; name: string };
  convertedOrderId?: string | null;
  lineItems: FinanceLineItemDTO[];
  invoices: { id: string; invoiceNumber: string; docType: string; status: string }[];
}

export interface InvoiceListItemDTO {
  id: string;
  invoiceNumber: string;
  docType: string;
  status: string;
  issueDate: string;
  dueDate?: string | null;
  placeOfSupply?: string | null;
  total: string;
  amountPaid: string;
  balance: string;
  overdue: boolean;
  customer: { id: string; name: string };
}

export interface InvoiceDetailDTO {
  id: string;
  invoiceNumber: string;
  docType: string;
  status: string;
  issueDate: string;
  dueDate?: string | null;
  placeOfSupply?: string | null;
  subtotal: string;
  discountAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  total: string;
  amountPaid: string;
  balance: string;
  overdue: boolean;
  notes?: string | null;
  terms?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  customer: { id: string; name: string; gstin?: string | null; state?: string | null; address?: string | null };
  order?: { id: string; orderNumber: string } | null;
  quotation?: { id: string; quoteNumber: string } | null;
  lineItems: FinanceLineItemDTO[];
  payments: {
    id: string;
    amount: string;
    method: string;
    reference?: string | null;
    receivedDate: string;
    notes?: string | null;
  }[];
}

export interface SupplierDTO {
  id: string;
  name: string;
  gstin?: string | null;
  state?: string | null;
  address?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  isActive: boolean;
}

export interface PurchaseOrderListItemDTO {
  id: string;
  poNumber: string;
  status: string;
  orderDate: string;
  total: string;
  supplier: { id: string; name: string };
}

export interface PurchaseOrderDetailDTO {
  id: string;
  poNumber: string;
  status: string;
  orderDate: string;
  expectedDate?: string | null;
  notes?: string | null;
  terms?: string | null;
  subtotal: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  total: string;
  supplier: { id: string; name: string; gstin?: string | null; state?: string | null; address?: string | null };
  order?: { id: string; orderNumber: string } | null;
  site?: { id: string } | null;
  lineItems: FinanceLineItemDTO[];
  bills: { id: string; billNumber: string; status: string; total: string }[];
}

export interface BillListItemDTO {
  id: string;
  billNumber: string;
  status: string;
  billDate: string;
  dueDate?: string | null;
  subtotal: string;
  taxAmount: string;
  total: string;
  amountPaid: string;
  balance: string;
  supplier: { id: string; name: string };
}

export interface ExpenseCategoryDTO {
  id: string;
  key: string;
  label: string;
  sequenceOrder: number;
}

export interface ExpenseListItemDTO {
  id: string;
  description: string;
  amount: string;
  expenseDate: string;
  method: string;
  category: { id: string; key: string; label: string };
  site?: { id: string } | null;
}

export interface FinanceSummaryDTO {
  outstandingReceivables: string;
  outstandingPayables: string;
  receivedThisMonth: string;
  overdueInvoiceCount: number;
  overdueInvoiceValue: string;
  expensesThisMonth: string;
}

export interface AgingBucketDTO {
  customerId: string;
  customerName: string;
  outstanding: string;
  current: string;
  days0_30: string;
  days31_60: string;
  days61_90: string;
  days90Plus: string;
}

export interface GstSummaryRowDTO {
  month: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
}

export interface MonthlyRevenueRowDTO {
  month: string;
  revenue: string;
  expenses: string;
}
