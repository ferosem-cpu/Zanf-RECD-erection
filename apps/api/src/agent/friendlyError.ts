import { randomBytes } from "node:crypto";

/** The only error text an agent user ever sees. Provider names and details stay in server logs. */
export const AGENT_FRIENDLY_ERROR = "Sorry - I couldn't finish that, please try again";

export function newAgentErrorId(): string {
  return randomBytes(4).toString("hex");
}

/** Logs the real error under an id and returns the response body for the client. */
export function agentErrorBody(err: unknown): { error: string; errorId: string } {
  const errorId = newAgentErrorId();
  console.error(`[agent:error ${errorId}] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  return { error: AGENT_FRIENDLY_ERROR, errorId };
}
