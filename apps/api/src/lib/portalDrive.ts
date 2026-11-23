/** Customer-portal photos in the company Google Drive (ZanF_DropBox), through the existing OAuth client (scope drive.file).
 *
 *  Final place:   <Customer> - <Site>/Photographs/DG n/<YYYY-MM-DD>-k.jpg   (the site's own folders, exactly as POST /sites/:id/drive-folders makes them)
 *  Before submit: ZanF_DropBox/Portal drafts/<file>   (no order exists yet; on submit each file is MOVED into the right DG folder, abandoned ones are deleted after 7 days)
 *
 *  Nothing here changes sharing or permissions, and nothing is logged except fixed labels. Everything is injected so tests run with Drive mocked. */
import { isoDateIST } from "../agent/istDates";

export class DriveUnavailableError extends Error {
  constructor() { super("Drive is not configured"); this.name = "DriveUnavailableError"; }
}
export interface DriveFolder { id: string; webViewLink: string }
export interface DriveApi {
  rootFolderId(): string;
  createFolder(name: string, parentId: string): Promise<DriveFolder>;
  findFolder(name: string, parentId: string): Promise<DriveFolder | null>;
  upload(name: string, mimeType: string, bytes: Buffer, parentId: string): Promise<DriveFolder>;
  move(fileId: string, toParentId: string, newName?: string): Promise<void>;
  download(fileId: string): Promise<Buffer>;
  remove(fileId: string): Promise<void>;
}
export interface SiteForDrive { id: string; companyName: string | null; address: string | null; customerName: string; photosDriveFolderId: string | null }
export interface UnfiledPhoto { id: string; siteId: string; storagePath: string; mimeType: string; dgIndex: number | null; createdAt: Date }
export interface PortalDriveDb {
  getSite(id: string): Promise<SiteForDrive | null>;
  saveSiteFolders(id: string, f: { photosId: string; photosUrl: string; drawingsId: string; drawingsUrl: string }): Promise<void>;
  listUnfiled(opts: { submissionId?: string; limit: number }): Promise<UnfiledPhoto[]>;
  countFiled(siteId: string, dgIndex: number): Promise<number>;
  markFiled(attachmentId: string, dgIndex: number, now: Date): Promise<void>;
}
export interface DriveDeps {
  drive: DriveApi;
  db: PortalDriveDb;
  /** Serialises work for one key across serverless instances (a database advisory lock in production). */
  withLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  now?: () => Date;
}

export const DRAFTS_FOLDER = "Portal drafts";
export const isDrivePath = (p: string) => p.startsWith("drive:");
export const driveIdOf = (p: string) => p.slice(6);
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };
export const extFor = (mime: string) => EXT[mime] ?? "jpg";

/** DG number from a portal site name such as "Mill - DG 2"; a single-DG site is DG 1. */
export function dgIndexFromSiteName(name: string | null): number {
  const m = /- DG (\d{1,2})$/.exec(name ?? "");
  return m ? Number(m[1]) : 1;
}

async function findOrCreate(deps: DriveDeps, lockKey: string, name: string, parentId: string): Promise<DriveFolder> {
  return deps.withLock(lockKey, async () => (await deps.drive.findFolder(name, parentId)) ?? (await deps.drive.createFolder(name, parentId)));
}

export const ensureDraftsFolder = (deps: DriveDeps) => findOrCreate(deps, "drive:drafts", DRAFTS_FOLDER, deps.drive.rootFolderId());

/** The site's Photographs folder id: the tracker's own, or created exactly the tracker's way (same names) and saved on the site. */
export async function ensureSiteFolders(deps: DriveDeps, siteId: string): Promise<string> {
  return deps.withLock("drive:site:" + siteId, async () => {
    const site = await deps.db.getSite(siteId);
    if (!site) throw new Error("site not found");
    if (site.photosDriveFolderId) return site.photosDriveFolderId;
    const label = site.companyName || site.address || site.id;
    const siteFolder = await deps.drive.createFolder(site.customerName + " - " + label, deps.drive.rootFolderId());
    const [photos, drawings] = await Promise.all([deps.drive.createFolder("Photographs", siteFolder.id), deps.drive.createFolder("Drawings", siteFolder.id)]);
    await deps.db.saveSiteFolders(siteId, { photosId: photos.id, photosUrl: photos.webViewLink, drawingsId: drawings.id, drawingsUrl: drawings.webViewLink });
    return photos.id;
  });
}

export const ensureDgFolder = (deps: DriveDeps, photosFolderId: string, dgIndex: number) =>
  findOrCreate(deps, "drive:dg:" + photosFolderId + ":" + dgIndex, "DG " + dgIndex, photosFolderId);

/** A photo uploaded while the order is still a draft. */
export async function uploadDraftPhoto(deps: DriveDeps, p: { attachmentId: string; bytes: Buffer; mimeType: string }): Promise<DriveFolder> {
  const folder = await ensureDraftsFolder(deps);
  return deps.drive.upload("draft-" + p.attachmentId.slice(0, 12) + "." + extFor(p.mimeType), p.mimeType, p.bytes, folder.id);
}

