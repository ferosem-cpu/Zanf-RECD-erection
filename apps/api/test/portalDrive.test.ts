import "./_testEnv";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DriveUnavailableError, dgIndexFromSiteName, ensureDgFolder, ensureSiteFolders, fileUnfiledPhotos, realDriveApi, setDriveApiOverride, uploadDraftPhoto, uploadSitePhoto,
  type DriveApi, type DriveDeps, type PortalDriveDb, type SiteForDrive, type UnfiledPhoto,
} from "../src/lib/portalDrive";
import { deleteFiles, getFile } from "../src/lib/portalStorage";
import { isoDateIST } from "../src/agent/istDates";

// ---- fake Drive: a tree of folders/files (ids are generated), call log, optional failures ----
interface Node { id: string; name: string; parent: string; folder: boolean; bytes?: Buffer }
function fakeDrive() {
  const nodes = new Map<string, Node>(); let n = 0; const calls: string[] = []; let failMove = false; let delay = 0;
  const wait = () => new Promise((r) => setTimeout(r, delay));
  const api: DriveApi = {
    rootFolderId: () => "ROOT",
    async createFolder(name, parent) { calls.push("createFolder:" + name); await wait(); const id = "F" + ++n; nodes.set(id, { id, name, parent, folder: true }); return { id, webViewLink: "https://drive/" + id }; },
    async findFolder(name, parent) { await wait(); const f = [...nodes.values()].find((x) => x.folder && x.name === name && x.parent === parent); return f ? { id: f.id, webViewLink: "https://drive/" + f.id } : null; },
    async upload(name, _m, bytes, parent) { calls.push("upload:" + name); const id = "U" + ++n; nodes.set(id, { id, name, parent, folder: false, bytes }); return { id, webViewLink: "https://drive/" + id }; },
    async move(id, to, name) { calls.push("move:" + id); if (failMove) throw new Error("drive down"); const x = nodes.get(id)!; x.parent = to; if (name) x.name = name; },
    async download(id) { const x = nodes.get(id); if (!x?.bytes) throw new Error("nf"); return x.bytes; },
    async remove(id) { calls.push("remove:" + id); nodes.delete(id); },
  };
  const pathOf = (id: string): string => { const x = nodes.get(id)!; return x.parent === "ROOT" ? x.name : pathOf(x.parent) + "/" + x.name; };
  return { api, nodes, calls, pathOf, setFail: (v: boolean) => { failMove = v; }, setDelay: (d: number) => { delay = d; } };
}
// simple async mutex per key (stands in for the advisory lock)
function lock() { const tails = new Map<string, Promise<unknown>>(); return <T>(key: string, fn: () => Promise<T>): Promise<T> => { const prev = tails.get(key) ?? Promise.resolve(); const run = prev.then(fn, fn); tails.set(key, run.catch(() => undefined)); return run; }; }
function fakeDb(sites: SiteForDrive[], unfiled: UnfiledPhoto[] = []) {
  const saved: Record<string, unknown> = {}; const filed: { id: string; dg: number }[] = [];
  const db: PortalDriveDb = {
    async getSite(id) { return sites.find((s) => s.id === id) ?? null; },
    async saveSiteFolders(id, f) { saved[id] = f; const s = sites.find((x) => x.id === id)!; s.photosDriveFolderId = f.photosId; },
    async listUnfiled() { return unfiled.filter((u) => !filed.some((f) => f.id === u.id)); },
    async countFiled(siteId, dg) { return filed.filter((f) => f.dg === dg && unfiled.find((u) => u.id === f.id)?.siteId === siteId).length + (extraFiled[siteId + ":" + dg] ?? 0); },
    async markFiled(id, dg) { filed.push({ id, dg }); },
  };
  return { db, saved, filed };
}
const extraFiled: Record<string, number> = {};
const NOW = new Date("2026-11-23T10:00:00Z");
const today = isoDateIST(NOW);
const site = (o: Partial<SiteForDrive> = {}): SiteForDrive => ({ id: "s1", companyName: "Mill - DG 2", address: "1 St", customerName: "Acme Ltd", photosDriveFolderId: null, ...o });
const photo = (id: string, driveId: string, o: Partial<UnfiledPhoto> = {}): UnfiledPhoto => ({ id, siteId: "s1", storagePath: "drive:" + driveId, mimeType: "image/jpeg", dgIndex: 2, createdAt: new Date(NOW.getTime() + Number(id.replace(/\D/g, ""))), ...o });
const deps = (d: ReturnType<typeof fakeDrive>, db: PortalDriveDb): DriveDeps => ({ drive: d.api, db, withLock: lock(), now: () => NOW });
beforeEach(() => { setDriveApiOverride(null); for (const k of Object.keys(extraFiled)) delete extraFiled[k]; });

