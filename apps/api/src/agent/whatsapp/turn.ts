/** Production wiring for a WhatsApp turn: resolve the sender, then build the policy-aware tool
 * set for runAgentTurn({ tools, getTool, isWriteTool, shouldAbort }). No route calls this yet
 * (bridge endpoints are M2/M3). */
import { prisma } from "../../lib/prisma";
import { allTools, isWriteTool } from "../tools/registry";
import { prismaSenderStore } from "../../services/whatsappMappingStore";
import { resolveSender, type SenderDecision } from "./policy";
import { createWhatsappTurn, type WhatsappTurn } from "./resolver";

export async function openWhatsappTurn(identity: { phoneE164?: string | null; lid?: string | null }): Promise<
  { ok: true; decision: Extract<SenderDecision, { ok: true }>; turn: WhatsappTurn } | { ok: false; reason: string }
> {
  const decision = await resolveSender(identity, prismaSenderStore);
  if (!decision.ok) return { ok: false, reason: decision.reason };
  const turn = createWhatsappTurn(decision, {
    store: prismaSenderStore,
    tools: allTools,
    isWriteTool,
    siteLookup: (siteId) =>
      prisma.site.findUnique({ where: { id: siteId }, select: { assignedEngineerId: true, vendorId: true } }),
  });
  return { ok: true, decision, turn };
}
