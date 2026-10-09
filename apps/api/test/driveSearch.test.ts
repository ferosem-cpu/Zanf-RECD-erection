import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildTextClause, searchTokens, searchDriveDocuments, listDriveDocuments, getFileMetadataWithinFolder, resetFolderTreeCache,
  getFolderTree, FOLDER_TREE_TTL_MS, HIDDEN_FILES_CLAUSE, HIDDEN_FILE_MESSAGE, isHiddenDriveFile, type DriveLike, type DriveFile,
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
          .replace(/mimeType = '([^']+)'/g, (_m, v) => `M(${JSON.stringify(v)})`)
          .replace(/mimeType != '([^']+)'/g, (_m, v) => `!M(${JSON.stringify(v)})`)
          .replace(/trashed = false/g, "T()")
          .replace(/\band\b/g, "&&")
          .replace(/\bor\b/g, "||")
          .replace(/\bnot\b/g, "!");
        const evaluate = new Function("N", "F", "P", "M", "T", `return (${expr});`);
        const matches = files.filter((f) =>
          evaluate(
            (v: string) => (f.name ?? "").toLowerCase().includes(v),
            (v: string) => `${f.name ?? ""} ${f.content ?? ""}`.toLowerCase().includes(v),
            (id: string) => opts.ignoreParents || (f.parents ?? []).includes(id),
            (v: string) => f.mimeType === v,
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

test("list_documents: descendants only, even if Drive returns a file outside the folder tree", async () => {
  const { drive } = fakeDrive(library(), { ignoreParents: true });
  const list = await listDriveDocuments(50, { drive, rootId: ROOT });
  assert.ok(!list.some((r) => r.fileId === "out"));
  assert.ok(list.every((r) => r.folderPath.startsWith("ZanF_DropBox")));
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

test("backups and JSON files are hidden from search_documents, list_documents and get_document_content", async () => {
  const files: FakeFile[] = [
    ...library(),
    { id: "bk1", name: "zanapp-backup-2026-10-08.json", mimeType: "application/json", parents: [ROOT], content: "PCR proforma", modifiedTime: "2026-10-08T00:00:00Z" },
    { id: "bk2", name: "zanapp-backup-2026-10-09.json.gz", mimeType: "application/gzip", parents: ["inv26"], content: "PCR", modifiedTime: "2026-10-09T00:00:00Z" },
    { id: "js1", name: "PCR export.json", mimeType: "text/plain", parents: ["bpcl"], modifiedTime: "2026-10-07T00:00:00Z" },
    { id: "js2", name: "PCR data", mimeType: "application/json", parents: ["bpcl"], modifiedTime: "2026-10-06T00:00:00Z" },
    { id: "db1", name: "PCR_backup_20261001.sql", mimeType: "application/octet-stream", parents: ["bpcl"], modifiedTime: "2026-10-05T00:00:00Z" },
  ];
  const { drive, calls } = fakeDrive(files);
  const hidden = ["bk1", "bk2", "js1", "js2", "db1"];

  const search = await searchDriveDocuments("PCR", 25, { drive, rootId: ROOT });
  assert.deepEqual(search.results.map((r) => r.fileId), ["f3"]);
  assert.ok(calls.some((q) => q.includes(HIDDEN_FILES_CLAUSE) && q.includes("fullText contains")), "server-side filter in the search query");

  const listed = await listDriveDocuments(50, { drive, rootId: ROOT });
  assert.ok(listed.length > 0);
  assert.ok(listed.every((r) => !hidden.includes(r.fileId)));
  assert.ok(calls.some((q) => q.includes(HIDDEN_FILES_CLAUSE) && q.includes("mimeType != 'application/vnd.google-apps.folder'")));

  // Defensive post-filter: even if Drive ignored the clause, nothing hidden comes back.
  resetFolderTreeCache();
  const leaky: DriveLike = { files: { ...drive.files, list: async (p) => ({ data: { files: (await drive.files.list({ ...p, q: String(p.q).replace(` and ${HIDDEN_FILES_CLAUSE}`, "") })).data.files } }) } };
  assert.deepEqual((await searchDriveDocuments("PCR", 25, { drive: leaky, rootId: ROOT })).results.map((r) => r.fileId), ["f3"]);
  assert.ok((await listDriveDocuments(50, { drive: leaky, rootId: ROOT })).every((r) => !hidden.includes(r.fileId)));

  for (const id of hidden) {
    await assert.rejects(getFileMetadataWithinFolder(drive, id, ROOT), (e: Error) => e.message === HIDDEN_FILE_MESSAGE, id);
  }
  assert.equal(isHiddenDriveFile("Backup DG set quotation.pdf", "application/pdf"), false); // a document about backup DG sets stays visible
  assert.equal(isHiddenDriveFile("PCR Report - Hosakote.pdf", "application/pdf"), false);
});
