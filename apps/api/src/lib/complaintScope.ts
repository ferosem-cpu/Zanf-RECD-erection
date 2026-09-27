import { PERMISSION_KEY } from "@recd/shared";

/** The caller fields that decide which complaints GET /complaints returns. */
export interface ComplaintScopeCaller {
  customerId?: string | null;
  userId: string;
  permissions: ReadonlySet<string>;
}

/** Any one of these lets a caller call GET /complaints at all (scoping is done below). */
export const COMPLAINT_LIST_PERMISSIONS = [
  PERMISSION_KEY.RAISE_COMPLAINT,
  PERMISSION_KEY.MANAGE_COMPLAINTS,
  PERMISSION_KEY.VIEW_COMPLAINTS_OVERVIEW,
  PERMISSION_KEY.ACT_ASSIGNED_COMPLAINTS,
] as const;

/**
 * Prisma `where` for the complaint list:
 * - customers see only their own company's tickets;
 * - managers / service team (manage_complaints) and overview viewers see everything;
 * - everyone else who got past the permission check (field engineers with
 *   act_assigned_complaints, or staff holding only raise_complaint) sees only tickets
 *   assigned to them.
 */
export function complaintListWhere(caller: ComplaintScopeCaller): Record<string, unknown> {
  if (caller.customerId) return { customerId: caller.customerId };
  if (
    caller.permissions.has(PERMISSION_KEY.MANAGE_COMPLAINTS) ||
    caller.permissions.has(PERMISSION_KEY.VIEW_COMPLAINTS_OVERVIEW)
  ) {
    return {};
  }
  return { assignedToId: caller.userId };
}
