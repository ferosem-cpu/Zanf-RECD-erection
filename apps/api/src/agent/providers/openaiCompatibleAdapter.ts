import OpenAI from "openai";
import type { ExtractDocumentParams, LlmAdapter, SendMessageParams, SendMessageResult, UnifiedMessage } from "./types";
import { ProviderCallError } from "./types";

export interface OpenAICompatibleAdapterConfig {
  providerName: string; // the user-given label, for error messages
  apiKey: string;
  model: string;
  /** Custom endpoint for non-OpenAI providers exposing an OpenAI-compatible API (Groq,
   * Together, DeepSeek, OpenRouter, Fireworks, Mistral, etc). Omit for real OpenAI. */
  baseUrl?: string;
}

function toOpenAIMessages(
  systemPrompt: string,
  messages: UnifiedMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: systemPrompt }];
  for (const m of messages) {
    if (m.role === "user") {
      result.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      result.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls?.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          // Some providers (Gemini's OpenAI-compat layer) attach extra out-of-spec fields
          // (e.g. extra_content.google.thought_signature) to each tool_call and REQUIRE them
          // echoed back verbatim on the next turn, or reject the request with a bare 400.
          // The OpenAI SDK's types don't model this, but it round-trips fine at runtime.
          ...((tc.providerMetadata as object) ?? {}),
        })) as OpenAI.Chat.ChatCompletionMessageToolCall[] | undefined,
      });
    } else {
      result.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return result;
}

function isGeminiBaseUrl(baseUrl: string | undefined): boolean {
  return !!baseUrl && baseUrl.includes("generativelanguage.googleapis.com");
}

/** Google's real Generative Language REST API (as opposed to the OpenAI-compatibility shim
 * this adapter otherwise speaks) accepts a PDF directly as inline base64 data - up to 20MB,
 * no separate upload step needed for a file this size. Used only as extractDocument's escape
 * hatch for non-image files on a Gemini-configured provider; sendMessage keeps going through
 * the OpenAI-compatible endpoint above unchanged, so normal chat behavior is untouched. */
async function extractDocumentViaNativeGemini(
  config: OpenAICompatibleAdapterConfig,
  params: ExtractDocumentParams,
): Promise<string> {
  const modelPath = config.model.replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}:generateContent`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: params.instructions }, { inline_data: { mime_type: params.mimeType, data: params.fileBase64 } }],
          },
        ],
      }),
    });
  } catch (err) {
    throw new ProviderCallError(
      `Provider "${config.providerName}" extraction failed: ${(err as Error).message}`,
      config.providerName,
      err,
    );
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new ProviderCallError(
      `Provider "${config.providerName}" extraction failed: ${response.status} ${response.statusText} ${bodyText}`.trim(),
      config.providerName,
    );
  }
  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return text.trim();
}

export function createOpenAICompatibleAdapter(config: OpenAICompatibleAdapterConfig): LlmAdapter {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });

  return {
    async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
      try {
        const response = await client.chat.completions.create({
          model: config.model,
          messages: toOpenAIMessages(params.systemPrompt, params.messages),
          tools: params.tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          })),
        });

        const message = response.choices[0]?.message;
        if (!message) {
          throw new Error("Provider returned no choices in the response.");
        }

        const toolCalls = (message.tool_calls ?? []).flatMap((tc) => {
          if (tc.type !== "function") return [];
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments || "{}");
          } catch {
            // Malformed JSON from the model - pass through empty input rather than crash;
            // the tool handler will likely fail validation and report that back to the model.
          }
          // Capture any extra out-of-spec fields the provider attached (see the comment in
          // toOpenAIMessages above) so they can be echoed back on the next turn.
          const { id: _id, type: _type, function: _fn, ...extra } = tc as unknown as Record<string, unknown> & {
            id: string;
          };
          return [
            {
              id: tc.id,
              name: tc.function.name,
              input,
              providerMetadata: Object.keys(extra).length > 0 ? extra : undefined,
            },
          ];
        });

        return { text: (message.content ?? "").trim(), toolCalls };
      } catch (err) {
        throw new ProviderCallError(
          `Provider "${config.providerName}" call failed: ${(err as Error).message}`,
          config.providerName,
          err,
        );
      }
    },

    async extractDocument(params: ExtractDocumentParams): Promise<string> {
      // Most OpenAI-compatible third-party endpoints (Groq/Together/OpenRouter/etc) accept
      // vision input as an image_url data: URI but do not accept raw PDF bytes the way the
      // real OpenAI API's file/vision handling does. Google's endpoint is the one exception
      // this app knows how to work around: Gemini's own native API (not the OpenAI-compat
      // shim this adapter otherwise talks to) DOES read PDFs directly, so a non-image file
      // on a Gemini-configured provider is routed to that native endpoint instead of failing.
      // Every other OpenAI-compatible provider still fails fast on non-image input so the
      // caller falls back to another configured provider (typically Anthropic).
      if (!params.mimeType.startsWith("image/")) {
        if (isGeminiBaseUrl(config.baseUrl)) {
          return extractDocumentViaNativeGemini(config, params);
        }
        throw new ProviderCallError(
          `Provider "${config.providerName}" only supports image extraction, not "${params.mimeType}".`,
          config.providerName,
        );
      }
      try {
        const response = await client.chat.completions.create({
          model: config.model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: params.instructions },
                { type: "image_url", image_url: { url: `data:${params.mimeType};base64,${params.fileBase64}` } },
              ],
            },
          ],
        });
        return (response.choices[0]?.message?.content ?? "").trim();
      } catch (err) {
        throw new ProviderCallError(
          `Provider "${config.providerName}" extraction failed: ${(err as Error).message}`,
          config.providerName,
          err,
        );
      }
    },
  };
}
