// One-off script: mints a fresh GOOGLE_DRIVE_REFRESH_TOKEN via the OAuth loopback flow for the
// "zan-app-agent-drive" Desktop client (project MyPersonalAgent). Run from apps/api:
//   node scripts/getDriveRefreshToken.js
// Prints an auth URL - open it, sign in as zanfpowersystems@gmail.com (the Drive account, NOT
// the Cloud Console owner), approve, and this script prints the refresh token once Google
// redirects back to the local server it starts. Not wired into any app code; delete when done.
const http = require("http");
const { URL } = require("url");
const { google } = require("googleapis");
require("dotenv").config();

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;

const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET not set in apps/api/.env");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive.readonly"],
});

console.log("\nOpen this URL and sign in as zanfpowersystems@gmail.com:\n");
console.log(authUrl);
console.log(`\nWaiting for the redirect on ${REDIRECT_URI} ...\n`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.end(`Error: ${error}. Check the terminal.`);
    console.error("OAuth error:", error);
    server.close();
    return;
  }
  if (!code) {
    res.end("No code in request.");
    return;
  }

  res.end("Success - you can close this tab and go back to the terminal.");
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("\nRefresh token:\n");
    console.log(tokens.refresh_token);
    console.log("\nSave this as GOOGLE_DRIVE_REFRESH_TOKEN.\n");
  } catch (err) {
    console.error("Token exchange failed:", err.message);
  } finally {
    server.close();
  }
});

server.listen(PORT);
