/** Guards against model replies that are leaked special tokens ("<EOS_TOKEN>", "<|endoftext|>",
 * ...) instead of an answer - the user must never be shown such text. */
import type { SendMessageResult } from "./providers/types";

/** <EOS_TOKEN>, <|endoftext|>, <eot_id>, <|eot_id|>, <|im_end|>, </s>, with optional spaces/pipes,
 * any case; plus any other ChatML-style <|...|> marker. */
const SPECIAL_TOKEN_RE =
  /<\s*\|?\s*(?:eos[\s_]*token|end[\s_]*of[\s_]*text|eot[\s_]*id|im[\s_]*end|im[\s_]*start)\s*\|?\s*>|<\s*\|[\w\s]*\|\s*>|<\s*\/\s*s\s*>/gi;

/** Removes special tokens and trims. */
export function stripSpecialTokens(text: string): string {
  return text.replace(SPECIAL_TOKEN_RE, "").trim();
}

/** True when nothing readable is left (empty, or only punctuation/whitespace token debris). */
export function isJunkReply(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(stripSpecialTokens(text));
}

/** An agent tool name (search_orders_and_sites, get_payables, propose_create_order, ...). */
const TOOL_NAME = String.raw`(?:search|get|list|propose|find|lookup|create|update|confirm)_[a-z0-9]+(?:_[a-z0-9]+)*`;
/** A whole "Source: search_orders_and_sites (...) -> allOrders.completedCount = 9" line (any
 * bullet/bold/italic decoration, "Source"/"Sources"/"Data source"). */
const SOURCE_LINE_RE = new RegExp(
  String.raw`^[ \t>*_\-]*(?:data\s+)?sources?\b[*_]*\s*:[^\n]*\b${TOOL_NAME}\b[^\n]*(?:\n|$)`,
  "gim",
);
/** "(`get_payables`)" / "(via `get_payables`)" asides, then any other backticked tool name. */
const TOOL_ASIDE_RE = new RegExp(String.raw`\s*\((?:via|from|using)?\s*\x60${TOOL_NAME}\x60[^)\n]*\)`, "g");
const BACKTICKED_TOOL_RE = new RegExp(String.raw`\x60${TOOL_NAME}\x60`, "g");

/** Strips leaked internal tool names from a reply: "Source: <tool>..." lines, parenthesised
 * backticked tool names, and other backticked tool names (replaced with "the app"). The prompt
 * forbids them (NO INTERNALS); this is the safety net on save. */
export function stripToolInternals(text: string): string {
  return text
    .replace(SOURCE_LINE_RE, "")
    .replace(TOOL_ASIDE_RE, "")
    .replace(BACKTICKED_TOOL_RE, "the app")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Shown instead of an assistant message that was nothing but special tokens. */
export const EMPTY_REPLY_PLACEHOLDER = "(no reply)";

/** Display/replay-safe assistant text: special tokens stripped; token-only text becomes the
 * placeholder (or "" when the message carries tool calls, whose text is optional). */
export function sanitizeAssistantText(text: string, hasToolCalls = false): string {
  const clean = stripToolInternals(stripSpecialTokens(text ?? ""));
  return isJunkReply(clean) ? (hasToolCalls ? "" : EMPTY_REPLY_PLACEHOLDER) : clean;
}

/** Applies sanitizeAssistantText to every assistant message of a stored thread. Used when a
 * thread is saved, returned to the UI and replayed to the LLM, so threads saved before the
 * fix-5 sanitiser (e.g. an old "<EOS_TOKEN>" reply) never show or re-prime it. Stored rows are
 * not migrated; this runs on every read. Non-arrays come back as an empty thread. */
export function sanitizeHistory<T extends { role: string; content?: unknown }>(messages: unknown): T[] {
  if (!Array.isArray(messages)) return [];
  return (messages as T[]).map((m) => {
    if (m?.role !== "assistant" || typeof m.content !== "string") return m;
    const toolCalls = (m as { toolCalls?: unknown[] }).toolCalls;
    const content = sanitizeAssistantText(m.content, Array.isArray(toolCalls) && toolCalls.length > 0);
    return content === m.content ? m : { ...m, content };
  });
}

/** Cleans a provider result. Returns null for a final reply (no tool calls) that is empty or
 * only token junk, so the caller retries / falls back instead of showing it. */
export function cleanAssistantResult(result: SendMessageResult): SendMessageResult | null {
  const text = stripSpecialTokens(result.text ?? "");
  if (result.toolCalls.length === 0 && isJunkReply(text)) return null;
  return { ...result, text: isJunkReply(text) ? "" : text };
}

/** Sends via one provider; an empty / token-only reply is retried once (if time allows), and a
 * second one throws so sendWithFallback moves on to the next provider. */
export async function sendCleaned(send: () => Promise<SendMessageResult>, canRetry: () => boolean): Promise<SendMessageResult> {
  const result = cleanAssistantResult(await send()) ?? (canRetry() ? cleanAssistantResult(await send()) : null);
  if (!result) throw new Error("returned an empty reply (only end-of-text tokens) twice");
  return result;
}
