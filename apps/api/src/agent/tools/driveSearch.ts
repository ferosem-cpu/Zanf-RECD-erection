/** Agent tool: search and read documents in the company's Drive folder (ZanF_DropBox).
 *
 * Two-step by design, same shape as an LLM tool would call it:
 *   1. searchDriveDocuments(query) - cheap, returns matches without downloading content.
 *   2. getDriveDocumentContent(fileId) - fetches + extracts text for one specific file.
 * Keeping these separate avoids downloading/extracting every match just to list results.
 */
import { getDriveClient, getDriveFolderId } from "../../lib/googleDrive";
import { extractText, isExtractable, ExtractionError } from "../../lib/docExtract";

export interface DriveSearchResult {
  fileId: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null | undefined;
  webViewLink: string | null | undefined;
}

/** Google-native docs/sheets need to be exported to a plain format rather than downloaded raw. */
const GOOGLE_EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};

export async function searchDriveDocuments(query: string, maxResults = 10): Promise<DriveSearchResult[]> {
  const drive = getDriveClient();
  const folderId = getDriveFolderId();

  // fullText search covers document content (not just filenames); scoped to the one folder
  // (non-recursive - Drive's `in parents` only matches direct children) and excludes trash.
  const escapedQuery = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `'${folderId}' in parents and trashed = false and fullText contains '${escapedQuery}'`;

  const res = await drive.files.list({
    q,
    fields: "files(id, name, mimeType, modifiedTime, webViewLink)",
    pageSize: maxResults,
  });

  return (res.data.files ?? []).map((f) => ({
    fileId: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
  }));
}

/** Lists all documents in the folder without a search filter - useful for browsing / "what's in there". */
export async function listDriveDocuments(maxResults = 50): Promise<DriveSearchResult[]> {
  const drive = getDriveClient();
  const folderId = getDriveFolderId();

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, modifiedTime, webViewLink)",
    pageSize: maxResults,
    orderBy: "modifiedTime desc",
  });

  return (res.data.files ?? []).map((f) => ({
    fileId: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
  }));
}

export async function getDriveDocumentContent(fileId: string): Promise<{ name: string; mimeType: string; text: string }> {
  const drive = getDriveClient();
  const folderId = getDriveFolderId();
  const meta = await getFileMetadataWithinFolder(drive, fileId, folderId);
  const mimeType = meta.mimeType;
  const name = meta.name;

  if (!isExtractable(mimeType)) {
    throw new ExtractionError(`Unsupported file type: ${mimeType}`);
  }

  const exportMime = GOOGLE_EXPORT_MIME[mimeType];
  const buffer = exportMime
    ? await downloadExport(drive, fileId, exportMime)
    : await downloadRaw(drive, fileId);

  const text = await extractText(buffer, exportMime ?? mimeType);
  return { name, mimeType, text };
}

/** Resolve metadata only after proving the file is inside the configured Drive folder tree.
 * A caller-supplied file ID must never broaden the service account's effective data scope.
 */
async function getFileMetadataWithinFolder(
  drive: ReturnType<typeof getDriveClient>,
  fileId: string,
  folderId: string,
): Promise<{ name: string; mimeType: string }> {
  const queue = [fileId];
  const visited = new Set<string>();
  let requestedFile: { name: string; mimeType: string } | undefined;

  while (queue.length > 0 && visited.size < 100) {
    const currentId = queue.shift()!;
    if (currentId === folderId) {
      if (!requestedFile) throw new ExtractionError("Could not resolve the requested Drive file");
      return requestedFile;
    }
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const meta = await drive.files.get({ fileId: currentId, fields: "id, name, mimeType, parents, trashed" });
    if (currentId === fileId) {
      if (meta.data.trashed) throw new ExtractionError("The requested Drive file is in trash");
      if (!meta.data.name || !meta.data.mimeType) {
        throw new ExtractionError("The requested Drive file has incomplete metadata");
      }
      requestedFile = { name: meta.data.name, mimeType: meta.data.mimeType };
    }
    for (const parentId of meta.data.parents ?? []) {
      if (!visited.has(parentId)) queue.push(parentId);
    }
  }

  throw new ExtractionError("The requested Drive file is outside the configured folder");
}

async function downloadRaw(drive: ReturnType<typeof getDriveClient>, fileId: string): Promise<Buffer> {
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(res.data as ArrayBuffer);
}

async function downloadExport(
  drive: ReturnType<typeof getDriveClient>,
  fileId: string,
  exportMimeType: string,
): Promise<Buffer> {
  const res = await drive.files.export({ fileId, mimeType: exportMimeType }, { responseType: "arraybuffer" });
  return Buffer.from(res.data as ArrayBuffer);
}
