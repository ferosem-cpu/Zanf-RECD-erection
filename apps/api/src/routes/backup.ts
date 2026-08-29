// Settings -> Backup: manual on-demand backups (downloaded to the requesting user's browser)
// and a scheduled backup fired by Vercel Cron (uploaded to Google Drive, since no browser is
// present - see vercel.json's `crons` entry and docs/HANDOVER.md). Manual routes are gated on
// MANAGE_SETTINGS, same as the rest of Settings (Super Admin only). The scheduled route is
// gated on CRON_SECRET instead, same pattern as the existing /agent/cron/cleanup-conversations
// route in agentCron.ts.
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { PERMISSION_KEY, backupRunSchema, backupSettingsUpdateSchema } from "@recd/shared";
import { buildBackup, serializeBackup } from "../services/backup";
import { createDriveFolder, uploadDriveFile, getDriveFolderId } from "../lib/googleDrive";

export const backupRouter = Router();

async function getOrCreateSettings() {
  const existing = await prisma.backupSettings.findUnique({ where: { id: "singleton" } });
  if (existing) return existing;
  return prisma.backupSettings.create({ data: { id: "singleton" } });
}

backupRouter.get("/settings", authenticate, requirePermission(PERMISSION_KEY.MANAGE_SETTINGS), async (_req, res) => {
  const settings = await getOrCreateSettings();
  res.json(settings);
});

backupRouter.put("/settings", authenticate, requirePermission(PERMISSION_KEY.MANAGE_SETTINGS), async (req, res) => {
  const parsed = backupSettingsUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await getOrCreateSettings();
  const settings = await prisma.backupSettings.update({
    where: { id: "singleton" },
    data: parsed.data,
  });
  res.json(settings);
});

backupRouter.get("/logs", authenticate, requirePermission(PERMISSION_KEY.MANAGE_SETTINGS), async (_req, res) => {
  const logs = await prisma.backupLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { triggeredBy: { select: { id: true, name: true } } },
  });
  res.json(logs);
});

// POST /backup/run - manual backup, downloaded straight to the calling user's browser as a
// file rather than the usual JSON envelope (see admin-web's downloadFileFromApi helper).
backupRouter.post("/run", authenticate, requirePermission(PERMISSION_KEY.MANAGE_SETTINGS), async (req: AuthenticatedRequest, res) => {
  const parsed = backupRunSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { method } = parsed.data;

  const settings = await getOrCreateSettings();
  const log = await prisma.backupLog.create({
    data: { method, trigger: "manual", status: "running", triggeredById: req.auth!.userId },
  });

  try {
    const sinceDate = method === "INCREMENTAL" ? settings.lastFullBackupAt : null;
    const result = await buildBackup(method, sinceDate);
    const body = serializeBackup(result);

    await prisma.backupLog.update({
      where: { id: log.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        tableCount: result.tableCount,
        rowCount: result.rowCount,
        sizeBytes: Buffer.byteLength(body),
      },
    });
    await prisma.backupSettings.update({
      where: { id: "singleton" },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "success",
        ...(method === "FULL" ? { lastFullBackupAt: new Date() } : {}),
      },
    });

    const filename = `zanapp-backup-${method.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.backupLog.update({
      where: { id: log.id },
      data: { status: "failed", finishedAt: new Date(), errorMessage: message },
    });
    await prisma.backupSettings.update({
      where: { id: "singleton" },
      data: { lastRunAt: new Date(), lastRunStatus: "failed" },
    });
    res.status(500).json({ error: "Backup failed", detail: message });
  }
});

// GET /backup/internal/run-scheduled - Vercel Cron only (see vercel.json's `crons`), not
// user-authenticated. Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when
// CRON_SECRET is set as a project env var - same pattern as agentCron.ts's existing cron
// route. Fires once/day (Vercel Cron has no reliable less-than-daily granularity); this
// route itself decides whether *today* (in IST) is the configured day-of-week before doing
// any real work, so it behaves like a weekly job even though the underlying cron is daily.
// Vercel Cron always issues a GET request (see agentCron.ts's existing cron route for the
// same convention), not POST.
backupRouter.get("/internal/run-scheduled", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.authorization !== `Bearer ${secret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }
  // No CRON_SECRET set (e.g. local dev) - allow through, matching agentCron.ts's own note
  // that production should always have CRON_SECRET set once this is deployed.

  const settings = await getOrCreateSettings();
  if (!settings.scheduleEnabled) {
    return res.json({ skipped: true, reason: "schedule disabled" });
  }

  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const istDayOfWeek = istNow.getUTCDay(); // shifted clock, so read UTC fields as IST fields
  if (istDayOfWeek !== settings.scheduleDayOfWeek) {
    return res.json({ skipped: true, reason: "not the scheduled day", istDayOfWeek });
  }

  const log = await prisma.backupLog.create({
    data: { method: settings.method, trigger: "scheduled", status: "running" },
  });

  try {
    const sinceDate = settings.method === "INCREMENTAL" ? settings.lastFullBackupAt : null;
    const result = await buildBackup(settings.method, sinceDate);
    const body = serializeBackup(result);

    let folderId = settings.driveBackupsFolderId;
    if (!folderId) {
      const folder = await createDriveFolder("Backups", getDriveFolderId());
      folderId = folder.id;
    }
    const filename = `zanapp-backup-${settings.method.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    const uploaded = await uploadDriveFile(filename, "application/json", body, folderId);

    await prisma.backupLog.update({
      where: { id: log.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        tableCount: result.tableCount,
        rowCount: result.rowCount,
        sizeBytes: Buffer.byteLength(body),
        driveFileId: uploaded.id,
        driveFileLink: uploaded.webViewLink,
      },
    });
    await prisma.backupSettings.update({
      where: { id: "singleton" },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "success",
        driveBackupsFolderId: folderId,
        ...(settings.method === "FULL" ? { lastFullBackupAt: new Date() } : {}),
      },
    });
    res.json({ ok: true, driveFileLink: uploaded.webViewLink, tableCount: result.tableCount, rowCount: result.rowCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.backupLog.update({
      where: { id: log.id },
      data: { status: "failed", finishedAt: new Date(), errorMessage: message },
    });
    await prisma.backupSettings.update({
      where: { id: "singleton" },
      data: { lastRunAt: new Date(), lastRunStatus: "failed" },
    });
    res.status(500).json({ error: "Scheduled backup failed", detail: message });
  }
});
