import "dotenv/config";
import { runAgentTurn } from "../src/agent/llm";
import { AGENT_SYSTEM_PROMPT } from "../src/agent/systemPrompt";
import { allTools } from "../src/agent/tools/registry";
import { prisma } from "../src/lib/prisma";

async function main() {
  try {
    const result = await runAgentTurn({
      systemPrompt: AGENT_SYSTEM_PROMPT,
      history: [{ role: "user", content: "What documents do you have access to? List them." }],
      tools: allTools,
      auth: { userId: "test", roleKey: "super_admin", permissions: new Set() },
    });
    console.log("SUCCESS. Reply:", result.reply);
  } catch (err) {
    console.error("FULL LOOP FAILED:");
    console.error(err);
  }
}

main().finally(() => prisma.$disconnect());
