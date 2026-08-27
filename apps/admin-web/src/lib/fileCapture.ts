/** Client-side helpers for the Vendor Invoice capture flow: downscale/compress a photographed
 * bill before it becomes a base64 data-URL upload (same convention as Expense.receiptUrl /
 * Site photos), and read a PDF straight through. Keeps the payload under the ~2-4MB cap the
 * backend enforces without needing any server round-trip just to check size.
 */

export interface CapturedFile {
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
}

const MAX_DIMENSION = 1800;
const JPEG_QUALITY = 0.78;
const MAX_BYTES = 4 * 1024 * 1024;

function dataUrlSizeBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((base64.length * 3) / 4);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read this image file."));
    img.src = URL.createObjectURL(file);
  });
}

async function compressImage(file: File): Promise<CapturedFile> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);

  let quality = JPEG_QUALITY;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  // Step quality down if still too large - handles a very large/high-detail source photo.
  while (dataUrlSizeBytes(dataUrl) > MAX_BYTES && quality > 0.35) {
    quality -= 0.15;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return { dataUrl, mimeType: "image/jpeg", sizeBytes: dataUrlSizeBytes(dataUrl) };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read this file."));
    reader.readAsDataURL(file);
  });
}

/** Compresses images client-side (downscale + re-encode as JPEG); passes PDFs through as-is
 * but rejects one over the size cap outright, since a PDF can't be losslessly shrunk here. */
export async function captureFile(file: File): Promise<CapturedFile> {
  if (file.type === "application/pdf") {
    const dataUrl = await readAsDataUrl(file);
    const sizeBytes = dataUrlSizeBytes(dataUrl);
    if (sizeBytes > MAX_BYTES) {
      throw new Error("This PDF is too large (max ~4MB). Please use a smaller file or a photo instead.");
    }
    return { dataUrl, mimeType: "application/pdf", sizeBytes };
  }
  if (file.type.startsWith("image/")) {
    return compressImage(file);
  }
  throw new Error("Please upload an image (JPG/PNG) or a PDF.");
}
