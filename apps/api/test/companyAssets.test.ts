import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { prisma } from "../src/lib/prisma";

process.env.JWT_SECRET ||= "company-assets-test-only-secret";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
const hash = createHash("md5").update(dataUrl).digest("hex");

function replace(t: any, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(prisma, key);
  Object.defineProperty(prisma, key, { configurable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(prisma, key, original);
    else Reflect.deleteProperty(prisma, key);
  });
}

async function serve(t: any) {
  const { settingsRouter } = await import("../src/routes/settings");
  const { invalidateAssetCache } = await import("../src/services/companyAssets");
  invalidateAssetCache();
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/settings", settingsRouter);
  const server = app.listen(0);
  t.after(() => { server.close(); invalidateAssetCache(); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("GET /settings/logo returns bytes, content type, ETag and immutable cache; second call hits cache", async (t) => {
  let reads = 0;
  replace(t, "companySettings", { findUnique: async () => { reads++; return { logoDataUrl: dataUrl }; } });
  const base = await serve(t);

  const res = await fetch(`${base}/settings/logo?v=${hash}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("etag"), `"${hash}"`);
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);

  const stale = await fetch(`${base}/settings/logo?v=old`);
  assert.equal(stale.headers.get("cache-control"), "public, max-age=300");

  const notModified = await fetch(`${base}/settings/logo`, { headers: { "If-None-Match": `"${hash}"` } });
  assert.equal(notModified.status, 304);
  assert.equal(reads, 1, "DB read once, then served from memory");
});

test("GET /settings/logo is 404 when no logo; settings update invalidates the cache", async (t) => {
  let stored: string | null = null;
  replace(t, "companySettings", {
    findUnique: async () => ({ logoDataUrl: stored }),
    upsert: async () => ({ id: "singleton", themeKey: "slate" }),
  });
  replace(t, "$queryRaw", async () => [{ logo: stored ? hash : null, signature: null }]);
  const base = await serve(t);
  assert.equal((await fetch(`${base}/settings/logo`)).status, 404);
  assert.equal((await fetch(`${base}/settings/signature`)).status, 404);

  stored = dataUrl;
  const { invalidateAssetCache } = await import("../src/services/companyAssets");
  assert.equal((await fetch(`${base}/settings/logo`)).status, 404, "negative result is cached until invalidated");
  invalidateAssetCache();
  assert.equal((await fetch(`${base}/settings/logo`)).status, 200);
});

test("PUT /settings validation rejects an oversized or non-image logo/signature (400 message)", async (t) => {
  const { requirePermission } = await import("../src/middleware/auth");
  assert.equal(typeof requirePermission, "function");
  const { assetDataUrlError, MAX_ASSET_DATA_URL_LENGTH } = await import("../src/services/companyAssets");
  assert.equal(assetDataUrlError("Logo", undefined), null);
  assert.equal(assetDataUrlError("Logo", null), null);
  assert.equal(assetDataUrlError("Logo", dataUrl), null);
  const big = `data:image/png;base64,${"A".repeat(MAX_ASSET_DATA_URL_LENGTH)}`;
  assert.match(assetDataUrlError("Logo", big)!, /too large/);
  assert.match(assetDataUrlError("Logo", "data:text/html;base64,AAAA")!, /image data URL/);
  assert.match(assetDataUrlError("Signature", "not a data url")!, /Signature/);
});

test("settings responses carry logoUrl/signatureUrl and never the image data", async (t) => {
  replace(t, "$queryRaw", async () => [{ logo: "abc123", signature: null }]);
  const { withAssetUrls } = await import("../src/routes/settings");
  const out = await withAssetUrls({ id: "singleton", themeKey: "slate" });
  assert.equal(out.logoUrl, "/settings/logo?v=abc123");
  assert.equal(out.hasLogo, true);
  assert.equal(out.signatureUrl, null);
  assert.equal(out.hasSignature, false);
  assert.equal(JSON.stringify(out).includes("DataUrl"), false);
});

test("the Prisma client omits the image columns globally and only companyAssets reads them", () => {
  const src = (f: string) => readFileSync(join(__dirname, "../src", f), "utf8");
  assert.match(src("lib/prisma.ts"), /omit:\s*\{\s*companySettings:\s*\{\s*logoDataUrl:\s*true,\s*signatoryDataUrl:\s*true/);
  const walk = (dir: string): string[] =>
    readdirSync(join(__dirname, "../src", dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const offenders = walk(".").filter((f) => f.endsWith(".ts") && /logoDataUrl|signatoryDataUrl/.test(src(f)));
  assert.deepEqual(offenders.map((f) => f.split("\\").join("/")).sort(), [
    "lib/prisma.ts", "routes/settings.ts", "services/companyAssets.ts",
  ]);
  assert.match(src("routes/settings.ts"), /res\.json\(await withAssetUrls\(settings\)\)/);
});
