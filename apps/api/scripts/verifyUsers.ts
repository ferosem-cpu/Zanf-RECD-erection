import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const users = await prisma.user.findMany({ select: { email: true, role: { select: { key: true } } }, take: 15 });
  console.log("Users in this DB:");
  for (const u of users) console.log(` - ${u.email} (${u.role?.key})`);
}

main()
  .catch((err) => console.error("FAILED:", err))
  .finally(() => prisma.$disconnect());
