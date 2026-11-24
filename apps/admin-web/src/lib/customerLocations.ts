/** Helpers for the customer-portal location screens (pure, unit-tested). */
export interface LocationRow { id: string; name: string; active: boolean; userCount?: number; siteCount?: number }

/** Options for a "Location" dropdown: active locations, plus the currently assigned one even if it has since been deactivated (so it stays visible). */
export function locationOptions(locations: LocationRow[], currentId?: string | null): LocationRow[] {
  return [...locations].filter((l) => l.active || l.id === currentId).sort((a, b) => a.name.localeCompare(b.name));
}

export function locationName(locations: LocationRow[], id?: string | null): string {
  if (!id) return "All locations (customer admin)";
  const l = locations.find((x) => x.id === id);
  return l ? l.name + (l.active ? "" : " (deactivated)") : "Unknown location";
}

/** A portal user with no location is a customer admin; one with a deactivated location cannot sign in. */
export function accessLabel(locations: LocationRow[], id?: string | null): string {
  if (!id) return "Customer admin";
  const l = locations.find((x) => x.id === id);
  return !l ? "Unknown location" : l.active ? l.name + " only" : l.name + " (deactivated: cannot sign in)";
}

/** Mobile for WhatsApp codes, same rule as the API (normalisePhone): +91 and 10 digits starting 6-9. "" = no mobile; null = invalid. */
export function normaliseMobile(raw: string): string | "" | null {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  let d = t.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? "+91" + d : null;
}

/** Why the "Add portal user" button is disabled ("" = ready). Name and a valid e-mail are required; mobile is optional but must be valid when given. */
export function addUserHint(f: { name: string; email: string; phone: string }): string {
  if (!f.name.trim()) return "Enter the user's name to enable Add portal user.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "Enter a valid e-mail (used to sign in) to enable Add portal user.";
  if (normaliseMobile(f.phone) === null) return "Mobile must be a 10-digit Indian number (starts with 6-9), or leave it blank.";
  return "";
}
