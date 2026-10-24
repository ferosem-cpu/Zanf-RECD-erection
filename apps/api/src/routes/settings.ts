import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { PERMISSION_KEY } from "@recd/shared";
import { assetDataUrlError, assetVersions, getAsset, invalidateAssetCache, type AssetKind } from "../services/companyAssets";

export const settingsRouter = Router();

/** Settings as the API exposes them: never the image bytes, only versioned URLs. */
export async function withAssetUrls<T extends object>(settings: T) {
  const v = await assetVersions();
  return {
    ...settings,
    hasLogo: !!v.logo,
    logoUrl: v.logo ? `/settings/logo?v=${v.logo}` : null,
    hasSignature: !!v.signature,
    signatureUrl: v.signature ? `/settings/signature?v=${v.signature}` : null,
  };
}

// Public (an <img> cannot send the Authorization header; the logo is printed on documents anyway).
// Registered before anything parameterised. ?v=<hash> matching the current hash makes it immutable.
function assetRoute(kind: AssetKind) {
  return async (req: import("express").Request, res: import("express").Response) => {
    try {
      const asset = await getAsset(kind);
      if (!asset) return res.status(404).json({ error: `No ${kind} set` });
      const etag = `"${asset.hash}"`;
      res.setHeader("ETag", etag);
      res.setHeader("Content-Type", asset.contentType);
      res.setHeader(
        "Cache-Control",
        req.query.v === asset.hash ? "public, max-age=31536000, immutable" : "public, max-age=300",
      );
      if (req.headers["if-none-match"] === etag) return res.status(304).end();
      res.send(asset.bytes);
    } catch {
      res.status(500).json({ error: `Failed to fetch ${kind}` });
    }
  };
}
settingsRouter.get("/logo", assetRoute("logo"));
settingsRouter.get("/signature", assetRoute("signature"));

// GET /settings - Authenticated users can retrieve settings
settingsRouter.get("/", authenticate, async (req, res) => {
  try {
    const settings = await prisma.companySettings.findUnique({
      where: { id: "singleton" },
    });
    if (!settings) {
      return res.json({ themeKey: "emerald", hasLogo: false, logoUrl: null, hasSignature: false, signatureUrl: null, customColors: null });
    }
    res.json(await withAssetUrls(settings));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

// PUT /settings - Gated with MANAGE_SETTINGS
settingsRouter.put("/", authenticate, requirePermission(PERMISSION_KEY.MANAGE_SETTINGS), async (req: AuthenticatedRequest, res) => {
  const {
    logoDataUrl,
    themeKey,
    customColors,
    legalName,
    address,
    city,
    pinCode,
    state,
    gstin,
    pan,
    email,
    website,
    phone,
    bankName,
    bankAccountNumber,
    bankIfsc,
    bankBranch,
    invoiceTerms,
    quotationTerms,
    purchaseOrderTerms,
    defaultTaxRatePct,
    documentFooterNote,
    signatoryName,
    signatoryDataUrl,
    agentVisibleRoleKeys,
    agentCustomInstructions,
  } = req.body;

  const imageError = assetDataUrlError("Logo", logoDataUrl) ?? assetDataUrlError("Signature", signatoryDataUrl);
  if (imageError) return res.status(400).json({ error: imageError });

  try {
    const settings = await prisma.companySettings.upsert({
      where: { id: "singleton" },
      update: {
        logoDataUrl,
        themeKey,
        customColors,
        legalName,
        address,
        city,
        pinCode,
        state,
        gstin,
        pan,
        email,
        website,
        phone,
        bankName,
        bankAccountNumber,
        bankIfsc,
        bankBranch,
        invoiceTerms,
        quotationTerms,
        purchaseOrderTerms,
        defaultTaxRatePct: defaultTaxRatePct !== undefined ? Number(defaultTaxRatePct) : undefined,
        documentFooterNote,
        signatoryName,
        signatoryDataUrl,
        agentVisibleRoleKeys,
        agentCustomInstructions,
      },
      create: {
        id: "singleton",
        logoDataUrl,
        themeKey,
        customColors,
        legalName,
        address,
        city,
        pinCode,
        state,
        gstin,
        pan,
        email,
        website,
        phone,
        bankName,
        bankAccountNumber,
        bankIfsc,
        bankBranch,
        invoiceTerms,
        quotationTerms,
        purchaseOrderTerms,
        defaultTaxRatePct: defaultTaxRatePct !== undefined ? Number(defaultTaxRatePct) : undefined,
        documentFooterNote,
        signatoryName,
        signatoryDataUrl,
        agentVisibleRoleKeys,
        agentCustomInstructions,
      },
    });
    invalidateAssetCache();
    res.json(await withAssetUrls(settings));
  } catch (error) {
    res.status(500).json({ error: "Failed to update settings" });
  }
});
