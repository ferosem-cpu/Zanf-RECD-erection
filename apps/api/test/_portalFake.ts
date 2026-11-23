/** In-memory stand-in for the Prisma client used by the portal routes: a tiny "where" interpreter (equality, null, in, not, startsWith,
 *  equals+insensitive, OR/AND and to-one relation filters) over plain arrays. It lets the REAL routers run through real signed HTTP calls
 *  so tests prove what the actual Prisma filters would return for each persona. */
import "./_testEnv";
import { prisma } from "../src/lib/prisma";

export type Rec = Record<string, any>;
export const DB: Record<string, Rec[]> = { sites: [], orders: [], complaints: [], attachments: [], pending: [], events: [], locations: [], users: [], customers: [], comments: [], roles: [] };
const TABLE: Record<string, string> = { site: "sites", order: "orders", complaint: "complaints", portalAttachment: "attachments", pendingAction: "pending", siteStageEvent: "events", customerLocation: "locations", user: "users", customer: "customers", complaintComment: "comments", role: "roles" };
const RELS: Record<string, Record<string, string>> = {
  site: { order: "order", customerLocation: "customerLocation" }, order: { site: "site" }, complaint: { site: "site" },
  portalAttachment: { site: "site", order: "order", complaint: "complaint" }, pendingAction: { site: "site" }, siteStageEvent: { site: "site" },
  user: { role: "role", customerLocation: "customerLocation" },
};
export const by = (t: string, id: unknown): Rec | undefined => (id ? DB[t].find((r) => r.id === id) : undefined);

export function match(model: string, rec: Rec, where: Rec): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") { if (!(v as Rec[]).some((w) => match(model, rec, w))) return false; continue; }
    if (k === "AND") { if (!(v as Rec[]).every((w) => match(model, rec, w))) return false; continue; }
    const relModel = RELS[model]?.[k];
    if (relModel) { const rel = rec[k]; if (!rel || !match(relModel, rel, v as Rec)) return false; continue; }
    const val = rec[k];
    if (v === null) { if (val != null) return false; continue; }
    if (typeof v === "object" && !(v instanceof Date)) {
      const o = v as Rec;
      if ("in" in o && !(o.in as unknown[]).includes(val)) return false;
      if ("not" in o) { if (o.not === null ? val == null : val === o.not) return false; }
      if ("startsWith" in o && !(typeof val === "string" && val.startsWith(o.startsWith))) return false;
      if ("equals" in o && (o.mode === "insensitive" ? String(val ?? "").toLowerCase() !== String(o.equals).toLowerCase() : val !== o.equals)) return false;
      if ("contains" in o && !(typeof val === "string" && val.includes(o.contains))) return false;
      continue;
    }
    if (val !== v) return false;
  }
  return true;
}

const pick = (r: Rec | null | undefined, select?: Rec) => {
  if (!r || !select) return r ?? null;
  const o: Rec = {};
  for (const [k, v] of Object.entries(select)) if (v) o[k] = r[k];
  return o;
};
function delegate(model: string) {
  const t = TABLE[model];
  const rows = (where?: Rec) => DB[t].filter((r) => match(model, r, where ?? {}));
  return {
    findMany: async (a: Rec = {}) => {
      let r = rows(a.where);
      if (a.take) r = r.slice(0, a.take);
      if (model === "customerLocation" && a.include?._count) return r.map((l) => ({ ...l, _count: { users: DB.users.filter((u) => u.customerLocationId === l.id).length, sites: DB.sites.filter((s) => s.customerLocationId === l.id).length } }));
      return a.select ? r.map((x) => pick(x, a.select)) : r;
    },
    findFirst: async (a: Rec = {}) => pick(rows(a.where)[0] ?? null, a.select),
    findUnique: async (a: Rec) => pick(rows(a.where)[0] ?? null, a.select),
    findUniqueOrThrow: async (a: Rec) => { const r = rows(a.where)[0]; if (!r) throw new Error("not found"); return r; },
    count: async (a: Rec = {}) => rows(a.where).length,
    updateMany: async (a: Rec) => { const r = rows(a.where); r.forEach((x) => Object.assign(x, a.data)); return { count: r.length }; },
    update: async (a: Rec) => { const x = rows(a.where)[0]; if (!x) throw new Error("not found"); Object.assign(x, a.data); return pick(x, a.select); },
    create: async (a: Rec) => {
      const x: Rec = { id: model + "_" + Math.random().toString(36).slice(2, 8), createdAt: new Date(), isActive: true, active: true, ...a.data };
      if (model === "user") x.role = { key: "customer" };
      DB[t].push(x); return pick(x, a.select);
    },
    deleteMany: async (a: Rec) => { const r = rows(a.where); DB[t] = DB[t].filter((x) => !r.includes(x)); return { count: r.length }; },
    delete: async (a: Rec) => { const x = rows(a.where)[0]; DB[t] = DB[t].filter((y) => y !== x); return x; },
    createMany: async () => ({ count: 1 }),
  };
}

