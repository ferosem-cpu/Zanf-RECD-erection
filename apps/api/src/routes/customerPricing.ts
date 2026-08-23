import { Router } from "express";
import { upsertCustomerProductPriceSchema, upsertCustomerSavedItemPriceSchema, PERMISSION_KEY } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { requirePermission, authenticate } from "../middleware/auth";
import { asString } from "../lib/params";

export const customerPricingRouter = Router();
customerPricingRouter.use(authenticate);
customerPricingRouter.use(requirePermission(PERMISSION_KEY.MANAGE_QUOTATIONS, PERMISSION_KEY.MANAGE_INVOICES));

// GET /customer-pricing?customerId=X - every product/saved-item price override for one customer.
customerPricingRouter.get("/", async (req, res) => {
  const customerId = req.query.customerId ? String(req.query.customerId) : null;
  if (!customerId) return res.status(400).json({ error: "customerId query param is required" });

  const [productPrices, savedItemPrices] = await Promise.all([
    prisma.customerProductPrice.findMany({
      where: { customerId },
      include: { product: { select: { name: true, model: true, silencerType: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.customerSavedItemPrice.findMany({
      where: { customerId },
      include: { savedItem: { select: { name: true, standardPrice: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  res.json({
    products: productPrices.map((p) => ({
      id: p.id,
      productId: p.productId,
      productName: p.product.name,
      productModel: p.product.model,
      silencerType: p.product.silencerType,
      price: p.price,
    })),
    savedItems: savedItemPrices.map((p) => ({
      id: p.id,
      savedItemId: p.savedItemId,
      name: p.savedItem.name,
      standardPrice: p.savedItem.standardPrice,
      price: p.price,
    })),
  });
});

// PUT /customer-pricing/products - upsert on the (customerId, productId) unique key.
customerPricingRouter.put("/products", async (req, res) => {
  const parsed = upsertCustomerProductPriceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { customerId, productId, price } = parsed.data;
  const [customer, product] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId } }),
    prisma.product.findUnique({ where: { id: productId } }),
  ]);
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  if (!product) return res.status(404).json({ error: "Product not found" });

  const row = await prisma.customerProductPrice.upsert({
    where: { customerId_productId: { customerId, productId } },
    update: { price },
    create: { customerId, productId, price },
  });
  res.json(row);
});

customerPricingRouter.delete("/products/:id", async (req, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.customerProductPrice.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Price override not found" });

  await prisma.customerProductPrice.delete({ where: { id } });
  res.status(204).end();
});

// PUT /customer-pricing/saved-items - upsert on the (customerId, savedItemId) unique key.
customerPricingRouter.put("/saved-items", async (req, res) => {
  const parsed = upsertCustomerSavedItemPriceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { customerId, savedItemId, price } = parsed.data;
  const [customer, savedItem] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId } }),
    prisma.savedLineItem.findUnique({ where: { id: savedItemId } }),
  ]);
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  if (!savedItem) return res.status(404).json({ error: "Saved item not found" });

  const row = await prisma.customerSavedItemPrice.upsert({
    where: { customerId_savedItemId: { customerId, savedItemId } },
    update: { price },
    create: { customerId, savedItemId, price },
  });
  res.json(row);
});

customerPricingRouter.delete("/saved-items/:id", async (req, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.customerSavedItemPrice.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Price override not found" });

  await prisma.customerSavedItemPrice.delete({ where: { id } });
  res.status(204).end();
});
