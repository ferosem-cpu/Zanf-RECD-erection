/** Production wiring for the WhatsApp bridge routes (Prisma stores, real assistant runner). */
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { runAgentTurn } from "../agent/llm";
import { AgentDeadline } from "../agent/timeouts";
import { buildAgentSystemPrompt } from "../agent/systemPrompt";
import { isoDateIST } from "../agent/istDates";
import { sanitizeAssistantText, sanitizeHistory } from "../agent/assistantText";
import { openWhatsappTurn } from "../agent/whatsapp/turn";
import { prismaSenderStore } from "./whatsappMappingStore";
import { prismaBridgeStore } from "./whatsappBridgeStore";
import { prismaNonceStore } from "./whatsappBridgeNonceStore";
import { createBridgeService, WHATSAPP_PROMPT_ADDENDUM } from "./whatsappBridge";
import { createWhatsappBridgeRouter } from "../routes/whatsappBridge";
import { runInBackground } from "../lib/backgroundTask";

/** WhatsApp turn prompt: the in-app prompt (already dated) + WhatsApp addendum + an explicit
 * IST date line at the end, so "today" questions on WhatsApp never fall back to a guessed date. */
export async function buildWhatsappSystemPrompt(now: Date = new Date()): Promise<string> {
  const company = await prisma.companySettings.findUnique({ where: { id: "singleton" } });
  const today = isoDateIST(now);
  return buildAgentSystemPrompt(false, company?.agentCustomInstructions) + WHATSAPP_PROMPT_ADDENDUM +
    `\n\nToday's date (IST, Asia/Kolkata) is ${today}. For "today"/"tomorrow" questions use this date.`;
}

export const whatsappBridgeService = createBridgeService({
  store: prismaBridgeStore,
  senders: prismaSenderStore,
  openTurn: openWhatsappTurn,
  runTurn: runAgentTurn,
  buildSystemPrompt: () => buildWhatsappSystemPrompt(),
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