export function resetDb() { for (const k of Object.keys(DB)) DB[k] = []; }
let installed = false;
export function installFakePrisma() {
  if (installed) return; installed = true;
  const p = prisma as unknown as object;
  const def = (k: string, v: unknown) => Object.defineProperty(p, k, { value: v, configurable: true, writable: true });
  for (const m of Object.keys(TABLE)) def(m, delegate(m));
  def("portalNonce", { createMany: async () => ({ count: 1 }), deleteMany: async () => ({ count: 0 }) });
  def("$transaction", async (x: unknown) => (Array.isArray(x) ? Promise.all(x) : (x as (c: unknown) => Promise<unknown>)(prisma)));
}

// ---- record factories (getters give each record the nested relations the real include would return) ----
let n = 0;
export const mkCustomer = (id: string, name: string) => { const r = { id, name }; DB.customers.push(r); return r; };
export const mkLocation = (id: string, customerId: string, name: string, active = true) => { const r = { id, customerId, name, active, createdAt: new Date() }; DB.locations.push(r); return r; };
export function mkUser(id: string, customerId: string | null, customerLocationId: string | null, o: Rec = {}) {
  const r: Rec = { id, name: "User " + id, email: id + "@example.test", phone: null, isActive: true, customerId, customerLocationId, role: { key: "customer" }, createdAt: new Date(++n), ...o };
  Object.defineProperty(r, "customerLocation", { enumerable: true, get: () => by("locations", r.customerLocationId) ?? null });
  DB.users.push(r); return r;
}
export function mkSite(id: string, customerId: string, customerLocationId: string | null, o: Rec = {}) {
  const orderId = "o_" + id;
  const order: Rec = { id: orderId, orderNumber: "ORD-" + id, customerId, orderDate: new Date("2026-11-01"), createdAt: new Date("2026-11-01"), customerPoNumber: null, requestedByCustomer: true, portalSubmissionId: null, portalSubmission: null };
  Object.defineProperty(order, "site", { enumerable: true, get: () => DB.sites.find((s) => s.orderId === orderId) });
  DB.orders.push(order);
  const s: Rec = {
    id, orderId, companyName: "Site " + id, address: "1 Road", addressParts: null, source: "portal", gpsLat: null, gpsLng: null, dgCapacityKva: 250, dgModel: null, dgLocation: null,
    accessNotes: null, requestedStartDate: null, requestedCompletionDate: null, installPriority: "normal", priorityReason: null, customerLocationId,
    currentStage: { key: "order_received", label: "Order received", phase: "SALES", sequenceOrder: 1 }, stageEvents: [], contacts: [], documentRequirements: [],
    updatedAt: new Date("2026-11-02T00:00:00Z"), createdAt: new Date("2026-11-01"), ...o,
  };
  Object.defineProperty(s, "order", { enumerable: true, get: () => by("orders", orderId) });
  Object.defineProperty(s, "customerLocation", { enumerable: true, get: () => by("locations", s.customerLocationId) ?? null });
  DB.sites.push(s); return s;
}
export const mkComplaint = (id: string, customerId: string, siteId: string | null, o: Rec = {}) => {
  const r: Rec = { id, ticketNumber: "TCK-" + id, customerId, siteId, category: "delivery_delay", description: "Something is wrong", severity: "medium", status: "open", createdAt: new Date("2026-11-03"), closedAt: null, ...o };
  Object.defineProperty(r, "site", { enumerable: true, get: () => { const s = by("sites", r.siteId); return s ? { id: s.id, companyName: s.companyName, ...s } : null; } });
  DB.complaints.push(r); return r;
};
export const mkAttachment = (id: string, customerId: string, o: Rec = {}) => {
  const r: Rec = { id, customerId, kind: "site_photo", siteId: null, orderId: null, complaintId: null, draftId: null, commentId: null, uploadedByUserId: "nobody", mimeType: "image/jpeg", fileName: id + ".jpg", storagePath: "drive:" + id, createdAt: new Date("2026-11-04"), ...o };
  for (const [rel, t, k] of [["site", "sites", "siteId"], ["order", "orders", "orderId"], ["complaint", "complaints", "complaintId"]] as const)
    Object.defineProperty(r, rel, { enumerable: true, get: () => by(t, r[k]) });
  DB.attachments.push(r); return r;
};
export const mkPending = (id: string, siteId: string, o: Rec = {}) => {
  const r: Rec = { id, ownerType: "CUSTOMER", status: "open", description: "Please send the PO", dueDate: null, createdAt: new Date("2026-11-05"), siteId, ...o };
  Object.defineProperty(r, "site", { enumerable: true, get: () => by("sites", siteId) });
  DB.pending.push(r); return r;
};
export const mkEvent = (id: string, siteId: string) => {
  const r: Rec = { id, siteId, createdAt: new Date("2026-11-06"), comment: null, stageDefinition: { label: "Order received", phase: "SALES" }, statusOption: { label: "On track" } };
  Object.defineProperty(r, "site", { enumerable: true, get: () => { const s = by("sites", siteId)!; return { id: s.id, companyName: s.companyName, order: { orderNumber: s.order.orderNumber }, ...s }; } });
  DB.events.push(r); return r;
};
