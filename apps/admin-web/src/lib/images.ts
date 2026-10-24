const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/** Absolute URL for an API-relative image path such as `/settings/logo?v=<hash>`. */
export function apiAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return /^(https?:|data:|blob:)/.test(path) ? path : `${API_URL}${path}`;
}

export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

interface ImageLike { complete?: boolean; decode?: () => Promise<void> }

/** Resolves when every image has loaded/decoded, or after `timeoutMs` (broken images never block). */
export function waitForImages(imgs: ImageLike[], timeoutMs = 5000): Promise<void> {
  const all = Promise.all(
    imgs.map((img) => (img.decode ? img.decode() : Promise.resolve()).catch(() => {})),
  ).then(() => {});
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    all.then(() => { clearTimeout(timer); resolve(); });
  });
}

/** Print only once every <img> on the page has finished, so a fresh load never prints a blank logo. */
export async function printWhenReady() {
  await waitForImages(Array.from(document.images));
  window.print();
}

/** Downscale an image file to a PNG data URL (longest side `maxSide`), shrinking further if still large. */
export async function downscaleImageToDataUrl(file: File, maxSide = 600, maxLength = 130_000): Promise<string> {
  const bitmap = await createImageBitmap(file);
  let side = maxSide;
  for (;;) {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, side);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/png");
    if (dataUrl.length <= maxLength || side <= 150) return dataUrl;
    side = Math.round(side * 0.75);
  }
}
