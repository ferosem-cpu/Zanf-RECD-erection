/**
 * Stages, statuses, roles, channels, and checkpoints all live as rows in the
 * database (see apps/api/prisma/schema.prisma + seed.ts) so new ones can be
 * added later without a code change. The keys below are the subset that
 * application logic itself needs to branch on - they must match the `key`
 * column of the corresponding seeded row exactly.
 */

export const SITC_PHASE = {
  SUPPLY: "SUPPLY",
  INSTALLATION: "INSTALLATION",
  TESTING: "TESTING",
  COMMISSIONING: "COMMISSIONING",
} as const;
export type SitcPhase = (typeof SITC_PHASE)[keyof typeof SITC_PHASE];

export const STAGE_KEY = {
  ORDER_RECEIVED: "order_received",
  DISPATCHED: "dispatched",
  DELIVERED_UNLOADING: "delivered_unloading",
  MEASURING: "measuring",
  MEASUREMENT_DONE: "measurement_done",
  STRUCTURE_BUILDING: "structure_building",
  STRUCTURE_COMPLETED: "structure_completed",
  INSTALLING: "installing",
  TESTING: "testing",
  COMMISSIONING: "commissioning",
  COMMISSIONED: "commissioned",
  CUSTOMER_SIGNOFF: "customer_signoff",
} as const;
export type StageKey = (typeof STAGE_KEY)[keyof typeof STAGE_KEY];

export const STATUS_OPTION_KEY = {
  PENDING: "pending",
  POSTPONE_TO_TOMORROW: "postpone_to_tomorrow",
  MATERIAL_NOT_ARRIVED: "material_not_arrived",
  AWAITING_SCAFFOLDING_MATERIALS: "awaiting_scaffolding_materials",
  DONE: "done",
} as const;
export type StatusOptionKey = (typeof STATUS_OPTION_KEY)[keyof typeof STATUS_OPTION_KEY];

export const PHOTO_CHECKPOINT_KEY = {
  BEFORE_INSTALLATION: "before_installation",
  MEASURING: "measuring",
  AFTER_INSTALLATION: "after_installation",
} as const;
export type PhotoCheckpointKey = (typeof PHOTO_CHECKPOINT_KEY)[keyof typeof PHOTO_CHECKPOINT_KEY];

export const ROLE_KEY = {
  SUPER_ADMIN: "super_admin",
  OWNER_ADMIN: "owner_admin",
  MANAGEMENT: "management",
  SALES: "sales",
  OPERATIONS_PM: "operations_pm",
  ERECTION_ENGINEER: "erection_engineer",
  COMMISSIONING_ENGINEER: "commissioning_engineer",
  SERVICE_TEAM: "service_team",
  FINANCE: "finance",
  CUSTOMER: "customer",
} as const;
export type RoleKey = (typeof ROLE_KEY)[keyof typeof ROLE_KEY];

export const NOTIFICATION_CHANNEL = {
  IN_APP: "in_app",
  EMAIL: "email",
  SMS: "sms",
  WHATSAPP: "whatsapp",
  TELEGRAM: "telegram",
} as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[keyof typeof NOTIFICATION_CHANNEL];

/** Channels with a real provider wired up in Phase 1; the rest are stubs that log to NotificationLog. */
export const LIVE_NOTIFICATION_CHANNELS: NotificationChannel[] = [
  NOTIFICATION_CHANNEL.IN_APP,
  NOTIFICATION_CHANNEL.EMAIL,
];

export const PENDING_ACTION_CATEGORY = {
  CUSTOMER_APPROVAL: "customer_approval",
  MATERIAL_SHORTAGE: "material_shortage",
  CUSTOMER_SIGNOFF_PENDING: "customer_signoff_pending",
} as const;
export type PendingActionCategory =
  (typeof PENDING_ACTION_CATEGORY)[keyof typeof PENDING_ACTION_CATEGORY];

export const EXHAUST_HOOKUP_TYPE = {
  REPLACE_EXISTING_SILENCER: "replace_existing_silencer",
  ADD_AFTER_EXISTING_EXHAUST: "add_after_existing_exhaust",
} as const;
export type ExhaustHookupType =
  (typeof EXHAUST_HOOKUP_TYPE)[keyof typeof EXHAUST_HOOKUP_TYPE];

export const COMPLAINT_STATUS = {
  OPEN: "open",
  ACKNOWLEDGED: "acknowledged",
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  WAITING_FOR_CUSTOMER: "waiting_for_customer",
  WAITING_FOR_PART: "waiting_for_part",
  ESCALATED: "escalated",
  RESOLVED: "resolved",
  CLOSED: "closed",
} as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUS)[keyof typeof COMPLAINT_STATUS];

export const COMPLAINT_CATEGORY = {
  ERECTION_COMMISSIONING: "erection_commissioning",
  DELIVERY_DELAY: "delivery_delay",
  NON_PERFORMANCE: "non_performance",
} as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORY)[keyof typeof COMPLAINT_CATEGORY];

export const VENDOR_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;
export type VendorStatus = (typeof VENDOR_STATUS)[keyof typeof VENDOR_STATUS];

