import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Customer web sign-in block must never touch the WhatsApp (/wa/*) routes or the agent's customer mapping.
test("WhatsApp routes and services do not reference the customer web block", () => {
  const src = path.join(__dirname, "..", "src");
  const files = [
    "routes/whatsappBridge.ts", "services/whatsappBridge.ts", "services/whatsappBridgeAuth.ts", "services/whatsappBridgeProd.ts",
    "services/whatsappMapping.ts", "agent/whatsapp/policy.ts", "agent/whatsapp/resolver.ts", "agent/whatsapp/turn.ts",
  ];
  for (const f of files) {
    const text = fs.readFileSync(path.join(src, f), "utf8");
    assert.ok(!/isCustomerWebBlocked|CUSTOMER_WEB_BLOCK_MESSAGE/.test(text), f);
  }
});
test("portal router is mounted before express.json and after /wa", () => {
  const idx = fs.readFileSync(path.join(__dirname, "..", "src", "index.ts"), "utf8");
  const wa = idx.indexOf('app.use("/wa"'), portal = idx.indexOf('app.use("/portal"'), json = idx.indexOf("express.json(");
  assert.ok(wa > 0 && portal > wa && json > portal);
});
