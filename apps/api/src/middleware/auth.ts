import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
    roleKey: string;
    customerId?: string | null;
    vendorId?: string | null;
    permissions: Set<string>;
  };
}

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  try {
    const payload = verifyToken(header.slice("Bearer ".length));
    // Load the user (not just the role) so we can (a) reject deactivated accounts whose
    // tokens are still valid, and (b) reflect role/permission changes immediately rather
    // than trusting the role baked into the token at sign-in time.
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!user) return res.status(401).json({ error: "Unknown user" });
    if (!user.isActive) return res.status(401).json({ error: "Account is inactive" });

    req.auth = {
      userId: user.id,
      roleKey: user.role.key,
      customerId: user.customerId,
      vendorId: user.vendorId,
      permissions: new Set(user.role.permissions.map((rp) => rp.permission.key)),
    };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requirePermission(...permissionKeys: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "Not authenticated" });
    const hasAny = permissionKeys.some((p) => req.auth!.permissions.has(p));
    if (!hasAny) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

export function requireRole(...roleKeys: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "Not authenticated" });
    if (!roleKeys.includes(req.auth.roleKey)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

/** Gate on CompanySettings.agentVisibleRoleKeys - the Super-Admin-controlled allowlist of
 * which roles may use the in-app AI agent at all, independent of what that role's normal
 * data permissions would otherwise let it see. Previously enforced client-side only (the
 * chat bubble just hid itself), which meant any authenticated user could reach the real
 * chat endpoints directly and use the agent regardless of the admin's setting - this closes
 * that gap by re-checking it on every agent route, the same way requirePermission re-checks
 * data permissions rather than trusting the frontend to hide a button. Fails closed: an empty
 * or missing allowlist (including no CompanySettings row yet) means nobody can use the agent,
 * matching the documented "empty array = hidden for everyone" behavior of the setting.
 */
export async function requireAgentAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "Not authenticated" });
  const company = await prisma.companySettings.findUnique({
    where: { id: "singleton" },
    select: { agentVisibleRoleKeys: true },
  });
  if (!company?.agentVisibleRoleKeys.includes(req.auth.roleKey)) {
    return res.status(403).json({ error: "The AI assistant isn't enabled for your role." });
  }
  next();
}
