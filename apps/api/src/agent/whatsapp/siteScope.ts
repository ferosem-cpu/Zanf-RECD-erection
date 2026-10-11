/** WhatsApp-only site scope (DISCOVERY 4.4 / 348). Every helper returns undefined when
 * auth.waGroup is unset, so the in-app assistant is never affected. */
import type { Prisma } from "@prisma/client";
import type { AgentAuthContext } from "../tools/types";

/** Site predicate: engineers see only sites assigned to them (vendor engineers: also their vendor). */
export function waSiteWhere(auth: Pick<AgentAuthContext, "waGroup" | "userId" | "vendorId">): Prisma.SiteWhereInput | undefined {
  if (!auth.waGroup) return undefined;
  if (auth.waGroup !== "engineer") return {};
  if (!auth.userId) return { id: { in: [] } };
  return { assignedEngineerId: auth.userId, ...(auth.vendorId ? { vendorId: auth.vendorId } : {}) };
}

/** True when the WhatsApp path restricts rows (engineers). */
export function waIsScoped(auth: Pick<AgentAuthContext, "waGroup">): boolean {
  return auth.waGroup === "engineer";
}

/** Order predicate for the same scope (orders without a site are invisible to engineers). */
export function waOrderWhere(auth: Pick<AgentAuthContext, "waGroup" | "userId" | "vendorId">): Prisma.OrderWhereInput | undefined {
  const site = waSiteWhere(auth);
  return site && waIsScoped(auth) ? { site: { is: site } } : undefined;
}

/** SiteStageEvent predicate for the same scope. */
export function waEventWhere(auth: Pick<AgentAuthContext, "waGroup" | "userId" | "vendorId">): Prisma.SiteStageEventWhereInput | undefined {
  const site = waSiteWhere(auth);
  return site && waIsScoped(auth) ? { site } : undefined;
}

/** Row-level check for a site already loaded by id. */
export function waSiteVisible(
  auth: Pick<AgentAuthContext, "waGroup" | "userId" | "vendorId">,
  site: { assignedEngineerId: string | null; vendorId: string | null } | null,
): boolean {
  if (!auth.waGroup) return true;
  if (!waIsScoped(auth)) return true;
  if (!site || !auth.userId || site.assignedEngineerId !== auth.userId) return false;
  return !auth.vendorId || site.vendorId === auth.vendorId;
}
