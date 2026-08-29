// In-app database backup (Settings -> Backup). Two callers:
//  - POST /backup/run (manual, authenticated user, downloads the JSON straight to their
//    browser - see routes/backup.ts)
//  - POST /backup/internal/run-scheduled (Vercel Cron, no browser present - uploads to the
//    "Backups" Drive subfolder instead - see routes/backup.ts and vercel.json's `crons`)
// Both share this module so the export logic (what counts as "changed since X" for an
// incremental run) only lives in one place.
import { Prisma, type BackupMethod } from "@prisma/client";
import { prisma } from "../lib/prisma";

export interface BackupResult {
  exportedAt: string;
  method: BackupMethod;
  sinceDate: string | null;
  tables: Record<string, unknown[]>;
  tableCount: number;
  rowCount: number;
}

function jsonSafe(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

/**
 * Dumps every Prisma-modeled table. FULL = every row. INCREMENTAL = only rows touched since
 * `sinceDate`, using the model's own updatedAt (falling back to createdAt, falling back to
 * "no timestamp field - always include everything", since untimed models here are small,
 * static lookup tables per this schema's own "data, not code" convention - see
 * schema.prisma's header comment).
 */
export async function buildBackup(method: BackupMethod, sinceDate: Date | null): Promise<BackupResult> {
  const tables: Record<string, unknown[]> = {};
  let rowCount = 0;

  for (const model of Prisma.dmmf.datamodel.models) {
    const clientKey = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (prisma as any)[clientKey];
    if (typeof delegate?.findMany !== "function") continue;

    let where: Record<string, unknown> | undefined;
    if (method === "INCREMENTAL" && sinceDate) {
      const fieldNames = new Set(model.fields.map((f) => f.name));
      if (fieldNames.has("updatedAt")) where = { updatedAt: { gt: sinceDate } };
      else if (fieldNames.has("createdAt")) where = { createdAt: { gt: sinceDate } };
      // else: no timestamp field on this model - fall through and include every row.
    }

    const rows = await delegate.findMany(where ? { where } : undefined);
    tables[model.name] = rows;
    rowCount += rows.length;
  }

  return {
    exportedAt: new Date().toISOString(),
    method,
    sinceDate: sinceDate ? sinceDate.toISOString() : null,
    tables,
    tableCount: Object.keys(tables).length,
    rowCount,
  };
}

export function serializeBackup(result: BackupResult): string {
  return JSON.stringify(result, jsonSafe, 2);
}
