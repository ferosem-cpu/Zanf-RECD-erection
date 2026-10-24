/** Pure helpers for the WhatsApp sender-mapping admin screen (Settings). No I/O. */

/** Mirrors ROLE_GROUP in apps/api/src/agent/whatsapp/policy.ts: roles that may use the WhatsApp agent. */
export const WHATSAPP_ROLE_KEYS: ReadonlySet<string> = new Set([
  "super_admin", "owner_admin", "management", "finance", "sales",
  "operations_pm", "erection_engineer", "commissioning_engineer", "service_team",
]);

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

/** Users the API will accept for a mapping: active staff (no customer/vendor link) with a WhatsApp role. */
export function eligibleUsers(users: UserOption[]): UserOption[] {
  return users
    .filter((u) => u.isActive && !u.customerId && !u.vendorId && !!u.role && WHATSAPP_ROLE_KEYS.has(u.role.key))
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
