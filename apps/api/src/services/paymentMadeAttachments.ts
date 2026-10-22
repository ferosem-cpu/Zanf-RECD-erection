import { PAYMENT_MADE_MAX_ATTACHMENTS } from "@recd/shared";

/** Vendor payment attachments: base64 data-URLs in PaymentMadeAttachment.dataUrl (same storage
 * convention as Bill.attachmentUrl - no Drive, no new storage). dataUrl is omitted by default in
 * lib/prisma.ts; lists only ever return the metadata below. */

/** Metadata-only select for lists/details - never the file bytes. */
export const attachmentMetaSelect = { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } as const;

export interface AttachmentInput {
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

/** Approx decoded size of a base64 data-URL, in bytes. */
export function dataUrlSizeBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  return Math.floor(((comma === -1 ? dataUrl.length : dataUrl.length - comma - 1) * 3) / 4);
}

/** Max decoded bytes per file - matches the client cap in admin-web lib/fileCapture.ts. */
export const MAX_ATTACHMENT_BYTES = 4_500_000;

/** User-facing error for a batch of new attachments given how many the payment already has, or null. */
export function attachmentsError(incoming: AttachmentInput[], existingCount: number): string | null {
  if (existingCount + incoming.length > PAYMENT_MADE_MAX_ATTACHMENTS) {
    return `A vendor payment can have at most ${PAYMENT_MADE_MAX_ATTACHMENTS} attachments`;
  }
  for (const a of incoming) {
    const declared = /^data:([^;,]+)[;,]/.exec(a.dataUrl)?.[1];
    if (!declared || declared.toLowerCase() !== a.mimeType.toLowerCase()) return `${a.fileName}: file type does not match its contents`;
    if (dataUrlSizeBytes(a.dataUrl) > MAX_ATTACHMENT_BYTES) return `${a.fileName} is too large (max ~4MB)`;
  }
  return null;
}

export function attachmentCreateRows(incoming: AttachmentInput[], uploadedById: string) {
  return incoming.map((a) => ({
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: dataUrlSizeBytes(a.dataUrl),
    dataUrl: a.dataUrl,
    uploadedById,
  }));
}

/** Decodes a stored data-URL for the download endpoint. */
export function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  return Buffer.from(comma === -1 ? dataUrl : dataUrl.slice(comma + 1), "base64");
}

/** Content-Disposition with a safe ASCII fallback plus the UTF-8 name. */
export function contentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
