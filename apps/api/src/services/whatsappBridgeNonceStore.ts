import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/prisma";
import type { NonceStore } from "./whatsappBridgeAuth";

/** Insert-or-conflict on the (keyId, nonce) primary key: createMany + skipDuplicates reports how many rows were new. */
export function createPrismaNonceStore(prisma: PrismaClient): NonceStore {
  return {
  async claim(keyId, nonce, expiresAt) {
    const { count } = await prisma.whatsappBridgeNonce.createMany({ data: [{ keyId, nonce, expiresAt }], skipDuplicates: true });
    if (count === 1 && Math.random() < 0.05) {
      await prisma.whatsappBridgeNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
    }
    return count === 1;
  },
  };
}

export const prismaNonceStore: NonceStore = createPrismaNonceStore(defaultPrisma);
