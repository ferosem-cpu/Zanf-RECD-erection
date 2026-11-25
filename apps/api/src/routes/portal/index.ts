/** Customer Portal API (/portal/*). Signed server-to-server only (see services/portalAuth.ts); mounted before express.json. */
import { Router } from "express";
import { putFile, getFile, deleteFiles, StorageUnavailableError } from "../../lib/portalStorage";
import { DriveUnavailableError, fileUnfiledPhotos, prodDriveDeps, uploadDraftPhoto, uploadSitePhoto } from "../../lib/portalDrive";
import crypto from "node:crypto";
import { COMPLAINT_STATUS, STAGE_KEY } from "@recd/shared";
import { createPortalAuth, createPortalUserLimiter } from "../../services/portalAuth";
import {
  COMPLAINT_CATEGORY_MAP, URGENCY_MAP, canReopen, last10, looksLikeEmail, normaliseEmail, normalisePhone, submissionSchema,
} from "../../services/portalDomain";
import { attachmentWhere, complaintWhere, filterFrom, orderWhere, pendingWhere, resolveSubmissionLocation, scopeOf, siteWhere, type LocationFilter, type PortalScope } from "../../services/portalScope";
import { waOtpBodySchema } from "../../services/portalWaOtp";
import { createPortalSubmission, PortalValidationError } from "../../services/portalOrders";
import { buildStaffOrderMail, mailStaffNewOrder, mailStaffPriorityChange } from "../../services/portalMail";
import { detectFileType, MAX_UPLOAD_BYTES, PDF_KINDS, UPLOAD_KINDS, type UploadKind } from "../../lib/portalFiles";
import { send as sendNotification } from "../../services/notifications/notificationService";
import { createComplaintRecord } from "../complaints";
import { z } from "zod";
import { h, ok, jsonBody, rawParser, portalPrisma as prisma, cap, iso, isoDate, param } from "./common";
import { siteInclude, siteView, contactsPatchSchema, accessPatchSchema, priorityPatchSchema } from "./sites";

export const portalRouter = Router();
portalRouter.use(rawParser);
portalRouter.use(createPortalAuth());
portalRouter.use(createPortalUserLimiter());

const ownSite = (siteId: string, scope: PortalScope) => prisma.site.findFirst({ where: { id: siteId, ...siteWhere(scope) }, include: siteInclude });
const myScope = (req: import("express").Request) => scopeOf(req.portal!);
const notFound = (res: import("express").Response) => res.status(404).json({ error: "Not found" });
const bad = (res: import("express").Response, e: z.ZodError) => res.status(400).json({ error: "Invalid request", fields: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });

// ---------- sign-in lookup (anonymous, signed) ----------
portalRouter.post("/auth/lookup", h(async (req, res) => {
  const parsed = z.object({ identifier: z.string().min(3).max(200) }).safeParse(jsonBody(req));
  if (!parsed.success) return void res.status(400).json({ error: "Invalid request" });
  const ident = parsed.data.identifier.trim();
  const select = { id: true, email: true, phone: true, isActive: true, customerId: true, customerLocationId: true, customerLocation: { select: { active: true } }, role: { select: { key: true } } } as const;
  let candidates;
  if (looksLikeEmail(ident)) {
    candidates = await prisma.user.findMany({ where: { email: { equals: normaliseEmail(ident), mode: "insensitive" } }, select });
  } else {
    const tail = last10(ident);
    if (tail.length !== 10) return void res.json({ found: false });
    const maybe = await prisma.user.findMany({ where: { customerId: { not: null }, phone: { contains: tail.slice(-4) } }, select });
    candidates = maybe.filter((u) => last10(u.phone ?? "") === tail);
  }
  const eligible = candidates.filter((u) => u.isActive && u.role.key === "customer" && u.customerId && u.email && looksLikeEmail(u.email) && (!u.customerLocationId || u.customerLocation?.active)); // a deactivated location locks its users out
  // Shared mobile numbers (or duplicate rows) never get a code: staff must fix the data.
  if (eligible.length !== 1 || candidates.filter((u) => u.isActive && u.role.key === "customer").length !== 1) return void res.json({ found: false });
  res.json({ found: true, userId: eligible[0].id, email: eligible[0].email });
}));

