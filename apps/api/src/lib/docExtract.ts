/** Extracts plain text from a document buffer, given its Drive mimeType.
 *
 * Mirrors MyPersonalAgent's agent/services/doc_extract.py scope: PDF, DOCX, and plain
 * text/CSV/Markdown. Scanned/image-only PDFs and images are explicitly unsupported (would
 * need OCR, not wired up) - callers should treat a thrown ExtractionError as "not searchable
 * content" rather than a hard failure.
 */
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

export class ExtractionError extends Error {}

const GOOGLE_DOC_EXPORT_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_EXPORT_MIME = "application/vnd.google-apps.spreadsheet";

export function isExtractable(mimeType: string): boolean {
  return (
    mimeType === "application/pdf" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "text/plain" ||
    mimeType === "text/csv" ||
    mimeType === "text/markdown" ||
    mimeType === GOOGLE_DOC_EXPORT_MIME ||
    mimeType === GOOGLE_SHEET_EXPORT_MIME
  );
}

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      if (!result.text.trim()) {
        throw new ExtractionError("PDF has no extractable text (likely scanned/image-only - OCR not supported).");
      }
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimeType === "text/plain" || mimeType === "text/csv" || mimeType === "text/markdown") {
    return buffer.toString("utf-8");
  }

  throw new ExtractionError(`Unsupported file type for extraction: ${mimeType}`);
}
