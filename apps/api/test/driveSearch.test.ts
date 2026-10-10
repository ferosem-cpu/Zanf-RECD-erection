import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildTextClause, searchTokens, searchDriveDocuments, listDriveDocuments, getFileMetadataWithinFolder, resetFolderTreeCache,
  getFolderTree, FOLDER_TREE_TTL_MS, HIDDEN_FILES_CLAUSE, HIDDEN_FILE_MESSAGE, isHiddenDriveFile, type DriveLike, type DriveFile,
  buildLooseNameClause, stripExtension, findFileIdByName, getDriveDocumentByRef, resetDocContentCache, DOC_MAX_TEXT_CHARS,
  excerptForFocus, AmbiguousDocumentError, EXCERPT_MAX_CHARS,
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
  // Strict matches (every word in name or content) first, then names with SOME of the words:
  // f4 "Old quotation proforma" and the "Zan-F Invoices" folder.
  assert.deepEqual(pi.results.map((r) => r.fileId), ["f1", "f2", "f4", "inv"]);
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
    // Narrow rule: a normal document with "backup" in its name is NOT hidden.
    { id: "db1", name: "PCR_backup_20261001.pdf", mimeType: "application/pdf", parents: ["bpcl"], modifiedTime: "2026-10-05T00:00:00Z" },
  ];
  const { drive, calls } = fakeDrive(files);
  const hidden = ["bk1", "bk2", "js1", "js2"];

  const search = await searchDriveDocuments("PCR", 25, { drive, rootId: ROOT });
  assert.deepEqual(search.results.map((r) => r.fileId), ["db1", "f3"]);
  assert.ok(calls.some((q) => q.includes(HIDDEN_FILES_CLAUSE) && q.includes("fullText contains")), "server-side filter in the search query");

  const listed = await listDriveDocuments(50, { drive, rootId: ROOT });
  assert.ok(listed.length > 0);
  assert.ok(listed.every((r) => !hidden.includes(r.fileId)));
  assert.ok(calls.some((q) => q.includes(HIDDEN_FILES_CLAUSE) && q.includes("mimeType != 'application/vnd.google-apps.folder'")));

  // Defensive post-filter: even if Drive ignored the clause, nothing hidden comes back.
  resetFolderTreeCache();
  const leaky: DriveLike = { files: { ...drive.files, list: async (p) => ({ data: { files: (await drive.files.list({ ...p, q: String(p.q).replace(` and ${HIDDEN_FILES_CLAUSE}`, "") })).data.files } }) } };
  assert.deepEqual((await searchDriveDocuments("PCR", 25, { drive: leaky, rootId: ROOT })).results.map((r) => r.fileId), ["db1", "f3"]);
  assert.ok((await listDriveDocuments(50, { drive: leaky, rootId: ROOT })).every((r) => !hidden.includes(r.fileId)));

  for (const id of hidden) {
    await assert.rejects(getFileMetadataWithinFolder(drive, id, ROOT), (e: Error) => e.message === HIDDEN_FILE_MESSAGE, id);
  }
  assert.equal(isHiddenDriveFile("Backup DG set quotation.pdf", "application/pdf"), false); // a document about backup DG sets stays visible
  assert.equal(isHiddenDriveFile("PCR Report - Hosakote.pdf", "application/pdf"), false);
  assert.equal(isHiddenDriveFile("Site backup plan 2026.pdf", "application/pdf"), false);
  assert.equal(isHiddenDriveFile("PCR_backup_20261001.sql", "application/octet-stream"), false);
  assert.equal(isHiddenDriveFile("zanapp-backup-2026-10-09.json.gz", "application/gzip"), true);
  assert.equal(isHiddenDriveFile("Export.JSON", "text/plain"), true);
  assert.ok(!HIDDEN_FILES_CLAUSE.includes("name contains"), "no server-side name exclusion");
});

const AGSAR = "AgsarPaint_Quote_TTCRN v1.2.pdf";

test("full file name with spaces, dots, underscores and quotes: name + tokens, escaped", () => {
  assert.equal(stripExtension(AGSAR), "AgsarPaint_Quote_TTCRN v1.2");
  assert.deepEqual(searchTokens(AGSAR), ["agsarpaint", "quote", "ttcrn", "v1"]);
  const clause = buildTextClause(AGSAR);
  assert.ok(clause.includes(`name contains '${AGSAR}'`));
  assert.ok(clause.includes("name contains 'AgsarPaint_Quote_TTCRN v1.2'"));
  assert.ok(clause.includes("(name contains 'agsarpaint' and name contains 'quote' and name contains 'ttcrn' and name contains 'v1')"));
  assert.ok(buildTextClause("O'Neil\\quote.pdf").includes("name contains 'O\\'Neil\\\\quote'"));
  assert.equal(buildLooseNameClause("PCR"), null);
  assert.equal(buildLooseNameClause("AgsarPaint warranty"), "(name contains 'agsarpaint' or name contains 'warranty')");
});

