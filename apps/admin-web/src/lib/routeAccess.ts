// Single source of truth for "which permissions open which page". Used by the route guard
// (AuthGuard) and the sidebar (Nav), so the two can't drift apart again. Before 2026-09-27 the
// guard had one "/finance" entry (view_finance_dashboard) covering every /finance/* page, so a
// user the sidebar offered "Vendor Invoices" to (record_vendor_invoice) was bounced to /sites.
//
// Holding ANY listed permission is enough. A path is matched against the LONGEST route prefix
// in this map, so "/finance/vendor-invoices/new" uses the vendor-invoices entry, not "/finance".
// Paths that match nothing are unguarded (the API still enforces its own permissions).

export const ROUTE_PERMISSIONS: Record<string, string[]> = {
  "/dashboard": ["view_dashboard"],
  "/orders": ["manage_orders", "view_orders"],
  "/customers": ["manage_orders", "manage_quotations", "manage_invoices"],
  "/products": ["manage_orders"],
  "/sites": ["view_site_status"],
  "/complaints": ["manage_complaints", "view_complaints_overview", "act_assigned_complaints"],
  "/vendors": ["manage_vendors"],
  "/users": ["manage_users"],
  "/settings": ["manage_settings"],
  "/work-orders": ["manage_work_orders", "act_assigned_work_orders"],

  // Reports hub = any report card's permission; each report page = its own card's permission.
  "/reports": ["view_site_status", "view_finance_dashboard", "manage_orders", "manage_quotations", "manage_invoices", "manage_vendors"],
  "/reports/sitc": ["view_site_status"],
  "/reports/finance": ["view_finance_dashboard"],
  "/reports/customer-history": ["manage_orders", "manage_quotations", "manage_invoices"],
  "/reports/vendor-performance": ["manage_vendors"],
  "/reports/tds": ["view_ledgers"],
  "/reports/gst-returns": ["view_ledgers"],

  // Finance: the dashboard itself stays on view_finance_dashboard; every sub-page has its own entry.
  "/finance": ["view_finance_dashboard"],
  "/finance/vendor-invoices": ["record_vendor_invoice", "approve_vendor_invoice"],
  "/finance/customer-pricing": ["manage_quotations", "manage_invoices"],
  "/finance/ledgers": ["view_ledgers"],
  "/finance/credit-notes": ["manage_credit_notes"],
  "/finance/debit-notes": ["manage_credit_notes"],
  "/finance/payments": ["record_payments", "view_ledgers"],
  "/finance/vendor-payments": ["record_payments", "approve_vendor_invoice", "view_ledgers"],

  "/quotations": ["manage_quotations"],
  "/invoices": ["manage_invoices"],
  "/customer-pos": ["manage_orders"],
  "/purchase-orders": ["manage_purchase_orders"],
  "/expenses": ["manage_expenses"],
};

// Where to send a staff user who lands on /login etc. - the first module they can actually open.
export const LANDING_PRIORITY = ["/dashboard", "/sites", "/finance", "/complaints", "/work-orders", "/orders", "/customers", "/quotations", "/invoices", "/purchase-orders", "/expenses", "/vendors", "/users", "/settings"];

/** The most specific guarded route that `pathname` falls under, or undefined if unguarded. */
export function matchRoute(pathname: string): string | undefined {
  let best: string | undefined;
  for (const route of Object.keys(ROUTE_PERMISSIONS)) {
    if ((pathname === route || pathname.startsWith(route + "/")) && (!best || route.length > best.length)) {
      best = route;
    }
  }
  return best;
}

/** `route` must be a key of ROUTE_PERMISSIONS (or unguarded, which is always allowed). */
export function canAccess(permissions: readonly string[], route: string): boolean {
  const required = ROUTE_PERMISSIONS[route];
  if (!required) return true;
  return required.some((p) => permissions.includes(p));
}

/** Can a user holding `permissions` open `pathname`? */
export function canAccessPath(permissions: readonly string[], pathname: string): boolean {
  const matched = matchRoute(pathname);
  return matched ? canAccess(permissions, matched) : true;
}

export function firstLanding(permissions: readonly string[]): string | null {
  return LANDING_PRIORITY.find((route) => canAccess(permissions, route)) ?? null;
}
