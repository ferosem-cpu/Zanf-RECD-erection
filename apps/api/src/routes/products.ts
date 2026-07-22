import { Router } from "express";
import { createProductSchema, PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { requirePermission, authenticate } from "../middleware/auth";

export const productsRouter = Router();
productsRouter.use(authenticate);

// Read access: anyone who can place an order needs to pick a product.
productsRouter.get("/", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (_req, res) => {
  const products = await prisma.product.findMany({ orderBy: { model: "asc" } });
  res.json(products);
});

productsRouter.post("/", requirePermission(PERMISSION_KEY.MANAGE_ORDERS), async (req, res) => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const modelTaken = await prisma.product.findUnique({ where: { model: parsed.data.model } });
  if (modelTaken) return res.status(400).json({ error: "A product with that model already exists" });

  const product = await prisma.product.create({
    data: {
      name: parsed.data.name,
      model: parsed.data.model,
      ratingSpec: parsed.data.ratingSpec,
      capacityKva: parsed.data.capacityKva,
      warrantyMonths: parsed.data.warrantyMonths,
    },
  });

  res.status(201).json(product);
});
