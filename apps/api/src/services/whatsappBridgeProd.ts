/** Production wiring for the WhatsApp bridge routes (Prisma stores, real assistant runner). */
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { runAgentTurn } from "../agent/llm";
import { AgentDeadline } from "../agent/timeouts";
import { buildAgentSystemPrompt } from "../agent/systemPrompt";
import { sanitizeAssistantText, sanitizeHistory } from "../agent/assistantText";
import { openWhatsappTurn } from "../agent/whatsapp/turn";
import { prismaSenderStore } from "./whatsappMappingStore";
import { prismaBridgeStore } from "./whatsappBridgeStore";
import { prismaNonceStore } from "./whatsappBridgeNonceStore";
import { createBridgeService, WHATSAPP_PROMPT_ADDENDUM } from "./whatsappBridge";
import { createWhatsappBridgeRouter } from "../routes/whatsappBridge";
import { runInBackground } from "../lib/backgroundTask";

export const whatsappBridgeService = createBridgeService({
  store: prismaBridgeStore,
  senders: prismaSenderStore,
  openTurn: openWhatsappTurn,
  runTurn: runAgentTurn,
  buildSystemPrompt: async () => {
    const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
    return buildAgentSystemPrompt(false, company?.agentCustomInstructions) + WHATSAPP_PROMPT_ADDENDUM;
  },
  sanitizeReply: (t) => sanitizeAssistantText(t),
  sanitizeHistory: (m) => sanitizeHistory(m),
  newDeadline: () => new AgentDeadline(),
  now: () => new Date(),
  newToken: () => crypto.randomUUID(),
});

export const whatsappBridgeRouter = createWhatsappBridgeRouter({
  nonces: prismaNonceStore,
  service: whatsappBridgeService,
  background: runInBackground,
});
