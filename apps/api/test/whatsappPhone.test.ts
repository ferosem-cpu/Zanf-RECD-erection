import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhoneE164, normalizeLid } from "../src/services/whatsappPhone";

test("Indian mobiles normalise to +91 from common formats", () => {
  for (const v of ["9876543210", "98765 43210", "09876543210", "919876543210", "+91 98765-43210", "+919876543210", "0091 9876543210", " (98765) 43210 "]) {
    assert.equal(normalizePhoneE164(v), "+919876543210", v);
  }
});

test("explicit international numbers are kept, ambiguous or invalid ones rejected", () => {
  assert.equal(normalizePhoneE164("+14155550123"), "+14155550123");
  assert.equal(normalizePhoneE164("+971 50 123 4567"), "+971501234567");
  const bad: unknown[] = ["", "   ", "abc", "98765", "1234567890", "5876543210", "+91 12345 67890", "+919876", "14155550123", "+0123456789", "+1234567890123456", "98765x43210", "9876543210 ext 5", null, undefined, 9876543210, "919876543210123"];
  for (const b of bad) assert.equal(normalizePhoneE164(b), null, String(b));
});

test("LID accepts digits with optional @lid suffix only", () => {
  assert.equal(normalizeLid("123456789012345"), "123456789012345");
  assert.equal(normalizeLid("123456789012345@lid"), "123456789012345");
  const bad: unknown[] = ["", "12", "abc123", "123@s.whatsapp.net", null, 12345678];
  for (const b of bad) assert.equal(normalizeLid(b), null);
});
