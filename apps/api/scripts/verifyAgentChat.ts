import "dotenv/config";

async function main() {
  const loginRes = await fetch("http://localhost:4011/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "ferosem@gmail.com", password: "changeme123" }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.error("Login failed:", loginRes.status, loginData);
    return;
  }
  const token = loginData.token;
  console.log("Logged in OK.\n");

  const chatRes = await fetch("http://localhost:4011/agent/chat-test", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: "What documents do you have access to? List them." }),
  });
  const chatData = await chatRes.json();
  console.log("Chat response status:", chatRes.status);
  console.log("Reply:\n", chatData.reply || chatData.error);
}

main().catch((err) => console.error("FAILED:", err));
