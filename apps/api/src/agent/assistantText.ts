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