// ---------- sign-in code over WhatsApp (signed, anonymous): queued for the existing bridge; the number comes from the user's row ----------
portalRouter.post("/auth/wa-otp", h(async (req, res) => {
  const parsed = waOtpBodySchema.safeParse(jsonBody(req));
  if (!parsed.success) return void res.status(400).json({ error: "Invalid request" });
  const { queueWaOtp } = await import("../../services/whatsappBridgeProd");
  const r = await queueWaOtp(parsed.data);
  res.json({ queued: r.queued });
}));

// ---------- maintenance (signed, anonymous): purge draft uploads never linked to an order ----------
portalRouter.post("/maintenance/purge", h(async (_req, res) => {
  const where = { draftId: { not: null }, orderId: null, siteId: null, complaintId: null, createdAt: { lt: new Date(Date.now() - 7 * 86400_000) } };
  const old = await prisma.portalAttachment.findMany({ where, select: { id: true, storagePath: true }, take: 500 });
  await deleteFiles(old.map((o) => o.storagePath));
  const r = await prisma.portalAttachment.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  let filed = 0;
  try { filed = (await fileUnfiledPhotos(prodDriveDeps(), { limit: 40, budgetMs: 120_000 })).filed; } catch { /* Drive not ready */ }
  res.json({ purged: r.count, filed });
}));

