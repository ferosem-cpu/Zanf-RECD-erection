/** Prisma-backed stores for the WhatsApp mapping service and sender resolution. */
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { isVendorAccessBlocked } from "../lib/authPolicy";
import { MappingError, type MappingStore } from "./whatsappMapping";
import type { SenderStore, WaUserContext } from "../agent/whatsapp/policy";
import type { AllowlistCandidate } from "./whatsappAllowlist";

/** Same loading rules as middleware/auth.ts authenticate: current role + permissions, active flag, vendor block. */
const WA_USER_INCLUDE = {
  role: { include: { permissions: { include: { permission: true } } } },
  vendor: { select: { status: true } },
} satisfies Prisma.UserInclude;
type WaUserRow = Prisma.UserGetPayload<{ include: typeof WA_USER_INCLUDE }>;

function toWaUserContext(user: WaUserRow): WaUserContext {
  return {
    userId: user.id,
    roleKey: user.role.key,
    isActive: user.isActive,
    customerId: user.customerId,
    vendorId: user.vendorId,
    vendorBlocked: isVendorAccessBlocked(user),
    permissions: new Set(user.role.permissions.map((rp) => rp.permission.key)),
  };
}

export async function loadWaUserContext(userId: string): Promise<WaUserContext | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: WA_USER_INCLUDE });
  return user ? toWaUserContext(user) : null;
}

/** GET /wa/allowlist: every enabled, unpaused mapping with its user (same loading rules as loadWaUserContext)
 * in ONE joined query instead of one user query per mapping. Eligibility is decided by buildAllowlist. */
export async function loadAllowlistCandidates(): Promise<AllowlistCandidate[]> {
  const rows = await prisma.whatsappSenderMapping.findMany({
    where: { enabled: true, aiPaused: false },
    select: { phoneE164: true, lid: true, enabled: true, aiPaused: true, user: { include: WA_USER_INCLUDE } },
  });
  return rows.map((r) => ({ phoneE164: r.phoneE164, lid: r.lid, enabled: r.enabled, aiPaused: r.aiPaused, user: r.user ? toWaUserContext(r.user) : null }));
}

export const prismaSenderStore: SenderStore = {
  findByPhone: (phoneE164) => prisma.whatsappSenderMapping.findMany({ where: { phoneE164 } }),
  findByLid: (lid) => prisma.whatsappSenderMapping.findMany({ where: { lid } }),
  findById: (id) => prisma.whatsappSenderMapping.findUnique({ where: { id } }),
  loadUser: loadWaUserContext,
};

function mapUnique<T>(work: Promise<T>): Promise<T> {
  return work.catch((err) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new MappingError(409, "Phone number or LID is already mapped");
    }
    throw err;
  });
}

export const prismaMappingStore: MappingStore = {
  async list() {
    const rows = await prisma.whatsappSenderMapping.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, isActive: true, role: { select: { key: true } } } } },
    });
    return rows.map(({ user, ...m }) => ({ ...m, user: user ? { name: user.name, isActive: user.isActive, roleKey: user.role.key } : null }));
  },
  get: (id) => prisma.whatsappSenderMapping.findUnique({ where: { id } }),
  findByPhone: (phoneE164) => prisma.whatsappSenderMapping.findUnique({ where: { phoneE164 } }),
  findByLid: (lid) => prisma.whatsappSenderMapping.findUnique({ where: { lid } }),
  findEnabledByUser: (userId) => prisma.whatsappSenderMapping.findMany({ where: { userId, enabled: true } }),
  async findUser(userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, isActive: true, customerId: true, role: { select: { key: true } } } });
    return u ? { id: u.id, name: u.name, roleKey: u.role.key, isActive: u.isActive, customerId: u.customerId } : null;
  },
  create: (data) => mapUnique(prisma.whatsappSenderMapping.create({ data })),
  update: (id, data) => mapUnique(prisma.whatsappSenderMapping.update({ where: { id }, data })),
  async remove(id) {
    await prisma.whatsappSenderMapping.delete({ where: { id } });
  },
};
