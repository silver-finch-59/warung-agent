// tools/check.mjs — Uji mandiri Warung Agent (tanpa API berbayar, tanpa jaringan luar).
// Node 22 stdlib saja. Pemakaian: node tools/check.mjs
// Menjalankan server statis lokal (situs + peer lintas origin + mock router BYOK),
// lalu menguji validasi artefak, determinisme router, alur konfirmasi tulis,
// pemuatan peer (satu origin + lintas origin + penolakan), dan BYOK.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgenticRuntime,
  createMemoryStore,
  validateManifest,
  validateNetwork,
} from "../runtime.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
let passes = 0;

function pass(name) {
  passes += 1;
  console.log(`PASS: ${name}`);
}
function fail(name, detail) {
  failures += 1;
  console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
}
function check(name, cond, detail) {
  if (cond) pass(name);
  else fail(name, detail);
}

async function waitReady(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // belum siap
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function startServer(port, root) {
  const child = spawn("node", ["tools/serve.mjs", String(port), root], { cwd: ROOT, stdio: "ignore" });
  return child;
}

// Mock router OpenAI-compatible untuk uji BYOK.
function startMockByok(port) {
  let calls = 0;
  let sawAuth = false;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      calls += 1;
      if (req.headers.authorization === "Bearer test-key-123") sawAuth = true;
      res.writeHead(200, { "Content-Type": "application/json" });
      if (calls === 1) {
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  role: "assistant",
                  tool_calls: [
                    {
                      function: { arguments: JSON.stringify({ items: [{ jumlah: 2, nama: "Mie Instan" }] }), name: "hitung_total" },
                      id: "call_1",
                      type: "function",
                    },
                  ],
                },
              },
            ],
          }),
        );
      } else {
        res.end(JSON.stringify({ choices: [{ message: { content: "Totalnya Rp 7.000.", role: "assistant" } }] }));
      }
    });
  });
  return new Promise((resolveListen) => {
    server.listen(port, "127.0.0.1", () => resolveListen({ calls: () => calls, sawAuth: () => sawAuth, server }));
  });
}

function makeRuntime(overrides = {}) {
  const consentCalls = [];
  const confirmCalls = [];
  const rt = new AgenticRuntime({
    confirm: async (info) => {
      confirmCalls.push(info);
      return overrides.autoConfirm !== false;
    },
    manifestUrl: "http://127.0.0.1:8131/agents/agent-manifest.json",
    onConsent: async (info) => {
      consentCalls.push(info);
      return overrides.autoConsent !== false;
    },
    onTrace: () => {},
    store: createMemoryStore(),
  });
  return { confirmCalls, consentCalls, rt };
}

const serverA = startServer(8131, ".");
const serverB = startServer(8132, "agents-peer");
let mock = null;

