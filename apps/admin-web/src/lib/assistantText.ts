/** Render-time guard against leaked model special tokens ("<EOS_TOKEN>", "<|endoftext|>", ...).
 * Mirrors apps/api/src/agent/assistantText.ts (same regex and placeholder): the API already
 * sanitises on save and load, this also covers threads/responses from an older API. */
const SPECIAL_TOKEN_RE =
  /<\s*\|?\s*(?:eos[\s_]*token|end[\s_]*of[\s_]*text|eot[\s_]*id|im[\s_]*end|im[\s_]*start)\s*\|?\s*>|<\s*\|[\w\s]*\|\s*>|<\s*\/\s*s\s*>/gi;

export const EMPTY_REPLY_PLACEHOLDER = "(no reply)";

export function sanitizeAssistantText(text: string): string {
  const clean = text.replace(SPECIAL_TOKEN_RE, "").trim();
  return /[\p{L}\p{N}]/u.test(clean) ? clean : EMPTY_REPLY_PLACEHOLDER;
}

/** Assistant messages with text are sanitised; empty ones (tool-call-only turns) stay empty. */
export function sanitizeMessages<T extends { role: string; content?: string }>(messages: T[]): T[] {
  return messages.map((m) => (m.role === "assistant" && m.content ? { ...m, content: sanitizeAssistantText(m.content) } : m));
}
