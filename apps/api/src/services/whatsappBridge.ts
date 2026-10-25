/** WhatsApp bridge service (M2): ingest -> job -> shared assistant turn -> outbox -> claim -> ack.
 * Storage, the assistant runner and sender resolution are injected (fakes in tests, Prisma in
 * production). Contract: docs/whatsapp/DISCOVERY.md section 7. */
import type { RunAgentTurnParams, RunAgentTurnResult } from "../agent/llm";
import type { UnifiedMessage } from "../agent/providers/types";
import { checkUserAccess, type SenderDecision, type SenderStore, type WaGroup } from "../agent/whatsapp/policy";
import type { WhatsappTurn } from "../agent/whatsapp/resolver";
import { AGENT_REQUEST_BUDGET_MS } from "../agent/timeouts";

export const JOB_LEASE_MS = 90_000;
export const OUTBOX_LEASE_MS = 30_000;
export const SEND_WINDOW_MS = 15_000;
export const OUTBOX_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;
/** Global cap on concurrently running WhatsApp turns; enforced atomically inside claimJob. */
export const MAX_CONCURRENT_TURNS = 2;
export const MAX_JOB_AGE_MS = 3 * 60_000;
export const RESTART_AFTER_MS = 20_000;
export const MAX_HISTORY_MESSAGES = 30;
export const MAX_REPLY_CHARS = 1500;
/** After a turn completes, up to this many queued turns for the same sender are started straight away
 * in the same background task (the /wa/outbox poll after RESTART_AFTER_MS stays as the backstop). */
export const MAX_KICK_CHAIN = 3;
/** The API function sets no maxDuration (vercel.json / api/index.js), so assume the 60 s platform limit unless
 * WA_FUNCTION_MAX_DURATION_MS says otherwise. A chained turn starts only if elapsed + one full turn budget
 * (AGENT_REQUEST_BUDGET_MS, 55 s) + CHAIN_MARGIN_MS still fits; otherwise the /wa/outbox poll runs it. With the
 * 60 s default only the first turn runs inline. */
const envMaxDuration = Number(process.env.WA_FUNCTION_MAX_DURATION_MS);
export const FUNCTION_MAX_DURATION_MS = Number.isFinite(envMaxDuration) && envMaxDuration > 0 ? envMaxDuration : 60_000;
export const CHAIN_MARGIN_MS = 5_000;
export function canChainAnotherTurn(elapsedMs: number, maxDurationMs = FUNCTION_MAX_DURATION_MS): boolean {
  return elapsedMs + AGENT_REQUEST_BUDGET_MS + CHAIN_MARGIN_MS <= maxDurationMs;
}
export const NEUTRAL_FAILURE_REPLY = "Sorry, I couldn't complete that. Please try again.";

export const WHATSAPP_PROMPT_ADDENDUM = `

You are replying over WhatsApp. Answer in 1-3 short sentences of plain text (no markdown, tables or \
bullet lists). You are read-only here: never propose or offer to create, change or send anything, and \
if asked to, say briefly that it can be done in the Zan app. If a tool says information is not \
available over WhatsApp, say so briefly and do not try to work around it. For any question about \
orders, invoices or sites, call the lookup tools in THIS turn and answer from their result; never \
answer from earlier messages in this chat, which may be out of date.`;

export interface InboundRow {
  id: string;
  waMessageId: string;
  keyId: string;
  senderJid: string;
  senderLid: string | null;
  resolvedPhone: string | null;
  chatJid: string;
  messageAt: Date;
  decision: "accept" | "ignore";
  mappingId: string | null;
  text: string | null;
  status: "received" | "processing" | "done" | "dropped" | "failed";
  attempts: number;
  leaseUntil: Date | null;
  leaseToken: string | null;
  createdAt: Date;
}

export type OutboxStatus = "pending" | "leased" | "sending" | "sent" | "delivered" | "failed" | "uncertain" | "discarded" | "expired";

export interface OutboxRow {
  id: string;
  inboundId: string;
  mappingId: string;
  waGroup: string;
  recipientPhone: string;
  recipientLid: string | null;
  text: string | null;
  status: OutboxStatus;
  leasedKeyId: string | null;
  leaseUntil: Date | null;
  sendBy: Date | null;
  expiresAt: Date;
}

