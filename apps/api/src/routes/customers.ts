import { Router } from "express";
import { Prisma } from "@prisma/client";
import { createCustomerSchema, updateCustomerSchema, PERMISSION_KEY, ROLE_KEY } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";
import { z } from "zod";
import { countCustomerBlockers, customerBlockerMessage, nonZeroBlockers, deleteCustomerWithPortalData, CUSTOMER_FK_MESSAGE } from "../services/customerDelete";
import { looksLikeEmail, normalisePhone } from "../services/portalDomain";

export const customersRouter = Router();
customersRouter.use(authenticate);

// Read access: anyone who needs to pick a customer for a document (sales orders, quotations,
// invoices) - not just order management. Creating/editing customers stays sales-only below.
customersRouter.get(
  "/",
  requirePermission(
    PERMISSION_KEY.MANAGE_ORDERS,
    PERMISSION_KEY.MANAGE_QUOTATIONS,
    PERMISSION_KEY.MANAGE_INVOICES,
    PERMISSION_KEY.VIEW_LEDGERS,
  ),
  async (_req, res) => {
    const customers = await prisma.customer.findMany({
      include: { contacts: { select: { id: true, name: true, phone: true, email: true } } },
      orderBy: { name: "asc" },
    });
    res.json(customers);
  },
);

customersRouter.get(
  "/:id",
  requirePermission(PERMISSION_KEY.MANAGE_ORDERS, PERMISSION_KEY.MANAGE_QUOTATIONS, PERMISSION_KEY.MANAGE_INVOICES),
  async (req, res) => {
    const id = asString(req.params.id);
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        contacts: { select: { id: true, name: true, phone: true, email: true } },
        orders: {
          include: {
            product: true,
            site: { include: { currentStage: true, assignedEngineer: true, vendor: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json(customer);
  },
);

/**
 * Create a customer plus its primary contact. The contact is a CUSTOMER-role user whose
 * phone is the credential they later use to log in (Order ID + phone -> OTP). No password
 * is set - customers never use email/password.
 */
customersRouter.post("/", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const parsed = createCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const customerRole = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEY.CUSTOMER } });

  const phoneTaken = await prisma.user.findUnique({ where: { phone: parsed.data.contactPhone } });
  if (phoneTaken) return res.status(400).json({ error: "A contact with that phone number already exists" });

  const customer = await prisma.customer.create({
    data: {
      name: parsed.data.name,
      address: parsed.data.address,
      gstin: parsed.data.gstin,
      state: parsed.data.state,
      salesOwnerId: req.auth!.userId,
      contacts: {
        create: {
          name: parsed.data.contactName,
          phone: parsed.data.contactPhone,
          email: parsed.data.contactEmail,
          roleId: customerRole.id,
          isActive: true,
          mustChangePassword: false,
        },
      },
    },
    include: { contacts: { select: { id: true, name: true, phone: true, email: true } } },
  });

  res.status(201).json(customer);
});

