import { test } from "node:test";
import assert from "node:assert/strict";
import { createThreadSwitchGuard } from "../src/lib/threadSwitchGuard";

test("a late load of the old thread can't overwrite the thread opened by '+ New'", async () => {
  const guard = createThreadSwitchGuard();
  let shown = { id: "", messages: [] as string[] };
  let releaseOld!: () => void;
  const oldFetch = new Promise<void>((r) => (releaseOld = r));

  // Opening the panel starts loading the most recent (old) thread...
  const loadOld = (async () => {
    const ticket = guard.begin();
    await oldFetch;
    if (guard.isCurrent(ticket)) shown = { id: "old", messages: ["hi", "earlier answer"] };
  })();
  // ...the user clicks "+ New" before it answers.
  const ticketNew = guard.begin();
  if (guard.isCurrent(ticketNew)) shown = { id: "new", messages: [] };

  releaseOld();
  await loadOld;
  assert.deepEqual(shown, { id: "new", messages: [] });
});

test("work on the current thread applies until the next switch", () => {
  const guard = createThreadSwitchGuard();
  guard.begin();
  const sendTicket = guard.current();
  assert.equal(guard.isCurrent(sendTicket), true);
  guard.begin();
  assert.equal(guard.isCurrent(sendTicket), false);
});
