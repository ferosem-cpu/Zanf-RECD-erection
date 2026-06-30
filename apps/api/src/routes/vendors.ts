import { Router } from "express";
import bcrypt from "bcryptjs";
import { registerVendorSchema, PERMISSION_KEY, ROLE_KEY, VENDOR_STATUS } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";

export const vendorsRouter = Router();

/**
 * PUBLIC: an external erection subcontractor self-registers. No auth - this is how a vendor
 * the company has never met gets into the system. Lands in "pending" for management's due
 * diligence. Defined before the authenticate guard below so it stays open.
 */
vendorsRouter.post("/register", async (req, res) => {
  const parsed = registerVendorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.vendor.findUnique({ where: { contactEmail: parsed.data.contactEmail } });
  if (existing) return res.status(400).json({ error: "A vendor with that contact email is already registered" });

  const vendor = await prisma.vendor.create({
    data: {
      name: parsed.data.name,
      contactName: parsed.data.contactName,
      contactEmail: parsed.data.contactEmail,
      contactPhone: parsed.data.contactPhone,
      address: parsed.data.address,
      status: VENDOR_STATUS.PENDING,
    },
  });
  res.status(201).json({ id: vendor.id, name: vendor.name, status: vendor.status });
});

// Everything below requires a logged-in user with the manage_vendors permission (Super Admin / Management).
vendorsRouter.use(authenticate);

vendorsRouter.get("/", requirePermission(PERMISSION_KEY.MANAGE_VENDORS), async (_req, res) => {
  const vendors = await prisma.vendor.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { _count: { select: { members: true, sites: true } } },
  });
  res.json(vendors);
});

vendorsRouter.post("/:id/approve", requirePermission(PERMISSION_KEY.MANAGE_VENDORS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  if (vendor.status === VENDOR_STATUS.APPROVED) return res.status(400).json({ error: "Vendor is already approved" });

  await prisma.vendor.update({
    where: { id },
    data: { status: VENDOR_STATUS.APPROVED, approvedById: req.auth!.userId, approvedAt: new Date() },
  });

  // On approval the vendor's primary contact becomes a vendor-scoped erection-engineer login,
  // so "once approved, they can be added to the users list" happens automatically.
  let tempPassword: string | undefined;
  const emailTaken = await prisma.user.findUnique({ where: { email: vendor.contactEmail } });
  if (!emailTaken) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEY.ERECTION_ENGINEER } });
    tempPassword = Math.random().toString(36).slice(2, 10);
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    await prisma.user.create({
      data: {
        name: vendor.contactName,
        email: vendor.contactEmail,
        phone: vendor.contactPhone,
        roleId: role.id,
        vendorId: vendor.id,
        passwordHash,
        mustChangePassword: true,
        title: "Erection Engineer",
        createdById: req.auth!.userId,
      },
    });
  }

  res.json({
    id: vendor.id,
    status: VENDOR_STATUS.APPROVED,
    contactLoginCreated: !emailTaken,
    contactEmail: vendor.contactEmail,
    tempPassword,
  });
});

vendorsRouter.post("/:id/reject", requirePermission(PERMISSION_KEY.MANAGE_VENDORS), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  await prisma.vendor.update({ where: { id }, data: { status: VENDOR_STATUS.REJECTED } });
  res.json({ id, status: VENDOR_STATUS.REJECTED });
});
