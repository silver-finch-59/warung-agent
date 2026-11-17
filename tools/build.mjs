// tools/build.mjs — Validasi artefak Warung Agent + salin snapshot deploy ke dist/.
// Node 22 stdlib saja. Pemakaian: node tools/build.mjs
// Keluar non-zero bila ada pemeriksaan yang gagal.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateLinks, validateManifest, validateNetwork } from "../runtime.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const failures = [];
const notes = [];

function fail(msg) {
  failures.push(msg);
  console.error(`FAIL: ${msg}`);
}
function ok(msg) {
  notes.push(msg);
  console.log(`ok: ${msg}`);
}
function readJson(rel) {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
  } catch (e) {
    fail(`${rel} bukan JSON sah: ${e.message}`);
    return null;
  }
}
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// 1. Validasi artefak spesifikasi.
const manifest = readJson("agents/agent-manifest.json");
const network = readJson("agents/warung.network.json");
const links = readJson("agents/links.json");
const peerManifest = readJson("agents-peer/agent-manifest.json");
const peerNetwork = readJson("agents-peer/gudang.network.json");
const peerLinks = readJson("agents-peer/links.json");
const peerData = readJson("agents-peer/harga-pemasok.json");

if (manifest) {
  const c = validateManifest(manifest);
  if (c.ok) ok("agents/agent-manifest.json sah");
  else fail(`agents/agent-manifest.json: ${c.errors.join("; ")}`);
}
if (network && manifest) {
  const actionNames = (manifest.actions?.catalog || []).map((a) => a.name);
  const peerNames = Object.keys((links?.networks?.warung) || {});
  const c = validateNetwork(network, { actions: actionNames, peers: peerNames });
  if (c.ok) ok("agents/warung.network.json sah (referensi + tanpa siklus)");
  else fail(`agents/warung.network.json: ${c.errors.join("; ")}`);
  const front = manifest.networks[0]?.front_man;
  if (front && !network.tools.some((a) => a.name === front)) fail(`front agent ${front} tidak ada di jaringan`);
}
if (links && manifest) {
  const c = validateLinks(links, manifest);
  if (c.ok) ok("agents/links.json sah");
  else fail(`agents/links.json: ${c.errors.join("; ")}`);
}
if (peerManifest) {
  const c = validateManifest(peerManifest);
  if (c.ok) ok("agents-peer/agent-manifest.json sah");
  else fail(`agents-peer/agent-manifest.json: ${c.errors.join("; ")}`);
}
if (peerNetwork && peerManifest) {
  const actionNames = (peerManifest.actions?.catalog || []).map((a) => a.name);
  const c = validateNetwork(peerNetwork, { actions: actionNames, peers: [] });
  if (c.ok) ok("agents-peer/gudang.network.json sah");
  else fail(`agents-peer/gudang.network.json: ${c.errors.join("; ")}`);
  const front = peerManifest.networks[0]?.front_man;
  if (front && !peerNetwork.tools.some((a) => a.name === front)) fail(`front agent peer ${front} tidak ada di jaringan peer`);
}
if (peerLinks && peerManifest) {
  const c = validateLinks(peerLinks, peerManifest);
  if (c.ok) ok("agents-peer/links.json sah");
  else fail(`agents-peer/links.json: ${c.errors.join("; ")}`);
}
if (peerData) {
  if (!Array.isArray(peerData.barang) || peerData.barang.length === 0) {
    fail("agents-peer/harga-pemasok.json: barang harus array tak kosong");
  } else if (peerData.barang.some((b) => typeof b.nama !== "string" || !Number.isInteger(b.harga_beli))) {
    fail("agents-peer/harga-pemasok.json: tiap barang wajib punya nama dan harga_beli bilangan bulat");
  } else {
    ok(`agents-peer/harga-pemasok.json sah (${peerData.barang.length} barang)`);
  }
}

