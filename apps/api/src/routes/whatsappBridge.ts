/** WhatsApp bridge endpoints (/wa/*). Mounted BEFORE express.json in index.ts: the HMAC covers the raw bytes. */
import express, { Router } from "express";
import { z } from "zod";
import { createBridgeAuth, type NonceStore } from "../services/whatsappBridgeAuth";
import type { BridgeService } from "../services/whatsappBridge";

const ingestSchema = z.object({
  messageId: z.string().min(1).max(200),
  senderJid: z.string().min(1).max(200),
  chatJid: z.string().min(1).max(200),
  timestamp: z.number().int().positive(),
  text: z.string().max(8192),
  senderLid: z.string().max(200).optional(),
  resolvedPhone: z.string().max(40).optional(),
}).strict();

const ackSchema = z.object({
  outboxId: z.string().min(1).max(200),
  status: z.enum(["sent", "failed", "uncertain", "delivered"]),
  at: z.number().int(),
  waMessageId: z.string().max(200).optional(),
  error: z.string().max(2000).optional(),
}).strict();

export interface WhatsappBridgeRouterDeps {
  nonces: NonceStore;
  service: BridgeService;
  background: (work: Promise<unknown>) => void;
  keys?: () => Map<string, string>;
  now?: () => number;
}

export function createWhatsappBridgeRouter(deps: WhatsappBridgeRouterDeps): Router {
  const router = Router();
  router.use(express.raw({ type: () => true, limit: "64kb" }));
  router.use(createBridgeAuth({ nonces: deps.nonces, keys: deps.keys, now: deps.now }));
  const keyId = (res: express.Response) => String(res.locals.bridgeKeyId);
  const body = (req: express.Request): unknown => {
    try {
      return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "");
    } catch {
      return undefined;
    }
  };

  router.post("/ingest", async (req, res) => {
    const parsed = ingestSchema.safeParse(body(req));
    const idem = req.header("idempotency-key");
    if (!parsed.success || (idem && idem !== parsed.data.messageId)) return void res.status(400).json({ error: "Invalid request" });
    const { decision, jobId } = await deps.service.ingest(keyId(res), parsed.data);
    res.status(202).json({ decision });
    if (jobId) deps.background(deps.service.processJob(jobId));
  });

  router.get("/outbox", async (req, res) => {
    const n = Number(req.query.limit ?? 5);
    const limit = Number.isInteger(n) && n >= 1 ? Math.min(n, 10) : 5;
    const { items, restart } = await deps.service.poll(keyId(res), limit);
    res.json({ items });
    for (const id of restart) deps.background(deps.service.processJob(id));
  });

  router.post("/outbox/:id/claim", async (req, res) => {
    const out = await deps.service.claim(keyId(res), String(req.params.id));
    if (out.status === 200) return void res.json({ text: out.text, sendBy: out.sendBy });
    res.status(out.status).json({ error: out.status === 409 ? "Not claimable" : out.status === 410 ? "Gone" : "Not found" });
  });

  router.post("/ack", async (req, res) => {
    const parsed = ackSchema.safeParse(body(req));
    if (!parsed.success) return void res.status(400).json({ error: "Invalid request" });
    const status = await deps.service.ack(keyId(res), parsed.data);
    res.status(status).json(status === 200 ? { ok: true } : { error: "Not found" });
  });

  return router;
}
