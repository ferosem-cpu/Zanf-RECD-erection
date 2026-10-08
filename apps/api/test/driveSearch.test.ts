import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildTextClause, searchTokens, searchDriveDocuments, listDriveDocuments, getFileMetadataWithinFolder, resetFolderTreeCache,
  getFolderTree, FOLDER_TREE_TTL_MS, type DriveLike, type DriveFile,
} from "../src/agent/tools/driveSearch";
import { driveTools } from "../src/agent/tools/driveTool";

const FOLDER = "application/vnd.google-apps.folder";
type FakeFile = DriveFile & { content?: string };

/** In-memory Drive: evaluates the q string (and/or/parens, name/fullText contains, in parents,
 * mimeType =/!=, trashed) so the real query builder is exercised. Never touches the network. */
function fakeDrive(files: FakeFile[], opts: { ignoreParents?: boolean } = {}) {
  const calls: string[] = [];
  const drive: DriveLike = {
    files: {
      async list(params) {
        const q = String(params.q);
        calls.push(q);
        const expr = q
          .replace(/(name|fullText) contains '((?:[^'\\]|\\.)*)'/g, (_m, field, v) => `${field === "name" ? "N" : "F"}(${JSON.stringify(v.replace(/\\(.)/g, "$1").toLowerCase())})`)
          .replace(/'((?:[^'\\]|\\.)*)' in parents/g, (_m, id) => `P(${JSON.stringify(id)})`)
          .replace(/mimeType = '[^']+'/g, "M()")
          .replace(/mimeType != '[^']+'/g, "!M()")
          .replace(/trashed = false/g, "T()")
          .replace(/\band\b/g, "&&")
          .replace(/\bor\b/g, "||");
        const evaluate = new Function("N", "F", "P", "M", "T", `return (${expr});`);
        const matches = files.filter((f) =>
          evaluate(
            (v: string) => (f.name ?? "").toLowerCase().includes(v),
            (v: string) => `${f.name ?? ""} ${f.content ?? ""}`.toLowerCase().includes(v),
            (id: string) => opts.ignoreParents || (f.parents ?? []).includes(id),
            () => f.mimeType === FOLDER,
            () => !f.trashed,
          ),
        );
        const start = params.pageToken ? Number(params.pageToken) : 0;
        const size = Number(params.pageSize ?? 100);
        const page = matches.slice(start, start + size);
        return { data: { files: page, nextPageToken: start + size < matches.length ? String(start + size) : null } };
      },
      async get(params) {
        const f = files.find((x) => x.id === params.fileId);
        if (!f) throw new Error("not found");
        return { data: f };
      },
      async export() {
        return { data: new ArrayBuffer(0) };
      },
    },
  };
  return { drive, calls };
}

const ROOT = "root";
function library(): FakeFile[] {
  return [
    { id: ROOT, name: "ZanF_DropBox", mimeType: FOLDER, parents: ["myDrive"] },
    { id: "inv", name: "Zan-F Invoices", mimeType: FOLDER, parents: [ROOT] },
    { id: "inv26", name: "2026-27", mimeType: FOLDER, parents: ["inv"] },
    { id: "sites", name: "Sites", mimeType: FOLDER, parents: [ROOT] },
    { id: "bpcl", name: "BPCL Hosakote", mimeType: FOLDER, parents: ["sites"] },
    { id: "f1", name: "Proforma_Invoice_ELCOT.pdf", mimeType: "application/pdf", parents: ["inv26"], modifiedTime: "2026-09-01T00:00:00Z" },
    { id: "f2", name: "PI-0042.pdf", mimeType: "application/pdf", parents: ["inv26"], content: "PROFORMA INVOICE for RECD-500", modifiedTime: "2026-09-20T00:00:00Z" },
    { id: "f3", name: "PCR Report - Hosakote.pdf", mimeType: "application/pdf", parents: ["bpcl"], modifiedTime: "2026-08-01T00:00:00Z" },
    { id: "f4", name: "Old quotation proforma.docx", mimeType: "application/msword", parents: [ROOT], modifiedTime: "2025-01-01T00:00:00Z" },
    { id: "out", name: "PCR outside.pdf", mimeType: "application/pdf", parents: ["elsewhere"], modifiedTime: "2026-10-01T00:00:00Z" },
    { id: "trash", name: "PCR deleted.pdf", mimeType: "application/pdf", parents: [ROOT], trashed: true },
  ];
}

beforeEach(() => resetFolderTreeCache());

