import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { portalPrisma as prisma, cap, iso, isoDate } from "./common";
import { PRIORITY_EDIT_MAX_SEQ, normalisePhone } from "../../services/portalDomain";

export const siteInclude = {
  currentStage: true,
  customerLocation: { select: { id: true, name: true } },
  order: { select: { id: true, orderNumber: true, portalSubmissionId: true, customerId: true } },
  contacts: { orderBy: { createdAt: "asc" } },
  documentRequirements: { include: { requirementType: true } },
  stageEvents: { orderBy: { createdAt: "desc" }, take: 1, include: { statusOption: true } },
} satisfies Prisma.SiteInclude;
export type SiteFull = Prisma.SiteGetPayload<{ include: typeof siteInclude }>;

export function formalityStatus(r: { required: boolean; status: string }): string {
  if (!r.required && r.status === "not_submitted") return "not_needed";
  return r.status;
}

/** Customer-facing site view: explicit allowlist (no staff, vendor, money, Drive or internal fields). */
export function siteView(s: SiteFull) {
  const parts = (s.addressParts ?? null) as Record<string, unknown> | null;
  const last = s.stageEvents[0];
  return {
    id: s.id,
    orderId: s.order.id,
    orderNumber: s.order.orderNumber,
    name: s.companyName ?? s.order.orderNumber,
    address: s.address,
    addressParts: parts,
    mapUrl: s.source === "portal" && s.gpsLat != null && s.gpsLng != null ? "https://www.google.com/maps?q=" + s.gpsLat + "," + s.gpsLng : null,
    ratingKva: s.dgCapacityKva == null ? null : Number(s.dgCapacityKva),
    dgModel: s.dgModel,
    dgLocation: s.dgLocation,
    accessNotes: s.accessNotes,
    requestedStartDate: isoDate(s.requestedStartDate),
    requestedCompletionDate: isoDate(s.requestedCompletionDate),
    installPriority: s.installPriority,
    priorityReason: s.priorityReason,
    priorityEditable: s.currentStage.sequenceOrder <= PRIORITY_EDIT_MAX_SEQ,
    stage: { key: s.currentStage.key, label: s.currentStage.label, phase: cap(String(s.currentStage.phase)), seq: s.currentStage.sequenceOrder },
    updateStatus: last ? last.statusOption.label : null,
    lastUpdatedAt: iso(last?.createdAt ?? s.updatedAt),
    location: s.customerLocation?.name ?? null,
    source: s.source === "portal" ? "Portal" : "Zan-F",
    version: s.updatedAt.toISOString(),
    contacts: s.contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, designation: c.role })),
    formalities: s.documentRequirements
      .sort((a, b) => a.requirementType.sequenceOrder - b.requirementType.sequenceOrder)
      .map((r) => ({ typeKey: r.requirementType.key, label: r.requirementType.label, required: r.required, status: formalityStatus(r), hasDocument: !!r.documentUrl, notes: r.notes })),
  };
}

export const contactsPatchSchema = z.object({
  version: z.string(),
  contacts: z
    .array(z.object({
      name: z.string().trim().min(1).max(120),
      phone: z.string().refine((v) => normalisePhone(v) !== null, "Enter a valid 10-digit mobile number"),
      email: z.string().trim().max(200).optional().refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid e-mail"),
      designation: z.string().trim().max(120).optional(),
    }))
    .min(1)
    .max(5),
});
export const accessPatchSchema = z.object({ version: z.string(), accessNotes: z.string().trim().max(1000) });
export const priorityPatchSchema = z
  .object({ version: z.string(), priority: z.enum(["critical", "high", "normal", "low"]), reason: z.string().trim().max(400).optional(), completeBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
  .superRefine((v, ctx) => {
    if ((v.priority === "critical" || v.priority === "high") && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason for this priority" });
    if (v.priority === "critical" && !v.completeBy) ctx.addIssue({ code: "custom", path: ["completeBy"], message: "Critical needs a completion date" });
  });
void prisma;