export type NewInbound = Omit<InboundRow, "id" | "attempts" | "leaseUntil" | "leaseToken" | "createdAt">;
export type NewOutbox = Pick<OutboxRow, "inboundId" | "mappingId" | "waGroup" | "recipientPhone" | "recipientLid" | "text" | "expiresAt">;

export interface OutboxGuard {
  statusIn: OutboxStatus[];
  leasedKeyId?: string;
  leaseUntilAfter?: Date;
}

export interface WaBridgeStore {
  /** Unique waMessageId: returns the existing row (created=false) on a duplicate. */
  insertInbound(row: NewInbound): Promise<{ row: InboundRow; created: boolean }>;
  /** Decision of an already-stored inbound row, or null when none exists (read-only; used for duplicates). */
  findInboundDecision(waMessageId: string): Promise<"accept" | "ignore" | null>;
  /** Atomic: received, or processing with an expired lease; attempts < max; no earlier non-terminal job for the same mapping. */
  claimJob(id: string, token: string, now: Date, leaseMs: number, maxAttempts: number): Promise<InboundRow | null>;
  /** Fenced on leaseToken + status processing. Inserts the outbox row and saves the conversation in the same step. Returns false for a zombie. */
  completeJob(id: string, token: string, patch: { status: "done" | "dropped" | "failed" }, outbox: NewOutbox | null, conversation: { id: string; messages: UnifiedMessage[] } | null): Promise<boolean>;
  /** Fenced: processing -> received so the next poll retries. */
  releaseJob(id: string, token: string): Promise<void>;
  /** Jobs that need attention now: stale processing leases and received rows older than the restart delay. */
  listStaleJobs(now: Date, restartAfterMs: number, limit: number): Promise<InboundRow[]>;
  /** Earliest received+accepted job for the mapping, by (createdAt, id); null when none is queued. */
  nextQueuedJob(mappingId: string): Promise<string | null>;
  /** Unfenced, only if still stale: -> failed. Returns whether this call did it. */
  failStaleJob(id: string, now: Date): Promise<boolean>;
  getConversation(userId: string): Promise<{ id: string; messages: unknown }>;
  insertOutboxIfAbsent(row: NewOutbox): Promise<void>;
  getOutbox(id: string): Promise<OutboxRow | null>;
  /** Conditional update; false when the guard no longer holds (someone else moved the row). */
  updateOutboxIf(id: string, guard: OutboxGuard, patch: Partial<Pick<OutboxRow, "status" | "leasedKeyId" | "leaseUntil" | "sendBy" | "text">> & { waMessageId?: string; error?: string }): Promise<boolean>;
  /** pending|leased rows past expiresAt -> expired (text cleared); sending past sendBy -> uncertain (text cleared). */
  expireOutbox(now: Date): Promise<void>;
  /** Leases up to `limit` rows (pending, or leased with an expired lease) to keyId. */
  leaseOutbox(keyId: string, now: Date, leaseMs: number, limit: number): Promise<OutboxRow[]>;
}

export type OpenTurn = (identity: { phoneE164?: string | null; lid?: string | null }) => Promise<
  { ok: true; decision: Extract<SenderDecision, { ok: true }>; turn: WhatsappTurn } | { ok: false; reason: string }
>;

export interface BridgeDeps {
  store: WaBridgeStore;
  senders: SenderStore;
  openTurn: OpenTurn;
  runTurn: (params: RunAgentTurnParams) => Promise<RunAgentTurnResult>;
  /** Prompt for this sender's group (customers get the customer audience, like the in-app assistant). */
  buildSystemPrompt: (ctx: { group: WaGroup }) => Promise<string>;
  sanitizeReply: (text: string) => string;
  sanitizeHistory: (messages: unknown) => UnifiedMessage[];
  newDeadline: () => RunAgentTurnParams["deadline"];
  now: () => Date;
  newToken: () => string;
}

export interface IngestInput {
  messageId: string;
  senderJid: string;
  chatJid: string;
  timestamp: number;
  text: string;
  senderLid?: string;
  resolvedPhone?: string;
}