// ---------------------------------------------------------------------------
// Finance module (see docs/FINANCE_MODULE_PLAN.md)
// ---------------------------------------------------------------------------

export const PERMISSION_KEY_FINANCE = {
  MANAGE_QUOTATIONS: "manage_quotations",
  MANAGE_INVOICES: "manage_invoices",
  RECORD_PAYMENTS: "record_payments",
  MANAGE_PURCHASE_ORDERS: "manage_purchase_orders",
  MANAGE_EXPENSES: "manage_expenses",
  VIEW_FINANCE_DASHBOARD: "view_finance_dashboard",
} as const;

/** Merge finance permission keys into PERMISSION_KEY so they seed + type-check everywhere. */
export const PERMISSION_KEY = {
  VIEW_SITE_STATUS: "view_site_status",
  CHANGE_SITE_STATUS: "change_site_status",
  VIEW_DASHBOARD: "view_dashboard",
  VIEW_COMPLAINTS_OVERVIEW: "view_complaints_overview",
  MANAGE_COMPLAINTS: "manage_complaints",
  RAISE_COMPLAINT: "raise_complaint",
  MANAGE_ORDERS: "manage_orders",
  MANAGE_USERS: "manage_users",
  RESOLVE_PENDING_ACTION: "resolve_pending_action",
  MANAGE_SETTINGS: "manage_settings",
  /** Act on complaints assigned to you (field engineers resolving their own tickets). */
  ACT_ASSIGNED_COMPLAINTS: "act_assigned_complaints",
  /** Review, approve/reject vendor registrations and assign vendors to sites. */
  MANAGE_VENDORS: "manage_vendors",
  /** Create/assign/edit work orders (dispatch tasks to field crews). */
  MANAGE_WORK_ORDERS: "manage_work_orders",
  /** Act on work orders assigned to you (field engineers updating status/completing their own). */
  ACT_ASSIGNED_WORK_ORDERS: "act_assigned_work_orders",
  ...PERMISSION_KEY_FINANCE,
} as const;
export type PermissionKey = (typeof PERMISSION_KEY)[keyof typeof PERMISSION_KEY];

export const WORK_ORDER_STATUS = {
  DRAFT: "draft",
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUS)[keyof typeof WORK_ORDER_STATUS];

export const WORK_ORDER_TASK_TYPE = {
  INSTALLATION: "installation",
  REPAIR: "repair",
  AMC_SERVICE: "amc_service",
  INSPECTION: "inspection",
  OTHER: "other",
} as const;
export type WorkOrderTaskType = (typeof WORK_ORDER_TASK_TYPE)[keyof typeof WORK_ORDER_TASK_TYPE];

export const QUOTATION_STATUS = {
  DRAFT: "draft",
  SENT: "sent",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  EXPIRED: "expired",
  CONVERTED: "converted",
} as const;
export type QuotationStatus = (typeof QUOTATION_STATUS)[keyof typeof QUOTATION_STATUS];

export const INVOICE_DOC_TYPE = {
  PROFORMA: "proforma",
  TAX_INVOICE: "tax_invoice",
} as const;
export type InvoiceDocType = (typeof INVOICE_DOC_TYPE)[keyof typeof INVOICE_DOC_TYPE];

export const INVOICE_STATUS = {
  DRAFT: "draft",
  ISSUED: "issued",
  PARTIALLY_PAID: "partially_paid",
  PAID: "paid",
  CANCELLED: "cancelled",
} as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

export const PO_STATUS = {
  DRAFT: "draft",
  ISSUED: "issued",
  PARTIALLY_RECEIVED: "partially_received",
  RECEIVED: "received",
  CANCELLED: "cancelled",
  CLOSED: "closed",
} as const;
export type PoStatus = (typeof PO_STATUS)[keyof typeof PO_STATUS];

export const BILL_STATUS = {
  UNPAID: "unpaid",
  PARTIALLY_PAID: "partially_paid",
  PAID: "paid",
  CANCELLED: "cancelled",
} as const;
export type BillStatus = (typeof BILL_STATUS)[keyof typeof BILL_STATUS];

export const PAYMENT_METHOD = {
  BANK_TRANSFER: "bank_transfer",
  UPI: "upi",
  CHEQUE: "cheque",
  CASH: "cash",
  OTHER: "other",
} as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];

/** Sequence keys for DocumentSequence rows (one counter per fiscal year). */
export const FINANCE_DOC_TYPE = {
  QUOTATION: "quotation",
  PROFORMA: "proforma",
  TAX_INVOICE: "tax_invoice",
  PURCHASE_ORDER: "purchase_order",
} as const;
export type FinanceDocType = (typeof FINANCE_DOC_TYPE)[keyof typeof FINANCE_DOC_TYPE];

/** Seeded expense category keys (data-not-code). */
export const EXPENSE_CATEGORY_KEY = {
  MATERIAL: "material",
  TRANSPORT: "transport",
  SITE_LABOUR: "site_labour",
  TRAVEL: "travel",
  OFFICE: "office",
  MISC: "misc",
} as const;
export type ExpenseCategoryKey = (typeof EXPENSE_CATEGORY_KEY)[keyof typeof EXPENSE_CATEGORY_KEY];
