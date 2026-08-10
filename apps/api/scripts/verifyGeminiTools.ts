import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { decryptSecret } from "../src/lib/crypto";
import { driveTools } from "../src/agent/tools/driveTool";

async function main() {
  const row = await prisma.agentLlmProvider.findFirst({ where: { name: "Gemini" } });
  if (!row) return console.log("No Gemini row found.");
  const apiKey = decryptSecret(row.apiKeyCiphertext);

  const tools = driveTools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));

  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: row.model,
      messages: [{ role: "user", content: "What documents do you have access to?" }],
      tools,
    }),
  });
  const text = await res.text();
  console.log("Status:", res.status);
  console.log(text.slice(0, 1500));
}

main()
  .catch((err) => console.error("FAILED:", err))
  .finally(() => prisma.$disconnect());
