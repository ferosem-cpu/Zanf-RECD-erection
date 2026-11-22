/** Upload type detection by file signature (never trusts the extension or declared type). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export type DetectedType = { mime: string; ext: string; image: boolean } | null;

const startsWith = (b: Buffer, sig: number[], off = 0) => sig.every((v, i) => b[off + i] === v);

export function detectFileType(b: Buffer): DetectedType {
  if (b.length < 12) return null;
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", image: true };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png", image: true };
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: "image/webp", ext: "webp", image: true };
  if (startsWith(b, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = b.subarray(8, 12).toString("latin1");
    if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(brand)) return { mime: "image/heic", ext: "heic", image: true };
  }
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf", image: false };
  return null;
}

export const UPLOAD_KINDS = ["po", "site_photo", "document", "complaint_photo", "priority_document"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];
/** Which kinds may be non-images. */
export const PDF_KINDS: UploadKind[] = ["po", "document", "priority_document"];
