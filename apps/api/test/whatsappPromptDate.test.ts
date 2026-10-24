import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { buildWhatsappSystemPrompt } from "../src/services/whatsappBridgeProd";
import { isoDateIST } from "../src/agent/istDates";

test("WhatsApp turn prompt carries today's IST date (late-evening UTC rolls to next IST day)", async () => {
  const d = Object.getOwnPropertyDescriptor(prisma, "companySettings");
  Object.defineProperty(prisma, "companySettings", { configurable: true, value: { findUnique: async () => null } });
  try {
    const now = new Date("2026-10-24T19:00:00Z"); // 00:30 IST on 25 Oct
    const p = await buildWhatsappSystemPrompt(now);
    assert.equal(isoDateIST(now), "2026-10-25");
    assert.match(p, /Today's date \(IST, Asia\/Kolkata\) is 2026-10-25\./);
    assert.match(p, /MY \/ MINE \/ ASSIGNED TO ME/);
  } finally {
    if (d) Object.defineProperty(prisma, "companySettings", d); else Reflect.deleteProperty(prisma, "companySettings");
  }
});