/** A photo added to an existing order's site: straight into its final folder. */
export async function uploadSitePhoto(deps: DriveDeps, p: { siteId: string; siteName: string | null; bytes: Buffer; mimeType: string }): Promise<DriveFolder & { dgIndex: number }> {
  const dgIndex = dgIndexFromSiteName(p.siteName);
  const dg = await ensureDgFolder(deps, await ensureSiteFolders(deps, p.siteId), dgIndex);
  const k = (await deps.db.countFiled(p.siteId, dgIndex)) + 1;
  const date = isoDateIST((deps.now ?? (() => new Date()))());
  const f = await deps.drive.upload(date + "-" + k + "." + extFor(p.mimeType), p.mimeType, p.bytes, dg.id);
  return { ...f, dgIndex };
}

/** Moves draft photos of submitted orders into their DG folders. Idempotent; stops after budgetMs and leaves the rest for the daily retry. */
export async function fileUnfiledPhotos(deps: DriveDeps, opts: { submissionId?: string; limit?: number; budgetMs?: number } = {}): Promise<{ filed: number; left: number }> {
  const now = deps.now ?? (() => new Date());
  const started = now().getTime();
  const rows = await deps.db.listUnfiled({ submissionId: opts.submissionId, limit: opts.limit ?? 200 });
  const bySite = new Map<string, UnfiledPhoto[]>();
  for (const r of rows) bySite.set(r.siteId, [...(bySite.get(r.siteId) ?? []), r]);
  let filed = 0;
  outer: for (const [siteId, list] of bySite) {
    const byDg = new Map<number, UnfiledPhoto[]>();
    for (const r of list) byDg.set(r.dgIndex ?? 1, [...(byDg.get(r.dgIndex ?? 1) ?? []), r]);
    for (const [dgIndex, photos] of byDg) {
      if (opts.budgetMs && now().getTime() - started > opts.budgetMs) break outer;
      try {
        const dg = await ensureDgFolder(deps, await ensureSiteFolders(deps, siteId), dgIndex);
        let k = await deps.db.countFiled(siteId, dgIndex);
        for (const ph of photos.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
          k++;
          await deps.drive.move(driveIdOf(ph.storagePath), dg.id, isoDateIST(now()) + "-" + k + "." + extFor(ph.mimeType));
          await deps.db.markFiled(ph.id, dgIndex, now());
          filed++;
        }
      } catch {
        // leave these for the next run; nothing sensitive is logged
      }
    }
  }
  return { filed, left: rows.length - filed };
}

// ---------------- production wiring (lazy: googleapis and Prisma load only when a photo is handled) ----------------
let override: DriveApi | null = null;
/** Test hook: use a fake Drive. */
export function setDriveApiOverride(api: DriveApi | null): void { override = api; }

export function realDriveApi(): DriveApi {
  if (override) return override;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const g = require("./googleDrive") as typeof import("./googleDrive");
  if (!g.driveConfigured()) throw new DriveUnavailableError();
  return {
    rootFolderId: () => g.getDriveFolderId(),
    createFolder: (n, p) => g.createDriveFolder(n, p),
    findFolder: (n, p) => g.findDriveFolder(n, p),
    upload: (n, m, b, p) => g.uploadDriveFile(n, m, b, p),
    move: (f, to, name) => g.moveDriveFile(f, to, name),
    download: (f) => g.downloadDriveFile(f),
    remove: (f) => g.deleteDriveFile(f),
  };
}

export function prodDriveDeps(): DriveDeps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prisma } = require("./prisma") as typeof import("./prisma");
  const drive = realDriveApi();
  return {
    drive,
    withLock: (key, fn) => prisma.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`; return fn(); }, { timeout: 60_000, maxWait: 30_000 }),
    db: {
      async getSite(id) {
        const s = await prisma.site.findUnique({ where: { id }, select: { id: true, companyName: true, address: true, photosDriveFolderId: true, order: { select: { customer: { select: { name: true } } } } } });
        return s ? { id: s.id, companyName: s.companyName, address: s.address, photosDriveFolderId: s.photosDriveFolderId, customerName: s.order.customer.name } : null;
      },
      async saveSiteFolders(id, f) {
        await prisma.site.update({ where: { id }, data: { photosDriveFolderId: f.photosId, photosDriveFolderUrl: f.photosUrl, drawingsDriveFolderId: f.drawingsId, drawingsDriveFolderUrl: f.drawingsUrl } });
      },
      async listUnfiled({ submissionId, limit }) {
        const rows = await prisma.portalAttachment.findMany({
          where: { kind: "site_photo", storagePath: { startsWith: "drive:" }, siteId: { not: null }, driveFiledAt: null, ...(submissionId ? { submissionId } : {}) },
          select: { id: true, siteId: true, storagePath: true, mimeType: true, dgIndex: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: limit,
        });
        return rows.map((r) => ({ ...r, siteId: r.siteId as string }));
      },
      countFiled: (siteId, dgIndex) => prisma.portalAttachment.count({ where: { siteId, dgIndex, kind: "site_photo", driveFiledAt: { not: null } } }),
      async markFiled(id, dgIndex, now) { await prisma.portalAttachment.update({ where: { id }, data: { dgIndex, driveFiledAt: now } }); },
    },
  };
}
