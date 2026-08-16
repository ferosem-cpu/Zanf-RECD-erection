/** Real chat endpoint for the in-app agent - persisted conversations, one thread per row
 * (see AgentConversation in schema.prisma). Replaces the throwaway /agent/chat-test route
 * for actual use; chat-test stays for manual verification without touching real user data.
 * Every route here is scoped to the caller's own conversations - no admin override, this is
 * personal chat history like any other user's own data.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { FINANCE_DOC_TYPE, INVOICE_STATUS } from "@recd/shared";
import { prisma } from "../lib/prisma";
import { authenticate, type AuthenticatedRequest } from "../middleware/auth";
import { runAgentTurn } from "../agent/llm";
import { buildAgentSystemPrompt } from "../agent/systemPrompt";
import { allTools } from "../agent/tools/registry";
import { computeDocumentTotals } from "../services/taxCalc";
import { nextDocumentNumber } from "../services/documentNumber";
import { createQuotationRecord } from "./quotations";
import { createPurchaseOrderRecord } from "./purchase-orders";
import { createComplaintRecord } from "./complaints";
import type { UnifiedMessage } from "../agent/providers/types";

export const agentConversationsRouter = Router();

function deriveTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim().replace(/\s+/g, " ");
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}...` : trimmed || "New conversation";
}

agentConversationsRouter.get("/conversations", authenticate, async (req: AuthenticatedRequest, res) => {
  const rows = await prisma.agentConversation.findMany({
    where: { userId: req.auth!.userId },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ conversations: rows });
});

agentConversationsRouter.post("/conversations", authenticate, async (req: AuthenticatedRequest, res) => {
  const row = await prisma.agentConversation.create({
    data: { userId: req.auth!.userId, messages: [] },
  });
  res.status(201).json({ id: row.id, title: row.title, messages: [], createdAt: row.createdAt, updatedAt: row.updatedAt });
});

agentConversationsRouter.get("/conversations/:id", authenticate, async (req: AuthenticatedRequest, res) => {
  const row = await prisma.agentConversation.findUnique({ where: { id: String(req.params.id) } });
  if (!row || row.userId !== req.auth!.userId) {
    return res.status(404).json({ error: "Conversation not found" });
  }
  res.json({ id: row.id, title: row.title, messages: row.messages, createdAt: row.createdAt, updatedAt: row.updatedAt });
});

agentConversationsRouter.delete("/conversations/:id", authenticate, async (req: AuthenticatedRequest, res) => {
  const row = await prisma.agentConversation.findUnique({ where: { id: String(req.params.id) } });
  if (!row || row.userId !== req.auth!.userId) {
    return res.status(404).json({ error: "Conversation not found" });
  }
  await prisma.agentConversation.delete({ where: { id: row.id } });
  res.status(204).send();
});

agentConversationsRouter.post("/conversations/:id/messages", authenticate, async (req: AuthenticatedRequest, res) => {
  const { message } = req.body as { message?: string };
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message (string) is required" });
  }

  const row = await prisma.agentConversation.findUnique({ where: { id: String(req.params.id) } });
  if (!row || row.userId !== req.auth!.userId) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  const priorHistory = (row.messages as unknown as UnifiedMessage[]) ?? [];
  const newHistory: UnifiedMessage[] = [...priorHistory, { role: "user", content: message }];

  try {
    const result = await runAgentTurn({
      systemPrompt: buildAgentSystemPrompt(!!req.auth!.customerId),
      history: newHistory,
      tools: allTools,
      auth: { ...req.auth!, conversationId: row.id },
    });

    const updated = await prisma.agentConversation.update({
      where: { id: row.id },
      data: {
        messages: result.history as unknown as object,
        title: row.title ?? deriveTitle(message),
      },
    });

    res.json({ reply: result.reply, id: updated.id, title: updated.title, messages: updated.messages });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});


/** Executes the real Prisma write for one confirmed pending action, dispatched by toolName.
 * Mirrors the equivalent REST create-route's logic exactly (see routes/expenses.ts) rather
 * than reinventing it, so a confirmed agent action and a normal UI-created record behave
 * identically. Returns the created record's id.
 */
