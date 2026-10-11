/** Prisma implementation of the WhatsApp bridge queue. Every state change is a conditional
 * updateMany (count must be 1) so concurrent serverless instances cannot double-process or double-release. */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/prisma";
import { MAX_CONCURRENT_TURNS, type InboundRow, type OutboxRow, type WaBridgeStore } from "./whatsappBridge";

class Zombie extends Error {}
const asInbound = (r: unknown) => r as InboundRow;
const asOutbox = (r: unknown) => r as OutboxRow;

function staleWhere(now: Date, restartAfterMs: number): Prisma.WhatsappInboundWhereInput {
  return {
    OR: [
      { status: "processing", leaseUntil: { lt: now } },
      { status: "received", decision: "accept", createdAt: { lt: new Date(now.getTime() - restartAfterMs) } },
    ],
  };
}

export function createPrismaBridgeStore(prisma: PrismaClient): WaBridgeStore {
  return {
  async insertInbound(row) {
    try {
      return { row: asInbound(await prisma.whatsappInbound.create({ data: row })), created: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existing = await prisma.whatsappInbound.findUnique({ where: { waMessageId: row.waMessageId } });
        if (existing) return { row: asInbound(existing), created: false };
      }
      throw err;
    }
  },

  async claimJob(id, token, now, leaseMs, maxAttempts) {
    // A transaction-scoped advisory lock serialises claims, so the per-sender ordering check and the
    // global cap are evaluated and applied atomically across serverless instances. A crashed worker's
    // lease expires (leaseUntil < now) and stops counting, so its slot is reclaimable.
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('whatsapp_turn_claim'))`;
      const job = await tx.whatsappInbound.findUnique({ where: { id } });
      if (!job || !job.mappingId) return null;
      const blocking = await tx.whatsappInbound.findFirst({
        where: {
          mappingId: job.mappingId,
          id: { not: id },
          OR: [
            { createdAt: { lt: job.createdAt }, status: { in: ["received", "processing"] } },
            { status: "processing", leaseUntil: { gte: now } },
          ],
        },
        select: { id: true },
      });
      if (blocking) return null;
      const running = await tx.whatsappInbound.count({ where: { id: { not: id }, status: "processing", leaseUntil: { gte: now } } });
      if (running >= MAX_CONCURRENT_TURNS) return null;
      const { count } = await tx.whatsappInbound.updateMany({
        where: { id, attempts: { lt: maxAttempts }, OR: [{ status: "received" }, { status: "processing", leaseUntil: { lt: now } }] },
        data: { status: "processing", leaseToken: token, leaseUntil: new Date(now.getTime() + leaseMs), attempts: { increment: 1 } },
      });
      return count === 1 ? asInbound(await tx.whatsappInbound.findUnique({ where: { id } })) : null;
    });
  },

  async completeJob(id, token, patch, outbox, conversation) {
    try {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.whatsappInbound.updateMany({
          where: { id, leaseToken: token, status: "processing" },
          data: { status: patch.status, text: null, leaseToken: null, leaseUntil: null },
        });
        if (count !== 1) throw new Zombie();
        if (outbox) await tx.whatsappOutbox.createMany({ data: [outbox], skipDuplicates: true });
        if (conversation) await tx.agentConversation.update({ where: { id: conversation.id }, data: { messages: conversation.messages as unknown as Prisma.InputJsonValue } });
      });
      return true;
    } catch (err) {
      if (err instanceof Zombie) return false;
      throw err;
    }
  },

  async releaseJob(id, token) {
    await prisma.whatsappInbound.updateMany({ where: { id, leaseToken: token, status: "processing" }, data: { status: "received", leaseToken: null, leaseUntil: null } });
  },

  async listStaleJobs(now, restartAfterMs, limit) {
    return (await prisma.whatsappInbound.findMany({ where: staleWhere(now, restartAfterMs), orderBy: { createdAt: "asc" }, take: limit })).map(asInbound);
  },

  async failStaleJob(id, now) {
    const { count } = await prisma.whatsappInbound.updateMany({
      where: { id, OR: [{ status: "processing", leaseUntil: { lt: now } }, { status: "received" }] },
      data: { status: "failed", text: null, leaseToken: null, leaseUntil: null },
    });
    return count === 1;
  },

  async getConversation(userId) {
    const existing = await prisma.agentConversation.findFirst({ where: { userId, channel: "whatsapp" }, orderBy: { createdAt: "asc" } });
    if (existing) return { id: existing.id, messages: existing.messages };
    const created = await prisma.agentConversation.create({ data: { userId, channel: "whatsapp", title: "WhatsApp", messages: [] } });
    return { id: created.id, messages: created.messages };
  },

  async insertOutboxIfAbsent(row) {
    await prisma.whatsappOutbox.createMany({ data: [row], skipDuplicates: true });
  },

  async getOutbox(id) {
    const r = await prisma.whatsappOutbox.findUnique({ where: { id } });
    return r ? asOutbox(r) : null;
  },

  async updateOutboxIf(id, guard, patch) {
    const { count } = await prisma.whatsappOutbox.updateMany({
      where: {
        id,
        status: { in: guard.statusIn },
        ...(guard.leasedKeyId ? { leasedKeyId: guard.leasedKeyId } : {}),
        ...(guard.leaseUntilAfter ? { leaseUntil: { gt: guard.leaseUntilAfter } } : {}),
      },
      data: patch,
    });
    return count === 1;
  },

  async expireOutbox(now) {
    await prisma.whatsappOutbox.updateMany({ where: { status: { in: ["pending", "leased"] }, expiresAt: { lt: now } }, data: { status: "expired", text: null } });
    await prisma.whatsappOutbox.updateMany({ where: { status: "sending", sendBy: { lt: now } }, data: { status: "uncertain", text: null } });
  },

  async leaseOutbox(keyId, now, leaseMs, limit) {
    const candidates = await prisma.whatsappOutbox.findMany({
      where: { expiresAt: { gt: now }, OR: [{ status: "pending" }, { status: "leased", leaseUntil: { lt: now } }] },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true },
    });
    const out: OutboxRow[] = [];
    for (const { id } of candidates) {
      const { count } = await prisma.whatsappOutbox.updateMany({
        where: { id, OR: [{ status: "pending" }, { status: "leased", leaseUntil: { lt: now } }] },
        data: { status: "leased", leasedKeyId: keyId, leaseUntil: new Date(now.getTime() + leaseMs) },
      });
      if (count === 1) {
        const row = await prisma.whatsappOutbox.findUnique({ where: { id } });
        if (row) out.push(asOutbox(row));
      }
    }
    return out;
  },
  };
}

export const prismaBridgeStore: WaBridgeStore = createPrismaBridgeStore(defaultPrisma);
