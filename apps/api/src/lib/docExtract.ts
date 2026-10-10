/** Extracts plain text from a document buffer, given its Drive mimeType.
 *
 * Mirrors MyPersonalAgent's agent/services/doc_extract.py scope: PDF, DOCX, and plain
 * text/CSV/Markdown. Scanned/image-only PDFs and images are explicitly unsupported (would
 * need OCR, not wired up) - callers should treat a thrown ExtractionError as "not searchable
 * content" rather than a hard failure.
 */
// mammoth is imported lazily too (DOCX branch below), purely to keep it off the cold start.
// pdf-parse is imported lazily inside extractText(), not statically here - importing it
// eagerly at module load crashed the ENTIRE api function on Vercel's Linux runtime, not just
// PDF extraction: pdf-parse tries to load the optional native "@napi-rs/canvas" package for
// rendering, and when that binary isn't available it falls through to a broken DOMMatrix
// polyfill path that throws `ReferenceError: DOMMatrix is not defined` at require-time. Since
// this module sits on the startup import chain (index.ts -> agent routers -> tool registry ->
// driveSearch -> docExtract), that crash took down every route including /health, not just
// document search. A dynamic import scopes the failure to only PDF extraction attempts.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The pdf.js worker: pdf-parse's bundled pdf.js loads it with `import(workerSrc)` (default
// "./pdf.worker.mjs"), a non-literal import @vercel/nft can't trace - so the deployed function
// had pdf-parse's index.cjs but no worker, and EVERY Drive PDF failed ("Setting up fake worker
// failed"), which the agent reported as "no OCR text". The __dirname-relative literal path
// (dist/lib -> repo-root node_modules, the layout both locally and inside the .func) is an
// asset reference nft does trace; setWorker points pdf.js at the file explicitly. The
// require.resolve candidate covers a differently hoisted install.
export function pdfWorkerUrl(): string {
  const traced = path.join(__dirname, "../../../../node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs");
  const file = fs.existsSync(traced) ? traced : path.join(path.dirname(require.resolve("pdf-parse")), "pdf.worker.mjs");
  return pathToFileURL(file).href;
}

/** pdf.js evaluates `new DOMMatrix()` at module load. Node has no DOMMatrix; pdf.js polyfills it
 * from the optional native "@napi-rs/canvas", whose Linux binary isn't installed (only the
 * Windows one is), so in the deployed function `import("pdf-parse")` threw "DOMMatrix is not
 * defined" and every Drive PDF failed (fix 6 only shipped the worker). Text extraction never
 * renders, so an inert stub is enough; a real DOMMatrix (browser, canvas) is left alone. */
export function ensureDomMatrix(): void {
  if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix !== "undefined") return;
  class DOMMatrixStub {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(init?: number[]) {
      if (Array.isArray(init) && init.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init;
    }
    multiplySelf() { return this; }
    preMultiplySelf() { return this; }
    translate() { return this; }
    scale() { return this; }
    invertSelf() { return this; }
  }
  (globalThis as { DOMMatrix?: unknown }).DOMMatrix = DOMMatrixStub;
}

/** Fail fast with a clear message instead of hanging the agent turn on a huge/odd PDF. */
export const PDF_EXTRACT_TIMEOUT_MS = 15_000;

export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExtractionError(message)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

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

export async function extractText(
  buffer: Buffer,
  mimeType: string,
  opts: { timeoutMs?: number; maxPages?: number } = {},
): Promise<string> {
  if (mimeType === "application/pdf") {
    let PDFParse: typeof import("pdf-parse").PDFParse;
    try {
      ensureDomMatrix();
      ({ PDFParse } = await import("pdf-parse"));
      PDFParse.setWorker(pdfWorkerUrl());
    } catch (err) {
      throw new ExtractionError(
        `PDF extraction is unavailable in this environment: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const parser = new PDFParse({ data: buffer });
    try {
      const timeoutMs = opts.timeoutMs ?? PDF_EXTRACT_TIMEOUT_MS;
      const result = await withTimeout(
        parser.getText(opts.maxPages ? { first: opts.maxPages } : undefined),
        timeoutMs,
        `PDF text extraction timed out after ${Math.round(timeoutMs / 1000)} s - the file may be very large; open it from its Drive link instead.`,
      );
      if (!result.text.trim()) {
        throw new ExtractionError("PDF has no extractable text (likely scanned/image-only - OCR not supported).");
      }
      return result.text;
    } catch (err) {
      if (err instanceof ExtractionError) throw err;
      throw new ExtractionError(
        `PDF extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await parser.destroy();
    }
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const { default: mammoth } = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimeType === "text/plain" || mimeType === "text/csv" || mimeType === "text/markdown") {
    return buffer.toString("utf-8");
  }

  throw new ExtractionError(`Unsupported file type for extraction: ${mimeType}`);
}
