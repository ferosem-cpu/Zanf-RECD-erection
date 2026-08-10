import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { decryptSecret } from "../src/lib/crypto";
import { driveTools } from "../src/agent/tools/driveTool";
import { createOpenAICompatibleAdapter } from "../src/agent/providers/openaiCompatibleAdapter";
import { AGENT_SYSTEM_PROMPT } from "../src/agent/systemPrompt";
import type { UnifiedMessage } from "../src/agent/providers/types";

async function main() {
  const row = await prisma.agentLlmProvider.findFirst({ where: { name: "Gemini" } });
  if (!row) return console.log("No Gemini row found.");
  const apiKey = decryptSecret(row.apiKeyCiphertext);

  const adapter = createOpenAICompatibleAdapter({
    providerName: row.name,
    apiKey,
    model: row.model,
    baseUrl: row.baseUrl ?? undefined,
  });

  const messages: UnifiedMessage[] = [{ role: "user", content: "What documents do you have access to?" }];
  const tools = driveTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));

  try {
    const result = await adapter.sendMessage({ systemPrompt: AGENT_SYSTEM_PROMPT, messages, tools });
    console.log("SUCCESS:", JSON.stringify(result, null, 2).slice(0, 500));
  } catch (err) {
    console.error("ADAPTER call failed:");
    console.error(err);
  }
}

main()
  .catch((err) => console.error("FAILED:", err))
  .finally(() => prisma.$disconnect());
