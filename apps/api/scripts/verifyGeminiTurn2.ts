import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { decryptSecret } from "../src/lib/crypto";
import { driveTools } from "../src/agent/tools/driveTool";
import { createOpenAICompatibleAdapter } from "../src/agent/providers/openaiCompatibleAdapter";
import { AGENT_SYSTEM_PROMPT } from "../src/agent/systemPrompt";
import type { UnifiedMessage } from "../src/agent/providers/types";
import { getToolByName } from "../src/agent/tools/registry";

async function main() {
  const row = await prisma.agentLlmProvider.findFirst({ where: { name: "Gemini" } });
  if (!row) return console.log("No Gemini row found.");
  const apiKey = decryptSecret(row.apiKeyCiphertext);

  const adapter = createOpenAICompatibleAdapter({
    providerName: row.name, apiKey, model: row.model, baseUrl: row.baseUrl ?? undefined,
  });
  const tools = driveTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));

  // Actually run the tool handler for real to get the real result shape (error or not)
  const tool = getToolByName("list_documents")!;
  let toolResult: unknown;
  try {
    toolResult = await tool.handler({}, { userId: "x", roleKey: "x", permissions: new Set() });
  } catch (err) {
    toolResult = { error: (err as Error).message };
  }
  console.log("Tool result:", JSON.stringify(toolResult).slice(0, 300));

  const messages: UnifiedMessage[] = [
    { role: "user", content: "What documents do you have access to?" },
    { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "list_documents", input: {} }] },
    { role: "tool", toolCallId: "call_1", toolName: "list_documents", content: JSON.stringify(toolResult) },
  ];

  try {
    const result = await adapter.sendMessage({ systemPrompt: AGENT_SYSTEM_PROMPT, messages, tools });
    console.log("TURN 2 SUCCESS:", JSON.stringify(result).slice(0, 500));
  } catch (err) {
    console.error("TURN 2 FAILED:");
    console.error(err);
  }
}

main().finally(() => prisma.$disconnect());
