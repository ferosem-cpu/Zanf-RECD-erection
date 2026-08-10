import "dotenv/config";
import OpenAI from "openai";
import { prisma } from "../src/lib/prisma";
import { decryptSecret } from "../src/lib/crypto";
import { driveTools } from "../src/agent/tools/driveTool";

async function main() {
  const row = await prisma.agentLlmProvider.findFirst({ where: { name: "Gemini" } });
  if (!row) return;
  const apiKey = decryptSecret(row.apiKeyCiphertext);
  const client = new OpenAI({ apiKey, baseURL: row.baseUrl ?? undefined });
  const tools = driveTools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));

  const turn1 = await client.chat.completions.create({
    model: row.model,
    messages: [{ role: "user", content: "What documents do you have access to?" }],
    tools,
  });
  const assistantMsg = turn1.choices[0].message;
  console.log("Turn 1 assistant message (raw, unmodified):", JSON.stringify(assistantMsg).slice(0, 200));

  try {
    const turn2 = await client.chat.completions.create({
      model: row.model,
      messages: [
        { role: "user", content: "What documents do you have access to?" },
        assistantMsg, // pass back EXACTLY as received, including extra_content
        {
          role: "tool",
          tool_call_id: assistantMsg.tool_calls![0].id,
          content: JSON.stringify({ error: "GOOGLE_DRIVE_CLIENT_ID is not set" }),
        },
      ],
      tools,
    });
    console.log("TURN 2 SUCCESS (preserving raw message):", JSON.stringify(turn2.choices[0].message).slice(0, 300));
  } catch (err) {
    console.error("TURN 2 STILL FAILED even preserving raw message:");
    console.error(err);
  }
}

main().finally(() => prisma.$disconnect());