// ---------- profile / reference data ----------
portalRouter.get("/me", h(async (req, res) => {
  const c = await prisma.customer.findUnique({ where: { id: req.portal!.customerId }, select: { name: true } });
  ok(res, { name: req.portal!.name, email: req.portal!.email, phone: req.portal!.phone, company: c?.name ?? "", location: req.portal!.customerLocationId ? { id: req.portal!.customerLocationId, name: req.portal!.customerLocationName } : null, isAdmin: !req.portal!.customerLocationId });
}));
/** Locations the user may see: admins all of the customer's; a location user only their own. */
portalRouter.get("/locations", h(async (req, res) => {
  const sc = myScope(req);
  const rows = await prisma.customerLocation.findMany({ where: { customerId: sc.customerId, ...(sc.locationId ? { id: sc.locationId } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true, active: true } });
  ok(res, { locations: rows });
}));
portalRouter.get("/catalogue", h(async (_req, res) => {
  const rows = await prisma.product.findMany({ where: { capacityKva: { not: null } }, select: { model: true, capacityKva: true }, orderBy: { capacityKva: "asc" } });
  ok(res, { ratings: rows.map((r) => ({ model: r.model, ratingKva: Number(r.capacityKva) })) });
}));
portalRouter.get("/document-types", h(async (_req, res) => {
  const rows = await prisma.documentRequirementType.findMany({ orderBy: { sequenceOrder: "asc" } });
  ok(res, { types: rows.map((r) => ({ key: r.key, label: r.label })) });
}));
portalRouter.get("/company-contact", h(async (_req, res) => {
  const c = await prisma.companySettings.findUnique({ where: { id: "singleton" }, select: { legalName: true, email: true, phone: true, website: true, address: true, city: true, pinCode: true } });
  ok(res, { contact: c ?? null });
}));

// ---------- orders (a portal "order" = a submission; staff-created orders are single-site orders) ----------
type Group = { id: string; reference: string; orderNumbers: string[]; po: string | null; date: Date; source: string; sites: ReturnType<typeof siteView>[] };

async function loadGroups(scope: PortalScope, filter?: LocationFilter, onlyId?: string): Promise<Group[]> {
  let where: Record<string, unknown> = orderWhere(scope, filter);
  if (onlyId?.startsWith("s_")) where = { ...where, portalSubmissionId: onlyId.slice(2) };
  else if (onlyId?.startsWith("o_")) where = { ...where, id: onlyId.slice(2) };
  else if (onlyId) return [];
  const orders = await prisma.order.findMany({
    where, orderBy: { createdAt: "desc" },
    include: { portalSubmission: { select: { id: true, reference: true } }, site: { include: siteInclude } },
  });
  const map = new Map<string, Group>();
  for (const o of orders) {
    if (!o.site) continue;
    const key = o.portalSubmission ? "s_" + o.portalSubmission.id : "o_" + o.id;
    let g = map.get(key);
    if (!g) {
      g = { id: key, reference: o.portalSubmission?.reference ?? o.orderNumber, orderNumbers: [], po: o.customerPoNumber, date: o.orderDate ?? o.createdAt, source: o.portalSubmission ? "Portal" : o.requestedByCustomer ? "Portal" : "Zan-F", sites: [] };
      map.set(key, g);
    }
    g.orderNumbers.push(o.orderNumber);
    g.sites.push(siteView(o.site));
  }
  return [...map.values()];
}
const cityOf = (s: Group["sites"][number]): string | null => { const c = (s.addressParts as { city?: unknown } | null)?.city; return typeof c === "string" && c.trim() ? c.trim() : null; };
/** Names and places of the order's sites for the order cards. Group.sites only ever holds sites the caller's scope allows (orders are loaded through orderWhere), so another location's sites can never appear here. */
export const SITE_PREVIEW_MAX = 3;
const sitePreview = (g: Group) => g.sites.slice(0, SITE_PREVIEW_MAX).map((s) => ({ id: s.id, name: s.name, address: s.address ?? null, city: cityOf(s), location: s.location ?? null }));
const groupSummary = (g: Group) => {
  const done = g.sites.filter((s) => s.stage.seq >= 11).length;
  return { sitePreview: sitePreview(g), id: g.id, reference: g.reference, orderNumbers: g.orderNumbers, customerPoNumber: g.po, orderDate: iso(g.date), source: g.source, siteCount: g.sites.length, commissionedCount: done, open: done < g.sites.length };
};

portalRouter.get("/orders", h(async (req, res) => {
  const q = z.object({ search: z.string().max(100).optional(), status: z.enum(["open", "closed"]).optional(), page: z.coerce.number().int().min(1).default(1) }).safeParse(req.query);
  if (!q.success) return void bad(res, q.error);
  let groups = await loadGroups(myScope(req), filterFrom(myScope(req), req.query.location));
  const s = q.data.search?.toLowerCase();
  if (s) groups = groups.filter((g) => g.reference.toLowerCase().includes(s) || g.orderNumbers.some((n) => n.toLowerCase().includes(s)) || (g.po ?? "").toLowerCase().includes(s) || g.sites.some((x) => [x.name, x.address, cityOf(x), x.location].some((v) => (v ?? "").toLowerCase().includes(s))));
  const sums = groups.map(groupSummary);
  const list = q.data.status ? sums.filter((g) => (q.data.status === "open") === g.open) : sums;
  const size = 20;
  ok(res, { orders: list.slice((q.data.page - 1) * size, q.data.page * size), page: q.data.page, pageCount: Math.max(1, Math.ceil(list.length / size)), resultCount: list.length });
}));

portalRouter.get("/orders/:id", h(async (req, res) => {
  const [g] = await loadGroups(myScope(req), undefined, param(req.params.id));
  if (!g) return void notFound(res);
  const countByKva: Record<string, number> = {};
  for (const s of g.sites) countByKva[String(s.ratingKva ?? "?")] = (countByKva[String(s.ratingKva ?? "?")] ?? 0) + 1;
  ok(res, { ...groupSummary(g), countByKva, sites: g.sites });
}));

portalRouter.post("/orders", h(async (req, res) => {
  const parsed = submissionSchema.safeParse(jsonBody(req));
  if (!parsed.success) return void bad(res, parsed.error);
  const sc = myScope(req);
  const loc = await resolveSubmissionLocation(prisma, sc, req.portal!.customerLocationName, parsed.data.customerLocationId);
  if (!loc.ok) return void res.status(422).json({ error: "Choose one of your locations.", field: "customerLocationId" });
  const who = { userId: req.portal!.userId, customerId: req.portal!.customerId, locationId: loc.locationId, locationName: loc.locationName };
  let result;
  try {
    result = await createPortalSubmission(prisma, who, parsed.data);
  } catch (e) {
    if (e instanceof PortalValidationError) return void res.status(422).json({ error: e.message, field: e.field });
    throw e;
  }
  if (!result.replay) {
    // Move this order's draft photos from "Portal drafts" into each DG's Drive folder. Best effort: leftovers are retried by the daily purge.
    try { await fileUnfiledPhotos(prodDriveDeps(), { submissionId: result.submission.id, budgetMs: 25_000 }); } catch { /* Drive not ready: retried later */ }
    // Best-effort notifications: a failure never undoes the order.
    try {
      const customer = await prisma.customer.findUnique({ where: { id: who.customerId }, select: { name: true } });
      const mail = buildStaffOrderMail({
        customer: customer?.name ?? "Customer", reference: result.submission.reference, orderNumbers: result.orders.map((o) => o.orderNumber), po: parsed.data.customerPoNumber, notes: parsed.data.notes, byKva: result.countByKva,
        sites: result.confirmation.map((c) => ({ name: c.name, city: c.city, pincode: c.pincode, ratingKva: c.ratingKva, contact: c.contact, priority: c.priority, priorityReason: c.priorityReason, startBy: c.startBy, completeBy: c.completeBy, formalities: c.formalities })),
      });
      await mailStaffNewOrder(mail);
      const managers = await prisma.user.findMany({ where: { isActive: true, role: { key: { in: ["management", "owner_admin", "super_admin"] } } }, select: { id: true } });
      await Promise.all(managers.map((m) => sendNotification({ recipientId: m.id, templateKey: "new_order_placed", channels: ["in_app"], data: { orderNumber: result.submission.reference, customer: customer?.name ?? "", product: result.orders.length + " site(s) via portal", quantity: result.orders.length, notes: mail.subject } }).catch(() => undefined)));
    } catch (err) { console.error("[portal] staff notification failed", err instanceof Error ? err.message : "unknown"); }
  }
  ok(res, { replay: result.replay, submission: result.submission, orders: result.orders, countByKva: result.countByKva, confirmation: result.confirmation }, result.replay ? 200 : 201);
}));

// ---------- sites ----------
portalRouter.get("/sites/:id", h(async (req, res) => {
  const s = await ownSite(param(req.params.id), myScope(req));
  if (!s) return void notFound(res);
  const photos = await prisma.portalAttachment.findMany({ where: { siteId: s.id, kind: "site_photo" }, select: { id: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  ok(res, { site: siteView(s), photos: photos.map((p) => ({ id: p.id, uploadedAt: iso(p.createdAt) })) });
}));

portalRouter.get("/sites/:id/timeline", h(async (req, res) => {
  const s = await ownSite(param(req.params.id), myScope(req));
  if (!s) return void notFound(res);
  const ev = await prisma.siteStageEvent.findMany({ where: { siteId: s.id }, orderBy: { createdAt: "desc" }, take: 100, include: { stageDefinition: true, statusOption: true } });
  ok(res, { events: ev.map((e) => ({ id: e.id, stage: e.stageDefinition.label, phase: cap(String(e.stageDefinition.phase)), status: e.statusOption.label, note: e.comment, at: iso(e.createdAt) })) });
}));

portalRouter.get("/updates", h(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const ev = await prisma.siteStageEvent.findMany({
    where: { site: siteWhere(myScope(req), filterFrom(myScope(req), req.query.location)) }, orderBy: { createdAt: "desc" }, take: limit,
    include: { stageDefinition: true, statusOption: true, site: { select: { id: true, companyName: true, order: { select: { orderNumber: true } } } } },
  });
  ok(res, { updates: ev.map((e) => ({ id: e.id, siteId: e.site.id, siteName: e.site.companyName ?? e.site.order.orderNumber, orderNumber: e.site.order.orderNumber, stage: e.stageDefinition.label, status: e.statusOption.label, at: iso(e.createdAt) })) });
}));

portalRouter.patch("/sites/:id/contacts", h(async (req, res) => {
  const p = contactsPatchSchema.safeParse(jsonBody(req));
  if (!p.success) return void bad(res, p.error);
  const s = await ownSite(param(req.params.id), myScope(req));
  if (!s) return void notFound(res);
  if (s.updatedAt.toISOString() !== p.data.version) return void res.status(409).json({ error: "This site was changed. Reload and try again." });
  const { normalisePhone } = await import("../../services/portalDomain");
  await prisma.$transaction([
    prisma.siteContact.deleteMany({ where: { siteId: s.id } }),
    prisma.siteContact.createMany({ data: p.data.contacts.map((c) => ({ siteId: s.id, name: c.name, phone: normalisePhone(c.phone), email: c.email || null, role: c.designation || null })) }),
    prisma.site.update({ where: { id: s.id }, data: { updatedAt: new Date() } }),
  ]);
  ok(res, { site: siteView((await ownSite(s.id, myScope(req)))!) });
}));

portalRouter.patch("/sites/:id/access-notes", h(async (req, res) => {
  const p = accessPatchSchema.safeParse(jsonBody(req));
  if (!p.success) return void bad(res, p.error);
  const s = await ownSite(param(req.params.id), myScope(req));
  if (!s) return void notFound(res);
  if (s.updatedAt.toISOString() !== p.data.version) return void res.status(409).json({ error: "This site was changed. Reload and try again." });
  await prisma.site.update({ where: { id: s.id }, data: { accessNotes: p.data.accessNotes || null } });
  ok(res, { site: siteView((await ownSite(s.id, myScope(req)))!) });
}));

portalRouter.patch("/sites/:id/priority", h(async (req, res) => {
  const p = priorityPatchSchema.safeParse(jsonBody(req));
  if (!p.success) return void bad(res, p.error);
  const s = await ownSite(param(req.params.id), myScope(req));
  if (!s) return void notFound(res);
  if (s.updatedAt.toISOString() !== p.data.version) return void res.status(409).json({ error: "This site was changed. Reload and try again." });
  if (s.currentStage.sequenceOrder > 7) return void res.status(409).json({ error: "Installation has started. Contact Zan-F to change the priority." });
  const changed = s.installPriority !== p.data.priority;
  await prisma.site.update({ where: { id: s.id }, data: { installPriority: p.data.priority, priorityReason: p.data.reason ?? null, requestedCompletionDate: p.data.completeBy ? new Date(p.data.completeBy) : undefined } });
  if (changed && (p.data.priority === "critical" || p.data.priority === "high")) {
    const c = await prisma.customer.findUnique({ where: { id: req.portal!.customerId }, select: { name: true } });
    await mailStaffPriorityChange({ customer: c?.name ?? "Customer", site: s.companyName ?? s.order.orderNumber, priority: p.data.priority, reason: p.data.reason });
  }
  ok(res, { site: siteView((await ownSite(s.id, myScope(req)))!) });
}));

// ---------- pending actions ----------
portalRouter.get("/pending-actions", h(async (req, res) => {
  const rows = await prisma.pendingAction.findMany({ where: { ownerType: "CUSTOMER", status: "open", ...pendingWhere(myScope(req), filterFrom(myScope(req), req.query.location)) }, orderBy: { createdAt: "desc" }, take: 50, include: { site: { select: { id: true, companyName: true } } } });
  ok(res, { actions: rows.map((a) => ({ id: a.id, siteId: a.site.id, siteName: a.site.companyName, description: a.description, dueDate: isoDate(a.dueDate), createdAt: iso(a.createdAt) })) });
}));
portalRouter.post("/pending-actions/:id/respond", h(async (req, res) => {
  const p = z.object({ response: z.string().trim().min(1).max(1000) }).safeParse(jsonBody(req));
  if (!p.success) return void bad(res, p.error);
  const a = await prisma.pendingAction.findFirst({ where: { id: param(req.params.id), ownerType: "CUSTOMER", status: "open", ...pendingWhere(myScope(req)) } });
  if (!a) return void notFound(res);
  await prisma.pendingAction.update({ where: { id: a.id }, data: { status: "resolved", resolvedAt: new Date(), resolution: "Customer response (portal): " + p.data.response } });
  ok(res, { ok: true });
}));

// ---------- complaints ----------
const complaintItem = (c: { id: string; ticketNumber: string; category: string; severity: string; status: string; createdAt: Date; closedAt: Date | null; site: { id: string; companyName: string | null } | null }) => ({
  id: c.id, ticketNumber: c.ticketNumber, category: c.category, urgency: c.severity, status: c.status, createdAt: iso(c.createdAt), closedAt: iso(c.closedAt),
  siteId: c.site?.id ?? null, siteName: c.site?.companyName ?? null, canReopen: canReopen(c.status, c.closedAt),
});
const cInclude = { site: { select: { id: true, companyName: true } } } as const;

portalRouter.get("/complaints", h(async (req, res) => {
  const rows = await prisma.complaint.findMany({ where: complaintWhere(myScope(req), filterFrom(myScope(req), req.query.location)), orderBy: { createdAt: "desc" }, take: 100, include: cInclude });
  ok(res, { complaints: rows.map(complaintItem), openCount: rows.filter((r) => r.status !== COMPLAINT_STATUS.CLOSED && r.status !== COMPLAINT_STATUS.RESOLVED).length });
}));

portalRouter.get("/complaints/:id", h(async (req, res) => {
  const c = await prisma.complaint.findFirst({ where: { id: param(req.params.id), ...complaintWhere(myScope(req)) }, include: cInclude });
  if (!c) return void notFound(res);
  const [comments, photos] = await Promise.all([
    prisma.complaintComment.findMany({ where: { complaintId: c.id, OR: [{ authorIsCustomer: true }, { visibleToCustomer: true }] }, orderBy: { createdAt: "asc" }, include: { attachments: { select: { id: true } } } }),
    prisma.portalAttachment.findMany({ where: { complaintId: c.id, commentId: null }, select: { id: true }, orderBy: { createdAt: "asc" } }),
  ]);
  ok(res, { complaint: { ...complaintItem(c), description: c.description }, photos: photos.map((p) => ({ id: p.id })), thread: comments.map((m) => ({ id: m.id, from: m.authorIsCustomer ? "you" : "zanf", body: m.body, at: iso(m.createdAt), attachments: m.attachments.map((a) => ({ id: a.id })) })) });
}));

portalRouter.post("/complaints", h(async (req, res) => {
  const p = z.object({
    siteId: z.string().min(1).max(40), category: z.enum(["delivery", "installation", "commissioning", "performance"]), urgency: z.enum(["normal", "high", "critical"]).default("normal"),
    description: z.string().trim().min(5).max(4000), photoIds: z.array(z.string().max(40)).max(5).default([]),
  }).safeParse(jsonBody(req));
  if (!p.success) return void bad(res, p.error);
  const site = await ownSite(p.data.siteId, myScope(req));
  if (!site) return void notFound(res);
  if (p.data.photoIds.length) {
    const n = await prisma.portalAttachment.count({ where: { id: { in: p.data.photoIds }, customerId: req.portal!.customerId, uploadedByUserId: req.portal!.userId, complaintId: null, kind: "complaint_photo" } });
    if (n !== p.data.photoIds.length) return void res.status(422).json({ error: "A photo could not be found. Please upload it again." });
  }
  let complaint;
  for (let i = 0; i < 3 && !complaint; i++) {
    try {
      complaint = await createComplaintRecord({ siteId: site.id, category: COMPLAINT_CATEGORY_MAP[p.data.category], description: p.data.description, severity: URGENCY_MAP[p.data.urgency] }, req.portal!.customerId);
    } catch (e) {
      if (!(e instanceof Error && /Unique constraint/i.test(e.message))) throw e;
    }
  }
  if (!complaint) throw new Error("could not create complaint");
  if (p.data.photoIds.length) await prisma.portalAttachment.updateMany({ where: { id: { in: p.data.photoIds }, customerId: req.portal!.customerId, uploadedByUserId: req.portal!.userId }, data: { complaintId: complaint.id, draftId: null } });
  ok(res, { complaint: { id: complaint.id, ticketNumber: complaint.ticketNumber } }, 201);
}));

portalRouter.post("/complaints/:id/comments", h(async (req, res) => {
  const p = z.object({ body: z.string().trim().min(1).max(4000), photoIds: z.array(z.string().max(40)).max(5).default([]) }).safeParse(jsonBody(req));
  if (!p.success) return void bad(res, p.error);
  const c = await prisma.complaint.findFirst({ where: { id: param(req.params.id), ...complaintWhere(myScope(req)) } });
  if (!c) return void notFound(res);
  if (c.status === COMPLAINT_STATUS.CLOSED) return void res.status(409).json({ error: "This complaint is closed. Reopen it to add a comment." });
  const m = await prisma.complaintComment.create({ data: { complaintId: c.id, authorUserId: req.portal!.userId, authorIsCustomer: true, body: p.data.body, visibleToCustomer: true } });
  if (p.data.photoIds.length) await prisma.portalAttachment.updateMany({ where: { id: { in: p.data.photoIds }, customerId: req.portal!.customerId, uploadedByUserId: req.portal!.userId, kind: "complaint_photo", complaintId: null }, data: { complaintId: c.id, commentId: m.id, draftId: null } });
  ok(res, { comment: { id: m.id } }, 201);
}));

portalRouter.post("/complaints/:id/reopen", h(async (req, res) => {
  const p = z.object({ reason: z.string().trim().min(3).max(1000) }).safeParse(jsonBody(req));
  if (!p.success) return void bad(res, p.error);
  const c = await prisma.complaint.findFirst({ where: { id: param(req.params.id), ...complaintWhere(myScope(req)) } });
  if (!c) return void notFound(res);
  if (!canReopen(c.status, c.closedAt)) return void res.status(409).json({ error: "This complaint can no longer be reopened. Please raise a new one." });
  await prisma.$transaction([
    prisma.complaint.update({ where: { id: c.id }, data: { status: COMPLAINT_STATUS.OPEN, closedAt: null } }),
    prisma.complaintComment.create({ data: { complaintId: c.id, authorUserId: req.portal!.userId, authorIsCustomer: true, body: "Reopened by customer: " + p.data.reason, visibleToCustomer: true } }),
  ]);
  ok(res, { ok: true });
}));

// ---------- uploads (raw body: the file bytes; metadata in the signed query string) ----------
const uploadQuery = z.object({
  kind: z.enum(UPLOAD_KINDS as unknown as [UploadKind, ...UploadKind[]]), draftId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  siteId: z.string().max(40).optional(), complaintId: z.string().max(40).optional(), typeKey: z.string().max(60).optional(), fileName: z.string().max(160).optional(),
});

async function storeUpload(req: import("express").Request, res: import("express").Response, over?: Partial<z.infer<typeof uploadQuery>>) {
  const q = uploadQuery.safeParse({ ...req.query, ...over });
  if (!q.success) return void bad(res, q.error);
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!body.length) return void res.status(400).json({ error: "No file" });
  if (body.length > MAX_UPLOAD_BYTES) return void res.status(413).json({ error: "File is larger than 4 MB" });
  const t = detectFileType(body);
  if (!t) return void res.status(415).json({ error: "Unsupported file type" });
  if (!t.image && !PDF_KINDS.includes(q.data.kind)) return void res.status(415).json({ error: "Please upload a photo" });
  const customerId = req.portal!.customerId;
  let siteId: string | undefined, complaintId: string | undefined, orderId: string | undefined;
  if (q.data.siteId) {
    const s = await prisma.site.findFirst({ where: { id: q.data.siteId, ...siteWhere(myScope(req)) }, select: { id: true, orderId: true } });
    if (!s) return void notFound(res);
    siteId = s.id; orderId = s.orderId;
  }
  if (q.data.complaintId) {
    const c = await prisma.complaint.findFirst({ where: { id: q.data.complaintId, ...complaintWhere(myScope(req)) }, select: { id: true } });
    if (!c) return void notFound(res);
    complaintId = c.id;
  }
  if (!siteId && !complaintId) {
    if (!q.data.draftId) return void res.status(400).json({ error: "draftId required" });
    const n = await prisma.portalAttachment.count({ where: { customerId, draftId: q.data.draftId } });
    if (n >= 60) return void res.status(429).json({ error: "Too many files for this draft" });
  }
  const id = crypto.randomUUID();
  const unavailable = () => void res.status(503).json({ error: "File upload is temporarily unavailable. Please try again later or contact Zan-F." });
  // Site photos go to the company Google Drive; every other file type keeps the private Supabase bucket.
  let storagePath: string;
  let driveUrl: string | undefined, dgIndex: number | undefined, driveFiledAt: Date | undefined;
  if (q.data.kind === "site_photo") {
    try {
      const deps = prodDriveDeps();
      if (siteId) {
        const site = await prisma.site.findUnique({ where: { id: siteId }, select: { companyName: true } });
        const f = await uploadSitePhoto(deps, { siteId, siteName: site?.companyName ?? null, bytes: body, mimeType: t.mime });
        storagePath = "drive:" + f.id; driveUrl = f.webViewLink; dgIndex = f.dgIndex; driveFiledAt = new Date();
      } else {
        const f = await uploadDraftPhoto(deps, { attachmentId: id, bytes: body, mimeType: t.mime });
        storagePath = "drive:" + f.id; driveUrl = f.webViewLink;
      }
    } catch (e) {
      if (e instanceof DriveUnavailableError) return unavailable();
      console.error("[portal] drive photo upload failed", e instanceof Error ? e.name : "error"); // never the file, name or number
      return unavailable();
    }
  } else {
    storagePath = customerId + "/" + id + "." + t.ext;
    try { await putFile(storagePath, body, t.mime); }
    catch (e) {
      if (e instanceof StorageUnavailableError) return unavailable();
      throw e;
    }
  }
  let a;
  try {
    a = await prisma.portalAttachment.create({
      data: { id, customerId, kind: q.data.kind, documentTypeKey: q.data.typeKey, draftId: siteId || complaintId ? null : q.data.draftId, siteId, complaintId, orderId, fileName: q.data.fileName?.replace(/[^\w.\- ]/g, "_"), mimeType: t.mime, sizeBytes: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex"), storagePath, driveUrl, dgIndex, driveFiledAt, uploadedByUserId: req.portal!.userId },
      select: { id: true, mimeType: true, sizeBytes: true, fileName: true },
    });
  } catch (e) { await deleteFiles([storagePath]); throw e; }
  return a;
}

portalRouter.post("/uploads", h(async (req, res) => {
  const a = await storeUpload(req, res);
  if (a) ok(res, { upload: a }, 201);
}));

/** A customer may remove a file they uploaded to a draft before it is linked to an order. */
portalRouter.delete("/uploads/:id", h(async (req, res) => {
  const a = await prisma.portalAttachment.findFirst({ where: { id: param(req.params.id), customerId: req.portal!.customerId, uploadedByUserId: req.portal!.userId, draftId: { not: null }, orderId: null, siteId: null, complaintId: null }, select: { id: true, storagePath: true } });
  if (!a) return void notFound(res);
  await deleteFiles([a.storagePath]);
  await prisma.portalAttachment.delete({ where: { id: a.id } });
  ok(res, { ok: true });
}));

portalRouter.get("/uploads/:id/content", h(async (req, res) => {
  const a = await prisma.portalAttachment.findFirst({ where: { id: param(req.params.id), ...attachmentWhere(myScope(req)) }, select: { storagePath: true, mimeType: true, fileName: true } });
  if (!a) return void notFound(res);
  res.setHeader("Content-Type", a.mimeType);
  res.setHeader("Content-Disposition", 'inline; filename="' + (a.fileName ?? "file") + '"');
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(await getFile(a.storagePath));
}));

portalRouter.post("/sites/:id/documents/:typeKey", h(async (req, res) => {
  const site = await ownSite(param(req.params.id), myScope(req));
  if (!site) return void notFound(res);
  const type = await prisma.documentRequirementType.findUnique({ where: { key: param(req.params.typeKey) } });
  if (!type) return void notFound(res);
  const existing = site.documentRequirements.find((r) => r.requirementTypeId === type.id);
  if (existing?.status === "verified") return void res.status(409).json({ error: "This document has already been accepted." });
  const a = await storeUpload(req, res, { kind: "document", siteId: site.id, typeKey: type.key });
  if (!a) return;
  await prisma.siteDocumentRequirement.upsert({
    where: { siteId_requirementTypeId: { siteId: site.id, requirementTypeId: type.id } },
    update: { status: "submitted", documentUrl: "portal-attachment:" + a.id, required: true },
    create: { siteId: site.id, requirementTypeId: type.id, required: true, status: "submitted", documentUrl: "portal-attachment:" + a.id },
  });
  await prisma.site.update({ where: { id: site.id }, data: { updatedAt: new Date() } });
  ok(res, { upload: a, status: "submitted" }, 201);
}));

portalRouter.get("/sites/:id/documents/:typeKey/content", h(async (req, res) => {
  const site = await ownSite(param(req.params.id), myScope(req));
  if (!site) return void notFound(res);
  const r = site.documentRequirements.find((x) => x.requirementType.key === param(req.params.typeKey));
  const id = r?.documentUrl?.startsWith("portal-attachment:") ? r.documentUrl.slice(18) : null;
  const a = id ? await prisma.portalAttachment.findFirst({ where: { id, ...attachmentWhere(myScope(req)) }, select: { storagePath: true, mimeType: true, fileName: true } }) : null;
  if (!a) return void notFound(res);
  res.setHeader("Content-Type", a.mimeType);
  res.setHeader("Content-Disposition", 'inline; filename="' + (a.fileName ?? "file") + '"');
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(await getFile(a.storagePath));
}));

void STAGE_KEY;
