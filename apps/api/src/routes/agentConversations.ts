/** Real chat endpoint for the in-app agent - persisted conversations, one thread per row
 * (see AgentConversation in schema.prisma). Replaces the throwaway /agent/chat-test route
 * for actual use; chat-test stays for manual verification without touching real user data.
 * Every route here is scoped to the caller's own conversations - no admin override, this is
 * personal chat history like any other user's own data.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, type AuthenticatedRequest } from "../middleware/auth";
import { runAgentTurn } from "../agent/llm";
import { AGENT_SYSTEM_PROMPT } from "../agent/systemPrompt";
import { allTools } from "../agent/tools/registry";
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
      systemPrompt: AGENT_SYSTEM_PROMPT,
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
