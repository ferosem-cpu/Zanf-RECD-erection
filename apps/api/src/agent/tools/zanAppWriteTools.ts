/** Confirm-gated write tools for Zan-APP (§56/§57 plan in HANDOVER.md, "Part B"). Unlike the
 * read tools, these NEVER write real data from the tool handler itself - they validate the
 * proposed input, resolve any references (category/site), and create an AgentPendingAction
 * row describing what *would* be created. The actual Prisma write only happens when the user
 * clicks Confirm in the chat UI (see the /conversations/:id/actions/:actionId/confirm route
 * in agentConversations.ts), which reuses the same logic as the real REST create-route.
 */
import { Prisma } from "@prisma/client";
import { PERMISSION_KEY, PAYMENT_METHOD } from "@recd/shared";
import { prisma } from "../../lib/prisma";
import type { AgentTool } from "./types";

const VALID_EXPENSE_METHODS = Object.values(PAYMENT_METHOD).filter((m) => m !== "tds");

function forbidden(what: string) {
  return { error: `You don't have permission to create ${what}.` };
}

const createExpenseTool: AgentTool = {
  name: "create_expense",
  description:
    "Propose a new expense-book entry (fuel, travel, site consumables, misc - non-PO spend). " +
    "This does NOT create the expense immediately - it prepares it and shows the user a " +
    "confirm card in the chat; only THEY can approve it by clicking Confirm. After calling " +
    "this, tell the user you've prepared it for their review - never say it has been created.",
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string", description: "What the expense was for, e.g. 'Crane hire for site erection'." },
      amount: { type: "number", description: "Amount in rupees." },
      categoryKey: {
        type: "string",
        description: "Category key. If unsure, first search_expenses or ask the user - do not guess.",
      },
      expenseDate: { type: "string", description: "ISO date (YYYY-MM-DD). Defaults to today if omitted." },
      method: { type: "string", enum: VALID_EXPENSE_METHODS, description: "How it was paid." },
      siteId: { type: "string", description: "Optional - a Site id from search_orders_and_sites, if this expense is tied to a specific site." },
    },
    required: ["description", "amount", "categoryKey", "method"],
  },
  handler: async (input, auth) => {
    if (!auth.permissions.has(PERMISSION_KEY.MANAGE_EXPENSES)) return forbidden("expenses");
    if (!auth.conversationId) return { error: "No active conversation - cannot propose a write action here." };

    const description = String(input.description ?? "").trim();
    const amount = Number(input.amount);
    const categoryKey = String(input.categoryKey ?? "").trim();
    const method = String(input.method ?? "");
    const siteId = input.siteId ? String(input.siteId) : null;
    const expenseDateStr = input.expenseDate ? String(input.expenseDate) : new Date().toISOString().slice(0, 10);

    if (!description) return { error: "description is required." };
    if (!Number.isFinite(amount) || amount <= 0) return { error: "amount must be a positive number." };
    if (!VALID_EXPENSE_METHODS.includes(method as (typeof VALID_EXPENSE_METHODS)[number])) {
      return { error: `method must be one of: ${VALID_EXPENSE_METHODS.join(", ")}` };
    }

    const category = await prisma.expenseCategory.findFirst({
      where: { OR: [{ key: categoryKey }, { label: { equals: categoryKey, mode: "insensitive" } }] },
    });
    if (!category) {
      const allCategories = await prisma.expenseCategory.findMany({ orderBy: { sequenceOrder: "asc" } });
      return {
        error: `No expense category matching "${categoryKey}". Available categories: ${allCategories
          .map((c) => `${c.key} (${c.label})`)
          .join(", ")}. Ask the user which one, then retry.`,
      };
    }

    if (siteId) {
      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) return { error: `No site found with id ${siteId}. Use search_orders_and_sites first.` };
    }

    const preview = {
      description,
      amount,
      category: category.label,
      expenseDate: expenseDateStr,
      method,
      siteId,
    };

    const pending = await prisma.agentPendingAction.create({
      data: {
        conversationId: auth.conversationId,
        toolName: "create_expense",
        input: { description, amount, categoryId: category.id, expenseDate: expenseDateStr, method, siteId },
        preview,
        createdById: auth.userId,
      },
    });

    return {
      status: "pending_confirmation",
      actionId: pending.id,
      preview,
      note: "Prepared for review - waiting for the user to confirm or reject in the chat UI. Do not tell the user it has been created yet.",
    };
  },
};

export const zanAppWriteTools: AgentTool[] = [createExpenseTool];
