import { google } from "googleapis";

// Separate from lib/googleAuth.ts (which verifies end-user Google Sign-In ID tokens via
// GOOGLE_CLIENT_ID). This client authenticates as the dedicated company Drive account
// (zanfpowersystems@gmail.com) using a long-lived refresh token, so the agent can read
// documents from a shared company folder regardless of who is chatting with it.
//
// Deliberately uses googleapis' own bundled google.auth.OAuth2 (not the top-level
// google-auth-library package) - googleapis does an internal version check on the auth
// client it's handed, and a client built from a different install of google-auth-library
// passes type-checking but silently fails to attach credentials to requests (manifests as
// a 403 "unregistered callers" error with no obvious cause).
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set - Drive document search is not configured on this deployment.`);
  }
  return value;
}

let oauth2Client: InstanceType<typeof google.auth.OAuth2> | undefined;

function getOAuth2Client() {
  if (oauth2Client) return oauth2Client;

  const clientId = requireEnv("GOOGLE_DRIVE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_DRIVE_CLIENT_SECRET");
  const refreshToken = requireEnv("GOOGLE_DRIVE_REFRESH_TOKEN");

  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  oauth2Client = client;
  return client;
}

/** The Drive folder ID documents are searched within (ZanF_DropBox on the company account). */
export function getDriveFolderId(): string {
  return requireEnv("GOOGLE_DRIVE_FOLDER_ID");
}

export function getDriveClient() {
  return google.drive({ version: "v3", auth: getOAuth2Client() });
}
