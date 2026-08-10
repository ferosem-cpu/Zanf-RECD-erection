import "dotenv/config";

async function main() {
  const loginRes = await fetch("http://localhost:4011/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "ferosem@gmail.com", password: "changeme123" }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) return console.error("Login failed:", loginData);
  const token = loginData.token;
  console.log("Logged in.");

  // Set visibility to include super_admin, so the bubble shows for this account.
  const settingsRes = await fetch("http://localhost:4011/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ agentVisibleRoleKeys: ["super_admin"] }),
  });
  console.log("Set visibility:", settingsRes.status, (await settingsRes.json()).agentVisibleRoleKeys);

  // Create a conversation and send a message.
  const createRes = await fetch("http://localhost:4011/agent/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  const conv = await createRes.json();
  console.log("Created conversation:", conv.id);

  const msgRes = await fetch(`http://localhost:4011/agent/conversations/${conv.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: "What documents do you have access to?" }),
  });
  const msgData = await msgRes.json();
  console.log("Reply:", msgRes.status, msgData.reply || msgData.error);

  // List conversations.
  const listRes = await fetch("http://localhost:4011/agent/conversations", {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log("Conversation list:", await listRes.json());

  // Cleanup.
  const delRes = await fetch(`http://localhost:4011/agent/conversations/${conv.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log("Cleanup:", delRes.status);
}

main().catch((err) => console.error("FAILED:", err));
