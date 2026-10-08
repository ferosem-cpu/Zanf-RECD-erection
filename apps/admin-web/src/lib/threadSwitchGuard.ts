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
