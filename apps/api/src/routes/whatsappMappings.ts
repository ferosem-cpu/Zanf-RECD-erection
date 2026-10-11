/** Super-Admin-only management of WhatsApp sender mappings (/whatsapp/mappings).
 * Gate: authenticate + role super_admin + MANAGE_SETTINGS. Owner/Admin and Management are
 * deliberately excluded: D1 "same as Super Admin" covers WhatsApp data access, not mapping admin.
 */
import { Router, type RequestHandler } from "express";
import { PERMISSION_KEY, ROLE_KEY } from "@recd/shared";
import { authenticate, requirePermission, requireRole, type AuthenticatedRequest } from "../middleware/auth";
import {
  createMapping, removeMapping, setEnabled, setPaused, MappingError, type MappingStore,
} from "../services/whatsappMapping";
import { prismaMappingStore } from "../services/whatsappMappingStore";

export function createWhatsappMappingsRouter(
  deps: { store?: MappingStore; authenticate?: RequestHandler } = {},
): Router {
  const store = deps.store ?? prismaMappingStore;
  const router = Router();
  router.use(
    deps.authenticate ?? authenticate,
    requireRole(ROLE_KEY.SUPER_ADMIN),
    requirePermission(PERMISSION_KEY.MANAGE_SETTINGS),
  );

  const handle = (fn: (req: AuthenticatedRequest) => Promise<unknown>): RequestHandler => async (req, res) => {
    try {
      res.json(await fn(req as AuthenticatedRequest));
    } catch (err) {
      if (err instanceof MappingError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  };
  const actor = (req: AuthenticatedRequest) => req.auth!.userId;
  const id = (req: AuthenticatedRequest) => String(req.params.id);

  router.get("/", handle(async () => ({ mappings: await store.list() })));
  router.post("/", handle(async (req) => ({ mapping: await createMapping(store, actor(req), req.body ?? {}) })));
  router.post("/:id/enable", handle(async (req) => ({ mapping: await setEnabled(store, actor(req), id(req), true) })));
  router.post("/:id/disable", handle(async (req) => ({ mapping: await setEnabled(store, actor(req), id(req), false) })));
  router.post("/:id/pause", handle(async (req) => ({ mapping: await setPaused(store, actor(req), id(req), true) })));
  router.post("/:id/unpause", handle(async (req) => ({ mapping: await setPaused(store, actor(req), id(req), false) })));
  router.delete("/:id", handle(async (req) => {
    await removeMapping(store, id(req));
    return { ok: true };
  }));
  return router;
}

export const whatsappMappingsRouter = createWhatsappMappingsRouter();
