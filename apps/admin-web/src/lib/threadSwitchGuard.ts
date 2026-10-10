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
 * created id is applied only if no later switch happened meanwhile. `settled(latest)` runs when
 * the attempt ends (success or failure); only the latest attempt may clear the "creating" flag,
 * otherwise a superseded attempt re-enables Send while the newest thread has no id yet. */
export async function startNewThread(
  guard: ThreadSwitchGuard,
  clear: () => void,
  create: () => Promise<string>,
  apply: (id: string) => void,
  settled?: (latest: boolean) => void,
): Promise<void> {
  const ticket = guard.begin();
  clear();
  try {
    const id = await create();
    if (guard.isCurrent(ticket)) apply(id);
  } finally {
    settled?.(guard.isCurrent(ticket));
  }
}

/** Thread a send must go to. An existing active id is used as is. With NO active id (a "+ New"
 * whose creation failed or was superseded) the send creates a brand-new thread - it must never
 * fall back to "the most recent thread", which is the previous conversation whose messages
 * would then be loaded above the reply. Resuming the latest thread is only for opening the
 * panel (see the bubble's openPanel), never for sending. */
export async function threadForSend(
  activeId: string | null,
  create: () => Promise<string>,
  apply: (id: string) => void,
): Promise<string> {
  if (activeId) return activeId;
  const id = await create();
  apply(id);
  return id;
}

/** A send requested while "+ New" is still creating its thread is queued, not dropped: the typed
 * text stays in the input and is sent once the thread exists. At most one send is queued, and
 * `take()` consumes it exactly once, so text is neither lost nor sent twice. */
export function createSendQueue() {
  let queued = false;
  return {
    /** Returns true if the send may run now; false if it was queued behind thread creation. */
    request(creatingThread: boolean): boolean {
      if (creatingThread) {
        queued = true;
        return false;
      }
      return true;
    },
    /** True once if a send was queued; clears the queue. */
    take(): boolean {
      const was = queued;
      queued = false;
      return was;
    },
    /** A new "+ New" or thread switch invalidates a queued send only if explicitly cancelled. */
    cancel() {
      queued = false;
    },
  };
}
