import { PrismaClient } from "@prisma/client";

// The logo and signature are multi-MB base64 columns; every settings read used to drag them
// over the wire (Supabase egress). They are omitted from every query by default and only read
// by services/companyAssets.ts, which overrides the omit for the image endpoints. Vendor payment
// attachment bytes get the same treatment: only the download route (routes/bills.ts) reads dataUrl.
// Typed as a plain PrismaClient so it still satisfies Prisma.TransactionClient parameters.
export const prisma: PrismaClient = new PrismaClient({
  omit: {
    companySettings: { logoDataUrl: true, signatoryDataUrl: true },
    paymentMadeAttachment: { dataUrl: true },
  },
}) as unknown as PrismaClient;