const digits = (s: string) => s.replace(/\D/g, "");

/** Phone/LID claimed by the bridge. Never parsed from message text. */
export function identityFromIngest(i: IngestInput): { phoneE164: string | null; lid: string | null } {
  const user = (jid: string) => jid.split("@")[0].split(":")[0];
  let phone: string | null = null;
  if (i.resolvedPhone && /^\d{8,15}$/.test(i.resolvedPhone)) phone = `+${i.resolvedPhone}`;
  else if (i.senderJid.endsWith("@s.whatsapp.net") && /^\d{8,15}$/.test(user(i.senderJid))) phone = `+${user(i.senderJid)}`;
  let lid: string | null = null;
  const rawLid = i.senderLid ?? (i.senderJid.endsWith("@lid") ? i.senderJid : null);
  if (rawLid && /^\d{5,30}$/.test(user(rawLid))) lid = user(rawLid);
  return { phoneE164: phone, lid };
}

const jidFromPhone = (phoneE164: string) => `${digits(phoneE164)}@s.whatsapp.net`;

export function createBridgeService(deps: BridgeDeps) {
  const { store } = deps;

  async function ingest(keyId: string, input: IngestInput): Promise<{ decision: "accept" | "ignore"; jobId: string | null }> {
    const identity = identityFromIngest(input);
    let mappingId: string | null = null;
    let accept = false;
    const text = input.text.trim();
    if (text && (identity.phoneE164 || identity.lid)) {
      const open = await deps.openTurn(identity);
      if (open.ok) {
        accept = true;
        mappingId = open.decision.mapping.id;
      }
    }
    if (!accept) {
      // Not accepted (unmapped, disabled, paused or not allowed): store NOTHING, no sender ids, no text, no
      // hashed debug row. A duplicate of an earlier accepted message still reports its original decision.
      const prior = await store.findInboundDecision(input.messageId);
      return { decision: prior ?? "ignore", jobId: null };
    }
    const { row, created } = await store.insertInbound({
      waMessageId: input.messageId,
      keyId,
      senderJid: input.senderJid,
      senderLid: input.senderLid ?? null,
      resolvedPhone: input.resolvedPhone ?? null,
      chatJid: input.chatJid,
      messageAt: new Date(input.timestamp * 1000),
      decision: "accept",
      mappingId,
      text,
      status: "received",
    });
    // A duplicate returns the original decision and never schedules a second job.
    return { decision: row.decision, jobId: created && row.decision === "accept" ? row.id : null };
  }

  function trimHistory(h: UnifiedMessage[]): UnifiedMessage[] {
    if (h.length <= MAX_HISTORY_MESSAGES) return h;
    const from = h.findIndex((m, i) => i >= h.length - MAX_HISTORY_MESSAGES && m.role === "user");
    return from === -1 ? [] : h.slice(from);
  }

  /** Recipient comes from the mapping row (the authorised number), never from the inbound message. */
  async function outboxTarget(job: InboundRow): Promise<{ mappingId: string; group: WaGroup; phone: string; lid: string | null } | null> {
    try {
      if (!job.mappingId) return null;
      const m = await deps.senders.findById(job.mappingId);
      if (!m || !m.enabled || m.aiPaused) return null;
      const user = await deps.senders.loadUser(m.userId);
      const access = user ? checkUserAccess(user) : null;
      if (!access || !access.ok) return null;
      return { mappingId: m.id, group: access.group, phone: m.phoneE164, lid: m.lid };
    } catch {
      return null;
    }
  }

  async function neutralOutbox(job: InboundRow): Promise<NewOutbox | null> {
    const t = await outboxTarget(job);
    return t ? { inboundId: job.id, mappingId: t.mappingId, waGroup: t.group, recipientPhone: t.phone, recipientLid: t.lid, text: NEUTRAL_FAILURE_REPLY, expiresAt: new Date(deps.now().getTime() + OUTBOX_TTL_MS) } : null;
  }

  async function failExhausted(job: InboundRow): Promise<void> {
    const row = await neutralOutbox(job);
    if (row) await store.insertOutboxIfAbsent(row);
  }

  /** Runs one job; when it reaches a terminal state, starts the sender's next queued job right away. */
  async function processJob(jobId: string, chain = 0, startedAt = deps.now().getTime()): Promise<void> {
    const mappingId = await runJob(jobId);
    if (!mappingId || chain >= MAX_KICK_CHAIN) return;
    if (!canChainAnotherTurn(deps.now().getTime() - startedAt)) return; // a full turn would not fit: leave it to the poll
    const next = await store.nextQueuedJob(mappingId).catch(() => null);
    if (next && next !== jobId) await processJob(next, chain + 1, startedAt);
  }

  /** Returns the job's mappingId once the job is terminal (done/dropped/failed), else null. */
  async function runJob(jobId: string): Promise<string | null> {
    const token = deps.newToken();
    const job = await store.claimJob(jobId, token, deps.now(), JOB_LEASE_MS, MAX_ATTEMPTS);
    if (!job || !job.text) return null;
    const finish = async (
      patch: { status: "done" | "dropped" | "failed" },
      outbox: NewOutbox | null,
      conversation: { id: string; messages: UnifiedMessage[] } | null,
    ): Promise<string | null> => ((await store.completeJob(job.id, token, patch, outbox, conversation)) ? job.mappingId : null);
    try {
      const open = await reopen(job);
      if (!open.ok || open.decision.mapping.id !== job.mappingId) {
        return await finish({ status: "dropped" }, null, null);
      }
      const { turn, decision } = open;
      const conv = await store.getConversation(decision.mapping.userId);
      const history: UnifiedMessage[] = [...trimHistory(deps.sanitizeHistory(conv.messages)), { role: "user", content: job.text }];
      const result = await deps.runTurn({
        systemPrompt: await deps.buildSystemPrompt({ group: decision.group }),
        history,
        tools: turn.tools,
        getTool: turn.getTool,
        isWriteTool: turn.isWriteTool,
        shouldAbort: turn.shouldAbort,
        finalCheck: turn.recheck,
        deadline: deps.newDeadline(),
        auth: {
          userId: decision.user.userId,
          roleKey: decision.user.roleKey,
          customerId: decision.user.customerId ?? null,
          vendorId: decision.user.vendorId ?? null,
          permissions: decision.user.permissions,
          waGroup: decision.group,
          conversationId: conv.id,
        },
      });
      const reply = deps.sanitizeReply(result.reply ?? "").trim().slice(0, MAX_REPLY_CHARS);
      if (!reply || turn.revokedReason() !== null) {
        return await finish({ status: "done" }, null, null);
      }
      return await finish(
        { status: "done" },
        {
          inboundId: job.id, mappingId: decision.mapping.id, waGroup: decision.group, recipientPhone: decision.mapping.phoneE164,
          recipientLid: decision.mapping.lid, text: reply, expiresAt: new Date(deps.now().getTime() + OUTBOX_TTL_MS),
        },
        { id: conv.id, messages: deps.sanitizeHistory(result.history) },
      );
    } catch (err) {
      console.error("whatsapp job error", job.id, err instanceof Error ? err.name : "error");
      if (job.attempts >= MAX_ATTEMPTS) {
        const neutral = await neutralOutbox(job).catch(() => null);
        return await finish({ status: "failed" }, neutral, null).catch(() => null);
      }
      await store.releaseJob(job.id, token).catch(() => undefined);
      return null;
    }
  }

  /** The stored identity is re-resolved from the inbound row's own fields (same rules as ingest). */
  async function reopen(job: InboundRow) {
    const identity = identityFromIngest({
      messageId: job.waMessageId, senderJid: job.senderJid, chatJid: job.chatJid, timestamp: 0, text: job.text ?? "",
      senderLid: job.senderLid ?? undefined, resolvedPhone: job.resolvedPhone ?? undefined,
    });
    return deps.openTurn(identity);
  }

  /** Re-authorisation used by poll and claim: mapping enabled and unpaused, user active, same group and same recipient. */
  async function reauthorize(row: OutboxRow): Promise<boolean> {
    try {
      const m = await deps.senders.findById(row.mappingId);
      if (!m || !m.enabled || m.aiPaused) return false;
      if (m.phoneE164 !== row.recipientPhone || (m.lid ?? null) !== (row.recipientLid ?? null)) return false;
      const user = await deps.senders.loadUser(m.userId);
      const access = user ? checkUserAccess(user) : null;
      return !!access && access.ok && access.group === row.waGroup;
    } catch {
      return false;
    }
  }

  async function poll(keyId: string, limit: number): Promise<{ items: Array<{ outboxId: string; recipient: { jid: string; lid?: string } }>; restart: string[] }> {
    const now = deps.now();
    await store.expireOutbox(now);
    const restart: string[] = [];
    for (const job of await store.listStaleJobs(now, RESTART_AFTER_MS, 3)) {
      const exhausted = job.attempts >= MAX_ATTEMPTS || now.getTime() - job.createdAt.getTime() > MAX_JOB_AGE_MS;
      if (exhausted) {
        if (await store.failStaleJob(job.id, now)) await failExhausted(job);
      } else if (restart.length < 1) {
        restart.push(job.id);
      }
    }
    const leased = await store.leaseOutbox(keyId, now, OUTBOX_LEASE_MS, limit);
    const items: Array<{ outboxId: string; recipient: { jid: string; lid?: string } }> = [];
    for (const row of leased) {
      if (!(await reauthorize(row))) {
        await store.updateOutboxIf(row.id, { statusIn: ["pending", "leased"] }, { status: "discarded", text: null });
        continue;
      }
      items.push({ outboxId: row.id, recipient: { jid: jidFromPhone(row.recipientPhone), ...(row.recipientLid ? { lid: `${row.recipientLid}@lid` } : {}) } });
    }
    return { items, restart };
  }

  type ClaimResult = { status: 200; text: string; sendBy: number } | { status: 404 | 409 | 410 };

  async function claim(keyId: string, outboxId: string): Promise<ClaimResult> {
    const now = deps.now();
    const row = await store.getOutbox(outboxId);
    if (!row || (row.leasedKeyId && row.leasedKeyId !== keyId)) return { status: 404 };
    if (row.status === "discarded" || row.status === "expired") return { status: 410 };
    if (row.status !== "leased" || !row.leaseUntil || row.leaseUntil <= now) return { status: 409 };
    if (row.expiresAt <= now) {
      await store.updateOutboxIf(row.id, { statusIn: ["pending", "leased"] }, { status: "expired", text: null });
      return { status: 410 };
    }
    if (!(await reauthorize(row))) {
      await store.updateOutboxIf(row.id, { statusIn: ["pending", "leased"] }, { status: "discarded", text: null });
      return { status: 410 };
    }
    const sendBy = new Date(now.getTime() + SEND_WINDOW_MS);
    const won = await store.updateOutboxIf(row.id, { statusIn: ["leased"], leasedKeyId: keyId, leaseUntilAfter: now }, { status: "sending", sendBy });
    if (!won || !row.text) return { status: 409 };
    return { status: 200, text: row.text, sendBy: Math.floor(sendBy.getTime() / 1000) };
  }

  const ACK_FROM: Record<string, OutboxStatus[]> = {
    sent: ["sending", "uncertain"],
    failed: ["sending"],
    uncertain: ["sending"],
    delivered: ["sent", "sending", "uncertain"],
  };

  async function ack(keyId: string, input: { outboxId: string; status: string; waMessageId?: string; error?: string }): Promise<200 | 404> {
    const row = await store.getOutbox(input.outboxId);
    if (!row || row.leasedKeyId !== keyId) return 404;
    const from = ACK_FROM[input.status];
    if (!from) return 200;
    // Idempotent and never backwards: a row already past this state simply stays where it is.
    await store.updateOutboxIf(row.id, { statusIn: from, leasedKeyId: keyId }, {
      status: input.status as OutboxStatus, text: null,
      ...(input.waMessageId ? { waMessageId: input.waMessageId.slice(0, 200) } : {}),
      ...(input.error ? { error: input.error.slice(0, 200) } : {}),
    });
    return 200;
  }

  return { ingest, processJob, poll, claim, ack };
}

export type BridgeService = ReturnType<typeof createBridgeService>;