customersRouter.put("/:id", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = updateCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const existing = await prisma.customer.findUnique({
    where: { id },
    include: { contacts: { select: { id: true, phone: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Customer not found" });

  const primaryContact = existing.contacts[0];
  if (data.contactPhone && data.contactPhone !== primaryContact?.phone) {
    const phoneTaken = await prisma.user.findUnique({ where: { phone: data.contactPhone } });
    if (phoneTaken) return res.status(400).json({ error: "A contact with that phone number already exists" });
  }

  const customer = await prisma.$transaction(async (tx) => {
    if (primaryContact && (data.contactName !== undefined || data.contactPhone !== undefined || data.contactEmail !== undefined)) {
      await tx.user.update({
        where: { id: primaryContact.id },
        data: {
          name: data.contactName,
          phone: data.contactPhone,
          email: data.contactEmail,
        },
      });
    }
    return tx.customer.update({
      where: { id },
      data: {
        name: data.name,
        address: data.address,
        gstin: data.gstin,
        state: data.state,
        openingBalance: data.openingBalance,
        openingBalanceDate: data.openingBalanceDate ? new Date(data.openingBalanceDate) : undefined,
      },
      include: { contacts: { select: { id: true, name: true, phone: true, email: true } } },
    });
  });

  res.json(customer);
});

customersRouter.delete("/:id", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return res.status(404).json({ error: "Customer not found" });

  const counts = await countCustomerBlockers(prisma, id);
  const message = customerBlockerMessage(counts);
  if (message) return res.status(409).json({ error: message, blockers: nonZeroBlockers(counts) });

  try {
    await prisma.$transaction((tx) => deleteCustomerWithPortalData(tx, id), { timeout: 30_000 });
  } catch (e) {
    // A portal contact is referenced by a restricting FK we did not pre-count: block, do not 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") return res.status(409).json({ error: CUSTOMER_FK_MESSAGE });
    throw e;
  }
  res.status(204).end();
});

// Payments recorded for this customer with a positive unallocated remainder - i.e. money
// on account that hasn't yet been applied to an invoice (see PaymentAllocation, Phase C).
customersRouter.get(
  "/:id/advances",
  requirePermission(PERMISSION_KEY.RECORD_PAYMENTS, PERMISSION_KEY.MANAGE_INVOICES, PERMISSION_KEY.VIEW_LEDGERS),
  async (req, res) => {
    const id = asString(req.params.id);
    const payments = await prisma.paymentReceived.findMany({
      where: { customerId: id },
      include: { allocations: { select: { amount: true } } },
      orderBy: { receivedDate: "desc" },
    });
    const advances = payments
      .map((p) => {
        const allocated = p.allocations.reduce((s, a) => s.plus(a.amount), new Prisma.Decimal(0));
        const unallocated = new Prisma.Decimal(p.amount).minus(allocated);
        return { ...p, allocatedAmount: allocated, unallocatedAmount: unallocated, allocations: undefined };
      })
      .filter((p) => p.unallocatedAmount.greaterThan(0.01));
    res.json(advances);
  },
);

// ---------- Customer Portal: locations (branches) and portal contacts. Same permission as the rest of customer management. ----------
const locationName = z.string().trim().min(1, "Enter a location name").max(80);

/** A location must belong to this customer (and, when assigning, be active). Returns null when it does not. */
async function ownLocation(customerId: string, locationId: string, mustBeActive: boolean) {
  const l = await prisma.customerLocation.findFirst({ where: { id: locationId, customerId, ...(mustBeActive ? { active: true } : {}) } });
  return l;
}
const dupName = async (customerId: string, name: string, exceptId?: string) =>
  !!(await prisma.customerLocation.findFirst({ where: { customerId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }));

customersRouter.get("/:id/locations", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req, res) => {
  const customerId = asString(req.params.id);
  if (!(await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) return res.status(404).json({ error: "Customer not found" });
  const rows = await prisma.customerLocation.findMany({ where: { customerId }, orderBy: { name: "asc" }, include: { _count: { select: { users: true, sites: true } } } });
  res.json(rows.map((l) => ({ id: l.id, name: l.name, active: l.active, userCount: l._count.users, siteCount: l._count.sites })));
});

customersRouter.post("/:id/locations", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req, res) => {
  const customerId = asString(req.params.id);
  const p = z.object({ name: locationName }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Enter a location name" });
  if (!(await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) return res.status(404).json({ error: "Customer not found" });
  if (await dupName(customerId, p.data.name)) return res.status(409).json({ error: "This customer already has a location with that name" });
  const l = await prisma.customerLocation.create({ data: { customerId, name: p.data.name } });
  res.status(201).json({ id: l.id, name: l.name, active: l.active, userCount: 0, siteCount: 0 });
});

customersRouter.put("/:id/locations/:locId", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req, res) => {
  const customerId = asString(req.params.id);
  const p = z.object({ name: locationName.optional(), active: z.boolean().optional() }).strict().safeParse(req.body);
  if (!p.success || (p.data.name === undefined && p.data.active === undefined)) return res.status(400).json({ error: "Nothing to change" });
  const l = await ownLocation(customerId, asString(req.params.locId), false);
  if (!l) return res.status(404).json({ error: "Location not found" });
  if (p.data.name !== undefined && (await dupName(customerId, p.data.name, l.id))) return res.status(409).json({ error: "This customer already has a location with that name" });
  const u = await prisma.customerLocation.update({ where: { id: l.id }, data: { ...(p.data.name !== undefined ? { name: p.data.name } : {}), ...(p.data.active !== undefined ? { active: p.data.active } : {}) } });
  res.json({ id: u.id, name: u.name, active: u.active });
});

/** Bulk assignment of existing sites to a location (staff). GET lists every site of the customer with its current location; PUT moves the chosen sites. */
customersRouter.get("/:id/sites", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req: AuthenticatedRequest, res) => {
  if (req.auth!.customerId || req.auth!.vendorId) return res.status(403).json({ error: "Forbidden" });
  const customerId = asString(req.params.id);
  if (!(await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) return res.status(404).json({ error: "Customer not found" });
  const rows = await prisma.site.findMany({
    where: { order: { customerId } }, orderBy: { createdAt: "desc" }, take: 1000,
    select: { id: true, companyName: true, customerLocationId: true, order: { select: { orderNumber: true } }, currentStage: { select: { label: true } } },
  });
  res.json(rows.map((s) => ({ id: s.id, name: s.companyName, orderNumber: s.order?.orderNumber ?? null, stage: s.currentStage?.label ?? null, customerLocationId: s.customerLocationId })));
});

customersRouter.put("/:id/locations/:locId/sites", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req: AuthenticatedRequest, res) => {
  if (req.auth!.customerId || req.auth!.vendorId) return res.status(403).json({ error: "Forbidden" });
  const customerId = asString(req.params.id);
  const p = z.object({ siteIds: z.array(z.string().min(1).max(40)).min(1).max(200) }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Choose between 1 and 200 sites" });
  const l = await ownLocation(customerId, asString(req.params.locId), true);
  if (!l) return res.status(400).json({ error: "Choose one of this customer's active locations" });
  const ids = [...new Set(p.data.siteIds)];
  // Only this customer's own sites can move; a foreign or unknown id is simply not counted.
  const r = await prisma.site.updateMany({ where: { id: { in: ids }, order: { customerId } }, data: { customerLocationId: l.id } });
  res.json({ assigned: r.count, requested: ids.length, location: l.name });
});

const contactSelect = { id: true, name: true, email: true, phone: true, isActive: true, customerLocationId: true } as const;

customersRouter.get("/:id/contacts", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req, res) => {
  const customerId = asString(req.params.id);
  if (!(await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) return res.status(404).json({ error: "Customer not found" });
  res.json(await prisma.user.findMany({ where: { customerId, role: { key: ROLE_KEY.CUSTOMER } }, select: contactSelect, orderBy: { createdAt: "asc" } }));
});

const contactBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(200).refine(looksLikeEmail, "Enter a valid e-mail"),
  phone: z.string().trim().max(40).refine((v) => !v || normalisePhone(v) !== null, "Enter a valid 10-digit mobile number").optional(),
  customerLocationId: z.string().max(40).nullable().optional(),
}).strict();

customersRouter.post("/:id/contacts", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req, res) => {
  const customerId = asString(req.params.id);
  const p = contactBody.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message ?? "Invalid request" });
  if (!(await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) return res.status(404).json({ error: "Customer not found" });
  if (p.data.customerLocationId && !(await ownLocation(customerId, p.data.customerLocationId, true))) return res.status(400).json({ error: "Choose one of this customer's active locations" });
  const email = p.data.email.toLowerCase();
  const phone = p.data.phone ? normalisePhone(p.data.phone) : null;
  if (await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })) return res.status(409).json({ error: "A user with that e-mail already exists" });
  if (phone && (await prisma.user.findUnique({ where: { phone }, select: { id: true } }))) return res.status(409).json({ error: "A user with that phone number already exists" });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEY.CUSTOMER } });
  const u = await prisma.user.create({
    data: { name: p.data.name, email, phone, roleId: role.id, customerId, customerLocationId: p.data.customerLocationId ?? null, isActive: true, mustChangePassword: false },
    select: contactSelect,
  });
  res.status(201).json(u);
});

