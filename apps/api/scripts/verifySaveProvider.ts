import "dotenv/config";
import { encryptSecret } from "../src/lib/crypto";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("Testing encryptSecret...");
  const ciphertext = encryptSecret("test-key-12345");
  console.log("Encrypted OK:", ciphertext.slice(0, 20) + "...");

  console.log("Testing prisma.agentLlmProvider.create (will delete after)...");
  const row = await prisma.agentLlmProvider.create({
    data: {
      name: "TEST - delete me",
      providerType: "openai_compatible",
      apiKeyCiphertext: ciphertext,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: "models/gemini-3.5-flash",
      priority: 99,
      isActive: false,
      createdById: (await prisma.user.findFirstOrThrow()).id,
    },
  });
  console.log("Created OK:", row.id);

  await prisma.agentLlmProvider.delete({ where: { id: row.id } });
  console.log("Cleaned up OK.");
}

main()
  .catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
