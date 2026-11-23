/** The ONE place that decides which customer data a portal user may touch.
 *  - locationId null  = customer admin: every site/order/complaint/attachment of the customer (legacy users behave this way).
 *  - locationId set   = location user: only sites with that customerLocationId, and the orders, complaints, pending actions and
 *                       files tied to those sites. Site-less complaints and unassigned sites are admin-only.
 *  Every portal route builds its Prisma "where" from these helpers; nothing is filtered only in the UI. */
import type { Prisma } from "@prisma/client";
import type { PortalIdentity } from "./portalAuth";

export interface PortalScope { customerId: string; locationId: string | null; userId: string }
export const scopeOf = (p: Pick<PortalIdentity, "customerId" | "customerLocationId" | "userId">): PortalScope => ({ customerId: p.customerId, locationId: p.customerLocationId ?? null, userId: p.userId });
export const isAdminScope = (s: PortalScope) => s.locationId === null;

/** Optional list filter, honoured for customer admins only ("none" = sites with no location). Location users cannot widen or change their scope. */
export type LocationFilter = string | "none" | undefined;
export function filterFrom(s: PortalScope, raw: unknown): LocationFilter {
  if (!isAdminScope(s) || typeof raw !== "string" || !raw || raw.length > 40 || !/^[A-Za-z0-9_-]+$/.test(raw)) return undefined;
  return raw;
}
/** Value for Site.customerLocationId, or undefined for "no location condition". */
function loc(s: PortalScope, f: LocationFilter): string | null | undefined {
  if (s.locationId) return s.locationId;
  if (f === "none") return null;
  return f || undefined;
}

export function siteWhere(s: PortalScope, f?: LocationFilter): Prisma.SiteWhereInput {
  const l = loc(s, f);
  return { order: { customerId: s.customerId }, ...(l !== undefined ? { customerLocationId: l } : {}) };
}
export function orderWhere(s: PortalScope, f?: LocationFilter): Prisma.OrderWhereInput {
  const l = loc(s, f);
  return { customerId: s.customerId, ...(l !== undefined ? { site: { customerLocationId: l } } : {}) };
}
export function complaintWhere(s: PortalScope, f?: LocationFilter): Prisma.ComplaintWhereInput {
  const l = loc(s, f);
  if (l === undefined) return { customerId: s.customerId };
  if (l === null) return { customerId: s.customerId, OR: [{ siteId: null }, { site: { customerLocationId: null } }] }; // admin filter "none"
  return { customerId: s.customerId, site: { customerLocationId: l } };
}
/** A file is reachable when it belongs to the customer and, for location users, to one of their sites (directly, through its order or complaint) or is their own unlinked draft upload. */
export function attachmentWhere(s: PortalScope): Prisma.PortalAttachmentWhereInput {
  if (!s.locationId) return { customerId: s.customerId };
  const inLoc = { customerLocationId: s.locationId };
  return {
    customerId: s.customerId,
    OR: [
      { site: inLoc },
      { order: { site: inLoc } },
      { complaint: { site: inLoc } },
      { uploadedByUserId: s.userId, siteId: null, orderId: null, complaintId: null },
    ],
  };
}
export const pendingWhere = (s: PortalScope, f?: LocationFilter): Prisma.PendingActionWhereInput => ({ site: siteWhere(s, f) });

/** The location a new submission is stamped with: location users always get their own (whatever the request says); admins may choose one of the customer's ACTIVE locations, or none. */
export async function resolveSubmissionLocation(
  db: { customerLocation: { findFirst(args: { where: { id: string; customerId: string; active: true }; select: { id: true; name: true } }): Promise<{ id: string; name: string } | null> } },
  s: PortalScope, ownName: string | null, requestedId?: string,
): Promise<{ ok: true; locationId: string | null; locationName: string | null } | { ok: false }> {
  if (s.locationId) return { ok: true, locationId: s.locationId, locationName: ownName };
  if (!requestedId) return { ok: true, locationId: null, locationName: null };
  const l = await db.customerLocation.findFirst({ where: { id: requestedId, customerId: s.customerId, active: true }, select: { id: true, name: true } });
  return l ? { ok: true, locationId: l.id, locationName: l.name } : { ok: false };
}
