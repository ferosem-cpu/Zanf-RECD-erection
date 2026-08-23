import { Router } from "express";
import { createSavedLineItemSchema, updateSavedLineItemSchema, PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { requirePermission, authenticate } from "../middleware/auth";
import { asString } from "../lib/params";

export const savedItemsRouter = Router();
savedItemsRouter.use(authenticate);
savedItemsRouter.use(requirePermission(PERMISSION_KEY.MANAGE_SETTINGS));

// GET /saved-items - active items by default; ?includeArchived=1 also returns archived ones.
savedItemsRouter.get("/", async (req, res) => {
  const includeArchived = req.query.includeArchived === "1";
  const items = await prisma.savedLineItem.findMany({
    where: includeArchived ? undefined : { active: true },
    orderBy: { name: "asc" },
  });
  res.json(items);
});

savedItemsRouter.post("/", async (req, res) => {
  const parsed = createSavedLineItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const item = await prisma.savedLineItem.create({
    data: {
      name: parsed.data.name,
      hsnCode: parsed.data.hsnCode,
      standardPrice: parsed.data.standardPrice,
      taxRatePct: parsed.data.taxRatePct ?? 18,
    },
  });
  res.status(201).json(item);
});

savedItemsRouter.put("/:id", async (req, res) => {
  const id = asString(req.params.id);
  const parsed = updateSavedLineItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.savedLineItem.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Saved item not found" });

  const item = await prisma.savedLineItem.update({
    where: { id },
    data: parsed.data,
  });
  res.json(item);
});

// PATCH /saved-items/:id/archive - soft delete; matches the vendor-archive convention.
savedItemsRouter.patch("/:id/archive", async (req, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.savedLineItem.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Saved item not found" });

  const item = await prisma.savedLineItem.update({ where: { id }, data: { active: false } });
  res.json(item);
});

savedItemsRouter.patch("/:id/unarchive", async (req, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.savedLineItem.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Saved item not found" });

  const item = await prisma.savedLineItem.update({ where: { id }, data: { active: true } });
  res.json(item);
});
