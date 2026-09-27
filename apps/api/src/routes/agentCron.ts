/** Daily cleanup of AgentConversation rows older than 30 days (decision: conversation
 * history isn't a permanent audit trail - InvoiceEditLog etc already serve that role - so
 * it's fine to expire and keeps Supabase storage/costs bounded). Invoked by Vercel Cron
 * (see the `crons` entry in vercel.json), which sends `Authorization: Bearer $CRON_SECRET`
 * automatically when CRON_SECRET is set as a project env var - this route rejects anything
 * else so it can't be triggered by an arbitrary request.
 */
import { Router } from "express";
import { prisma } from "../lib/prisma";

export const agentCronRouter = Router();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

agentCronRouter.get("/cron/cleanup-conversations", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.authorization;
  if (!secret || header !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  const result = await prisma.agentConversation.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  });
  res.json({ deleted: result.count });
});
