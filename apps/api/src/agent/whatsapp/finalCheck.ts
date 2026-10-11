/** Runs a turn, then re-checks the sender immediately before the reply is returned. A false result
 * or a throw makes the reply silent; errors from the turn itself propagate (nothing is sent). */
export async function withFinalCheck<T extends { reply: string }>(
  run: () => Promise<T>,
  finalCheck?: () => Promise<boolean>,
): Promise<T> {
  const result = await run();
  if (!finalCheck) return result;
  let ok = false;
  try {
    ok = await finalCheck();
  } catch {
    ok = false;
  }
  return ok ? result : { ...result, reply: "" };
}
