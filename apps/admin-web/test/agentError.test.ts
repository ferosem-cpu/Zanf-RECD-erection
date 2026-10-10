import { test } from "node:test";
import assert from "node:assert/strict";
import { agentErrorText, AGENT_FRIENDLY_ERROR } from "../src/lib/agentError";
import { ApiError, NetworkError } from "../src/lib/apiClient";

test("server error JSON and network/timeout errors render the same friendly text", () => {
  const raw = JSON.stringify('All configured LLM providers failed:\nPrimary Free LLM API: Request timed out.');
  const errs = [
    new ApiError(500, raw),
    new NetworkError("The server took too long", { timedOut: true }),
    new TypeError("Failed to fetch"),
    "plain string",
  ];
  for (const e of errs) {
    const text = agentErrorText(e);
    assert.equal(text, AGENT_FRIENDLY_ERROR);
    assert.ok(!text.includes("\\n") && !text.includes("\n"));
    assert.ok(!/provider|LLM|Free LLM|timed out/i.test(text));
  }
});