async function executeConfirmedAction(
  toolName: string,
  input: Record<string, unknown>,
  userId: string,
): Promise<string> {
  switch (toolName) {
    case "create_expense": {
      const expense = await prisma.expense.create({
        data: {
          categoryId: String(input.categoryId),
          description: String(input.description),
          amount: new Prisma.Decimal(String(input.amount)),
          expenseDate: new Date(String(input.expenseDate)),
          method: String(input.method),
          siteId: input.siteId ? String(input.siteId) : null,
          recordedById: userId,
        },
      });
      return expense.id;
    }
    case "create_purchase_order": {
      interface PendingPoLine {
        description: string;
        hsnCode?: string | null;
        quantity: number;
        unitPrice: number;
        taxRatePct: number;
      }
      const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
      const po = await prisma.$transaction(async (tx) => {
        const poNumber = await nextDocumentNumber(tx, FINANCE_DOC_TYPE.PURCHASE_ORDER);
        return createPurchaseOrderRecord(
          tx,
          {
            supplierId: String(input.supplierId),
            lineItems: (input.lineItems as PendingPoLine[]) ?? [],
            orderDate: input.orderDate ? String(input.orderDate) : undefined,
            expectedDate: input.expectedDate ? String(input.expectedDate) : undefined,
            notes: (input.notes as string | null) ?? undefined,
            terms: (input.terms as string | null) ?? undefined,
          },
          userId,
          poNumber,
          company?.state,
        );
      });
      return po.id;
    }
    case "create_quotation": {
      interface PendingQuoteLine {
        productId?: string;
        description: string;
        hsnCode: string;
        quantity: number;
        unitPrice: number;
        discountPct: number;
        taxRatePct: number;
      }
      const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
      const quotation = await prisma.$transaction(async (tx) => {
        const quoteNumber = await nextDocumentNumber(tx, FINANCE_DOC_TYPE.QUOTATION);
        return createQuotationRecord(
          tx,
          {
            customerId: String(input.customerId),
            lineItems: (input.lineItems as PendingQuoteLine[]) ?? [],
            placeOfSupply: (input.placeOfSupply as string | undefined) ?? undefined,
            validUntil: input.validUntil ? new Date(String(input.validUntil)).toISOString() : undefined,
            notes: (input.notes as string | null) ?? undefined,
            terms: (input.terms as string | null) ?? undefined,
          },
          userId,
          quoteNumber,
          company?.state,
        );
      });
      return quotation.id;
    }
    case "create_invoice": {
      interface PendingInvoiceLine {
        productId?: string;
        description: string;
        hsnCode?: string;
        quantity: number;
        unitPrice: number;
        discountPct: number;
        taxRatePct: number;
      }
      const lineItems = (input.lineItems as PendingInvoiceLine[]) ?? [];
      const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
      const totals = computeDocumentTotals(
        lineItems.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRatePct: l.taxRatePct })),
        company?.state,
        input.placeOfSupply as string | undefined,
      );
      // Created as a DRAFT with a placeholder number, exactly like routes/invoices.ts's real
      // POST /invoices - the real sequential invoice number is only allocated later when a
      // human issues the draft (separate manual step, not something the agent does).
      const invoice = await prisma.invoice.create({
        data: {
          docType: String(input.docType),
          invoiceNumber: `DRAFT-${crypto.randomUUID()}`,
          customerId: String(input.customerId),
          orderId: input.orderId ? String(input.orderId) : undefined,
          quotationId: input.quotationId ? String(input.quotationId) : undefined,
          status: INVOICE_STATUS.DRAFT,
          issueDate: new Date(String(input.issueDate)),
          dueDate: input.dueDate ? new Date(String(input.dueDate)) : null,
          placeOfSupply: (input.placeOfSupply as string | undefined) ?? null,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          cgstAmount: totals.cgstAmount,
          sgstAmount: totals.sgstAmount,
          igstAmount: totals.igstAmount,
          total: totals.total,
          notes: (input.notes as string | null) ?? null,
          terms: (input.terms as string | null) ?? null,
          createdById: userId,
          lineItems: {
            create: lineItems.map((l, i) => ({
              productId: l.productId,
              description: l.description,
              hsnCode: l.hsnCode,
              quantity: new Prisma.Decimal(String(l.quantity)),
              unitPrice: new Prisma.Decimal(String(l.unitPrice)),
              discountPct: new Prisma.Decimal(String(l.discountPct)),
              taxRatePct: new Prisma.Decimal(String(l.taxRatePct)),
              lineTotal: new Prisma.Decimal(String(l.quantity * l.unitPrice * (1 - l.discountPct / 100))).toDecimalPlaces(
                2,
                Prisma.Decimal.ROUND_HALF_UP,
              ),
              sortOrder: i,
            })),
          },
        },
      });
      return invoice.id;
    }
    case "create_complaint": {
      const complaint = await createComplaintRecord(
        {
          siteId: String(input.siteId),
          category: String(input.category),
          description: String(input.description),
          severity: String(input.severity),
        },
        String(input.customerId),
      );
      return complaint.id;
    }
    default:
      throw new Error(`Don't know how to execute confirmed action for tool "${toolName}".`);
  }
}

