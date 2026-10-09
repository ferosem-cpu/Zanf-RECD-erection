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

test("'+ New' clears the old thread synchronously, before the create call resolves", async () => {
  const { startNewThread } = await import("../src/lib/threadSwitchGuard");
  const guard = createThreadSwitchGuard();
  guard.begin(); // the old thread was opened...
  const oldSendTicket = guard.current(); // ...and a message to it is still in flight
  let shown = { id: "old" as string | null, messages: ["hi", "old answer"] };
  let releaseCreate!: (id: string) => void;
  const created = new Promise<string>((r) => (releaseCreate = r));
  const pending = startNewThread(guard, () => (shown = { id: null, messages: [] }), () => created, (id) => (shown = { ...shown, id }));
  // Nothing awaited yet: the old text is already gone.
  assert.deepEqual(shown, { id: null, messages: [] });
  // A reply for the old thread that arrives now is ignored (its ticket is stale).
  assert.equal(guard.isCurrent(oldSendTicket), false);
  releaseCreate("new");
  await pending;
  assert.deepEqual(shown, { id: "new", messages: [] });
});

test("a superseded '+ New' does not apply its id", async () => {
  const { startNewThread } = await import("../src/lib/threadSwitchGuard");
  const guard = createThreadSwitchGuard();
  let applied: string | null = null;
  const p = startNewThread(guard, () => {}, async () => "first", (id) => (applied = id));
  guard.begin(); // the user opened another thread meanwhile
  await p;
  assert.equal(applied, null);
});

test("assistant text is sanitised at render: token-only replies show a placeholder", async () => {
  const { sanitizeMessages, EMPTY_REPLY_PLACEHOLDER } = await import("../src/lib/assistantText");
  const out = sanitizeMessages([
    { role: "user", content: "<EOS_TOKEN> typed by a user" },
    { role: "assistant", content: "<EOS_TOKEN>" },
    { role: "assistant", content: "Done.<|im_end|>" },
    { role: "assistant", content: "" },
  ]);
  assert.deepEqual(out.map((m) => m.content), ["<EOS_TOKEN> typed by a user", EMPTY_REPLY_PLACEHOLDER, "Done.", ""]);
});
