/** Agent tool: search and read documents in the company's Drive folder (ZanF_DropBox).
 *
 * Two-step by design, same shape as an LLM tool would call it:
 *   1. searchDriveDocuments(query) - cheap, returns matches without downloading content.
 *   2. getDriveDocumentContent(fileId) - fetches + extracts text for one specific file.
 * Keeping these separate avoids downloading/extracting every match just to list results.
 *
 * Security rule: only DESCENDANTS of the configured folder (any depth) are ever searched,
 * listed or read. Drive queries have no "descendant of" operator, so the folder tree under the
 * root is listed once (cached for FOLDER_TREE_TTL_MS) and every query is scoped with
 * `'<folder>' in parents` over that tree, in chunks. Before 2026-10 only direct children of the
 * root were searched, with one exact-phrase fullText clause and 10 results, so anything filed
 * in a subfolder (e.g. invoice or site folders) was invisible.
 */
import { getDriveClient, getDriveFolderId } from "../../lib/googleDrive";
import { extractText, isExtractable, ExtractionError } from "../../lib/docExtract";

export interface DriveSearchResult {
  fileId: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  /** Folder path below the shared root, e.g. "ZanF_DropBox / Invoices / 2026-27". */
  folderPath: string;
  modifiedTime: string | null | undefined;
  webViewLink: string | null | undefined;
}

/** The subset of the googleapis Drive v3 client used here (lets tests pass a fake). */
export interface DriveLike {
  files: {
    list(params: Record<string, unknown>): Promise<{ data: { files?: DriveFile[] | null; nextPageToken?: string | null } }>;
    get(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ data: unknown }>;
    export(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ data: unknown }>;
  };
}

export interface DriveFile {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  parents?: string[] | null;
  modifiedTime?: string | null;
  webViewLink?: string | null;
  trashed?: boolean | null;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Shared drives and items shared into the account are searched too, not just My Drive. */
const ALL_DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: "allDrives" };
const FILE_FIELDS = "nextPageToken, files(id, name, mimeType, parents, modifiedTime, webViewLink)";
/** Parents per query - keeps each q string well inside Drive's query length limit. */
export const PARENT_CHUNK = 40;
const MAX_PAGES_PER_QUERY = 5;
const MAX_FOLDERS = 2000;
export const FOLDER_TREE_TTL_MS = 10 * 60_000;

/** Google-native docs/sheets need to be exported to a plain format rather than downloaded raw. */
const GOOGLE_EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};

export function escapeDriveQuery(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Search words: punctuation-separated tokens, lower-cased, 2+ chars ("PCR" kept). */
export function searchTokens(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2))];
}

/** Matches the phrase OR every word, in the file name OR the indexed content - so "proforma
 * invoice" also finds "Proforma_Invoice_ELCOT.pdf" and "PI - proforma ... invoice" text, and
 * "PCR" finds "PCR Report.pdf" by name even when the content isn't indexed. */
export function buildTextClause(query: string): string {
  const phrase = escapeDriveQuery(query.trim());
  const tokens = searchTokens(query).map(escapeDriveQuery);
  const clauses = [`name contains '${phrase}'`, `fullText contains '${phrase}'`];
  if (tokens.length > 1) {
    clauses.push(`(${tokens.map((t) => `name contains '${t}'`).join(" and ")})`);
    clauses.push(`(${tokens.map((t) => `fullText contains '${t}'`).join(" and ")})`);
  }
  return `(${clauses.join(" or ")})`;
}

export function parentsClause(folderIds: string[]): string {
  return `(${folderIds.map((id) => `'${escapeDriveQuery(id)}' in parents`).join(" or ")})`;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface FolderTree {
  rootId: string;
  folders: Map<string, { name: string; parentId: string | null }>;
}

/** "Root / Sub / Leaf" for a folder in the tree (the root is shown by its own name). */
export function folderPath(tree: FolderTree, folderId: string | null | undefined): string {
  const names: string[] = [];
  let id = folderId ?? null;
  for (let guard = 0; id && guard < 50; guard++) {
    const f = tree.folders.get(id);
    if (!f) break;
    names.unshift(f.name);
    id = f.parentId;
  }
  return names.join(" / ");
}

/** First parent of a file that lies inside the tree, or null if it is outside. */
export function parentInTree(tree: FolderTree, parents: string[] | null | undefined): string | null {
  return (parents ?? []).find((p) => tree.folders.has(p)) ?? null;
}

async function listAll(drive: DriveLike, q: string, extra: Record<string, unknown> = {}, maxPages = MAX_PAGES_PER_QUERY): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await drive.files.list({ q, fields: FILE_FIELDS, pageSize: 100, ...ALL_DRIVES, ...extra, ...(pageToken ? { pageToken } : {}) });
    out.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }
  return out;
}

