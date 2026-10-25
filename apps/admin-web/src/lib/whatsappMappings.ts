/** Pure helpers for the WhatsApp sender-mapping admin screen (Settings). No I/O. */

import { WHATSAPP_ROLE_GROUP } from "@recd/shared";

/** Roles that may use the WhatsApp agent: the same shared map the API policy uses (no copy to drift). */
export const WHATSAPP_ROLE_KEYS: ReadonlySet<string> = new Set(Object.keys(WHATSAPP_ROLE_GROUP));

export interface MappingUserRef { name: string; roleKey: string; isActive: boolean }

export interface MappingRow {
  id: string;
  userId: string;
  phoneE164: string;
  lid: string | null;
  enabled: boolean;
  aiPaused: boolean;
  note: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: MappingUserRef | null;
}

export interface UserOption {
  id: string;
  name: string;
  isActive: boolean;
  customerId?: string | null;
  vendorId?: string | null;
  role?: { key: string; name?: string } | null;
}

/** Users the API will accept for a mapping (mirrors groupForUser): active, WhatsApp role; a customer-linked user only
 * with the customer role and the customer role only with a customer link. Vendor-linked staff are allowed (the API
 * still refuses a blocked vendor at message time). */
export function eligibleUsers(users: UserOption[]): UserOption[] {
  return users
    .filter((u) => u.isActive && !!u.role && WHATSAPP_ROLE_KEYS.has(u.role.key) && (u.customerId ? u.role.key === "customer" : u.role.key !== "customer"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Client-side pre-check only; the API's normalizePhoneE164 is authoritative. */
export function looksLikePhone(raw: string): boolean {
  const s = raw.trim();
  if (!/^\+?[\d\s\-().]+$/.test(s)) return false;
  const n = s.replace(/\D/g, "").length;
  return n >= 8 && n <= 15;
}

/** Can this row be switched on? Mirrors setEnabled's guards so the button explains itself. */
export function enableBlocker(row: MappingRow, rows: MappingRow[]): string | null {
  if (row.enabled) return null;
  if (!row.user || !row.user.isActive) return "User is missing or inactive";
  if (!WHATSAPP_ROLE_KEYS.has(row.user.roleKey)) return "This user's role has no WhatsApp access";
  if (!row.verifiedAt) return "Mapping is not verified";
  if (rows.some((r) => r.id !== row.id && r.userId === row.userId && r.enabled)) return "This user already has an enabled WhatsApp mapping";
  return null;
}

export function mappingStatus(row: MappingRow): "On" | "Paused" | "Off" {
  if (!row.enabled) return "Off";
  return row.aiPaused ? "Paused" : "On";
}

/** Per-number tick box: what ticking (true) / unticking (false) should call, or why it can't. */
export function toggleRequest(row: MappingRow, rows: MappingRow[], checked: boolean): { path: string } | { blocked: string } | null {
  if (checked === row.enabled) return null;
  if (!checked) return { path: `/whatsapp/mappings/${row.id}/disable` };
  const blocker = enableBlocker(row, rows);
  return blocker ? { blocked: blocker } : { path: `/whatsapp/mappings/${row.id}/enable` };
}
