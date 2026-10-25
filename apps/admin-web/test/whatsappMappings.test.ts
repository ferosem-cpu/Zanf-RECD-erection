import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleUsers, looksLikePhone, enableBlocker, mappingStatus, toggleRequest, type MappingRow } from "../src/lib/whatsappMappings";

const row = (o: Partial<MappingRow> = {}): MappingRow => ({
  id: "m1", userId: "u1", phoneE164: "+910000000000", lid: null, enabled: false, aiPaused: false, note: null,
  verifiedAt: "2026-10-24T00:00:00Z", createdAt: "", updatedAt: "",
  user: { name: "A", roleKey: "management", isActive: true }, ...o,
});

test("eligibleUsers keeps active staff with a WhatsApp role only, sorted", () => {
  const out = eligibleUsers([
    { id: "1", name: "Zed", isActive: true, role: { key: "sales" } },
    { id: "2", name: "Amy", isActive: true, role: { key: "management" } },
    { id: "3", name: "Off", isActive: false, role: { key: "sales" } },
    { id: "4", name: "Cust", isActive: true, customerId: "c", role: { key: "management" } },
    { id: "5", name: "Vend", isActive: true, vendorId: "v", role: { key: "finance" } },
    { id: "6", name: "Client", isActive: true, role: { key: "customer" } },
    { id: "7", name: "NoRole", isActive: true, role: null },
  ]);
  assert.deepEqual(out.map((u) => u.id), ["2", "1"]);
});

test("looksLikePhone accepts common spellings and rejects junk", () => {
  for (const ok of ["+91 98765 43210", "98765-43210", "0098765432100"]) assert.equal(looksLikePhone(ok), true, ok);
  for (const bad of ["", "abc", "12345", "+1234567890123456", "98765x43210"]) assert.equal(looksLikePhone(bad), false, bad);
});

test("enableBlocker mirrors the API's setEnabled guards", () => {
  assert.equal(enableBlocker(row(), [row()]), null);
  assert.equal(enableBlocker(row({ enabled: true }), []), null);
  assert.match(enableBlocker(row({ user: { name: "A", roleKey: "management", isActive: false } }), [])!, /inactive/);
  assert.match(enableBlocker(row({ user: { name: "A", roleKey: "customer", isActive: true } }), [])!, /no WhatsApp access/);
  assert.match(enableBlocker(row({ verifiedAt: null }), [])!, /not verified/);
  const other = row({ id: "m2", enabled: true });
  assert.match(enableBlocker(row(), [row(), other])!, /already has an enabled/);
});

test("mappingStatus", () => {
  assert.equal(mappingStatus(row()), "Off");
  assert.equal(mappingStatus(row({ enabled: true })), "On");
  assert.equal(mappingStatus(row({ enabled: true, aiPaused: true })), "Paused");
});

test("toggleRequest: tick enables, untick disables, blocked tick explains, no-op returns null", () => {
  const off = row();
  assert.deepEqual(toggleRequest(off, [off], true), { path: "/whatsapp/mappings/m1/enable" });
  const on = row({ enabled: true });
  assert.deepEqual(toggleRequest(on, [on], false), { path: "/whatsapp/mappings/m1/disable" });
  assert.equal(toggleRequest(on, [on], true), null);
  assert.equal(toggleRequest(off, [off], false), null);
  const unverified = row({ verifiedAt: null });
  assert.deepEqual(toggleRequest(unverified, [unverified], true), { blocked: "Mapping is not verified" });
});
