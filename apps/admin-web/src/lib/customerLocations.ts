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

export interface CustomerSiteRow { id: string; name: string; orderNumber: string | null; stage: string | null; customerLocationId: string | null; address?: string | null; city?: string | null; product?: string | null }

/** Short address for a row: the portal city when known, else the address trimmed to ~48 chars. The full address goes in the tooltip. */
export function shortAddress(s: Pick<CustomerSiteRow, "address" | "city">): string {
  const city = (s.city ?? "").trim();
  if (city) return city;
  const a = (s.address ?? "").replace(/\s+/g, " ").trim();
  return a.length > 48 ? a.slice(0, 47).trimEnd() + "…" : a;
}
export const fullAddress = (s: Pick<CustomerSiteRow, "address" | "city">): string => (s.address ?? "").replace(/\s+/g, " ").trim() || (s.city ?? "").trim();

/** Sites to list in the bulk-assign box: unassigned ones, plus assigned ones when the user ticks "show all". Oldest list order is kept. */
export function assignableSites(sites: CustomerSiteRow[], showAll: boolean, search = ""): CustomerSiteRow[] {
  const s = search.trim().toLowerCase();
  return sites.filter((x) => (showAll || !x.customerLocationId) && (!s || [x.name, x.orderNumber, x.address, x.city, x.product].some((v) => (v ?? "").toLowerCase().includes(s))));
}

/** Why "Assign" is disabled ("" = ready). */
export function assignHint(locationId: string, selected: number): string {
  if (!locationId) return "Choose a location to enable Assign.";
  if (selected === 0) return "Tick at least one site to enable Assign.";
  return "";
}
