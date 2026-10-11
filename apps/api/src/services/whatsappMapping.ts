/** Super-Admin managed WhatsApp sender mappings. Store-injected so tests run without a DB. */
import { groupForRole } from "../agent/whatsapp/policy";
import { normalizeLid, normalizePhoneE164 } from "./whatsappPhone";

export class MappingError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Prisma P2002 or a raw Postgres 23505 (the partial unique index surfaces either way). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  return e.code === "P2002" || e.code === "23505" || e.meta?.code === "23505" ||
    (typeof e.message === "string" && /23505|duplicate key value violates unique constraint/i.test(e.message));
}

/** Runs a store write and turns a unique-constraint race (two admins at once) into a clean 409. */
async function guardUnique<T>(work: Promise<T>, message: string): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (isUniqueViolation(err)) throw new MappingError(409, message);
    throw err;
  }
}

export interface MappingRecord {
  id: string;
  userId: string;
  phoneE164: string;
  lid: string | null;
  enabled: boolean;
  aiPaused: boolean;
  note: string | null;
  createdById: string;
  updatedById: string;
  verifiedById: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MappingUser {
  id: string;
  name: string;
  roleKey: string;
  isActive: boolean;
  customerId: string | null;
}

export interface MappingStore {
  list(): Promise<Array<MappingRecord & { user: { name: string; roleKey: string; isActive: boolean } | null }>>;
  get(id: string): Promise<MappingRecord | null>;
  findByPhone(phoneE164: string): Promise<MappingRecord | null>;
  findByLid(lid: string): Promise<MappingRecord | null>;
  findEnabledByUser(userId: string): Promise<MappingRecord[]>;
  findUser(userId: string): Promise<MappingUser | null>;
  create(data: Omit<MappingRecord, "id" | "createdAt" | "updatedAt">): Promise<MappingRecord>;
  update(id: string, data: Partial<Pick<MappingRecord, "enabled" | "aiPaused" | "note" | "updatedById">>): Promise<MappingRecord>;
  remove(id: string): Promise<void>;
}

export async function createMapping(
  store: MappingStore,
  actorId: string,
  input: { userId?: unknown; phone?: unknown; lid?: unknown; note?: unknown },
): Promise<MappingRecord> {
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  if (!userId) throw new MappingError(400, "userId is required");
  const phoneE164 = normalizePhoneE164(input.phone);
  if (!phoneE164) throw new MappingError(400, "phone is invalid or ambiguous (use +<country code><number>, or a 10-digit Indian mobile)");
  let lid: string | null = null;
  if (input.lid != null && input.lid !== "") {
    lid = normalizeLid(input.lid);
    if (!lid) throw new MappingError(400, "lid is invalid");
  }
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null;

  const user = await store.findUser(userId);
  if (!user) throw new MappingError(400, "User not found");
  if (!user.isActive) throw new MappingError(400, "User is inactive");
  if (user.customerId || !groupForRole(user.roleKey)) throw new MappingError(400, "This user's role has no WhatsApp access");

  if (await store.findByPhone(phoneE164)) throw new MappingError(409, "That phone number is already mapped");
  if (lid && (await store.findByLid(lid))) throw new MappingError(409, "That LID is already mapped");

  return guardUnique(store.create({
    userId, phoneE164, lid, enabled: false, aiPaused: false, note,
    createdById: actorId, updatedById: actorId, verifiedById: actorId, verifiedAt: new Date(),
  }), "Phone number or LID is already mapped");
}

async function mustGet(store: MappingStore, id: string): Promise<MappingRecord> {
  const row = await store.get(id);
  if (!row) throw new MappingError(404, "Mapping not found");
  return row;
}

export async function setEnabled(store: MappingStore, actorId: string, id: string, enabled: boolean): Promise<MappingRecord> {
  const row = await mustGet(store, id);
  if (enabled) {
    const user = await store.findUser(row.userId);
    if (!user || !user.isActive) throw new MappingError(400, "User is missing or inactive");
    if (user.customerId || !groupForRole(user.roleKey)) throw new MappingError(400, "This user's role has no WhatsApp access");
    if (!row.verifiedAt) throw new MappingError(400, "Mapping is not verified");
    const others = (await store.findEnabledByUser(row.userId)).filter((m) => m.id !== id);
    if (others.length > 0) throw new MappingError(409, "This user already has an enabled WhatsApp mapping");
  }
  return guardUnique(store.update(id, { enabled, updatedById: actorId }), enabled ? "This user already has an enabled WhatsApp mapping" : "Mapping conflict");
}

export async function setPaused(store: MappingStore, actorId: string, id: string, aiPaused: boolean): Promise<MappingRecord> {
  await mustGet(store, id);
  return store.update(id, { aiPaused, updatedById: actorId });
}

export async function removeMapping(store: MappingStore, id: string): Promise<void> {
  await mustGet(store, id);
  await store.remove(id);
}
