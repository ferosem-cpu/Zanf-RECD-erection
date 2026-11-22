import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Customers hold raise_complaint / view_site_status, so every staff-side portal route must refuse a customer JWT explicitly
// (otherwise a customer could read internal notes or another company's files while PORTAL_ENABLED is off).
test("staff-side portal routes refuse callers that have a customerId", () => {
  const src = path.join(__dirname, "..", "src", "routes");
  const checks: [string, string[]][] = [
    ["complaints.ts", ['"/:id/comments", requirePermission(...COMPLAINT_LIST_PERMISSIONS)', '"/attachments/:attachmentId"']],
    ["sites.ts", ['"/portal-attachments/:attId/content"', '"/:id/portal-attachments"', '"/:id/priority"']],
  ];
  for (const [file, routes] of checks) {
    const text = fs.readFileSync(path.join(src, file), "utf8");
    for (const r of routes) {
      const i = text.indexOf(r);
      assert.ok(i > 0, file + " " + r);
      const body = text.slice(i, i + 700);
      assert.match(body, /req\.auth!\.customerId\) return res\.status\(403\)/, file + " " + r);
    }
  }
});
test("JSON backup never includes uploaded file bytes", () => {
  const text = fs.readFileSync(path.join(__dirname, "..", "src", "services", "backup.ts"), "utf8");
  assert.match(text, /PortalAttachment[\s\S]{0,200}f\.name !== "data"/);
});
