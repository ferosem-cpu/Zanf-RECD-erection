import { test } from "node:test";
import assert from "node:assert/strict";
import { stripSpecialTokens, isJunkReply, cleanAssistantResult, sendCleaned, stripToolInternals, sanitizeHistory as sanitizeHistoryFn } from "../src/agent/assistantText";
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

test("stored threads are sanitised on load/replay/save: old <EOS_TOKEN> replies never reach the UI or the model", async () => {
  const { sanitizeHistory, sanitizeAssistantText, EMPTY_REPLY_PLACEHOLDER } = await import("../src/agent/assistantText");
  const stored = [
    { role: "user", content: "how many overdue?" },
    { role: "assistant", content: "<EOS_TOKEN>" },
    { role: "assistant", content: "3 invoices are overdue.<EOS_TOKEN>" },
    { role: "assistant", content: "<|endoftext|>", toolCalls: [{ id: "t1", name: "search_invoices", input: {} }] },
    { role: "tool", toolCallId: "t1", toolName: "search_invoices", content: "{\"note\":\"<EOS_TOKEN> stays in raw tool JSON\"}" },
  ];
  const out = sanitizeHistory<any>(stored);
  assert.deepEqual(out.map((m) => m.content), [
    "how many overdue?", EMPTY_REPLY_PLACEHOLDER, "3 invoices are overdue.", "", stored[4].content,
  ]);
  assert.equal(out[3].toolCalls.length, 1);
  assert.equal(stored[1].content, "<EOS_TOKEN>", "the stored row itself is not rewritten");
  assert.equal(out[0], stored[0], "untouched messages keep their identity");
  assert.deepEqual(sanitizeHistory(null), []);
  assert.equal(sanitizeAssistantText("Hello </s>"), "Hello");
});

test("fix 9: leaked tool names / Source lines are stripped on save", () => {
  const leaked = "9 orders are completed.\n\nSource: search_orders_and_sites (no filters) -> allOrders.completedCount = 9";
  assert.equal(stripToolInternals(leaked), "9 orders are completed.");
  assert.equal(stripToolInternals("Total 5,000\n*Source: `get_payables`*\nDone."), "Total 5,000\nDone.");
  assert.equal(stripToolInternals("Payables are 5,000 (via `get_payables`)."), "Payables are 5,000.");
  assert.equal(stripToolInternals("I checked `search_vendor_bills` for Selvam."), "I checked the app for Selvam.");
  for (const ok of ["Source: Sites page", "File `zanapp_report.pdf` found.", "Status: get well soon"]) {
    assert.equal(stripToolInternals(ok), ok);
  }
  const saved = sanitizeHistoryFn<{ role: string; content: string }>([
    { role: "user", content: "Source: search_orders_and_sites" },
    { role: "assistant", content: leaked },
  ]);
  assert.equal(saved[0].content, "Source: search_orders_and_sites");
  assert.equal(saved[1].content, "9 orders are completed.");
});

test("narration that names internals is removed, real content is kept", () => {
  const leaks = [
    "9 orders are done. This comes from the completedCount field in the the app result.",
    "Open orders: 4. The allOrders.byUpdateStatus field lists the rest.",
    "There are 12 open orders (allOrders.open).",
    "Total outstanding is ₹12,53,514.00. These figures come from the get_receivables tool.",
    "Two invoices are late. I used a search with overdueOnly=true to find them.",
  ];
  const out = leaks.map(stripToolInternals);
  assert.equal(out[0], "9 orders are done.");
  assert.equal(out[1], "Open orders: 4.");
  assert.equal(out[2], "There are 12 open orders.");
  assert.equal(out[3], "Total outstanding is ₹12,53,514.00.");
  assert.equal(out[4], "Two invoices are late.");
  for (const o of out) assert.ok(!/\b(?:the the|field|get_receivables|overdueOnly|allOrders)\b/.test(o));
});

test("doubled words from tool-name substitution are collapsed", () => {
  assert.equal(stripToolInternals("See the `get_payables` page."), "See the app page.");
  assert.equal(stripToolInternals("Check the the report."), "Check the report.");
});

test("document numbers, ALL-CAPS names, amounts, dates and links are untouched", () => {
  const keep = [
    "TXIN0934 for BOSTIK is ₹12,53,514.00 due 2026-10-10.",
    "PO/2026-27/0001 and INV-2026-27-0042 are issued; INTERGLOBE AVIATION owes ₹1,20,00,000.50 (BPCL: ₹0.00).",
    "See [TXIN0934](/sites/abc-123) on app.zanf.org, e.g. the Sites page.",
    "- BOSTIK: Rs 4,50,000\n- BPCL: Rs 2,00,000",
    "| Customer | Amount |\n| BPCL | ₹1,00,000 |",
  ];
  for (const k of keep) assert.equal(stripToolInternals(k), k);
});

test("overdue list lines naming bill, vendor and days survive the internals filter", () => {
  const reply = "There is one overdue vendor bill:\n- TXIN0934 (Platino), 11 days overdue, balance Rs 1,18,000\nTotal overdue: Rs 1,18,000.";
  assert.equal(stripToolInternals(reply), reply);
  assert.equal(stripToolInternals("TXIN0934 (Platino), 11 days"), "TXIN0934 (Platino), 11 days");
});
