import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { assertCustomerSafe } from "../../lib/portalProjection";
import { prisma } from "../../lib/prisma";

export const portalPrisma = prisma;

/** Async handler: unexpected errors -> generic 500 (never leaks details). */
export const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next: NextFunction) => {
  fn(req, res).catch((err) => {
    console.error("[portal] handler error", err instanceof Error ? err.message : "unknown");
    if (!res.headersSent) res.status(500).json({ error: "Something went wrong" });
    void next;
  });
};

/** Every JSON answer goes through the forbidden-key guard. */
export function ok(res: Response, body: unknown, status = 200) {
  return res.status(status).json(assertCustomerSafe(body));
}

export function jsonBody(req: Request): unknown {
  try {
    return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "");
  } catch {
    return undefined;
  }
}

export const rawParser = express.raw({ type: () => true, limit: "4600kb" });
export const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s ?? null);
export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const param = (v: unknown): string => (Array.isArray(v) ? String(v[0]) : String(v ?? ""));
