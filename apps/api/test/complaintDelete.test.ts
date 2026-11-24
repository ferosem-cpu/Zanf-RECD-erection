import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PERMISSION_KEY } from "@recd/shared";
import { complaintDeleteBlocker, deleteOpenComplaint } from "../src/services/complaintDelete";
process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret-0123456789";

function fakeTx(row: { status: string; comments: number; attachments: number } | null) {
  const deleted: string[] = [];
  const tx: any = {
    complaint: {
      findUnique: async () => (row ? { status: row.status, _count: { comments: row.comments, portalAttachments: row.attachments } } : null),
      delete: async (a: any) => { deleted.push(a.where.id); },
    },
  };
  return { tx, deleted };
}

test("open complaint with no comments/files is deleted", async () => {
  const { tx, deleted } = fakeTx({ status: "open", comments: 0, attachments: 0 });
  assert.deepEqual(await deleteOpenComplaint(tx, "c1"), { ok: true });
  assert.deepEqual(deleted, ["c1"]);
});

test("every non-open status is rejected with 409 and nothing is deleted", async () => {
  for (const s of ["acknowledged", "assigned", "in_progress", "waiting_for_customer", "waiting_for_part", "escalated", "resolved", "closed"]) {
    const { tx, deleted } = fakeTx({ status: s, comments: 0, attachments: 0 });
    const r: any = await deleteOpenComplaint(tx, "c1");
    assert.equal(r.ok, false, s); assert.equal(r.status, 409, s); assert.match(r.error, /Only an open complaint/);
    assert.equal(deleted.length, 0);
  }
});

test("comments or attached files block with a clear reason", async () => {
  let t = fakeTx({ status: "open", comments: 2, attachments: 0 });
  let r: any = await deleteOpenComplaint(t.tx, "c1");
  assert.equal(r.status, 409); assert.match(r.error, /2 comment/); assert.equal(t.deleted.length, 0);
  t = fakeTx({ status: "open", comments: 0, attachments: 1 });
  r = await deleteOpenComplaint(t.tx, "c1");
  assert.equal(r.status, 409); assert.match(r.error, /1 attached file/); assert.equal(t.deleted.length, 0);
});

test("unknown complaint -> 404", async () => {
  const r: any = await deleteOpenComplaint(fakeTx(null).tx, "nope");
  assert.equal(r.status, 404);
});

test("blocker is null only for open/0/0", () => {
  assert.equal(complaintDeleteBlocker({ status: "open", comments: 0, attachments: 0 }), null);
});

test("route needs manage_complaints only: anonymous 401, engineer with act_assigned_complaints 403, manager passes", () => {
  const { requirePermission } = require("../src/middleware/auth") as typeof import("../src/middleware/auth");
  const guard = requirePermission(PERMISSION_KEY.MANAGE_COMPLAINTS);
  const run = (auth: any) => {
    let code = 0; let nexted = false;
    const res: any = { status: (c: number) => { code = c; return { json: () => undefined }; } };
    guard({ auth } as any, res, () => { nexted = true; });
    return { code, nexted };
  };
  assert.equal(run(undefined).code, 401);
  assert.equal(run({ permissions: new Set([PERMISSION_KEY.ACT_ASSIGNED_COMPLAINTS]) }).code, 403);
  assert.equal(run({ permissions: new Set([PERMISSION_KEY.MANAGE_COMPLAINTS]) }).nexted, true);
  const src = readFileSync(join(__dirname, "../src/routes/complaints.ts"), "utf8");
  assert.match(src, /complaintsRouter\.delete\("\/:id", requirePermission\(PERMISSION_KEY\.MANAGE_COMPLAINTS\)/);
});