customersRouter.put("/:id/contacts/:userId", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req, res) => {
  const customerId = asString(req.params.id);
  const p = contactBody.partial().extend({ isActive: z.boolean().optional() }).strict().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message ?? "Invalid request" });
  const user = await prisma.user.findFirst({ where: { id: asString(req.params.userId), customerId, role: { key: ROLE_KEY.CUSTOMER } }, select: { id: true } });
  if (!user) return res.status(404).json({ error: "Contact not found" });
  if (p.data.customerLocationId && !(await ownLocation(customerId, p.data.customerLocationId, true))) return res.status(400).json({ error: "Choose one of this customer's active locations" });
  const data: Prisma.UserUncheckedUpdateInput = {};
  if (p.data.name !== undefined) data.name = p.data.name;
  if (p.data.email !== undefined) {
    const email = p.data.email.toLowerCase();
    if (await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, id: { not: user.id } }, select: { id: true } })) return res.status(409).json({ error: "A user with that e-mail already exists" });
    data.email = email;
  }
  if (p.data.phone !== undefined) {
    const phone = p.data.phone ? normalisePhone(p.data.phone) : null;
    if (phone && (await prisma.user.findFirst({ where: { phone, id: { not: user.id } }, select: { id: true } }))) return res.status(409).json({ error: "A user with that phone number already exists" });
    data.phone = phone;
  }
  if (p.data.customerLocationId !== undefined) data.customerLocationId = p.data.customerLocationId; // null = customer admin (all locations)
  if (p.data.isActive !== undefined) data.isActive = p.data.isActive;
  res.json(await prisma.user.update({ where: { id: user.id }, data, select: contactSelect }));
});
