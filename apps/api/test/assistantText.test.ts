import { test } from "node:test";
import assert from "node:assert/strict";
import { stripSpecialTokens, isJunkReply, cleanAssistantResult, sendCleaned } from "../src/agent/assistantText";
import type { SendMessageResult } from "../src/agent/providers/types";

test("special tokens are stripped; token-only replies are junk", () => {
  for (const junk of ["<EOS_TOKEN>", " <eos_token> ", "< EOS_TOKEN >", "<|endoftext|>", "<| endoftext |>", "<eot_id>", "<|eot_id|>",
    "<|im_end|>", "< | im_end | >", "<EOS_TOKEN><|endoftext|>", "", "   ", "<EOS_TOKEN>.", "</s>"]) {
    assert.ok(isJunkReply(junk), JSON.stringify(junk));
  }
  assert.equal(stripSpecialTokens("3 invoices are overdue.<EOS_TOKEN>"), "3 invoices are overdue.");
  assert.equal(stripSpecialTokens("Total ₹1,18,000 <|im_end|>"), "Total ₹1,18,000");
  assert.equal(isJunkReply("3 invoices are overdue."), false);
  assert.equal(stripSpecialTokens("a < b and c > d"), "a < b and c > d");
});

test("cleanAssistantResult rejects a token-only final reply but keeps tool calls", () => {
  assert.equal(cleanAssistantResult({ text: "<EOS_TOKEN>", toolCalls: [] }), null);
  assert.deepEqual(cleanAssistantResult({ text: "Done.<|endoftext|>", toolCalls: [] }), { text: "Done.", toolCalls: [] });
  const call = { id: "1", name: "get_receivables", input: {} };
  assert.deepEqual(cleanAssistantResult({ text: "<EOS_TOKEN>", toolCalls: [call] as any }), { text: "", toolCalls: [call] });
});

const fake = (replies: SendMessageResult[]) => {
  let calls = 0;
  return { send: async () => replies[Math.min(calls++, replies.length - 1)], calls: () => calls };
};

test("a token-only reply is retried once on the same provider", async () => {
  const a = fake([{ text: "<EOS_TOKEN>", toolCalls: [] }, { text: "Two bills are overdue.", toolCalls: [] }]);
  assert.equal((await sendCleaned(a.send, () => true)).text, "Two bills are overdue.");
  assert.equal(a.calls(), 2);
  const ok = fake([{ text: "Fine.", toolCalls: [] }]);
  await sendCleaned(ok.send, () => true);
  assert.equal(ok.calls(), 1);
});

test("a second token-only reply throws (so sendWithFallback tries the next provider) without echoing the token", async () => {
  const a = fake([{ text: "<EOS_TOKEN>", toolCalls: [] }]);
  await assert.rejects(sendCleaned(a.send, () => true), (err: Error) => /empty reply/.test(err.message) && !/EOS_TOKEN/.test(err.message));
  assert.equal(a.calls(), 2);
  const late = fake([{ text: "<|endoftext|>", toolCalls: [] }]);
  await assert.rejects(sendCleaned(late.send, () => false), /empty reply/); // out of time: no retry
  assert.equal(late.calls(), 1);
});
