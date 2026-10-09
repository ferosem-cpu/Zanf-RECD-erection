/** Guards the assistant bubble against thread-switch races: every switch (open a thread, "+ New")
 * takes a ticket, and a fetch may only apply its result while its ticket is still the latest.
 * Without it, a slow load of the previous thread could resolve after "+ New" and paint the old
 * history over the new empty thread. */
export function createThreadSwitchGuard() {
  let latest = 0;
  return {
    /** Starts a switch; earlier tickets become stale. */
    begin: () => ++latest,
    /** Ticket for work that belongs to the current thread (send, confirm) without switching. */
    current: () => latest,
    isCurrent: (ticket: number) => ticket === latest,
  };
}

export type ThreadSwitchGuard = ReturnType<typeof createThreadSwitchGuard>;

/** "+ New": takes a ticket and clears the visible thread SYNCHRONOUSLY, before any await - the
 * old thread's text must not stay on screen while the new conversation is being created. The
 * created id is applied only if no later switch happened meanwhile. */
export async function startNewThread(
  guard: ThreadSwitchGuard,
  clear: () => void,
  create: () => Promise<string>,
  apply: (id: string) => void,
): Promise<void> {
  const ticket = guard.begin();
  clear();
  const id = await create();
  if (guard.isCurrent(ticket)) apply(id);
}
