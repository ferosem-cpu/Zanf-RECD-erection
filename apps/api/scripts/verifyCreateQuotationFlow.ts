import "dotenv/config";

const BASE = "http://localhost:4011";

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "ferosem@gmail.com", password: "changeme123" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${JSON.stringify(data)}`);
  return data.token as string;
}

async function main() {
  const token = await login();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const custRes = await fetch(`${BASE}/customers`, { headers });
  const customers = await custRes.json();
  console.log("Customers:", customers.map((c: { name: string }) => c.name));
  if (!Array.isArray(customers) || customers.length === 0) {
    console.log("No customers exist - test needs at least one. Aborting.");
    return;
  }
  const customerName = customers[0].name;

  const convRes = await fetch(`${BASE}/agent/conversations`, { method: "POST", headers, body: "{}" });
  const conv = await convRes.json();
  console.log("Created conversation:", conv.id);

  const msgRes = await fetch(`${BASE}/agent/conversations/${conv.id}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: `create a quotation for ${customerName}: 2 units of a 62.5 kVA generator RECD retrofit kit at 85000 rupees each, 18% GST`,
    }),
  });
  const msgData = await msgRes.json();
  console.log("\n--- Raw response ---\n", msgRes.status, JSON.stringify(msgData, null, 2));

  const pendingMsg = (msgData.messages ?? []).find((m: { role: string; content?: string }) => {
    if (m.role !== "tool" || !m.content) return false;
    try { return JSON.parse(m.content).status === "pending_confirmation"; } catch { return false; }
  });
  if (!pendingMsg) {
    console.log("\nNo pending action found - stopping here.");
    return;
  }
  const action = JSON.parse(pendingMsg.content);
  console.log("\n--- Pending action ---\n", action);

  const confirmRes = await fetch(`${BASE}/agent/conversations/${conv.id}/actions/${action.actionId}/confirm`, {
    method: "POST",
    headers,
  });
  const confirmData = await confirmRes.json();
  console.log("\n--- Confirm result ---\n", confirmRes.status, confirmData);
}

main().catch((err) => console.error("FAILED:", err));
