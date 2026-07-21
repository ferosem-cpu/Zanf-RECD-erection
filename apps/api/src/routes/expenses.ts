import { Router } from "express";
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY, expenseCreateSchema, expenseUpdateSchema } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, requirePermission, type AuthenticatedRequest } from "../middleware/auth";
import { asString } from "../lib/params";

export const expensesRouter = Router();
expensesRouter.use(authenticate);

expensesRouter.get("/", requirePermission(PERMISSION_KEY.MANAGE_EXPENSES), async (req, res) => {
  const where: Record<string, unknown> = {};
  if (typeof req.query.categoryId === "string") where.categoryId = req.query.categoryId;
  if (typeof req.query.siteId === "string") where.siteId = req.query.siteId;
  if (typeof req.query.from === "string") {
    where.expenseDate = { ...(where.expenseDate as object), gte: new Date(req.query.from as string) };
  }
  if (typeof req.query.to === "string") {
    where.expenseDate = { ...(where.expenseDate as object), lte: new Date(req.query.to as string) };
  }

  const expenses = await prisma.expense.findMany({
    where,
    include: { category: { select: { id: true, key: true, label: true } }, site: { select: { id: true } } },
    orderBy: { expenseDate: "desc" },
  });
  res.json(expenses);
});

expensesRouter.post("/", requirePermission(PERMISSION_KEY.MANAGE_EXPENSES), async (req: AuthenticatedRequest, res) => {
  const parsed = expenseCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const category = await prisma.expenseCategory.findUnique({ where: { id: data.categoryId } });
  if (!category) return res.status(404).json({ error: "Expense category not found" });

  const expense = await prisma.expense.create({
    data: {
      categoryId: data.categoryId,
      description: data.description,
      amount: new Prisma.Decimal(String(data.amount)),
      expenseDate: new Date(data.expenseDate),
      method: data.method,
      siteId: data.siteId,
      receiptUrl: data.receiptUrl,
      recordedById: req.auth!.userId,
    },
  });
  res.status(201).json(expense);
});

expensesRouter.put("/:id", requirePermission(PERMISSION_KEY.MANAGE_EXPENSES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const parsed = expenseUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Expense not found" });
  if (data.categoryId) {
    const category = await prisma.expenseCategory.findUnique({ where: { id: data.categoryId } });
    if (!category) return res.status(404).json({ error: "Expense category not found" });
  }

  const expense = await prisma.expense.update({
    where: { id },
    data: {
      categoryId: data.categoryId,
      description: data.description,
      amount: data.amount !== undefined ? new Prisma.Decimal(String(data.amount)) : undefined,
      expenseDate: data.expenseDate ? new Date(data.expenseDate) : undefined,
      method: data.method,
      siteId: data.siteId,
      receiptUrl: data.receiptUrl,
    },
  });
  res.json(expense);
});

expensesRouter.delete("/:id", requirePermission(PERMISSION_KEY.MANAGE_EXPENSES), async (req: AuthenticatedRequest, res) => {
  const id = asString(req.params.id);
  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Expense not found" });
  await prisma.expense.delete({ where: { id } });
  res.status(204).end();
});
