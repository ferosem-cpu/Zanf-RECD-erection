/**
 * Role -> permission definitions, shared by seed.ts and the API tests (apps/api/test/roleDefinitions.test.ts).
 * Pure data, no Prisma - importing this file never touches a database.
 *
 * Production does not re-run the seed (new grants reach prod through SQL migrations), so any
 * change here that production needs must also ship as an idempotent migration - see
 * migrations/20260927120000_management_all_permissions_except_settings for the pattern.
 */
import { PERMISSION_KEY, ROLE_KEY, type PermissionKey } from "@recd/shared";

type RoleKey = (typeof ROLE_KEY)[keyof typeof ROLE_KEY];

export interface RoleDefinition {
  name: string;
  description: string;
  permissions: PermissionKey[];
  /** Permissions the seed actively REMOVES from this role if a row exists (the seed is otherwise
   * additive-only). Used for the "everything except Settings" roles so manage_settings can never
   * linger on them. */
  revoke?: PermissionKey[];
}

/** Every permission key the code knows about - computed, so a new key added to PERMISSION_KEY
 * is automatically part of it (and therefore of every "all" / "all except settings" role). */
export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSION_KEY);

/** Management and Owner/Admin: every permission Super Admin has EXCEPT manage_settings
 * (Settings/white-label branding is Super Admin only). */
export const ALL_EXCEPT_SETTINGS: PermissionKey[] = ALL_PERMISSIONS.filter((p) => p !== PERMISSION_KEY.MANAGE_SETTINGS);

export const PERMISSION_DEFINITIONS: ReadonlyArray<{ key: PermissionKey; name: string }> = [
  { key: PERMISSION_KEY.VIEW_SITE_STATUS, name: "View site status" },
  { key: PERMISSION_KEY.CHANGE_SITE_STATUS, name: "Change site status" },
  { key: PERMISSION_KEY.VIEW_DASHBOARD, name: "View dashboard" },
  { key: PERMISSION_KEY.VIEW_COMPLAINTS_OVERVIEW, name: "View company-wide complaints overview" },
  { key: PERMISSION_KEY.MANAGE_COMPLAINTS, name: "Manage / resolve complaints" },
  { key: PERMISSION_KEY.RAISE_COMPLAINT, name: "Raise a complaint" },
  { key: PERMISSION_KEY.MANAGE_ORDERS, name: "Create / manage orders" },
  { key: PERMISSION_KEY.VIEW_ORDERS, name: "View orders and order value (read-only)" },
  { key: PERMISSION_KEY.MANAGE_USERS, name: "Add users and assign roles" },
  { key: PERMISSION_KEY.RESOLVE_PENDING_ACTION, name: "Resolve a pending action" },
  { key: PERMISSION_KEY.MANAGE_SETTINGS, name: "Manage company settings and theming" },
  { key: PERMISSION_KEY.ACT_ASSIGNED_COMPLAINTS, name: "Act on complaints assigned to you" },
  { key: PERMISSION_KEY.MANAGE_VENDORS, name: "Approve and manage external vendors" },
  { key: PERMISSION_KEY.MANAGE_WORK_ORDERS, name: "Create and assign work orders to field crews" },
  { key: PERMISSION_KEY.ACT_ASSIGNED_WORK_ORDERS, name: "Act on work orders assigned to you" },
  { key: PERMISSION_KEY.PLACE_ORDER, name: "Submit a new order request (Customer Portal)" },
  { key: PERMISSION_KEY.MANAGE_QUOTATIONS, name: "Create and manage quotations" },
  { key: PERMISSION_KEY.MANAGE_INVOICES, name: "Create and issue invoices (proforma + tax)" },
  { key: PERMISSION_KEY.RECORD_PAYMENTS, name: "Record payments received and made" },
  { key: PERMISSION_KEY.MANAGE_PURCHASE_ORDERS, name: "Manage suppliers, purchase orders, and bills" },
  { key: PERMISSION_KEY.MANAGE_EXPENSES, name: "Manage the expense book" },
  { key: PERMISSION_KEY.VIEW_FINANCE_DASHBOARD, name: "View finance dashboard and reports" },
  { key: PERMISSION_KEY.RECORD_VENDOR_INVOICE, name: "Upload / capture a vendor invoice" },
  { key: PERMISSION_KEY.APPROVE_VENDOR_INVOICE, name: "Verify, approve, or reject a vendor invoice" },
  { key: PERMISSION_KEY.VIEW_LEDGERS, name: "View party ledger statements, TDS report, and GST exports" },
  { key: PERMISSION_KEY.MANAGE_CREDIT_NOTES, name: "Create, issue, and cancel credit notes and debit notes" },
];

