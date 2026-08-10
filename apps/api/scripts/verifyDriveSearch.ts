/** One-off manual verification for the Drive search + extraction tool - not part of the
 * agent module itself, just confirms the Vercel env vars + Drive API + extraction libs work
 * together before wiring this into the actual LLM tool-use loop. Delete once that's built
 * and has its own test coverage. Run: npx tsx scripts/verifyDriveSearch.ts
 */
import "dotenv/config";
import { listDriveDocuments, searchDriveDocuments, getDriveDocumentContent } from "../src/agent/tools/driveSearch";

async function main() {
  console.log("Listing documents in ZanF_DropBox...");
  const docs = await listDriveDocuments();
  console.log(`Found ${docs.length} document(s):`);
  for (const d of docs) {
    console.log(`  - ${d.name}  (${d.mimeType})  [${d.fileId}]`);
  }

  if (docs.length === 0) {
    console.log("\nNo documents to test extraction against - upload a file to ZanF_DropBox and rerun.");
    return;
  }

  const first = docs[0];
  console.log(`\nExtracting content from first document: ${first.name}`);
  try {
    const content = await getDriveDocumentContent(first.fileId);
    console.log(`Extracted ${content.text.length} chars. First 300:\n${content.text.slice(0, 300)}`);
  } catch (err) {
    console.log(`Extraction failed (expected for unsupported types): ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
