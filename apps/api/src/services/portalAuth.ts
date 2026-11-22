/** Customer Portal (portal.zanf.org) request authentication for /portal/*.
 * Mounted BEFORE express.json (raw body). Reuses the WhatsApp bridge signing primitives:
 *   signature = HMAC-SHA256(secret, METHOD \n PATH?QUERY \n TIMESTAMP \n NONCE \n sha256(rawBody))
 * Headers: X-Portal-Key-Id, X-Portal-Timestamp, X-Portal-Nonce, X-Portal-Signature. The body hash is computed
 * server-side from the raw bytes (no body-hash header). The acting user travels as the `uid` query parameter, so it is
 * covered by the signature. Keys: env PORTAL_BRIDGE_KEYS (same format as WHATSAPP_BRIDGE_KEYS). */
import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { parseBridgeKeys, sha256Hex, signBridgeRequest, MAX_SKEW_SECONDS, NONCE_TTL_SECONDS, type NonceStore } from "./whatsappBridgeAuth";
import { prisma as defaultPrisma } from "../lib/prisma";

export const PORTAL_HEADERS = {
  keyId: "x-portal-key-id",
  timestamp: "x-portal-timestamp",
  nonce: "x-portal-nonce",
  signature: "x-portal-signature",
} as const;

export interface PortalIdentity {
  userId: string;
  customerId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export function portalEnabled(): boolean {
  return (process.env.PORTAL_ENABLED ?? "").trim().toLowerCase() === "true";
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function createPrismaPortalNonceStore(prisma: PrismaClient): NonceStore {
  return {
    async claim(keyId, nonce, expiresAt) {
      const { count } = await prisma.portalNonce.createMany({ data: [{ keyId, nonce, expiresAt }], skipDuplicates: true });
      if (count === 1 && Math.random() < 0.05) {
        await prisma.portalNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
      }
      return count === 1;
    },
  };
}

export interface PortalVerifyInput {
  method: string;
  pathQuery: string;
  header: (name: string) => string | undefined;
  rawBody: Buffer;
  nowMs: number;
  keys: Map<string, string>;
  nonces: NonceStore;
}

/** Never says why it failed. */
export async function verifyPortalRequest(i: PortalVerifyInput): Promise<boolean> {
  const keyId = i.header(PORTAL_HEADERS.keyId);
  const timestamp = i.header(PORTAL_HEADERS.timestamp);
  const nonce = i.header(PORTAL_HEADERS.nonce);
  const signature = i.header(PORTAL_HEADERS.signature);
  if (!keyId || !timestamp || !nonce || !signature) return false;
  const secret = i.keys.get(keyId);
  if (!secret) return false;
  if (!/^\d{1,12}$/.test(timestamp) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(i.nowMs / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const expected = signBridgeRequest(secret, i.method.toUpperCase(), i.pathQuery, timestamp, nonce, sha256Hex(i.rawBody));
  if (!safeEqualHex(expected, signature)) return false;
  return i.nonces.claim(keyId, nonce, new Date(i.nowMs + NONCE_TTL_SECONDS * 1000));
}

export interface PortalAuthDeps {
  nonces?: NonceStore;
  prisma?: PrismaClient;
  keys?: () => Map<string, string>;
  now?: () => number;
  /** Routes that do not act as a user (e.g. /auth/lookup). */
  anonymousPaths?: string[];
}

/** Loads the acting customer user. customerId always comes from the DB row. */
export async function loadPortalIdentity(prisma: PrismaClient, userId: string): Promise<PortalIdentity | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: { select: { key: true } } } });
  if (!user || !user.isActive || user.role.key !== "customer" || !user.customerId) return null;
  return { userId: user.id, customerId: user.customerId, name: user.name, email: user.email, phone: user.phone };
}

declare module "express-serve-static-core" {
  interface Request {
    portal?: PortalIdentity;
    portalRawBody?: Buffer;
  }
}

export function createPortalAuth(deps: PortalAuthDeps = {}): RequestHandler {
  const prisma = deps.prisma ?? defaultPrisma;
  const nonces = deps.nonces ?? createPrismaPortalNonceStore(prisma);
  const anonymous = new Set(deps.anonymousPaths ?? ["/auth/lookup"]);
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!portalEnabled()) return void res.status(503).json({ error: "Portal is switched off" });
    try {
      const ok = await verifyPortalRequest({
        method: req.method,
        pathQuery: req.originalUrl,
        header: (n) => {
          const v = req.headers[n];
          return Array.isArray(v) ? undefined : v;
        },
        rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        nowMs: (deps.now ?? Date.now)(),
        keys: (deps.keys ?? (() => parseBridgeKeys(process.env.PORTAL_BRIDGE_KEYS)))(),
        nonces,
      });
      if (!ok) return void res.status(401).json({ error: "Unauthorized" });
      req.portalRawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const path = req.path;
      if (anonymous.has(path)) return next();
      const uid = typeof req.query.uid === "string" ? req.query.uid : "";
      const identity = uid ? await loadPortalIdentity(prisma, uid) : null;
      if (!identity) return void res.status(403).json({ error: "Forbidden" });
      req.portal = identity;
      next();
    } catch {
      res.status(503).json({ error: "Temporarily unavailable" });
    }
  };
}

/** Tiny per-user fixed-window limiter (per function instance; the portal also rate-limits). */
export function createPortalUserLimiter(max = 240, windowMs = 60_000): RequestHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req, res, next) => {
    const id = req.portal?.userId;
    if (!id) return next();
    const now = Date.now();
    const h = hits.get(id);
    if (!h || h.reset < now) hits.set(id, { n: 1, reset: now + windowMs });
    else if (++h.n > max) return void res.status(429).json({ error: "Too many requests" });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}
