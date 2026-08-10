import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { decryptSecret } from "../src/lib/crypto";

async function tryModel(apiKey: string, model: string) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "Say hi in 3 words." }] }),
  });
  const text = await res.text();
  console.log(`model="${model}" -> status ${res.status}`);
  console.log(text.slice(0, 500));
  console.log("---");
}

async function main() {
  const row = await prisma.agentLlmProvider.findFirst({ where: { name: "Gemini" } });
  if (!row) {
    console.log("No 'Gemini' provider row found - check the name matches what you saved.");
    return;
  }
  const apiKey = decryptSecret(row.apiKeyCiphertext);
  console.log("Saved model on row:", row.model);

  await tryModel(apiKey, row.model); // as saved (likely "models/gemini-3.5-flash")
  await tryModel(apiKey, row.model.replace(/^models\//, "")); // stripped prefix
}

main()
  .catch((err) => console.error("FAILED:", err))
  .finally(() => prisma.$disconnect());