export const ROLE_DEFINITIONS: Record<RoleKey, RoleDefinition> = {
  [ROLE_KEY.SUPER_ADMIN]: {
    name: "Super Admin",
    description: "Root-level administrator. Full access to settings, user management, and configuration.",
    permissions: ALL_PERMISSIONS,
  },
  [ROLE_KEY.OWNER_ADMIN]: {
    name: "Owner / Admin",
    description: "Proprietor, Owner, CEO, or CTO. Full standard administrative permissions.",
    permissions: ALL_EXCEPT_SETTINGS,
    revoke: [PERMISSION_KEY.MANAGE_SETTINGS],
  },
  [ROLE_KEY.MANAGEMENT]: {
    name: "Management",
    description: "Senior managers below owner level. Full standard administrative permissions.",
    permissions: ALL_EXCEPT_SETTINGS,
    revoke: [PERMISSION_KEY.MANAGE_SETTINGS],
  },
  [ROLE_KEY.SALES]: {
    name: "Sales",
    description: "Creates orders, views customer project progress. Manages quotations and converts them to orders.",
    permissions: [PERMISSION_KEY.MANAGE_ORDERS, PERMISSION_KEY.VIEW_SITE_STATUS, PERMISSION_KEY.MANAGE_QUOTATIONS],
  },
  [ROLE_KEY.OPERATIONS_PM]: {
    name: "Operations / Project Manager",
    description: "Assigns engineers, updates plans, tracks pending items, dispatches work orders.",
    permissions: [
      PERMISSION_KEY.VIEW_SITE_STATUS,
      PERMISSION_KEY.CHANGE_SITE_STATUS,
      PERMISSION_KEY.RESOLVE_PENDING_ACTION,
      PERMISSION_KEY.MANAGE_WORK_ORDERS,
      PERMISSION_KEY.RECORD_VENDOR_INVOICE,
    ],
  },
  [ROLE_KEY.ERECTION_ENGINEER]: {
    name: "Erection Engineer",
    description: "Updates site progress on the ground. Oversees all erection-stage field work (fitters/welders are informal titles under this role, not separate roles). Resolves complaints and work orders assigned to them.",
    permissions: [
      PERMISSION_KEY.VIEW_SITE_STATUS,
      PERMISSION_KEY.CHANGE_SITE_STATUS,
      PERMISSION_KEY.ACT_ASSIGNED_COMPLAINTS,
      PERMISSION_KEY.ACT_ASSIGNED_WORK_ORDERS,
      PERMISSION_KEY.RECORD_VENDOR_INVOICE,
    ],
  },
  [ROLE_KEY.COMMISSIONING_ENGINEER]: {
    name: "Commissioning Engineer",
    description: "Updates commissioning stages, uploads test reports. Resolves complaints and work orders assigned to them.",
    permissions: [
      PERMISSION_KEY.VIEW_SITE_STATUS,
      PERMISSION_KEY.CHANGE_SITE_STATUS,
      PERMISSION_KEY.ACT_ASSIGNED_COMPLAINTS,
      PERMISSION_KEY.ACT_ASSIGNED_WORK_ORDERS,
      PERMISSION_KEY.RECORD_VENDOR_INVOICE,
    ],
  },
  [ROLE_KEY.SERVICE_TEAM]: {
    name: "Service Team",
    description: "Handles and resolves customer complaints and AMC/service work orders day to day.",
    permissions: [PERMISSION_KEY.MANAGE_COMPLAINTS, PERMISSION_KEY.VIEW_SITE_STATUS, PERMISSION_KEY.ACT_ASSIGNED_WORK_ORDERS],
  },
  [ROLE_KEY.FINANCE]: {
    name: "Finance",
    description: "Quotations, invoicing, payments, purchase orders, expenses, and finance reports.",
    permissions: [
      PERMISSION_KEY.MANAGE_QUOTATIONS,
      PERMISSION_KEY.MANAGE_INVOICES,
      PERMISSION_KEY.RECORD_PAYMENTS,
      PERMISSION_KEY.MANAGE_PURCHASE_ORDERS,
      PERMISSION_KEY.MANAGE_EXPENSES,
      PERMISSION_KEY.VIEW_FINANCE_DASHBOARD,
      PERMISSION_KEY.RECORD_VENDOR_INVOICE,
      PERMISSION_KEY.APPROVE_VENDOR_INVOICE,
      PERMISSION_KEY.VIEW_LEDGERS,
      PERMISSION_KEY.MANAGE_CREDIT_NOTES,
      // Read-only order access - Finance needs to see order value while searching orders,
      // but not MANAGE_ORDERS' create/edit/delete powers.
      PERMISSION_KEY.VIEW_ORDERS,
    ],
  },
  [ROLE_KEY.CUSTOMER]: {
    name: "Customer",
    description: "Views only their own orders/sites, raises complaints, resolves their own pending actions, and can submit new order requests.",
    permissions: [
      PERMISSION_KEY.VIEW_SITE_STATUS,
      PERMISSION_KEY.RAISE_COMPLAINT,
      PERMISSION_KEY.RESOLVE_PENDING_ACTION,
      PERMISSION_KEY.PLACE_ORDER,
    ],
  },
};