test("draft photos go to ZanF_DropBox/Portal drafts; the folder is created once even for concurrent uploads", async () => {
  const d = fakeDrive(); d.setDelay(5); const { db } = fakeDb([]);
  const shared = deps(d, db); // one lock, like the one database lock all instances share
  const out = await Promise.all([1, 2, 3, 4, 5].map((i) => uploadDraftPhoto(shared, { attachmentId: "att-" + i + "-abcdefghij", bytes: Buffer.from("x" + i), mimeType: "image/jpeg" })));
  assert.equal(d.calls.filter((c) => c === "createFolder:Portal drafts").length, 1);
  assert.equal(out.length, 5);
  for (const f of out) assert.match(d.pathOf(f.id), /^Portal drafts\/draft-att-\d-abcdef\.jpg$/);
});

test("filing creates the site folders exactly like the tracker (Customer - Site, Photographs, Drawings), then DG n, and moves + renames", async () => {
  const d = fakeDrive(); const a = await d.api.upload("draft-a.jpg", "image/jpeg", Buffer.from("a"), "ROOT"), b = await d.api.upload("draft-b.jpg", "image/jpeg", Buffer.from("b"), "ROOT");
  const s = site(); const { db, saved, filed } = fakeDb([s], [photo("p1", a.id), photo("p2", b.id)]);
  const r = await fileUnfiledPhotos(deps(d, db));
  assert.deepEqual(r, { filed: 2, left: 0 });
  assert.equal(d.pathOf(a.id), "Acme Ltd - Mill - DG 2/Photographs/DG 2/" + today + "-1.jpg");
  assert.equal(d.pathOf(b.id), "Acme Ltd - Mill - DG 2/Photographs/DG 2/" + today + "-2.jpg");
  assert.ok([...d.nodes.values()].some((x) => x.folder && x.name === "Drawings" && x.parent === [...d.nodes.values()].find((y) => y.name === "Acme Ltd - Mill - DG 2")!.id));
  assert.ok(saved.s1 && (saved.s1 as { photosId: string }).photosId); // ids/urls persisted on the Site
  assert.deepEqual(filed.map((f) => [f.id, f.dg]), [["p1", 2], ["p2", 2]]);
  // second run: nothing to do, no new folders
  const before = d.calls.length;
  assert.deepEqual(await fileUnfiledPhotos(deps(d, db)), { filed: 0, left: 0 });
  assert.equal(d.calls.length, before);
});

test("a site that already has photosDriveFolderId is reused; an existing DG folder is not duplicated", async () => {
  const d = fakeDrive(); const photos = await d.api.createFolder("Photographs", "ROOT"); const dg = await d.api.createFolder("DG 1", photos.id);
  const up = await d.api.upload("draft.jpg", "image/jpeg", Buffer.from("z"), "ROOT");
  const { db } = fakeDb([site({ companyName: "Mill", photosDriveFolderId: photos.id })], [photo("p1", up.id, { dgIndex: 1 })]);
  d.calls.length = 0;
  await fileUnfiledPhotos(deps(d, db));
  assert.deepEqual(d.calls.filter((c) => c.startsWith("createFolder")), []);
  assert.equal(d.nodes.get(up.id)!.parent, dg.id);
});

test("two filing runs at once create one site folder set and one DG folder", async () => {
  const d = fakeDrive(); d.setDelay(5);
  const u1 = await d.api.upload("d1.jpg", "image/jpeg", Buffer.from("1"), "ROOT"), u2 = await d.api.upload("d2.jpg", "image/jpeg", Buffer.from("2"), "ROOT");
  const { db } = fakeDb([site()], [photo("p1", u1.id), photo("p2", u2.id)]);
  d.calls.length = 0;
  const shared = deps(d, db);
  await Promise.all([fileUnfiledPhotos(shared), fileUnfiledPhotos(shared)]);
  assert.equal(d.calls.filter((c) => c === "createFolder:Acme Ltd - Mill - DG 2").length, 1);
  assert.equal(d.calls.filter((c) => c === "createFolder:Photographs").length, 1);
  assert.equal(d.calls.filter((c) => c === "createFolder:DG 2").length, 1);
});

