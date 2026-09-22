const GOOGLE_ONLY_STAFF_EMAILS = new Set(["ferosem@gmail.com"]);

export function isGoogleOnlyStaffEmail(email: string): boolean {
  return GOOGLE_ONLY_STAFF_EMAILS.has(email.trim().toLowerCase());
}