test("AgsarPaint_Quote_TTCRN v1.2.pdf at the top level: found by full name, its words, or with topic words added", async () => {
  const files: FakeFile[] = [
    ...library(),
    { id: "agsar", name: AGSAR, mimeType: "application/pdf", parents: [ROOT], modifiedTime: "2026-10-01T00:00:00Z" },
    { id: "q2", name: "Quote_Other.pdf", mimeType: "application/pdf", parents: [ROOT], modifiedTime: "2026-10-02T00:00:00Z" },
  ];
  const { drive } = fakeDrive(files);
  for (const q of [AGSAR, "AgsarPaint_Quote_TTCRN v1.2", "AgsarPaint Quote TTCRN", "agsarpaint", "AgsarPaint warranty", "AgsarPaint quote warranty terms"]) {
    const res = await searchDriveDocuments(q, 25, { drive, rootId: ROOT });
    assert.equal(res.results[0]?.fileId, "agsar", q);
    assert.equal(res.results[0].folderPath, "ZanF_DropBox", q);
  }
  const loose = await searchDriveDocuments("AgsarPaint warranty", 25, { drive, rootId: ROOT });
  assert.match(loose.note ?? "", /SOME of the words/);
});

test("get_document_content accepts a fileId or the exact file name; hidden names never resolve", async () => {
  const files: FakeFile[] = [
    ...library(),
    { id: "agsarPaintFileId123", name: AGSAR, mimeType: "text/plain", parents: [ROOT], modifiedTime: "2026-10-01T00:00:00Z" },
    { id: "bk1", name: "zanapp-backup-2026-10-08.json", mimeType: "application/json", parents: [ROOT] },
  ];
  const base = fakeDrive(files).drive;
  const drive: DriveLike = {
    files: {
      ...base.files,
      get: async (params, options) => (params.alt === "media" ? { data: new TextEncoder().encode("Warranty: 12 months").buffer } : base.files.get(params, options)),
    },
  };
  assert.equal(await findFileIdByName(AGSAR, { drive, rootId: ROOT }), "agsarPaintFileId123");
  assert.equal(await findFileIdByName("agsarpaint_quote_ttcrn v1.2", { drive, rootId: ROOT }), "agsarPaintFileId123");
  const byName = await getDriveDocumentByRef(AGSAR, { drive, rootId: ROOT });
  assert.equal(byName.name, AGSAR);
  assert.match(byName.text, /Warranty: 12 months/);
  assert.equal((await getDriveDocumentByRef("agsarPaintFileId123", { drive, rootId: ROOT })).name, AGSAR);
  // Id-shaped but unknown to Drive (404): retried as a name; a partial name that fits one file reads it.
  assert.equal((await getDriveDocumentByRef("AgsarPaint_Quote_TTCRN", { drive, rootId: ROOT })).name, AGSAR);
  await assert.rejects(findFileIdByName("zanapp-backup-2026-10-08.json", { drive, rootId: ROOT }), (e: Error) => e.message === HIDDEN_FILE_MESSAGE);
  await assert.rejects(findFileIdByName("nothing here.pdf", { drive, rootId: ROOT }), /No document named "nothing here.pdf"/);
});

test("get_document_content: repeat reads within 60 s hit memory; long text is cut with a notice", async () => {
  resetDocContentCache();
  const long = "x".repeat(DOC_MAX_TEXT_CHARS + 500);
  const files: FakeFile[] = [...library(), { id: "longDocFileId123", name: "Long.txt", mimeType: "text/plain", parents: [ROOT] }];
  const base = fakeDrive(files).drive;
  let downloads = 0;
  const drive: DriveLike = {
    files: {
      ...base.files,
      get: async (params, options) => {
        if (params.alt === "media") { downloads++; return { data: new TextEncoder().encode(long).buffer }; }
        return base.files.get(params, options);
      },
    },
  };
  const first = await getDriveDocumentByRef("Long.txt", { drive, rootId: ROOT, cache: true });
  const second = await getDriveDocumentByRef("Long.txt", { drive, rootId: ROOT, cache: true });
  assert.equal(downloads, 1, "second read served from the cache");
  assert.equal(second, first);
  assert.ok(first.text.length < long.length);
  assert.match(first.text, /text cut at 60000 characters/);
  resetDocContentCache();
  await getDriveDocumentByRef("Long.txt", { drive, rootId: ROOT, cache: true });
  assert.equal(downloads, 2);
  await getDriveDocumentByRef("Long.txt", { drive, rootId: ROOT });
  await getDriveDocumentByRef("Long.txt", { drive, rootId: ROOT });
  assert.equal(downloads, 4, "no caching unless asked when a drive is injected");
});

function countingDrive(files: FakeFile[], bodies: Record<string, string>) {
  const base = fakeDrive(files);
  const stats = { downloads: 0, lists: 0, gets: 0 };
  const drive: DriveLike = {
    files: {
      ...base.drive.files,
      list: async (params) => { stats.lists++; return base.drive.files.list(params); },
      get: async (params, options) => {
        if (params.alt === "media") { stats.downloads++; return { data: new TextEncoder().encode(bodies[String(params.fileId)] ?? "").buffer }; }
        stats.gets++;
        return base.drive.files.get(params, options);
      },
    },
  };
  return { drive, stats };
}