test("text clause: phrase or every word, in names or content, quotes escaped", () => {
  assert.deepEqual(searchTokens("Proforma invoice, PCR"), ["proforma", "invoice", "pcr"]);
  const clause = buildTextClause("proforma invoice");
  assert.match(clause, /name contains 'proforma invoice'/);
  assert.match(clause, /fullText contains 'proforma invoice'/);
  assert.match(clause, /\(name contains 'proforma' and name contains 'invoice'\)/);
  assert.match(buildTextClause("O'Neil"), /name contains 'O\\'Neil'/);
});

test("finds files in nested subfolders (not just direct children) with folder path; skips trash", async () => {
  const { drive } = fakeDrive(library());
  const pcr = await searchDriveDocuments("PCR", 25, { drive, rootId: ROOT });
  assert.deepEqual(pcr.results.map((r) => r.fileId), ["f3"]);
  assert.equal(pcr.results[0].folderPath, "ZanF_DropBox / Sites / BPCL Hosakote");
  assert.equal(pcr.searchedFolders, 5);

  const pi = await searchDriveDocuments("proforma invoice", 25, { drive, rootId: ROOT });
  assert.deepEqual(pi.results.map((r) => r.fileId).sort(), ["f1", "f2"]);
  assert.equal(pi.results[0].fileId, "f1"); // every word in the name ranks first
  assert.equal(pi.results.find((r) => r.fileId === "f2")!.folderPath, "ZanF_DropBox / Zan-F Invoices / 2026-27");
});

test("descendants only: a match outside the folder tree is dropped even if Drive returns it", async () => {
  const { drive } = fakeDrive(library(), { ignoreParents: true });
  const res = await searchDriveDocuments("PCR", 25, { drive, rootId: ROOT });
  assert.ok(!res.results.some((r) => r.fileId === "out"));
  await assert.rejects(getFileMetadataWithinFolder(drive, "out", ROOT), /outside the configured folder/);
  await assert.rejects(getFileMetadataWithinFolder(drive, ROOT, ROOT), /Could not resolve/);
  const ok = await getFileMetadataWithinFolder(fakeDrive(library()).drive, "f3", ROOT);
  assert.equal(ok.folderPath, "ZanF_DropBox / Sites / BPCL Hosakote");
});

test("a folder created after the tree was cached is picked up by one forced rebuild", async () => {
  const files = library();
  const { drive } = fakeDrive(files);
  await getFolderTree(drive, ROOT);
  files.push({ id: "newf", name: "New", mimeType: FOLDER, parents: [ROOT] }, { id: "f9", name: "late.pdf", mimeType: "application/pdf", parents: ["newf"] });
  const meta = await getFileMetadataWithinFolder(drive, "f9", ROOT);
  assert.equal(meta.folderPath, "ZanF_DropBox / New");
});

test("pages through every result, caps the list and caches the folder tree", async () => {
  const files = library();
  for (let i = 0; i < 230; i++) files.push({ id: `p${i}`, name: `PCR ${i}.pdf`, mimeType: "application/pdf", parents: ["bpcl"], modifiedTime: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z` });
  const { drive, calls } = fakeDrive(files);
  const res = await searchDriveDocuments("PCR", 25, { drive, rootId: ROOT });
  assert.equal(res.totalMatches, 231);
  assert.equal(res.results.length, 25);
  const folderQueries = calls.filter((q) => q.startsWith("mimeType = ")).length;
  await searchDriveDocuments("invoice", 25, { drive, rootId: ROOT });
  assert.equal(calls.filter((q) => q.startsWith("mimeType = ")).length, folderQueries); // tree reused
  const later = await getFolderTree(drive, ROOT, { now: Date.now() + FOLDER_TREE_TTL_MS + 1 });
  assert.equal(later.folders.size, 5);
});

test("list_documents covers subfolders, newest first, folders excluded", async () => {
  const { drive } = fakeDrive(library());
  const list = await listDriveDocuments(50, { drive, rootId: ROOT });
  assert.deepEqual(list.map((r) => r.fileId), ["f2", "f1", "f3", "f4"]);
});

test("empty result explains scope; customers are refused every Drive tool", async () => {
  const { drive } = fakeDrive(library());
  const none = await searchDriveDocuments("nonexistent", 25, { drive, rootId: ROOT });
  assert.match(none.note!, /outside that folder tree are not visible/);
  const customer = { userId: "c", roleKey: "customer", customerId: "cust1", permissions: new Set<string>() };
  for (const tool of driveTools) {
    assert.match((await tool.handler({ query: "PCR", fileId: "f3" }, customer) as any).error, /permission/);
  }
});