/** Breadth-first listing of every folder under the root, one Drive query per level-chunk. */
export async function buildFolderTree(drive: DriveLike, rootId: string, rootName = "Shared folder"): Promise<FolderTree> {
  const folders = new Map<string, { name: string; parentId: string | null }>([[rootId, { name: rootName, parentId: null }]]);
  let frontier = [rootId];
  while (frontier.length > 0 && folders.size < MAX_FOLDERS) {
    const next: string[] = [];
    for (const ids of chunk(frontier, PARENT_CHUNK)) {
      const children = await listAll(drive, `mimeType = '${FOLDER_MIME}' and trashed = false and ${parentsClause(ids)}`, {}, 20);
      for (const f of children) {
        // Only trust a folder whose parent really is one we asked about - never widen the tree.
        const parentId = parentInTreeIds(ids, f.parents);
        if (!f.id || folders.has(f.id) || !parentId) continue;
        folders.set(f.id, { name: f.name ?? "(untitled)", parentId });
        next.push(f.id);
      }
    }
    frontier = next;
  }
  return { rootId, folders };
}

function parentInTreeIds(ids: string[], parents: string[] | null | undefined): string | null {
  return (parents ?? []).find((p) => ids.includes(p)) ?? null;
}

let cachedTree: { tree: FolderTree; at: number } | undefined;

/** Cached folder tree (per warm instance). `force` rebuilds it, e.g. when a file's parent is a
 * folder created after the cache was filled. */
export async function getFolderTree(drive: DriveLike, rootId: string, opts: { force?: boolean; now?: number } = {}): Promise<FolderTree> {
  const now = opts.now ?? Date.now();
  if (!opts.force && cachedTree && cachedTree.tree.rootId === rootId && now - cachedTree.at < FOLDER_TREE_TTL_MS) return cachedTree.tree;
  let rootName = "Shared folder";
  try {
    const meta = (await drive.files.get({ fileId: rootId, fields: "id, name", supportsAllDrives: true })).data as DriveFile;
    rootName = meta.name ?? rootName;
  } catch {
    // Name is cosmetic; the tree itself is what scopes access.
  }
  const tree = await buildFolderTree(drive, rootId, rootName);
  cachedTree = { tree, at: now };
  return tree;
}

export function resetFolderTreeCache(): void {
  cachedTree = undefined;
}

function toResult(tree: FolderTree, f: DriveFile): DriveSearchResult {
  return {
    fileId: f.id!,
    name: f.name ?? "(untitled)",
    mimeType: f.mimeType ?? "",
    isFolder: f.mimeType === FOLDER_MIME,
    folderPath: folderPath(tree, parentInTree(tree, f.parents)),
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
  };
}

/** Name matches on every word rank first, then everything else; newest first within each group. */
export function rankResults(results: DriveSearchResult[], query: string): DriveSearchResult[] {
  const tokens = searchTokens(query);
  const nameHit = (r: DriveSearchResult) => tokens.length > 0 && tokens.every((t) => r.name.toLowerCase().includes(t));
  return [...results].sort((a, b) => Number(nameHit(b)) - Number(nameHit(a)) || String(b.modifiedTime ?? "").localeCompare(String(a.modifiedTime ?? "")));
}

export async function searchDriveDocuments(
  query: string,
  maxResults = 25,
  deps: { drive?: DriveLike; rootId?: string } = {},
): Promise<{ query: string; searchedFolders: number; totalMatches: number; results: DriveSearchResult[]; note?: string }> {
  const drive = deps.drive ?? (getDriveClient() as unknown as DriveLike);
  const rootId = deps.rootId ?? getDriveFolderId();
  if (!query.trim()) return { query, searchedFolders: 0, totalMatches: 0, results: [], note: "Give a search term." };
  const tree = await getFolderTree(drive, rootId);
  const text = buildTextClause(query);
  const batches = await Promise.all(
    chunk([...tree.folders.keys()], PARENT_CHUNK).map((ids) => listAll(drive, `trashed = false and ${parentsClause(ids)} and ${text}`)),
  );
  const seen = new Set<string>();
  const results: DriveSearchResult[] = [];
  for (const f of batches.flat()) {
    if (!f.id || seen.has(f.id) || !parentInTree(tree, f.parents)) continue;
    seen.add(f.id);
    results.push(toResult(tree, f));
  }
  const ranked = rankResults(results, query);
  return {
    query,
    searchedFolders: tree.folders.size,
    totalMatches: ranked.length,
    results: ranked.slice(0, maxResults),
    ...(ranked.length === 0
      ? { note: `No file or folder under the shared folder (${tree.folders.size} folders searched, names and indexed content) matches. Documents stored outside that folder tree are not visible to the agent.` }
      : {}),
  };
}