test("get_document_content by partial name: ONE tool call resolves and reads (no search_documents round)", async () => {
  resetDocContentCache();
  const files: FakeFile[] = [
    ...library(),
    { id: "agsarPaintFileId123", name: AGSAR, mimeType: "text/plain", parents: [ROOT], modifiedTime: "2026-10-01T00:00:00Z" },
  ];
  const { drive } = countingDrive(files, { agsarPaintFileId123: "Warranty: 12 months from commissioning" });
  assert.equal(await findFileIdByName("AgsarPaint quote", { drive, rootId: ROOT }), "agsarPaintFileId123");
  const doc = await getDriveDocumentByRef("agsarpaint ttcrn", { drive, rootId: ROOT });
  assert.equal(doc.name, AGSAR);
  assert.match(doc.text, /Warranty: 12 months/);
});

test("get_document_content: several partial matches return candidates instead of guessing", async () => {
  const files: FakeFile[] = [
    ...library(),
    { id: "qa1234567890", name: "Vendor_Quote_A.pdf", mimeType: "text/plain", parents: [ROOT], modifiedTime: "2026-10-01T00:00:00Z" },
    { id: "qb1234567890", name: "Vendor_Quote_B.pdf", mimeType: "text/plain", parents: [ROOT], modifiedTime: "2026-10-02T00:00:00Z" },
  ];
  const { drive } = fakeDrive(files);
  await assert.rejects(findFileIdByName("vendor quote", { drive, rootId: ROOT }), (e: unknown) => e instanceof AmbiguousDocumentError && e.candidates.length === 2);
  await assert.rejects(findFileIdByName("zzz nothing", { drive, rootId: ROOT }), /No document named/);
});

test("name and content caches: repeat read skips search and download; an edited file (new modifiedTime) is re-read", async () => {
  resetDocContentCache();
  const file: FakeFile = { id: "cachedDocFile123", name: "Terms.txt", mimeType: "text/plain", parents: [ROOT], modifiedTime: "2026-10-01T00:00:00Z" };
  const { drive, stats } = countingDrive([...library(), file], { cachedDocFile123: "Payment terms: 30 days" });
  const opts = { drive, rootId: ROOT, cache: true };
  await getDriveDocumentByRef("Terms.txt", opts);
  const listsAfterFirst = stats.lists;
  await getDriveDocumentByRef("Terms.txt", opts);
  assert.equal(stats.downloads, 1, "text served from the 10-minute cache");
  assert.equal(stats.lists, listsAfterFirst, "name->id resolution served from cache, no Drive search");
  file.modifiedTime = "2026-10-02T00:00:00Z";
  await getDriveDocumentByRef("Terms.txt", opts);
  assert.equal(stats.downloads, 2, "new modifiedTime = cache miss");
});

test("folder tree is built once for concurrent callers (single flight)", async () => {
  const { drive, stats } = countingDrive(library(), {});
  await Promise.all([getFolderTree(drive, ROOT), getFolderTree(drive, ROOT), getFolderTree(drive, ROOT)]);
  const once = stats.lists;
  await getFolderTree(drive, ROOT);
  assert.equal(stats.lists, once);
  resetFolderTreeCache();
  const { drive: d2, stats: s2 } = countingDrive(library(), {});
  await getFolderTree(d2, ROOT);
  assert.equal(s2.lists, once, "three concurrent callers cost the same as one");
});

test("excerptForFocus: long text with keywords returns head + matching paragraphs, capped; short text untouched", () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `Clause ${i}: general conditions of supply apply here and nothing else.`).join("\n\n");
  const long = `Quotation\n\n${filler(200)}\n\nWarranty: 12 months from commissioning.\n\n${filler(50)}`;
  const out = excerptForFocus(long, "warranty period");
  assert.ok(out.excerpted);
  assert.equal(out.totalChars, long.length);
  assert.ok(out.text.length <= EXCERPT_MAX_CHARS + 400);
  assert.match(out.text, /Warranty: 12 months from commissioning/);
  assert.match(out.text, /^Quotation/);
  assert.equal(excerptForFocus("short text", "warranty").excerpted, false);
  assert.equal(excerptForFocus(long, undefined).excerpted, false);
  assert.ok(excerptForFocus(long, "nomatchword").text.length <= EXCERPT_MAX_CHARS);
});

test("get_document_content tool: focus excerpts, ambiguous names return candidates, schema offers focus", async () => {
  const tool = driveTools.find((t) => t.name === "get_document_content")!;
  assert.ok((tool.inputSchema as any).properties.focus);
  assert.match(tool.description, /call THIS tool directly|call THIS tool\s+directly/);
  assert.match(tool.description, /NOT call search_documents first/);
});
