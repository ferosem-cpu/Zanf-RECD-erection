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