/** Lists the most recently modified files anywhere under the folder (folders themselves excluded). */
export async function listDriveDocuments(maxResults = 50, deps: { drive?: DriveLike; rootId?: string } = {}): Promise<DriveSearchResult[]> {
  const drive = deps.drive ?? (getDriveClient() as unknown as DriveLike);
  const rootId = deps.rootId ?? getDriveFolderId();
  const tree = await getFolderTree(drive, rootId);
  const batches = await Promise.all(
    chunk([...tree.folders.keys()], PARENT_CHUNK).map((ids) =>
      listAll(drive, `trashed = false and mimeType != '${FOLDER_MIME}' and ${parentsClause(ids)}`, { orderBy: "modifiedTime desc" }, 1),
    ),
  );
  return batches
    .flat()
    .filter((f) => f.id && parentInTree(tree, f.parents))
    .map((f) => toResult(tree, f))
    .sort((a, b) => String(b.modifiedTime ?? "").localeCompare(String(a.modifiedTime ?? "")))
    .slice(0, maxResults);
}

export async function getDriveDocumentContent(
  fileId: string,
  deps: { drive?: DriveLike; rootId?: string } = {},
): Promise<{ name: string; mimeType: string; folderPath: string; webViewLink: string | null | undefined; text: string }> {
  const drive = deps.drive ?? (getDriveClient() as unknown as DriveLike);
  const rootId = deps.rootId ?? getDriveFolderId();
  const meta = await getFileMetadataWithinFolder(drive, fileId, rootId);

  if (!isExtractable(meta.mimeType)) {
    throw new ExtractionError(`Unsupported file type: ${meta.mimeType}`);
  }
  const exportMime = GOOGLE_EXPORT_MIME[meta.mimeType];
  const buffer = exportMime ? await downloadExport(drive, fileId, exportMime) : await downloadRaw(drive, fileId);
  const text = await extractText(buffer, exportMime ?? meta.mimeType);
  return { name: meta.name, mimeType: meta.mimeType, folderPath: meta.folderPath, webViewLink: meta.webViewLink, text };
}

/** Resolve metadata only after proving the file's parent is a folder inside the configured
 * tree. A caller-supplied file ID must never broaden the account's effective data scope. */
export async function getFileMetadataWithinFolder(
  drive: DriveLike,
  fileId: string,
  rootId: string,
): Promise<{ name: string; mimeType: string; folderPath: string; webViewLink: string | null | undefined }> {
  if (!fileId || fileId === rootId) throw new ExtractionError("Could not resolve the requested Drive file");
  const meta = (await drive.files.get({ fileId, fields: "id, name, mimeType, parents, trashed, webViewLink", supportsAllDrives: true })).data as DriveFile;
  if (meta.trashed) throw new ExtractionError("The requested Drive file is in trash");
  if (!meta.name || !meta.mimeType) throw new ExtractionError("The requested Drive file has incomplete metadata");

  let tree = await getFolderTree(drive, rootId);
  let parent = parentInTree(tree, meta.parents);
  if (!parent) {
    // The parent may be a folder created after the tree was cached - rebuild once.
    tree = await getFolderTree(drive, rootId, { force: true });
    parent = parentInTree(tree, meta.parents);
  }
  if (!parent) throw new ExtractionError("The requested Drive file is outside the configured folder");
  return { name: meta.name, mimeType: meta.mimeType, folderPath: folderPath(tree, parent), webViewLink: meta.webViewLink };
}

/** Download cap, so a stuck Drive response fails the tool call fast instead of eating the turn.
 * Read-only by design: Drive has no read-only API that returns a PDF's text (files.export only
 * covers Google Docs/Sheets; OCR needs a copy-and-convert, i.e. a write), so PDFs are always
 * downloaded and parsed in-process. */
export const DRIVE_DOWNLOAD_TIMEOUT_MS = 20_000;

async function downloadRaw(drive: DriveLike, fileId: string): Promise<Buffer> {
  const res = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer", timeout: DRIVE_DOWNLOAD_TIMEOUT_MS });
  return Buffer.from(res.data as ArrayBuffer);
}

async function downloadExport(drive: DriveLike, fileId: string, exportMimeType: string): Promise<Buffer> {
  const res = await drive.files.export({ fileId, mimeType: exportMimeType }, { responseType: "arraybuffer", timeout: DRIVE_DOWNLOAD_TIMEOUT_MS });
  return Buffer.from(res.data as ArrayBuffer);
}