// 2. Konsistensi silang: aksi yang dirujuk jaringan harus ada di katalog manifest.
if (network && manifest) {
  const catalog = new Set((manifest.actions?.catalog || []).map((a) => a.name));
  for (const agent of network.tools) {
    for (const ref of agent.tools) {
      const isAgent = network.tools.some((a) => a.name === ref);
      const isPeer = Object.keys((links?.networks?.warung) || {}).includes(ref);
      const isUrl = /^https?:\/\//.test(ref);
      if (!isAgent && !isPeer && !isUrl && !catalog.has(ref)) {
        fail(`agen ${agent.name} merujuk ${ref} yang bukan agen, aksi katalog, peer, atau URL`);
      }
    }
  }
  ok("semua referensi alat jaringan warung teresolusi");
}
if (peerNetwork && peerManifest) {
  const catalog = new Set((peerManifest.actions?.catalog || []).map((a) => a.name));
  for (const agent of peerNetwork.tools) {
    for (const ref of agent.tools) {
      const isAgent = peerNetwork.tools.some((a) => a.name === ref);
      if (!isAgent && !catalog.has(ref) && !/^https?:\/\//.test(ref)) {
        fail(`agen peer ${agent.name} merujuk ${ref} yang tak teresolusi`);
      }
    }
  }
  ok("semua referensi alat jaringan peer teresolusi");
}

// 3. Pindaian URL eksternal: situs tidak boleh memanggil host luar kecuali
// yang diizinkan (default BYOK + placeholder contoh di HTML).
const ALLOWED_URLS = new Set([
  "https://api.openai.com/v1",
  "https://contoh.id/agents-peer/gudang",
]);
const siteFiles = walk(ROOT).filter(
  (p) => !p.startsWith(join(ROOT, "dist")) && !p.startsWith(join(ROOT, "tools")) && !p.startsWith(join(ROOT, ".git")) && !/\.(md)$/.test(p),
);
const urlRe = /https?:\/\/[^\s"'<>)]+/g;
for (const file of siteFiles) {
  const text = readFileSync(file, "utf8");
  const found = text.match(urlRe) || [];
  for (const u of new Set(found)) {
    if (!ALLOWED_URLS.has(u)) fail(`URL eksternal tak diizinkan di ${file.replace(ROOT + "/", "")}: ${u}`);
  }
}
ok("tidak ada URL eksternal di luar daftar izin");

// 4. Berkas yang dirujuk index.html harus ada.
for (const rel of ["index.html", "styles.css", "runtime.js"]) {
  if (!existsSync(join(ROOT, rel))) fail(`berkas hilang: ${rel}`);
}
ok("index.html, styles.css, runtime.js ada");

// 5. Snapshot deploy ke dist/ (salinan bersih file situs saja).
rmSync(DIST, { force: true, recursive: true });
mkdirSync(DIST, { recursive: true });
for (const rel of ["index.html", "styles.css", "runtime.js"]) {
  copyFileSync(join(ROOT, rel), join(DIST, rel));
}
for (const dir of ["agents", "agents-peer"]) {
  mkdirSync(join(DIST, dir), { recursive: true });
  for (const entry of readdirSync(join(ROOT, dir))) {
    copyFileSync(join(ROOT, dir, entry), join(DIST, dir, entry));
  }
}
writeFileSync(
  join(DIST, "BUILD.json"),
  JSON.stringify({ built_by: "tools/build.mjs", files: walk(DIST).map((p) => p.replace(DIST + "/", "")).sort(), profile: "worldwide-agentic-web-mvp-0.2" }, null, 2) + "\n",
);
ok(`snapshot deploy ditulis ke dist/ (${walk(DIST).length} berkas)`);

console.log(`\n${failures.length ? `BUILD GAGAL: ${failures.length} pemeriksaan gagal` : "BUILD LOLOS: semua pemeriksaan berhasil"}`);
process.exit(failures.length ? 1 : 0);
