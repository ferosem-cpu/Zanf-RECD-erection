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
  console.log("Logged in OK.");

  const saveRes = await fetch("http://localhost:4011/agent/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: "TEST - delete me",
      providerType: "openai_compatible",
      apiKey: "test-key-12345",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: "models/gemini-3.5-flash",
      priority: 99,
      isActive: false,
    }),
  });
  const saveData = await saveRes.json();
  console.log("Save response:", saveRes.status, saveData);

  if (saveRes.ok) {
    const delRes = await fetch(`http://localhost:4011/agent/providers/${saveData.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log("Cleanup:", delRes.status);
  }
}

main().catch((err) => console.error("FAILED:", err));
