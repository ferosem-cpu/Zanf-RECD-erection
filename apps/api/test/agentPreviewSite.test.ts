import { test } from "node:test";
import assert from "node:assert/strict";


test("confirmation previews show the site name, or '(no site name)' with the address separate", async () => {
  process.env.JWT_SECRET ||= "preview-test-only-secret"; // route helpers need one; test value only
  const { sitePreviewFields } = await import("../src/agent/tools/zanAppWriteTools");
  assert.deepEqual(sitePreviewFields({ companyName: "BOSTIK", address: "Bommasandra" }), { site: "BOSTIK", siteAddress: "Bommasandra" });
  for (const none of [null, "", "  "]) {
    assert.deepEqual(sitePreviewFields({ companyName: none, address: "Plot 5, Hosur" }), { site: "(no site name)", siteAddress: "Plot 5, Hosur" });
  }
  assert.equal(sitePreviewFields({ companyName: null, address: null }).siteAddress, null);
});
