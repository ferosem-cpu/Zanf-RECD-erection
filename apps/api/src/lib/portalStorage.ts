/** Private Supabase Storage bucket "portal-uploads" (never public). Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on the API. */
import { driveIdOf, isDrivePath, realDriveApi } from "./portalDrive";
export const PORTAL_BUCKET = "portal-uploads";
export class StorageUnavailableError extends Error {
  constructor() { super("File storage is not configured"); this.name = "StorageUnavailableError"; }
}
function cfg() {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new StorageUnavailableError();
  return { url, headers: { Authorization: "Bearer " + key, apikey: key } };
}
export const storageConfigured = () => !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export async function putFile(path: string, bytes: Buffer, contentType: string): Promise<void> {
  const { url, headers } = cfg();
  const r = await fetch(url + "/storage/v1/object/" + PORTAL_BUCKET + "/" + enc(path), { method: "POST", headers: { ...headers, "Content-Type": contentType, "x-upsert": "false" }, body: new Uint8Array(bytes) });
  if (!r.ok) throw new Error("storage put failed: " + r.status);
}
export async function getFile(path: string): Promise<Buffer> {
  if (isDrivePath(path)) return realDriveApi().download(driveIdOf(path)); // photos live in Google Drive (owner-checked by the calling route)
  const { url, headers } = cfg();
  const r = await fetch(url + "/storage/v1/object/" + PORTAL_BUCKET + "/" + enc(path), { headers });
  if (!r.ok) throw new Error("storage get failed: " + r.status);
  return Buffer.from(await r.arrayBuffer());
}
export async function deleteFiles(all: string[]): Promise<void> {
  const drive = all.filter(isDrivePath);
  if (drive.length) {
    try { const api = realDriveApi(); await Promise.all(drive.map((p) => api.remove(driveIdOf(p)).catch(() => undefined))); } catch { /* Drive not configured: nothing to delete */ }
  }
  const paths = all.filter((p) => !isDrivePath(p));
  if (!paths.length || !storageConfigured()) return;
  const { url, headers } = cfg();
  await fetch(url + "/storage/v1/object/" + PORTAL_BUCKET, { method: "DELETE", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths }) });
}
