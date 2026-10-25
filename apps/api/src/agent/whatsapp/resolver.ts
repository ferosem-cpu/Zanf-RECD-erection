/** Policy-aware tool resolution for one WhatsApp turn (DISCOVERY 4.5). Tools are injected so
 * this module has no DB or registry dependency; whatsapp/turn.ts wires the real ones.
 *
 * - Only allowed tool schemas are handed to the model.
 * - getTool() returns undefined for anything not allowed (hallucinated or disallowed names).
 * - Every call re-loads mapping + user + permissions and re-checks the policy; any revocation
 *   fails closed and flags the turn for a silent abort.
 * - Results are checked/sanitised per group before they reach the model.
 */
import type { AgentTool, AgentAuthContext } from "../tools/types";
import {
  checkUserAccess, projectDetail, isDetailDocAllowed, isFinanceGroup, isToolAllowed, looksLikeFinanceDoc, sanitizeNonFinance,
  type SenderDecision, type SenderStore, type WaGroup,
} from "./policy";
import { waSiteVisible } from "./siteScope";

export type SiteLookup = (siteId: string) => Promise<{ assignedEngineerId: string | null; vendorId: string | null } | null>;

export interface WhatsappTurnDeps {
  store: SenderStore;
  tools: AgentTool[];
  isWriteTool: (name: string) => boolean;
  siteLookup: SiteLookup;
}

export interface WhatsappTurn {
  tools: AgentTool[];
  getTool: (name: string) => AgentTool | undefined;
  isWriteTool: (name: string) => boolean;
  shouldAbort: () => boolean;
  /** Re-resolves mapping, user and group right now; false (and flags revoked) on any change or failure. */
  recheck: () => Promise<boolean>;
  revokedReason: () => string | null;
}

const DENIED = { error: "That information isn't available to you over WhatsApp." };
const NOT_FOUND = (docType: string, id: string) => ({ error: `No ${docType} found with id ${id}.` });

export function createWhatsappTurn(sender: Extract<SenderDecision, { ok: true }>, deps: WhatsappTurnDeps): WhatsappTurn {
  let revoked: string | null = null;
  const { mapping } = sender;

  async function recheck(): Promise<boolean> {
    if (revoked) return false;
    try {
      const row = await deps.store.findById(mapping.id);
      if (!row || !row.enabled || row.aiPaused || row.userId !== mapping.userId) { revoked = "mapping_changed"; return false; }
      const user = await deps.store.loadUser(mapping.userId);
      const access = user ? checkUserAccess(user) : null;
      if (!user || !access || !access.ok) { revoked = access && !access.ok ? access.reason : "user_missing"; return false; }
      if (access.group !== sender.group) { revoked = "group_changed"; return false; }
      return true;
    } catch {
      revoked = "lookup_error";
      return false;
    }
  }

  function wrap(inner: AgentTool): AgentTool {
    return {
      name: inner.name,
      description: inner.description,
      inputSchema: inner.inputSchema,
      handler: async (input) => {
        if (revoked) return DENIED;
        // Reload everything: nothing from the start of the turn is trusted.
        const row = await deps.store.findById(mapping.id);
        if (!row || !row.enabled || row.aiPaused || row.userId !== mapping.userId) {
          revoked = "mapping_changed";
          return DENIED;
        }
        const user = await deps.store.loadUser(mapping.userId);
        const access = user ? checkUserAccess(user) : null;
        if (!user || !access || !access.ok) {
          revoked = access && !access.ok ? access.reason : "user_missing";
          return DENIED;
        }
        const group: WaGroup = access.group;
        if (group !== sender.group) {
          revoked = "group_changed";
          return DENIED;
        }
        if (!isToolAllowed(group, inner.name) || deps.isWriteTool(inner.name)) return DENIED;

        const auth: AgentAuthContext = {
          userId: user.userId,
          roleKey: user.roleKey,
          customerId: user.customerId ?? null,
          vendorId: user.vendorId ?? null,
          permissions: user.permissions,
          waGroup: group,
        };

        let docType = "";
        let docId = "";
        if (inner.name === "get_document_detail") {
          docType = String(input.docType ?? "");
          docId = String(input.id ?? "");
          if (!isDetailDocAllowed(group, docType)) return DENIED;
        }

        let result = await inner.handler(input, auth);

        if (inner.name === "get_document_detail" && result && typeof result === "object" && !("error" in (result as object))) {
          if (!isFinanceGroup(group) && looksLikeFinanceDoc(result)) return DENIED;
          if (group === "customer") {
            // Defence in depth on top of the tool's own check: a customer only ever sees rows of their own customer.
            const owner = (result as { customerId?: string | null }).customerId ?? null;
            if (!auth.customerId || owner !== auth.customerId) return NOT_FOUND(docType, docId);
          }
          if (group === "engineer") {
            const siteId = (result as { siteId?: string | null }).siteId ?? null;
            const site = siteId ? await deps.siteLookup(siteId) : null;
            if (!waSiteVisible(auth, site)) return NOT_FOUND(docType, docId);
          }
          result = projectDetail(docType, result, isFinanceGroup(group));
        }
        return isFinanceGroup(group) ? result : sanitizeNonFinance(result);
      },
    };
  }

  const allowed = deps.tools.filter((t) => isToolAllowed(sender.group, t.name) && !deps.isWriteTool(t.name)).map(wrap);
  const byName = new Map(allowed.map((t) => [t.name, t]));

  return {
    tools: allowed,
    getTool: (name) => byName.get(name),
    isWriteTool: deps.isWriteTool,
    shouldAbort: () => revoked !== null,
    recheck,
    revokedReason: () => revoked,
  };
}
