/** Customer Portal: turns a validated submission into tracker records.
 * Schema fact: Order<->Site is 1:1 (Site.orderId unique), so one Order+Site is created per DG set and all of them are
 * grouped by a PortalSubmission whose submissionKey (the portal draft id) is UNIQUE: a retry returns the existing set.
 * Mirrors the staff/customer POST /orders path: requestedByCustomer=true, value never set, first stage order_received,
 * no stage event. */
import { Prisma, type PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import { STAGE_KEY } from "@recd/shared";
import {
  composeAddress, matchProduct, normalisePhone, orderNumberFor, siteDisplayName, submissionReference,
  type ProductLite, type SubmissionInput,
} from "./portalDomain";

export class PortalValidationError extends Error {
  constructor(message: string, public field?: string) { super(message); }
}

export interface SubmissionResult {
  replay: boolean;
  submission: { id: string; reference: string };
  orders: { id: string; orderNumber: string; siteId: string; siteName: string }[];
  countByKva: Record<string, number>;
  confirmation: ConfirmationSite[];
}
export interface ConfirmationSite {
  name: string; address: string; city: string; pincode: string; ratingKva: number; contact: string; priority: string;
  priorityReason: string | null; startBy: string | null; completeBy: string | null; formalities: string[];
}

const rnd = () => crypto.randomInt(0, 1_000_000) / 1_000_000;

async function loadExisting(prisma: PrismaClient, key: string, customerId: string): Promise<SubmissionResult | null> {
  const sub = await prisma.portalSubmission.findUnique({ where: { submissionKey: key } });
  if (!sub) return null;
  if (sub.customerId !== customerId) throw new PortalValidationError("Submission key already used");
  const orders = await prisma.order.findMany({
    where: { portalSubmissionId: sub.id },
    include: { site: true, product: true },
    orderBy: { createdAt: "asc" },
  });
  const countByKva: Record<string, number> = {};
  for (const o of orders) {
    const k = String(o.site?.dgCapacityKva ?? "?");
    countByKva[k] = (countByKva[k] ?? 0) + 1;
  }
  return {
    replay: true,
    submission: { id: sub.id, reference: sub.reference },
    orders: orders.map((o) => ({ id: o.id, orderNumber: o.orderNumber, siteId: o.site?.id ?? "", siteName: o.site?.companyName ?? "" })),
    countByKva,
    confirmation: [],
  };
}

export async function createPortalSubmission(
  prisma: PrismaClient,
  who: { userId: string; customerId: string },
  input: SubmissionInput,
  opts: { now?: Date } = {},
): Promise<SubmissionResult> {
  const existing = await loadExisting(prisma, input.submissionKey, who.customerId);
  if (existing) return existing;

  const [firstStage, productRows, docTypes] = await Promise.all([
    prisma.stageDefinition.findUniqueOrThrow({ where: { key: STAGE_KEY.ORDER_RECEIVED } }),
    prisma.product.findMany({ where: { capacityKva: { not: null } }, select: { id: true, model: true, capacityKva: true } }),
    prisma.documentRequirementType.findMany({ orderBy: { sequenceOrder: "asc" } }),
  ]);
  const products: ProductLite[] = productRows.map((p) => ({ id: p.id, model: p.model, capacityKva: Number(p.capacityKva) }));
  if (!products.length) throw new PortalValidationError("No RECD ratings are set up yet. Please contact Zan-F.");
  const docKeys = new Set(docTypes.map((d) => d.key));
  for (const s of input.sites) for (const k of Object.keys(s.formalities)) if (!docKeys.has(k)) throw new PortalValidationError("Unknown formality " + k, "formalities");

  // Attachments referenced by the submission must belong to this customer and still be unlinked.
  const refIds = new Set<string>();
  if (input.poAttachmentId) refIds.add(input.poAttachmentId);
  for (const s of input.sites) {
    s.photoIds.forEach((i) => refIds.add(i));
    Object.values(s.documentIds).forEach((i) => refIds.add(i));
    if (s.priorityDocumentId) refIds.add(s.priorityDocumentId);
  }
  if (refIds.size) {
    const found = await prisma.portalAttachment.findMany({ where: { id: { in: [...refIds] }, customerId: who.customerId, orderId: null }, select: { id: true } });
    if (found.length !== refIds.size) throw new PortalValidationError("An uploaded file could not be found. Please upload it again.");
  }

  const year = (opts.now ?? new Date()).getFullYear();
  const reference = submissionReference(year, rnd());
  const byKva: Record<string, number> = {};
  const confirmation: ConfirmationSite[] = [];
  const created: SubmissionResult["orders"] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        const sub = await tx.portalSubmission.create({
          data: {
            reference, customerId: who.customerId, submittedByUserId: who.userId, submissionKey: input.submissionKey,
            customerPoNumber: input.customerPoNumber, customerPoDate: input.customerPoDate ? new Date(input.customerPoDate) : undefined, notes: input.notes,
          },
        });
        const usedNumbers = new Set<string>();
        for (const s of input.sites) {
          for (let n = 1; n <= s.dgs.length; n++) {
            const dg = s.dgs[n - 1];
            const match = matchProduct(products, dg.ratingKva)!;
            const unsure = dg.ratingUnsure || !match.exact;
            let orderNumber = "";
            for (let tries = 0; tries < 25; tries++) {
              const cand = orderNumberFor(year, rnd());
              if (usedNumbers.has(cand)) continue;
              if (await tx.order.findUnique({ where: { orderNumber: cand }, select: { id: true } })) continue;
              orderNumber = cand;
              break;
            }
            if (!orderNumber) throw new Error("could not allocate an order number");
            usedNumbers.add(orderNumber);

            const name = siteDisplayName(s.name, n, s.dgs.length);
            const address = composeAddress({ line: s.line, area: s.area, city: s.city, district: s.district, state: s.state, pincode: s.pincode });
            const formalities = docTypes.filter((d) => s.formalities[d.key]).map((d) => d.label);
            const noteBits = ["Submitted via customer portal (" + reference + ")."];
            if (unsure) noteBits.push("Rating stated by customer: " + dg.ratingKva + " kVA" + (dg.ratingUnsure ? " (not sure)" : "") + "; nearest RECD " + match.product.model + " used - staff to confirm.");
            if (input.notes) noteBits.push(input.notes);
            const accessNotes = [s.accessNotes, s.formalityOther ? "Other formalities: " + s.formalityOther : ""].filter(Boolean).join("\n") || undefined;

            const order = await tx.order.create({
              data: {
                orderNumber, customerId: who.customerId, productId: match.product.id, quantity: 1,
                customerPoNumber: input.customerPoNumber, customerPoDate: input.customerPoDate ? new Date(input.customerPoDate) : undefined,
                requestedByCustomer: true, customerNotes: noteBits.join(" "), portalSubmissionId: sub.id,
                site: {
                  create: {
                    currentStageId: firstStage.id, companyName: name, address, gpsLat: s.lat, gpsLng: s.lng,
                    dgCapacityKva: dg.ratingKva, dgModel: dg.dgModel, dgLocation: dg.dgLocation, accessNotes,
                    addressParts: { line: s.line, area: s.area ?? null, city: s.city, district: s.district ?? null, state: s.state, pincode: s.pincode },
                    requestedStartDate: s.startBy ? new Date(s.startBy) : undefined, requestedCompletionDate: s.completeBy ? new Date(s.completeBy) : undefined,
                    installPriority: s.priority, priorityReason: s.priorityReason, source: "portal",
                    contacts: { create: s.contacts.map((c) => ({ name: c.name, phone: normalisePhone(c.phone), email: c.email || null, role: c.designation ?? null })) },
                    documentRequirements: {
                      create: docTypes.map((d) => ({
                        requirementTypeId: d.id, required: !!s.formalities[d.key],
                        status: s.documentIds[d.key] ? "submitted" : "not_submitted",
                        documentUrl: s.documentIds[d.key] ? "portal-attachment:" + s.documentIds[d.key] : null,
                      })),
                    },
                  },
                },
              },
              include: { site: true },
            });
            created.push({ id: order.id, orderNumber, siteId: order.site!.id, siteName: name });
            const k = String(dg.ratingKva);
            byKva[k] = (byKva[k] ?? 0) + 1;
            confirmation.push({
              name, address, city: s.city, pincode: s.pincode, ratingKva: dg.ratingKva, contact: s.contacts[0].name,
              priority: s.priority, priorityReason: s.priorityReason ?? null, startBy: s.startBy ?? null, completeBy: s.completeBy ?? null, formalities,
            });

            // Link uploaded files to the first DG set of a row (documents are shared by reference for the rest).
            if (n === 1) {
              const link = (ids: string[]) => ids.length ? tx.portalAttachment.updateMany({ where: { id: { in: ids }, customerId: who.customerId, orderId: null }, data: { orderId: order.id, siteId: order.site!.id, submissionId: sub.id, draftId: null } }) : null;
              await link([...s.photoIds, ...Object.values(s.documentIds), ...(s.priorityDocumentId ? [s.priorityDocumentId] : [])]);
            }
          }
        }
        if (input.poAttachmentId && created[0]) {
          await tx.portalAttachment.updateMany({ where: { id: input.poAttachmentId, customerId: who.customerId, orderId: null }, data: { orderId: created[0].id, submissionId: sub.id, draftId: null } });
        }
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (err) {
    // A concurrent duplicate submit lost the unique race on submissionKey: return the winner's records.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await loadExisting(prisma, input.submissionKey, who.customerId);
      if (again) return again;
    }
    throw err;
  }

  const sub = await prisma.portalSubmission.findUniqueOrThrow({ where: { submissionKey: input.submissionKey } });
  return { replay: false, submission: { id: sub.id, reference: sub.reference }, orders: created, countByKva: byKva, confirmation };
}