/** Rewrites the tool-result message in a conversation's stored history that matches this
 * actionId, so the transcript reflects the resolved (confirmed/rejected) state instead of
 * staying frozen on "pending_confirmation" - the next chat turn's context, and the frontend
 * re-render, both pick this up automatically. */
function resolveActionInHistory(
  messages: UnifiedMessage[],
  actionId: string,
  resolution: Record<string, unknown>,
): UnifiedMessage[] {
  return messages.map((m) => {
    if (m.role !== "tool" || !m.content) return m;
    try {
      const parsed = JSON.parse(m.content);
      if (parsed.actionId === actionId) {
        return { ...m, content: JSON.stringify({ ...parsed, ...resolution }) };
      }
    } catch {
      // not JSON - not a tool-result we care about
    }
    return m;
  });
}

async function handleResolveAction(
  req: AuthenticatedRequest,
  res: import("express").Response,
  outcome: "confirmed" | "rejected",
) {
  const conversation = await prisma.agentConversation.findUnique({ where: { id: String(req.params.id) } });
  if (!conversation || conversation.userId !== req.auth!.userId) {
    return res.status(404).json({ error: "Conversation not found" });
  }
  const action = await prisma.agentPendingAction.findUnique({ where: { id: String(req.params.actionId) } });
  if (!action || action.conversationId !== conversation.id) {
    return res.status(404).json({ error: "Pending action not found" });
  }
  if (action.status !== "pending") {
    return res.status(400).json({ error: `This action was already ${action.status}.` });
  }

  try {
    let resultId: string | null = null;
    if (outcome === "confirmed") {
      resultId = await executeConfirmedAction(action.toolName, action.input as Record<string, unknown>, req.auth!.userId);
    }

    await prisma.agentPendingAction.update({
      where: { id: action.id },
      data: { status: outcome, resultId, resolvedAt: new Date() },
    });

    const priorHistory = (conversation.messages as unknown as UnifiedMessage[]) ?? [];
    const newHistory = resolveActionInHistory(priorHistory, action.id, { status: outcome, resultId });
    const updated = await prisma.agentConversation.update({
      where: { id: conversation.id },
      data: { messages: newHistory as unknown as object },
    });

    res.json({ status: outcome, resultId, messages: updated.messages });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

agentConversationsRouter.post("/conversations/:id/actions/:actionId/confirm", authenticate, (req: AuthenticatedRequest, res) =>
  handleResolveAction(req, res, "confirmed"),
);

agentConversationsRouter.post("/conversations/:id/actions/:actionId/reject", authenticate, (req: AuthenticatedRequest, res) =>
  handleResolveAction(req, res, "rejected"),
);
