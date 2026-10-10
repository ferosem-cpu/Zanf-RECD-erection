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

/** True when the text holds an internal identifier: a snake_case or camelCase name (every tool
 * name is snake_case), a key=value parameter or a dotted JSON path. Document numbers (TXIN0934,
 * PO/2026-27/0001), ALL-CAPS names, amounts, dates, URLs and ordinary words do not match. */
export function hasInternalIdentifier(text: string): boolean {
  const t = text
    .replace(/\]\([^)\s]*\)/g, "]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:org|com|in|net|io|app|pdf|xlsx?|docx?|png|jpe?g)\b/gi, " ");
  return (
    /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/.test(t) ||
    /\b[a-z]+[A-Z][A-Za-z0-9]*\b/.test(t) ||
    /\b[A-Za-z_]\w*=[\w"'.-]+/.test(t) ||
    /\b[a-z][A-Za-z0-9]{2,}(?:\.[a-z][A-Za-z0-9]{2,})+\b/.test(t)
  );
}

/** Removes parentheticals and sentences that expose internal names. Works line by line so list
 * items and table rows keep their own lines. */
function dropInternalNarration(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!hasInternalIdentifier(line)) return line;
      const noParens = line.replace(/\s*\([^()\n]*\)/g, (m) => (hasInternalIdentifier(m) ? "" : m));
      if (!hasInternalIdentifier(noParens)) return noParens;
      const indent = /^\s*(?:[-*>]\s+|\d+[.)]\s+)?/.exec(noParens)?.[0] ?? "";
      const body = noParens.slice(indent.length);
      const kept = body.split(/(?<=[.!?])\s+(?=[A-Z0-9*_(\[])/).filter((sentence) => !hasInternalIdentifier(sentence));
      return kept.length ? indent + kept.join(" ") : "";
    })
    .join("\n");
}

/** Collapses a word doubled by a substitution ("the the app"). */
function collapseDoubledWords(text: string): string {
  return text.replace(/\b(the|a|an|of|in|to|app)(\s+\1\b)+/gi, "$1");
}

/** Strips leaked internal names from a reply: "Source: <tool>..." lines, backticked tool names
 * (replaced with "the app"), then any sentence or parenthetical that still names a tool, field,
 * parameter or JSON path. The prompt forbids them (NO INTERNALS); this is the safety net. */
export function stripToolInternals(text: string): string {
  const cleaned = text
    .replace(SOURCE_LINE_RE, "")
    .replace(TOOL_ASIDE_RE, "")
    .replace(new RegExp(String.raw`\b(the|a|an)\s+\x60${TOOL_NAME}\x60`, "gi"), "$1 app")
    .replace(BACKTICKED_TOOL_RE, "the app");
  return collapseDoubledWords(dropInternalNarration(collapseDoubledWords(cleaned)))
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
