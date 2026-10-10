export const AGENT_FRIENDLY_ERROR = "Sorry - I couldn't finish that, please try again";

/** One user-facing text for every failed agent send (server error JSON, timeout, network drop).
 * Raw messages can carry provider names and escaped newlines, so they are never shown. */
export function agentErrorText(_err: unknown): string {
  return AGENT_FRIENDLY_ERROR;
}
