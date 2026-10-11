import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma";

export type AssetKind = "logo" | "signature";
export interface AssetBytes { bytes: Buffer; contentType: string; hash: string }

// Server-side cap on an uploaded image data URL (the admin UI downsizes before sending).
export const MAX_ASSET_DATA_URL_LENGTH = 300 * 1024;
const TTL_MS = 10 * 60 * 1000;
const COLUMN = { logo: "logoDataUrl", signature: "signatoryDataUrl" } as const;

type CacheEntry = { at: number; value: AssetBytes | null };
const cache = new Map<AssetKind, CacheEntry>();

export function invalidateAssetCache() {
  cache.clear();
}

export function parseDataUrl(dataUrl: string): { bytes: Buffer; contentType: string } | null {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m || !m[1].startsWith("image/")) return null;
  return { bytes: Buffer.from(m[2], "base64"), contentType: m[1] };
}

/** Validation for an incoming PUT value: undefined/null pass through, strings must be a small image data URL. */
export function assetDataUrlError(label: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return `${label} must be an image data URL`;
  if (value.length > MAX_ASSET_DATA_URL_LENGTH) {
    return `${label} is too large (${Math.round(value.length / 1024)} KB); the limit is ${Math.round(MAX_ASSET_DATA_URL_LENGTH / 1024)} KB. Use a smaller image.`;
  }
  if (!parseDataUrl(value)) return `${label} must be a base64 image data URL`;
  return null;
}

/**
 * Short version tag for the image URL, computed in the database so the multi-MB column is never
 * transferred. Returns null when there is no image. One cheap query returns both hashes.
 */
export async function assetVersions(): Promise<{ logo: string | null; signature: string | null }> {
  const rows = await prisma.$queryRaw<{ logo: string | null; signature: string | null }[]>`
    SELECT md5("logoDataUrl") AS logo, md5("signatoryDataUrl") AS signature
    FROM "CompanySettings" WHERE id = 'singleton'`;
  const r = rows[0];
  return { logo: r?.logo ?? null, signature: r?.signature ?? null };
}

/** Decoded image bytes, cached in memory (per instance) for 10 minutes. */
export async function getAsset(kind: AssetKind): Promise<AssetBytes | null> {
  const hit = cache.get(kind);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const column = COLUMN[kind];
  const row = await prisma.companySettings.findUnique({
    where: { id: "singleton" },
    select: { [column]: true },
  } as any) as Record<string, string | null> | null;
  const parsed = row?.[column] ? parseDataUrl(row[column]!) : null;
  const value = parsed
    ? { ...parsed, hash: createHash("md5").update(row![column]!).digest("hex") }
    : null;
  cache.set(kind, { at: Date.now(), value });
  return value;
}
