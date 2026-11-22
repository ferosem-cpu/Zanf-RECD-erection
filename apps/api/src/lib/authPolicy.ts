const GOOGLE_ONLY_STAFF_EMAILS = new Set(["ferosem@gmail.com"]);

export function isGoogleOnlyStaffEmail(email: string): boolean {
  return GOOGLE_ONLY_STAFF_EMAILS.has(email.trim().toLowerCase());
}

/**
 * Vendor-tenant login gate. A user attached to a vendor company (User.vendorId set) may only
 * sign in, and may only keep using an existing session, while that vendor is "approved".
 * A vendor that is pending, rejected (including approved-then-rejected), archived, or whose
 * row is missing locks out every member login - on every login path (password, Google,
 * phone OTP, email OTP) AND in the authenticate middleware, so tokens issued before the
 * status change stop working on the next request. Re-approving the vendor restores access
 * without touching User.isActive.
 *
 * Callers must load the user with `include: { vendor: true }` (or select vendor.status).
 * Users without a vendorId (staff, customers) are never affected.
 */
export function isVendorAccessBlocked(user: {
  vendorId?: string | null;
  vendor?: { status: string } | null;
}): boolean {
  if (!user.vendorId) return false;
  return user.vendor?.status !== "approved";
}

/** Role keys whose users belong to an external vendor company (User.vendorId). Only these may
 * carry a vendorId: every site route scopes a user with a vendorId to that vendor's sites, so a
 * stray vendorId on a staff account (e.g. a Management user created after the Users form had an
 * erection-engineer vendor picked, or an engineer later promoted to a staff role) silently
 * turns Sites into an empty list for them. */
const VENDOR_MEMBER_ROLE_KEYS = new Set(["erection_engineer"]);

export function roleAllowsVendor(roleKey: string): boolean {
  return VENDOR_MEMBER_ROLE_KEYS.has(roleKey);
}

/** Customer Portal cut-over: once PORTAL_ENABLED=true, customer users (role customer / any user with a customerId)
 * can no longer hold a web session on app.zanf.org - they use portal.zanf.org. Enforced at every login door AND in the
 * authenticate middleware, so tokens issued earlier stop working too (JWTs have no revocation list). The WhatsApp
 * routes (/wa/*) authenticate by HMAC and never call this. Gated on the flag so nothing changes before go-live. */
export const CUSTOMER_WEB_BLOCK_MESSAGE = "Customers now sign in at https://portal.zanf.org";
export function isCustomerWebBlocked(user: { customerId?: string | null; role?: { key: string } | null }, env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.PORTAL_ENABLED ?? "").trim().toLowerCase() !== "true") return false;
  return !!user.customerId || user.role?.key === "customer";
}
