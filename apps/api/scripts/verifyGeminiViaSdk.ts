import "dotenv/config";
import OpenAI from "openai";
import { prisma } from "../src/lib/prisma";
import { decryptSecret } from "../src/lib/crypto";
import { driveTools } from "../src/agent/tools/driveTool";

async function main() {
  const row = await prisma.agentLlmProvider.findFirst({ where: { name: "Gemini" } });
  if (!row) return console.log("No Gemini row found.");
  const apiKey = decryptSecret(row.apiKeyCiphertext);

  const client = new OpenAI({ apiKey, baseURL: row.baseUrl ?? undefined });

  try {
    const response = await client.chat.completions.create({
      model: row.model,
      messages: [{ role: "user", content: "What documents do you have access to?" }],
      tools: driveTools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
    });
    console.log("SUCCESS:", JSON.stringify(response.choices[0], null, 2).slice(0, 800));
  } catch (err) {
    console.error("SDK call failed:");
    console.error(err);
  }
}

main()
  .catch((err) => console.error("FAILED:", err))
  .finally(() => prisma.$disconnect());