test("numbering continues after photos already filed; a Drive failure leaves photos unfiled and does not throw", async () => {
  const d = fakeDrive(); const up = await d.api.upload("d.jpg", "image/jpeg", Buffer.from("1"), "ROOT");
  extraFiled["s1:2"] = 3;
  const { db, filed } = fakeDb([site()], [photo("p1", up.id)]);
  await fileUnfiledPhotos(deps(d, db));
  assert.match(d.pathOf(up.id), new RegExp("/" + today + "-4\\.jpg$"));
  const d2 = fakeDrive(); d2.setFail(true); const u2 = await d2.api.upload("d.jpg", "image/jpeg", Buffer.from("1"), "ROOT");
  const f2 = fakeDb([site()], [photo("p1", u2.id)]);
  assert.deepEqual(await fileUnfiledPhotos(deps(d2, f2.db)), { filed: 0, left: 1 });
  assert.equal(f2.filed.length, 0); assert.equal(filed.length, 1);
});

test("the time budget stops filing and leaves the rest for the retry", async () => {
  const d = fakeDrive(); const u1 = await d.api.upload("a.jpg", "image/jpeg", Buffer.from("1"), "ROOT"), u2 = await d.api.upload("b.jpg", "image/jpeg", Buffer.from("2"), "ROOT");
  const { db } = fakeDb([site({ id: "s1" }), site({ id: "s2", companyName: "Other" })], [photo("p1", u1.id), photo("p2", u2.id, { siteId: "s2", dgIndex: 1 })]);
  let t = NOW.getTime(); const dp = { ...deps(d, db), now: () => new Date((t += 40_000)) };
  const r = await fileUnfiledPhotos(dp, { budgetMs: 30_000 });
  assert.ok(r.left >= 1);
});

test("a photo added to an existing site goes straight into its DG folder", async () => {
  const d = fakeDrive(); const { db } = fakeDb([site({ companyName: "Mill - DG 3" })]);
  const f = await uploadSitePhoto(deps(d, db), { siteId: "s1", siteName: "Mill - DG 3", bytes: Buffer.from("x"), mimeType: "image/png" });
  assert.equal(f.dgIndex, 3);
  assert.equal(d.pathOf(f.id), "Acme Ltd - Mill - DG 3/Photographs/DG 3/" + today + "-1.png");
});

test("DG number comes from the site name; single-DG sites are DG 1", () => {
  assert.equal(dgIndexFromSiteName("Mill - DG 12"), 12); assert.equal(dgIndexFromSiteName("Mill"), 1); assert.equal(dgIndexFromSiteName(null), 1); assert.equal(dgIndexFromSiteName("DG 2 Plant"), 1);
});

test("viewing streams from Drive by file id; deleting removes the Drive file; Supabase paths do not need Drive", async () => {
  const d = fakeDrive(); setDriveApiOverride(d.api);
  const up = await d.api.upload("x.jpg", "image/jpeg", Buffer.from("pixels"), "ROOT");
  assert.equal((await getFile("drive:" + up.id)).toString(), "pixels");
  const before = process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  await deleteFiles(["drive:" + up.id, "cust/x.pdf"]); // no Supabase key: the pdf path is a no-op, the Drive file is gone
  if (before) process.env.SUPABASE_SERVICE_ROLE_KEY = before;
  assert.equal(d.nodes.has(up.id), false); assert.ok(d.calls.includes("remove:" + up.id));
});

test("photos never need SUPABASE_SERVICE_ROLE_KEY, and Drive being unconfigured is reported as unavailable", async () => {
  const d = fakeDrive(); const { db } = fakeDb([]);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  await uploadDraftPhoto(deps(d, db), { attachmentId: "att-abcdefghijkl", bytes: Buffer.from("x"), mimeType: "image/jpeg" });
  if (key) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  const saved = { ...process.env }; for (const k of ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN", "GOOGLE_DRIVE_FOLDER_ID"]) delete process.env[k];
  try { assert.throws(() => realDriveApi(), DriveUnavailableError); } finally { process.env = saved; }
});

test("the Drive code never touches sharing or permissions", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "portalDrive.ts"), "utf8");
  const gd = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "googleDrive.ts"), "utf8");
  const portalPart = gd.slice(gd.indexOf("helpers used by the customer portal"));
  for (const s of [src.replace(/never permissions[^\n]*/g, ""), portalPart.replace(/never permissions[^\n]*/g, "")]) assert.doesNotMatch(s, /permissions\.|\.permissions|webContentLink|anyone/i);
  assert.doesNotMatch(src + portalPart, /console\.(log|info|warn|error)/);
});

test("ensureSiteFolders / ensureDgFolder are idempotent", async () => {
  const d = fakeDrive(); const { db } = fakeDb([site()]);
  const p1 = await ensureSiteFolders(deps(d, db), "s1"); const p2 = await ensureSiteFolders(deps(d, db), "s1");
  assert.equal(p1, p2);
  const g1 = await ensureDgFolder(deps(d, db), p1, 1), g2 = await ensureDgFolder(deps(d, db), p1, 1);
  assert.equal(g1.id, g2.id);
});