try {
  const readyA = await waitReady("http://127.0.0.1:8131/agents/agent-manifest.json");
  const readyB = await waitReady("http://127.0.0.1:8132/agent-manifest.json");
  check("server situs lokal siap", readyA);
  check("server peer lintas origin siap", readyB);
  if (!readyA || !readyB) throw new Error("server uji tidak siap");

  // 1. Artefak termuat lewat HTTP + lolos validasi.
  {
    const manifest = await (await fetch("http://127.0.0.1:8131/agents/agent-manifest.json")).json();
    const network = await (await fetch("http://127.0.0.1:8131/agents/warung.network.json")).json();
    const links = await (await fetch("http://127.0.0.1:8131/agents/links.json")).json();
    check("manifest lewat HTTP sah", validateManifest(manifest).ok);
    check(
      "jaringan lewat HTTP sah",
      validateNetwork(network, {
        actions: manifest.actions.catalog.map((a) => a.name),
        peers: Object.keys(links.networks.warung),
      }).ok,
    );
    const peerManifest = await (await fetch("http://127.0.0.1:8132/agent-manifest.json")).json();
    check("manifest peer lintas origin sah", validateManifest(peerManifest).ok);
  }

  // 2. Runtime init.
  {
    const { rt } = makeRuntime();
    await rt.init();
    check("runtime init berhasil", rt.network.tools.length === 4 && rt.frontAgent === "pelayan");
  }

  // 3. Determinisme router: input sama -> jawaban sama persis (dua runtime baru).
  const CASES = [
    "2 mie instan dan 1 teh botol, bayar 50000",
    "berapa stok gula?",
    "saran promo",
    "laporan hari ini",
    "halo",
    "berapa harga laptop?",
  ];
  for (const input of CASES) {
    const runOnce = async () => {
      const { rt } = makeRuntime();
      await rt.init();
      const res = await rt.ask(input);
      return res.answer;
    };
    const a = await runOnce();
    const b = await runOnce();
    check(`deterministik: "${input}"`, a === b, `berbeda:\nA: ${a}\nB: ${b}`);
  }

  // 4. Keluaran eksak untuk kasus kunci.
  {
    const { rt } = makeRuntime();
    await rt.init();
    const total = await rt.ask("2 mie instan dan 1 teh botol, bayar 50000");
    check(
      "hitung total + kembalian eksak",
      total.answer.includes("Total: Rp 12.000") && total.answer.includes("Kembalian: Rp 38.000"),
      total.answer,
    );
    const stok = await rt.ask("berapa stok gula?");
    check("cek stok eksak", stok.answer.includes("Stok Gula Pasir 1kg: 12"), stok.answer);
    const promo = await rt.ask("saran promo");
    check(
      "saran promo memuat paket",
      promo.answer.includes("Mie Instan + Telur 1kg") && promo.answer.includes("Rp 2.000"),
      promo.answer,
    );
    const laporan = await rt.ask("laporan hari ini");
    check("laporan harian kosong", laporan.answer.includes("Transaksi: 0") && laporan.answer.includes("Omzet: Rp 0"), laporan.answer);
    const bantuan = await rt.ask("halo");
    check("sapaan bantuan umum", bantuan.answer.includes("Saya Pelayan") || bantuan.answer.includes("Pelayan"), bantuan.answer);
    const unknown = await rt.ask("berapa harga laptop?");
    check("barang tak dikenal ditanya ulang", unknown.answer.includes("Barang apa yang mau dihitung?"), unknown.answer);
  }

  // 5. Alur tulis: konfirmasi dulu, baru mutasi.
  {
    const { rt } = makeRuntime();
    await rt.init();
    const catat = await rt.ask("catat 2 mie instan, dibayar 10000");
    check("catat penjualan minta konfirmasi", catat.needsConfirmation?.tool === "catat_penjualan", JSON.stringify(catat.needsConfirmation));
    const before = rt.store.getState().inventory.find((i) => i.nama === "Mie Instan").stok;
    check("stok belum berubah sebelum konfirmasi", before === 60, `stok=${before}`);
    const out = await rt.executeAction("catat_penjualan", catat.needsConfirmation.args, { preApproved: true });
    check("eksekusi setelah konfirmasi ok", out.ok && out.data.sale_id === "JUAL-0001" && out.data.total === 7000 && out.data.kembalian === 3000, JSON.stringify(out));
    const after = rt.store.getState().inventory.find((i) => i.nama === "Mie Instan").stok;
    check("stok berkurang setelah pencatatan", after === 58, `stok=${after}`);
    const laporan = await rt.ask("laporan hari ini");
    check("laporan mencatat transaksi", laporan.answer.includes("Transaksi: 1") && laporan.answer.includes("Omzet: Rp 7.000"), laporan.answer);

    const tambah = await rt.ask("tambah stok beras 5");
    check("tambah stok minta konfirmasi", tambah.needsConfirmation?.tool === "tambah_stok");
    const out2 = await rt.executeAction("tambah_stok", tambah.needsConfirmation.args, { preApproved: true });
    check("tambah stok eksak", out2.ok && out2.data.stok_baru === 25, JSON.stringify(out2));

    const gagal = await rt.ask("catat 100 minyak goreng 1l, dibayar 5000000");
    check("stok tak cukup gagal tertutup", !gagal.needsConfirmation && gagal.answer.includes("Stok tidak cukup"), gagal.answer);
    const kurangBayar = await rt.ask("catat 1 mie instan, dibayar 1000");
    check("uang kurang ditolak", kurangBayar.answer.includes("kurang dari total"), kurangBayar.answer);
  }

  // 6. Peer satu origin (subpath) lewat percakapan.
  {
    const { consentCalls, rt } = makeRuntime();
    await rt.init();
    const res = await rt.ask("harga beli minyak dari pemasok?");
    check(
      "peer satu origin menjawab harga pemasok",
      res.answer.includes("Rp 34.000") && res.answer.includes("Grosir Jaya"),
      res.answer,
    );
    check("peer satu origin tanpa persetujuan pihak ketiga", consentCalls.length === 0, `consentCalls=${consentCalls.length}`);
    check("peer terdaftar", rt.peerRuntimes.has("gudang"));
  }

  // 7. Peer lintas origin: persetujuan diminta, kunci tak bocor, data terbaca.
  {
    const { consentCalls, rt } = makeRuntime();
    await rt.init();
    await rt.loadPeer("http://127.0.0.1:8132/gudang", "uji lintas origin");
    check("persetujuan peer lintas origin diminta", consentCalls.length === 1 && consentCalls[0].origin === "http://127.0.0.1:8132", JSON.stringify(consentCalls));
    const peer = rt.peerRuntimes.get("gudang");
    check("data harga pemasok lintas origin dimuat", peer && Array.isArray(peer.data.barang) && peer.data.barang.length === 10);
    const out = await rt.executeAction("cek_harga_pemasok", { nama: "Kopi Sachet" }, { peerData: peer.data, peerHandlers: peer.handlers, preApproved: true });
    check("aksi peer lintas origin eksak", out.ok && out.data.harga_beli === 1600, JSON.stringify(out));
  }

  // 8. Penolakan persetujuan peer -> gagal tertutup.
  {
    const { rt } = makeRuntime({ autoConsent: false });
    await rt.init();
    let msg = "";
    try {
      await rt.loadPeer("http://127.0.0.1:8132/gudang", "uji tolak");
    } catch (e) {
      msg = e.message;
    }
    check("penolakan peer ditolak dengan jelas", msg.includes("ditolak pengguna"), msg);
  }

  // 9. Penolakan jaringan tak sah.
  {
    const badDup = { metadata: { description: "x" }, tools: [{ function: { description: "d" }, instructions: "i", name: "a", tools: [] }, { function: { description: "d" }, instructions: "i", name: "a", tools: [] }] };
    check("nama agen ganda ditolak", !validateNetwork(badDup).ok);
    const badRef = { metadata: { description: "x" }, tools: [{ function: { description: "d" }, instructions: "i", name: "a", tools: ["tidak_ada"] }] };
    check("referensi tak dikenal ditolak", !validateNetwork(badRef).ok);
    const badCycle = {
      metadata: { description: "x" },
      tools: [
        { function: { description: "d" }, instructions: "i", name: "a", tools: ["b"] },
        { function: { description: "d" }, instructions: "i", name: "b", tools: ["a"] },
      ],
    };
    check("siklus delegasi ditolak", !validateNetwork(badCycle).ok);
    check("profil manifest salah ditolak", !validateManifest({ profile: "lain", networks: [] }).ok);
  }

  // 10. BYOK: mock router, tool-call didispatch, kunci tak masuk jejak.
  {
    mock = await startMockByok(8133);
    const { rt } = makeRuntime();
    await rt.init();
    rt.routerMode = "byok";
    rt.byok = { baseUrl: "http://127.0.0.1:8133", key: "test-key-123", model: "mock-model" };
    const res = await rt.ask("berapa total 2 mie instan?");
    check("BYOK mengembalikan teks setelah tool-call", res.answer === "Totalnya Rp 7.000.", res.answer);
    check("BYOK memanggil router mock", mock.calls() === 2, `calls=${mock.calls()}`);
    check("BYOK mengirim Authorization", mock.sawAuth());
    check("kunci tidak ada di jejak", !JSON.stringify(rt.trace).includes("test-key-123"));

    const rt2 = makeRuntime().rt;
    await rt2.init();
    rt2.routerMode = "byok";
    rt2.byok = { baseUrl: "http://127.0.0.1:8133", key: "", model: "mock-model" };
    let msg = "";
    try {
      await rt2.ask("halo");
    } catch (e) {
      msg = e.message;
    }
    check("BYOK tanpa kunci error jelas", msg.includes("kunci belum diisi"), msg);
  }
} finally {
  serverA.kill();
  serverB.kill();
  if (mock) mock.server.close();
}

console.log(`\n${failures ? `CHECK GAGAL: ${failures} gagal, ${passes} lolos` : `CHECK LOLOS: ${passes} pemeriksaan berhasil`}`);
process.exit(failures ? 1 : 0);
