import "./_testEnv";
import { test } from "node:test";
import assert from "node:assert/strict";
import { withFinalCheck } from "../src/agent/whatsapp/finalCheck";
import { createWhatsappTurn } from "../src/agent/whatsapp/resolver";
import { resolveSender, type MappingRow, type SenderStore, type WaUserContext } from "../src/agent/whatsapp/policy";
import { isWriteTool } from "../src/agent/tools/registry";

const okResult = { reply: "Here is the status", history: [] as unknown[] };

async function turnFor(state: { u: WaUserContext | null; m: MappingRow }) {
  const store: SenderStore = {
    findByPhone: async () => [state.m], findByLid: async () => [], findById: async () => state.m, loadUser: async () => state.u,
  };
  const d = await resolveSender({ phoneE164: "+919876543210" }, store);
  assert.ok(d.ok);
  return createWhatsappTurn(d as Extract<typeof d, { ok: true }>, { store, tools: [], isWriteTool, siteLookup: async () => null });
}
const user = (roleKey: string, over: Partial<WaUserContext> = {}): WaUserContext =>
  ({ userId: "u1", roleKey, isActive: true, customerId: null, vendorId: null, vendorBlocked: false, permissions: new Set(), ...over });
const map = (over: Partial<MappingRow> = {}): MappingRow => ({ id: "m1", userId: "u1", phoneE164: "+919876543210", lid: null, enabled: true, aiPaused: false, ...over });

test("withFinalCheck: reply passes through when the check passes or none is given", async () => {
  assert.equal((await withFinalCheck(async () => okResult)).reply, "Here is the status");
  assert.equal((await withFinalCheck(async () => okResult, async () => true)).reply, "Here is the status");
});

test("no-tool reply after revocation is silent (disabled, paused, deactivated, group change, lookup failure)", async () => {
  const cases: Array<[string, (s: { u: WaUserContext | null; m: MappingRow }) => void]> = [
    ["disabled", (s) => { s.m = map({ enabled: false }); }],
    ["paused", (s) => { s.m = map({ aiPaused: true }); }],
    ["deactivated", (s) => { s.u = user("finance", { isActive: false }); }],
    ["downgrade mid-turn", (s) => { s.u = user("sales"); }],
    ["user lookup returns nothing", (s) => { s.u = null; }],
  ];
  for (const [name, change] of cases) {
    const state = { u: user("finance") as WaUserContext | null, m: map() };
    const turn = await turnFor(state);
    // The model answers without calling any tool; access is lost while the provider call is in flight.
    const out = await withFinalCheck(async () => { change(state); return okResult; }, turn.recheck);
    assert.equal(out.reply, "", name);
  }
});

test("timeout and error-fallback replies after revocation are silent too", async () => {
  for (const text of ["Sorry - this is taking longer than allowed, so I stopped here.", "Something went wrong. Anything already prepared is shown above."]) {
    const state = { u: user("finance") as WaUserContext | null, m: map() };
    const turn = await turnFor(state);
    const out = await withFinalCheck(async () => { state.m = map({ enabled: false }); return { reply: text, history: [] }; }, turn.recheck);
    assert.equal(out.reply, "", text);
  }
});

test("a throwing final check is silent; a throwing turn propagates (nothing is sent)", async () => {
  assert.equal((await withFinalCheck(async () => okResult, async () => { throw new Error("db"); })).reply, "");
  await assert.rejects(withFinalCheck(async () => { throw new Error("llm"); }, async () => true), /llm/);
});

test("an unchanged sender still gets the reply after the final re-check", async () => {
  const turn = await turnFor({ u: user("sales"), m: map() });
  assert.equal((await withFinalCheck(async () => okResult, turn.recheck)).reply, "Here is the status");
});
