// runtime.js — Warung Agent: runtime browser untuk Open Agentic Web Challenge.
// Sesuai Spesifikasi Minimum Worldwide Agentic Web, MVP Profile 0.2 (6 Nov 2026).
// Modul ES vanilla tanpa dependensi. Fungsi murni aman di Node (untuk tools/build.mjs
// dan tools/check.mjs); API browser (fetch, localStorage, performance) hanya dipakai
// di dalam metode dan selalu lewat injeksi atau guard typeof.
// Aturan keras: tanpa Math.random, tanpa Date.now() dalam jalur keputusan — keluaran
// router deterministik untuk input yang sama. Kunci BYOK tidak pernah ditulis ke
// manifest, jaringan, prompt, argumen aksi, jejak, atau permintaan peer.

export const VERSION = "1.0.0";
export const PROFILE = "worldwide-agentic-web-mvp-0.2";

// ---------------------------------------------------------------------------
// Data: inventaris demo warung (harga jual) dan pasangan promo (deterministik)
// ---------------------------------------------------------------------------

export const INVENTORY_SEED = [
  { harga: 4000, margin: 800, nama: "Air Mineral 600ml", stok: 36 },
  { harga: 14500, margin: 2000, nama: "Beras 1kg", stok: 20 },
  { harga: 17500, margin: 2500, nama: "Gula Pasir 1kg", stok: 12 },
  { harga: 2000, margin: 400, nama: "Kopi Sachet", stok: 48 },
  { harga: 3500, margin: 500, nama: "Mie Instan", stok: 60 },
  { harga: 38500, margin: 4500, nama: "Minyak Goreng 1L", stok: 8 },
  { harga: 4500, margin: 700, nama: "Sabun Mandi", stok: 30 },
  { harga: 1000, margin: 200, nama: "Sampo Sachet", stok: 50 },
  { harga: 5000, margin: 800, nama: "Teh Botol", stok: 24 },
  { harga: 28000, margin: 4000, nama: "Telur 1kg", stok: 15 },
];

export const PROMO_PAIRS = [
  { a: "Kopi Sachet", b: "Gula Pasir 1kg", diskon: 1000 },
  { a: "Mie Instan", b: "Telur 1kg", diskon: 2000 },
  { a: "Teh Botol", b: "Mie Instan", diskon: 1000 },
  { a: "Air Mineral 600ml", b: "Kopi Sachet", diskon: 500 },
];

export const LOW_STOCK_AT = 5; // stok di bawah ini dianggap menipis
export const CLEARANCE_STOCK_AT = 40; // stok di atas ini masuk cuci gudang
export const CLEARANCE_DISCOUNT_PCT = 10;

// ---------------------------------------------------------------------------
// Util kecil (deterministik)
// ---------------------------------------------------------------------------

export function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatRupiah(n) {
  const s = String(Math.trunc(Number(n) || 0));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const fromRight = s.length - i;
    out += s[i];
    if (fromRight > 1 && fromRight % 3 === 1) out += ".";
  }
  return "Rp " + out;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function deepCopy(v) {
  return JSON.parse(JSON.stringify(v));
}

function resolveUrl(base, rel) {
  return new URL(rel, base).toString();
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

// Alias kata tunggal -> nama barang resmi (untuk "kopi", "mie", "gula", ...).
const ALIASES = {
  air: "Air Mineral 600ml",
  beras: "Beras 1kg",
  gula: "Gula Pasir 1kg",
  kopi: "Kopi Sachet",
  mie: "Mie Instan",
  minyak: "Minyak Goreng 1L",
  sabun: "Sabun Mandi",
  sampo: "Sampo Sachet",
  teh: "Teh Botol",
  telur: "Telur 1kg",
};

// Cari barang + jumlah dari teks. Mengembalikan [{nama, jumlah}] terurut sesuai
// urutan kemunculan pertama di teks. Tanpa kecocokan -> [].
export function parseItems(text, inventory) {
  const t = norm(text);
  const found = new Map(); // nama -> {nama, jumlah, pos}
  const matchers = [];
  for (const item of inventory) {
    matchers.push({ nama: item.nama, key: norm(item.nama) });
  }
  for (const [alias, nama] of Object.entries(ALIASES)) {
    if (inventory.some((it) => it.nama === nama)) matchers.push({ nama, key: alias });
  }
  for (const m of matchers) {
    const idx = t.indexOf(m.key);
    if (idx === -1) continue;
    if (found.has(m.nama)) continue;
    let qty = null;
    const before = t.slice(0, idx).trim().split(" ").filter(Boolean);
    const beforeNum = before.length ? Number(before[before.length - 1]) : NaN;
    if (Number.isInteger(beforeNum) && beforeNum > 0 && beforeNum <= 10000) qty = beforeNum;
    if (qty === null) {
      const after = t.slice(idx + m.key.length).trim();
      const mm = after.match(/^(?:x|sebanyak)?\s*(\d+)\b/);
      if (mm) qty = Number(mm[1]);
    }
    if (qty === null) qty = 1;
    found.set(m.nama, { jumlah: qty, nama: m.nama, pos: idx });
  }
  return [...found.values()]
    .sort((a, b) => a.pos - b.pos)
    .map(({ jumlah, nama }) => ({ jumlah, nama }));
}

// Ambil angka uang setelah kata bayar/dibayar/uang. "bayar 50.000" -> 50000.
export function parseDibayar(text) {
  const t = norm(text);
  const m = t.match(/(?:dibayar|bayar|uang|bayarnya)\s*(\d[\d.]*)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Validasi JSON Schema (subset kecil yang dipakai skema aksi)
// ---------------------------------------------------------------------------

export function validateArgs(schema, args) {
  const errors = [];
  const check = (sch, val, path) => {
    if (!sch || typeof sch !== "object") return;
    if (sch.type === "object") {
      if (val === null || typeof val !== "object" || Array.isArray(val)) {
        errors.push(`${path || "argumen"} harus objek`);
        return;
      }
      for (const req of sch.required || []) {
        if (!(req in val)) errors.push(`${path || "argumen"} wajib berisi ${req}`);
      }
      for (const [k, sub] of Object.entries(sch.properties || {})) {
        if (k in val) check(sub, val[k], path ? `${path}.${k}` : k);
      }
      if (sch.additionalProperties === false) {
        for (const k of Object.keys(val)) {
          if (!(sch.properties || {}).hasOwnProperty(k)) errors.push(`properti tak dikenal: ${k}`);
        }
      }
    } else if (sch.type === "array") {
      if (!Array.isArray(val)) {
        errors.push(`${path || "argumen"} harus array`);
        return;
      }
      val.forEach((v, i) => check(sch.items || {}, v, `${path}[${i}]`));
      if (typeof sch.minItems === "number" && val.length < sch.minItems) {
        errors.push(`${path || "argumen"} minimal ${sch.minItems} item`);
      }
    } else if (sch.type === "integer") {
      if (!Number.isInteger(val)) errors.push(`${path || "argumen"} harus bilangan bulat`);
      else if (typeof sch.minimum === "number" && val < sch.minimum) {
        errors.push(`${path || "argumen"} minimal ${sch.minimum}`);
      }
    } else if (sch.type === "number") {
      if (typeof val !== "number" || Number.isNaN(val)) errors.push(`${path || "argumen"} harus angka`);
      else if (typeof sch.minimum === "number" && val < sch.minimum) {
        errors.push(`${path || "argumen"} minimal ${sch.minimum}`);
      }
    } else if (sch.type === "string") {
      if (typeof val !== "string") errors.push(`${path || "argumen"} harus teks`);
      else if (Array.isArray(sch.enum) && !sch.enum.includes(val)) {
        errors.push(`${path || "argumen"} harus salah satu dari: ${sch.enum.join(", ")}`);
      }
    }
  };
  check(schema, args, "");
  return { errors, ok: errors.length === 0 };
}

// ---------------------------------------------------------------------------
// Validasi artefak spesifikasi (manifest, jaringan, links)
// ---------------------------------------------------------------------------

export function validateNetwork(def, opts = {}) {
  const errors = [];
  const actions = new Set(opts.actions || []);
  const peers = new Set(opts.peers || []);
  if (!def || typeof def !== "object" || Array.isArray(def)) {
    return { errors: ["definisi jaringan bukan objek"], ok: false };
  }
  if (!def.metadata || typeof def.metadata.description !== "string" || !def.metadata.description) {
    errors.push("metadata.description wajib berupa teks tak kosong");
  }
  if (!Array.isArray(def.tools) || def.tools.length === 0) {
    errors.push("tools harus array tak kosong");
    return { errors, ok: false };
  }
  const names = new Set();
  for (const a of def.tools) {
    if (!a || typeof a.name !== "string" || !a.name) {
      errors.push("agen tanpa nama");
      continue;
    }
    if (names.has(a.name)) errors.push(`nama agen ganda: ${a.name}`);
    names.add(a.name);
    if (!a.function || typeof a.function.description !== "string" || !a.function.description) {
      errors.push(`agen ${a.name}: function.description wajib teks tak kosong`);
    }
    if (typeof a.instructions !== "string" || !a.instructions) {
      errors.push(`agen ${a.name}: instructions wajib teks tak kosong`);
    }
    if (!Array.isArray(a.tools)) errors.push(`agen ${a.name}: tools harus array`);
    if (a.parameters !== undefined && (typeof a.parameters !== "object" || a.parameters === null)) {
      errors.push(`agen ${a.name}: parameters harus objek skema`);
    }
  }
  // Resolusi referensi + deteksi siklus delegasi antar agen lokal.
  const edges = new Map();
  for (const a of def.tools) {
    if (!a || !Array.isArray(a.tools)) continue;
    const localTargets = [];
    for (const ref of a.tools) {
      if (typeof ref !== "string") {
        errors.push(`agen ${a.name}: referensi tools bukan teks`);
        continue;
      }
      if (names.has(ref)) {
        localTargets.push(ref);
      } else if (actions.has(ref) || peers.has(ref)) {
        // referensi sah: aksi situs atau jaringan peer simbolik
      } else if (/^https?:\/\//.test(ref)) {
        // URL jaringan peer absolut — sah menurut spesifikasi
      } else {
        errors.push(`agen ${a.name}: referensi tak dikenal: ${ref}`);
      }
    }
    edges.set(a.name, localTargets);
  }
  const visiting = new Set();
  const done = new Set();
  const visit = (n, trail) => {
    if (done.has(n)) return;
    if (visiting.has(n)) {
      errors.push(`siklus delegasi: ${[...trail, n].join(" -> ")}`);
      return;
    }
    visiting.add(n);
    for (const m of edges.get(n) || []) visit(m, [...trail, n]);
    visiting.delete(n);
    done.add(n);
  };
  for (const n of names) visit(n, []);
  return { errors, ok: errors.length === 0 };
}

export function validateManifest(man) {
  const errors = [];
  if (!man || typeof man !== "object" || Array.isArray(man)) {
    return { errors: ["manifest bukan objek"], ok: false };
  }
  if (man.profile !== PROFILE) errors.push(`profile harus ${PROFILE}`);
  if (!man.site || typeof man.site.name !== "string" || !man.site.name) {
    errors.push("site.name wajib teks tak kosong");
  }
  if (!Array.isArray(man.networks) || man.networks.length === 0) {
    errors.push("networks harus array tak kosong");
  } else {
    for (const n of man.networks) {
      if (typeof n.name !== "string" || !n.name) errors.push("network tanpa nama");
      if (typeof n.front_man !== "string" || !n.front_man) {
        errors.push(`network ${n.name || "?"}: front_man wajib teks`);
      }
      if (typeof n.hocon !== "string" || !n.hocon) {
        errors.push(`network ${n.name || "?"}: hocon wajib teks (path/URL definisi)`);
      }
    }
  }
  if (!man.router || typeof man.router !== "object") errors.push("router wajib objek");
  else {
    if (!man.router.default || typeof man.router.default.type !== "string") {
      errors.push("router.default.type wajib teks");
    }
    if (man.router.byok && typeof man.router.byok.supported !== "boolean") {
      errors.push("router.byok.supported wajib boolean");
    }
  }
  if (!man.peer_policy || typeof man.peer_policy.default !== "string") {
    errors.push("peer_policy.default wajib teks");
  }
  return { errors, ok: errors.length === 0 };
}

export function validateLinks(links, manifest) {
  const errors = [];
  if (!links || typeof links !== "object" || Array.isArray(links)) {
    return { errors: ["links.json bukan objek"], ok: false };
  }
  if (links.version !== 1) errors.push("links.version harus 1");
  if (!links.networks || typeof links.networks !== "object") {
    errors.push("links.networks wajib objek");
    return { errors, ok: false };
  }
  const known = new Set((manifest.networks || []).map((n) => n.name));
  for (const [net, map] of Object.entries(links.networks)) {
    if (!known.has(net)) errors.push(`links merujuk jaringan tak dikenal: ${net}`);
    if (!map || typeof map !== "object") errors.push(`links.${net} wajib objek`);
    else {
      for (const [sym, url] of Object.entries(map)) {
        if (typeof url !== "string" || !url) errors.push(`links.${net}.${sym} wajib URL teks tak kosong`);
      }
    }
  }
  return { errors, ok: errors.length === 0 };
}

// ---------------------------------------------------------------------------
// Store: buku stok + buku penjualan (di memori; opsional persist localStorage)
// ---------------------------------------------------------------------------

export function freshState(seedInventory) {
  return {
    day: todayISO(),
    inventory: deepCopy(seedInventory || INVENTORY_SEED),
    nextSaleId: 1,
    sales: [],
  };
}

export function createMemoryStore(seedInventory) {
  let state = freshState(seedInventory);
  return {
    getState: () => deepCopy(state),
    reset: () => {
      state = freshState(seedInventory);
    },
    save: () => {},
    setState: (next) => {
      state = deepCopy(next);
    },
  };
}

export function createBrowserStore(key, seedInventory) {
  const mem = createMemoryStore(seedInventory);
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.inventory)) mem.setState(parsed);
      }
    } catch {
      // penyimpanan rusak -> mulai dari data demo
    }
  }
  return {
    getState: mem.getState,
    reset: () => {
      mem.reset();
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    },
    save: () => {
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(key, JSON.stringify(mem.getState()));
        } catch {
          // penyimpanan penuh/diblokir: tetap jalan di memori
        }
      }
    },
    setState: mem.setState,
  };
}

// ---------------------------------------------------------------------------
// Aksi situs lokal (grounded capabilities). Handler: (ctx, args, opts) ->
// {ok, data} | {ok:false, error}. opts.dryRun=true menghitung tanpa mutasi.
// ---------------------------------------------------------------------------

function findItem(state, nama) {
  const n = norm(nama);
  return state.inventory.find((it) => norm(it.nama) === n) || null;
}

function computeTotal(state, items) {
  const lines = [];
  let total = 0;
  for (const it of items) {
    const found = findItem(state, it.nama);
    if (!found) return { error: `Barang tidak dikenal: ${it.nama}. Barang yang ada: ${state.inventory.map((x) => x.nama).join(", ")}.` };
    if (!Number.isInteger(it.jumlah) || it.jumlah < 1) {
      return { error: `Jumlah untuk ${it.nama} harus bilangan bulat minimal 1.` };
    }
    const subtotal = found.harga * it.jumlah;
    total += subtotal;
    lines.push({ harga_satuan: found.harga, jumlah: it.jumlah, nama: found.nama, subtotal });
  }
  return { lines, total };
}

export const ACTION_SCHEMAS = {
  catat_penjualan: {
    additionalProperties: false,
    properties: {
      dibayar: { minimum: 0, type: "integer" },
      items: {
        items: {
          additionalProperties: false,
          properties: { jumlah: { minimum: 1, type: "integer" }, nama: { type: "string" } },
          required: ["nama", "jumlah"],
          type: "object",
        },
        minItems: 1,
        type: "array",
      },
    },
    required: ["items", "dibayar"],
    type: "object",
  },
  cek_harga_pemasok: {
    additionalProperties: false,
    properties: { nama: { type: "string" } },
    required: ["nama"],
    type: "object",
  },
  cek_stok: {
    additionalProperties: false,
    properties: { nama: { type: "string" } },
    required: [],
    type: "object",
  },
  hitung_total: {
    additionalProperties: false,
    properties: {
      dibayar: { minimum: 0, type: "integer" },
      items: {
        items: {
          additionalProperties: false,
          properties: { jumlah: { minimum: 1, type: "integer" }, nama: { type: "string" } },
          required: ["nama", "jumlah"],
          type: "object",
        },
        minItems: 1,
        type: "array",
      },
    },
    required: ["items"],
    type: "object",
  },
  kurangi_stok: {
    additionalProperties: false,
    properties: { jumlah: { minimum: 1, type: "integer" }, nama: { type: "string" } },
    required: ["nama", "jumlah"],
    type: "object",
  },
  laporan_harian: { additionalProperties: false, properties: {}, required: [], type: "object" },
  saran_promo: { additionalProperties: false, properties: {}, required: [], type: "object" },
  tambah_stok: {
    additionalProperties: false,
    properties: { jumlah: { minimum: 1, type: "integer" }, nama: { type: "string" } },
    required: ["nama", "jumlah"],
    type: "object",
  },
};

export const ACTION_DEFS = [
  { description: "Menghitung total belanja dari daftar harga resmi warung.", effect: "read", name: "hitung_total" },
  { description: "Mencatat penjualan: mengurangi stok dan menambah buku penjualan harian.", effect: "write", name: "catat_penjualan" },
  { description: "Membaca buku stok warung.", effect: "read", name: "cek_stok" },
  { description: "Menambah jumlah stok sebuah barang.", effect: "write", name: "tambah_stok" },
  { description: "Mengurangi jumlah stok sebuah barang.", effect: "write", name: "kurangi_stok" },
  { description: "Menyarankan paket promo dari stok dan margin yang tercatat.", effect: "read", name: "saran_promo" },
  { description: "Merangkum penjualan hari ini dari buku penjualan.", effect: "read", name: "laporan_harian" },
  { description: "Membaca harga beli grosir sebuah barang dari daftar harga pemasok.", effect: "read", name: "cek_harga_pemasok" },
];

export function actionHandlers(store) {
  const get = () => store.getState();
  const put = (s) => {
    store.setState(s);
    store.save();
  };
  return {
    catat_penjualan(ctx, args, opts = {}) {
      const state = get();
      const computed = computeTotal(state, args.items);
      if (computed.error) return { error: computed.error, ok: false };
      if (args.dibayar < computed.total) {
        return { error: `Uang dibayar (${formatRupiah(args.dibayar)}) kurang dari total (${formatRupiah(computed.total)}).`, ok: false };
      }
      const kurang = [];
      for (const it of args.items) {
        const found = findItem(state, it.nama);
        if (found.stok < it.jumlah) kurang.push(`${found.nama} (sisa ${found.stok}, diminta ${it.jumlah})`);
      }
      if (kurang.length) {
        return { error: `Stok tidak cukup: ${kurang.join("; ")}.`, ok: false };
      }
      const saleId = `JUAL-${String(state.nextSaleId).padStart(4, "0")}`;
      const receipt = {
        dibayar: args.dibayar,
        items: computed.lines,
        kembalian: args.dibayar - computed.total,
        sale_id: saleId,
        total: computed.total,
      };
      if (!opts.dryRun) {
        const next = deepCopy(state);
        for (const it of args.items) {
          const found = next.inventory.find((x) => norm(x.nama) === norm(it.nama));
          found.stok -= it.jumlah;
        }
        next.sales.push({ ...receipt, hari: todayISO() });
        next.nextSaleId += 1;
        put(next);
      }
      return { data: receipt, ok: true };
    },

    cek_harga_pemasok(ctx, args) {
      const data = ctx.peerData;
      if (!data || !Array.isArray(data.barang)) {
        return { error: "Daftar harga pemasok belum dimuat.", ok: false };
      }
      const found = data.barang.find((b) => norm(b.nama) === norm(args.nama));
      if (!found) {
        return { error: `Pemasok tidak menjual ${args.nama}. Barang pemasok: ${data.barang.map((b) => b.nama).join(", ")}.`, ok: false };
      }
      return { data: { harga_beli: found.harga_beli, mata_uang: data.mata_uang || "IDR", nama: found.nama, pemasok: found.pemasok || "Pemasok", satuan: found.satuan || "pcs" }, ok: true };
    },

    cek_stok(ctx, args) {
      const state = get();
      if (args.nama) {
        const found = findItem(state, args.nama);
        if (!found) return { error: `Barang tidak dikenal: ${args.nama}.`, ok: false };
        return { data: { items: [{ harga: found.harga, nama: found.nama, stok: found.stok }] }, ok: true };
      }
      const items = [...state.inventory]
        .sort((a, b) => (a.nama < b.nama ? -1 : a.nama > b.nama ? 1 : 0))
        .map((it) => ({ harga: it.harga, nama: it.nama, stok: it.stok }));
      return { data: { items }, ok: true };
    },

    hitung_total(ctx, args) {
      const state = get();
      const computed = computeTotal(state, args.items);
      if (computed.error) return { error: computed.error, ok: false };
      const out = { lines: computed.lines, total: computed.total };
      if (args.dibayar !== undefined && args.dibayar !== null) {
        if (args.dibayar < computed.total) {
          return { error: `Uang dibayar (${formatRupiah(args.dibayar)}) kurang dari total (${formatRupiah(computed.total)}).`, ok: false };
        }
        out.dibayar = args.dibayar;
        out.kembalian = args.dibayar - computed.total;
      }
      return { data: out, ok: true };
    },

    kurangi_stok(ctx, args, opts = {}) {
      const state = get();
      const found = findItem(state, args.nama);
      if (!found) return { error: `Barang tidak dikenal: ${args.nama}.`, ok: false };
      if (found.stok < args.jumlah) {
        return { error: `Stok ${found.nama} hanya ${found.stok}, tidak bisa dikurangi ${args.jumlah}.`, ok: false };
      }
      if (!opts.dryRun) {
        const next = deepCopy(state);
        next.inventory.find((x) => norm(x.nama) === norm(args.nama)).stok -= args.jumlah;
        put(next);
      }
      return { data: { nama: found.nama, stok_baru: found.stok - args.jumlah }, ok: true };
    },

    laporan_harian() {
      const state = get();
      const hari = todayISO();
      const today = state.sales.filter((s) => s.hari === hari);
      let omzet = 0;
      let barangTerjual = 0;
      for (const s of today) {
        omzet += s.total;
        for (const l of s.items) barangTerjual += l.jumlah;
      }
      const menipis = state.inventory
        .filter((it) => it.stok < LOW_STOCK_AT)
        .sort((a, b) => (a.nama < b.nama ? -1 : a.nama > b.nama ? 1 : 0))
        .map((it) => ({ nama: it.nama, stok: it.stok }));
      return { data: { barang_terjual: barangTerjual, hari, jumlah_transaksi: today.length, omzet, stok_menipis: menipis }, ok: true };
    },

    saran_promo() {
      const state = get();
      const byName = new Map(state.inventory.map((it) => [norm(it.nama), it]));
      const paket = [];
      for (const p of PROMO_PAIRS) {
        const a = byName.get(norm(p.a));
        const b = byName.get(norm(p.b));
        if (!a || !b) continue;
        if (a.stok < 5 || b.stok < 5) continue;
        const normal = a.harga + b.harga;
        paket.push({ diskon: p.diskon, harga_normal: normal, harga_promo: normal - p.diskon, items: [a.nama, b.nama] });
      }
      paket.sort((x, y) => y.diskon - x.diskon || (x.items[0] < y.items[0] ? -1 : 1));
      const cuciGudang = state.inventory
        .filter((it) => it.stok >= CLEARANCE_STOCK_AT)
        .sort((a, b) => (a.nama < b.nama ? -1 : a.nama > b.nama ? 1 : 0))
        .map((it) => ({
          diskon_persen: CLEARANCE_DISCOUNT_PCT,
          harga_normal: it.harga,
          harga_promo: Math.round((it.harga * (100 - CLEARANCE_DISCOUNT_PCT)) / 100),
          nama: it.nama,
          stok: it.stok,
        }));
      return { data: { cuci_gudang: cuciGudang, paket }, ok: true };
    },

    tambah_stok(ctx, args, opts = {}) {
      const state = get();
      const found = findItem(state, args.nama);
      if (!found) return { error: `Barang tidak dikenal: ${args.nama}.`, ok: false };
      if (!opts.dryRun) {
        const next = deepCopy(state);
        next.inventory.find((x) => norm(x.nama) === norm(args.nama)).stok += args.jumlah;
        put(next);
      }
      return { data: { nama: found.nama, stok_baru: found.stok + args.jumlah }, ok: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Klasifikasi maksud deterministik (router lokal bawaan)
// ---------------------------------------------------------------------------

export function classifyIntent(text, inventory, scope = "local") {
  const t = norm(text);
  const has = (...words) => words.some((w) => t.includes(w));
  const items = parseItems(text, inventory);
  const dibayar = parseDibayar(text);

  if (scope === "peer") {
    const first = items[0];
    return {
      agent: "pemasok",
      args: first ? { nama: first.nama } : { nama: "" },
      reason: "tanya harga pemasok",
      tool: "cek_harga_pemasok",
    };
  }

  if (has("pemasok", "supplier", "harga beli", "restok", "kulakan", "grosir")) {
    return { agent: "pelayan", args: { pesan: text }, reason: "restok / harga pemasok (peer)", tool: "peer:gudang" };
  }
  if (has("catat", "terjual", "laku", "jual")) {
    const args = { dibayar: dibayar ?? undefined, items };
    if (dibayar === null) delete args.dibayar;
    return { agent: "kasir", args, reason: "pencatatan penjualan / pembayaran", tool: "catat_penjualan" };
  }
  if (has("tambah stok", "tambahin stok", "tambah barang", "tambahin barang")) {
    const first = items[0];
    return { agent: "stok", args: first ? { jumlah: first.jumlah, nama: first.nama } : { jumlah: 1, nama: "" }, reason: "tambah stok", tool: "tambah_stok" };
  }
  if (has("kurangi stok", "kurangin stok", "kurang stok")) {
    const first = items[0];
    return { agent: "stok", args: first ? { jumlah: first.jumlah, nama: first.nama } : { jumlah: 1, nama: "" }, reason: "kurangi stok", tool: "kurangi_stok" };
  }
  if (has("laporan", "omzet", "penjualan hari ini", "untung")) {
    return { agent: "promo", args: {}, reason: "laporan harian", tool: "laporan_harian" };
  }
  if (has("promo", "paket", "bundel", "bundle", "diskon", "hemat")) {
    return { agent: "promo", args: {}, reason: "saran promo", tool: "saran_promo" };
  }
  if (has("total", "harga", "berapa", "hitung", "bayar")) {
    if (has("stok", "sisa", "tersedia", "masih ada")) {
      return { agent: "stok", args: items[0] ? { nama: items[0].nama } : {}, reason: "cek stok", tool: "cek_stok" };
    }
    const args = { dibayar: dibayar ?? undefined, items };
    if (dibayar === null) delete args.dibayar;
    return { agent: "kasir", args, reason: "hitung total", tool: "hitung_total" };
  }
  if (has("stok", "sisa", "tersedia", "masih ada")) {
    return { agent: "stok", args: items[0] ? { nama: items[0].nama } : {}, reason: "cek stok", tool: "cek_stok" };
  }
  return { agent: "pelayan", args: { pesan: text }, reason: "bantuan umum", tool: null };
}

// ---------------------------------------------------------------------------
// Format jawaban (Bahasa Indonesia, deterministik)
// ---------------------------------------------------------------------------

export function formatAnswer(tool, result) {
  if (!result.ok) return `Maaf, ${result.error}`;
  const d = result.data;
  switch (tool) {
    case "hitung_total": {
      const lines = d.lines.map((l) => `• ${l.jumlah} × ${l.nama} @ ${formatRupiah(l.harga_satuan)} = ${formatRupiah(l.subtotal)}`).join("\n");
      let out = `${lines}\nTotal: ${formatRupiah(d.total)}`;
      if (d.dibayar !== undefined) out += `\nDibayar: ${formatRupiah(d.dibayar)}\nKembalian: ${formatRupiah(d.kembalian)}`;
      return out;
    }
    case "catat_penjualan":
      return `Tercatat: ${d.sale_id} — total ${formatRupiah(d.total)}, dibayar ${formatRupiah(d.dibayar)}, kembalian ${formatRupiah(d.kembalian)}. Stok sudah diperbarui.`;
    case "cek_stok":
      if (d.items.length === 1) {
        const it = d.items[0];
        return `Stok ${it.nama}: ${it.stok} (harga ${formatRupiah(it.harga)}).`;
      }
      return d.items.map((it) => `• ${it.nama}: ${it.stok} — ${formatRupiah(it.harga)}`).join("\n");
    case "tambah_stok":
      return `Stok ${d.nama} sekarang ${d.stok_baru}.`;
    case "kurangi_stok":
      return `Stok ${d.nama} sekarang ${d.stok_baru}.`;
    case "saran_promo": {
      const parts = [];
      if (d.paket.length) {
        parts.push("Paket hemat:");
        for (const p of d.paket) {
          parts.push(`• ${p.items.join(" + ")}: ${formatRupiah(p.harga_normal)} jadi ${formatRupiah(p.harga_promo)} (hemat ${formatRupiah(p.diskon)})`);
        }
      }
      if (d.cuci_gudang.length) {
        parts.push("Cuci gudang (diskon 10%):");
        for (const c of d.cuci_gudang) {
          parts.push(`• ${c.nama} (stok ${c.stok}): ${formatRupiah(c.harga_normal)} jadi ${formatRupiah(c.harga_promo)}`);
        }
      }
      if (!parts.length) return "Belum ada promo yang bisa disarankan dari stok saat ini.";
      return parts.join("\n");
    }
    case "laporan_harian": {
      const lines = [
        `Laporan ${d.hari}:`,
        `• Transaksi: ${d.jumlah_transaksi}`,
        `• Omzet: ${formatRupiah(d.omzet)}`,
        `• Barang terjual: ${d.barang_terjual}`,
      ];
      if (d.stok_menipis.length) {
        lines.push("• Stok menipis:");
        for (const s of d.stok_menipis) lines.push(`  - ${s.nama}: ${s.stok}`);
      } else {
        lines.push("• Tidak ada stok menipis.");
      }
      return lines.join("\n");
    }
    case "cek_harga_pemasok":
      return `Harga beli ${d.nama} di ${d.pemasok}: ${formatRupiah(d.harga_beli)} per ${d.satuan}.`;
    default:
      return JSON.stringify(d);
  }
}

export function helpText(inventory) {
  const names = inventory.map((it) => it.nama).join(", ");
  return [
    "Halo! Saya Pelayan, agen warung ini. Saya bisa membantu:",
    "• Hitung total belanja dan kembalian — contoh: \"2 mie instan dan 1 teh botol, bayar 50000\"",
    "• Cek stok — contoh: \"berapa stok gula?\"",
    "• Catat penjualan — contoh: \"catat 3 kopi sachet, dibayar 10000\"",
    "• Tambah/kurangi stok — contoh: \"tambah stok beras 5\"",
    "• Saran promo dan laporan harian — contoh: \"saran promo\" atau \"laporan hari ini\"",
    "• Cek harga pemasok (jaringan peer, perlu persetujuanmu dulu) — contoh: \"harga beli minyak dari pemasok?\"",
    `Barang yang ada: ${names}.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Klien BYOK OpenAI-compatible (tanpa kunci = error jelas; kunci tak pernah
// keluar dari browser kecuali ke router yang dipilih pengguna)
// ---------------------------------------------------------------------------

export async function callByokChat({ baseUrl, fetchImpl, key, maxRounds = 5, messages, model, onToolCall, tools }) {
  const fetchFn = fetchImpl || fetch;
  const endpoint = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const transcript = [...messages];
  const trace = [];
  for (let round = 0; round < maxRounds; round++) {
    const body = { messages: transcript, model };
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    let res;
    try {
      res = await fetchFn(endpoint, {
        body: JSON.stringify(body),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        method: "POST",
      });
    } catch (e) {
      throw new Error(`Router BYOK tidak bisa dihubungi: ${e.message}`);
    }
    if (!res.ok) {
      let detail = "";
      try {
        const j = await res.json();
        detail = j && j.error && j.error.message ? ` — ${j.error.message}` : "";
      } catch {
        // abaikan
      }
      throw new Error(`Router BYOK menolak permintaan (HTTP ${res.status})${detail}`);
    }
    const json = await res.json();
    const choice = json && json.choices && json.choices[0] && json.choices[0].message;
    if (!choice) throw new Error("Router BYOK mengembalikan jawaban kosong.");
    transcript.push(choice);
    const calls = choice.tool_calls || [];
    if (!calls.length || !onToolCall) {
      return { text: choice.content || "", toolCalls: trace, trace };
    }
    for (const call of calls) {
      const name = call.function && call.function.name;
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        throw new Error(`Argumen tool ${name} bukan JSON yang sah.`);
      }
      trace.push({ args, name });
      const out = await onToolCall(name, args, call.id);
      transcript.push({ content: JSON.stringify(out), role: "tool", tool_call_id: call.id });
    }
  }
  throw new Error("Router BYOK melebihi batas putaran tool-call.");
}

// ---------------------------------------------------------------------------
// Runtime: memuat manifest + jaringan, menjalankan loop agen, memuat peer
// ---------------------------------------------------------------------------

export class AgenticRuntime {
  constructor(opts = {}) {
    this.manifestUrl = opts.manifestUrl;
    this.fetchImpl = opts.fetchImpl || fetch;
    this.store = opts.store || createMemoryStore();
    this.confirm = opts.confirm || (async () => true);
    this.onTrace = opts.onTrace || (() => {});
    this.onConsent = opts.onConsent || (async () => false);
    this.maxDepth = opts.maxDepth || 4;
    this.maxInvocations = opts.maxInvocations || 25;
    this.maxElapsedMs = opts.maxElapsedMs || 30000;
    this.routerMode = opts.routerMode || "local";
    this.byok = opts.byok || null; // {baseUrl, model, key}
    this.trace = [];
    this.invocations = 0;
    this.startedAt = 0;
    this.approvedOrigins = new Set();
    this.peerRuntimes = new Map(); // nama jaringan peer -> {manifest, network, handlers, data}
    this.localHandlers = actionHandlers(this.store);
    this.manifest = null;
    this.network = null;
    this.links = null;
    this.agents = new Map();
  }

  log(kind, text) {
    const step = { kind, n: this.trace.length + 1, text };
    this.trace.push(step);
    this.onTrace(step);
    return step;
  }

  elapsedGuard() {
    if (this.startedAt && typeof performance !== "undefined" && performance.now() - this.startedAt > this.maxElapsedMs) {
      throw new Error("Batas waktu eksekusi terlampaui.");
    }
    if (this.invocations > this.maxInvocations) {
      throw new Error("Batas jumlah pemanggilan terlampaui.");
    }
  }

  async fetchJson(url, purpose) {
    let res;
    try {
      res = await this.fetchImpl(url, { headers: { Accept: "application/json" } });
    } catch (e) {
      throw new Error(`Gagal memuat ${url}: ${e.message}`);
    }
    if (!res.ok) throw new Error(`Gagal memuat ${url}: HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new Error(`Isi ${url} bukan JSON yang sah.`);
    }
  }

  async init() {
    this.log("init", `Memuat manifest: ${this.manifestUrl}`);
    this.manifest = await this.fetchJson(this.manifestUrl, "manifest");
    const mCheck = validateManifest(this.manifest);
    if (!mCheck.ok) throw new Error(`Manifest tidak sah: ${mCheck.errors.join("; ")}`);
    const netEntry = this.manifest.networks[0];
    const netUrl = resolveUrl(this.manifestUrl, netEntry.hocon);
    this.log("init", `Memuat jaringan: ${netUrl}`);
    this.network = await this.fetchJson(netUrl, "network");
    const actionNames = (this.manifest.actions && this.manifest.actions.catalog || []).map((a) => a.name);
    const peerNames = Object.keys((await this.loadLinks()).networks[netEntry.name] || {});
    const nCheck = validateNetwork(this.network, { actions: actionNames, peers: peerNames });
    if (!nCheck.ok) throw new Error(`Jaringan tidak sah: ${nCheck.errors.join("; ")}`);
    if (netEntry.front_man && !this.network.tools.some((a) => a.name === netEntry.front_man)) {
      throw new Error(`Front agent ${netEntry.front_man} tidak ada di jaringan.`);
    }
    for (const a of this.network.tools) this.agents.set(a.name, a);
    this.frontAgent = netEntry.front_man;
    this.log("init", `Jaringan ${netEntry.name} siap: ${this.network.tools.length} agen, front agent ${this.frontAgent}.`);
    return this;
  }

  async loadLinks() {
    if (this.links) return this.links;
    if (this.manifest.links) {
      const url = resolveUrl(this.manifestUrl, this.manifest.links);
      this.links = await this.fetchJson(url, "links");
      const lCheck = validateLinks(this.links, this.manifest);
      if (!lCheck.ok) throw new Error(`links.json tidak sah: ${lCheck.errors.join("; ")}`);
    } else {
      this.links = { networks: {}, version: 1 };
    }
    return this.links;
  }

  peerUrlFor(symbolicName) {
    const netName = this.manifest.networks[0].name;
    const map = (this.links.networks && this.links.networks[netName]) || {};
    const raw = map[symbolicName];
    if (!raw) return null;
    return resolveUrl(this.manifestUrl, raw);
  }

  async loadPeer(peerNetworkUrl, purpose) {
    const origin = originOf(peerNetworkUrl);
    const callerOrigin = originOf(this.manifestUrl);
    if (origin !== callerOrigin && !this.approvedOrigins.has(origin)) {
      this.log("consent", `Meminta persetujuan kontak ke origin pihak ketiga ${origin} (tujuan: ${purpose}). Kunci router tidak akan dikirim ke origin ini.`);
      const ok = await this.onConsent({ origin, purpose, url: peerNetworkUrl });
      if (!ok) {
        this.log("consent", `Pengguna menolak kontak ke ${origin}.`);
        throw new Error(`Kontak ke ${origin} ditolak pengguna.`);
      }
      this.approvedOrigins.add(origin);
      this.log("consent", `Pengguna menyetujui kontak ke ${origin} untuk sesi ini.`);
    } else if (origin === callerOrigin) {
      this.log("peer", `Peer satu origin (${origin}); tidak perlu persetujuan pihak ketiga.`);
    }
    const base = peerNetworkUrl.replace(/\/[^/]*$/, "/");
    const manifestUrl = base + "agent-manifest.json";
    this.log("peer", `Memuat manifest peer: ${manifestUrl}`);
    const manifest = await this.fetchJson(manifestUrl, "peer manifest");
    const mCheck = validateManifest(manifest);
    if (!mCheck.ok) throw new Error(`Manifest peer tidak sah: ${mCheck.errors.join("; ")}`);
    const netName = peerNetworkUrl.split("/").filter(Boolean).pop();
    const entry = manifest.networks.find((n) => n.name === netName);
    if (!entry) throw new Error(`Manifest peer tidak memuat jaringan bernama ${netName}.`);
    const netUrl = resolveUrl(manifestUrl, entry.hocon);
    this.log("peer", `Memuat jaringan peer: ${netUrl}`);
    const network = await this.fetchJson(netUrl, "peer network");
    const actionNames = (manifest.actions && manifest.actions.catalog || []).map((a) => a.name);
    const nCheck = validateNetwork(network, { actions: actionNames, peers: [] });
    if (!nCheck.ok) throw new Error(`Jaringan peer tidak sah: ${nCheck.errors.join("; ")}`);
    if (!network.tools.some((a) => a.name === entry.front_man)) {
      throw new Error(`Front agent peer ${entry.front_man} tidak ada di jaringan peer.`);
    }
    // Muat data pendukung aksi peer (data-backed read action), bila dideklarasikan.
    let peerData = null;
    const dataAction = (manifest.actions && manifest.actions.catalog || []).find((a) => a.data);
    if (dataAction) {
      const dataUrl = resolveUrl(manifestUrl, dataAction.data);
      this.log("peer", `Memuat data peer: ${dataUrl}`);
      peerData = await this.fetchJson(dataUrl, "peer data");
    }
    const handlers = actionHandlers(this.store);
    this.peerRuntimes.set(entry.name, { data: peerData, handlers, manifest, network });
    this.log("peer", `Jaringan peer ${entry.name} dimuat dan berjalan di browser ini.`);
    return { manifest, network };
  }

  // Jalankan satu aksi situs (lokal atau peer) dengan validasi skema + konfirmasi tulis.
  async executeAction(name, args, opts = {}) {
    this.invocations += 1;
    this.elapsedGuard();
    const schema = ACTION_SCHEMAS[name];
    if (!schema) return { error: `Aksi tak dikenal: ${name}.`, ok: false };
    const v = validateArgs(schema, args);
    if (!v.ok) return { error: `Argumen ${name} tidak sah: ${v.errors.join("; ")}`, ok: false };
    const def = ACTION_DEFS.find((a) => a.name === name);
    const ctx = { peerData: opts.peerData || null };
    const handlers = opts.peerHandlers || this.localHandlers;
    const handler = handlers[name];
    if (!handler) return { error: `Aksi ${name} tidak terdaftar di runtime ini.`, ok: false };
    if (def && def.effect === "write" && !opts.preApproved) {
      const preview = handler(ctx, args, { dryRun: true });
      return { data: preview.ok ? preview.data : null, error: preview.error, needsConfirmation: true, ok: preview.ok, preview: true };
    }
    this.log("action", `Menjalankan aksi ${name} (${def ? def.effect : "?"})`);
    const out = handler(ctx, args, {});
    if (!out.ok) this.log("error", `Aksi ${name} gagal: ${out.error}`);
    return out;
  }

  // Satu giliran dengan router lokal deterministik.
  async askLocal(text) {
    this.startedAt = typeof performance !== "undefined" ? performance.now() : 0;
    this.invocations = 0;
    const state = this.store.getState();
    const plan = classifyIntent(text, state.inventory, "local");
    this.log("intent", `Maksud: ${plan.reason} -> agen ${plan.agent}${plan.tool ? `, alat ${plan.tool}` : ""}`);
    if (!plan.tool) {
      this.log("result", "Menjawab bantuan umum.");
      return { answer: helpText(state.inventory), tool: null, trace: this.trace };
    }
    if (plan.tool === "peer:gudang") {
      const url = this.peerUrlFor("gudang");
      if (!url) return { answer: "Maaf, tautan jaringan pemasok belum dikonfigurasi di links.json.", tool: plan.tool, trace: this.trace };
      try {
        await this.loadPeer(url, "cek harga beli grosir dari pemasok");
      } catch (e) {
        return { answer: `Maaf, ${e.message}`, tool: plan.tool, trace: this.trace };
      }
      const peer = this.peerRuntimes.get("gudang");
      const peerPlan = classifyIntent(text, (peer.data && peer.data.barang || []).map((b) => ({ harga: b.harga_beli, nama: b.nama, stok: 0 })), "peer");
      this.log("delegate", `Peer gudang -> agen ${peerPlan.agent}, alat ${peerPlan.tool}`);
      const out = await this.executeAction(peerPlan.tool, peerPlan.args, { peerData: peer.data, peerHandlers: peer.handlers, preApproved: true });
      if (out.needsConfirmation) {
        return { answer: formatAnswer(peerPlan.tool, out), tool: peerPlan.tool, trace: this.trace };
      }
      return { answer: formatAnswer(peerPlan.tool, out), tool: peerPlan.tool, trace: this.trace };
    }
    // Alat lokal: agen yang memilikinya harus terdaftar di jaringan.
    const agent = this.agents.get(plan.agent);
    if (!agent || !agent.tools.includes(plan.tool)) {
      return { answer: `Maaf, agen ${plan.agent} tidak boleh memakai alat ${plan.tool}.`, tool: plan.tool, trace: this.trace };
    }
    this.log("delegate", `${this.frontAgent} -> ${plan.agent} -> ${plan.tool}`);
    if (plan.tool === "catat_penjualan" && (plan.args.items || []).length === 0) {
      return { answer: "Barang apa yang terjual? Sebutkan nama dan jumlahnya, contoh: \"catat 2 mie instan, dibayar 10000\".", tool: plan.tool, trace: this.trace };
    }
    if (plan.tool === "catat_penjualan" && (plan.args.dibayar === undefined || plan.args.dibayar === null)) {
      return { answer: "Uang bayarnya berapa? Contoh: \"catat 2 mie instan, dibayar 10000\".", tool: plan.tool, trace: this.trace };
    }
    if (plan.tool === "hitung_total" && (plan.args.items || []).length === 0) {
      return { answer: `Barang apa yang mau dihitung? Barang yang ada: ${state.inventory.map((it) => it.nama).join(", ")}.`, tool: plan.tool, trace: this.trace };
    }
    const out = await this.executeAction(plan.tool, plan.args, {});
    if (out.needsConfirmation) {
      const pending = out.ok
        ? `Perlu konfirmasi sebelum dilanjutkan:\n${formatAnswer(plan.tool, out)}\n\nTekan Konfirmasi untuk menjalankan, atau Batal untuk membatalkan.`
        : `Tidak bisa dilanjutkan: ${out.error}`;
      return { answer: pending, needsConfirmation: out.ok ? { args: plan.args, tool: plan.tool } : null, tool: plan.tool, trace: this.trace };
    }
    return { answer: formatAnswer(plan.tool, out), tool: plan.tool, trace: this.trace };
  }

  // Satu giliran dengan router BYOK OpenAI-compatible.
  async askByok(text) {
    if (!this.byok || !this.byok.key) {
      throw new Error("BYOK aktif tapi kunci belum diisi. Isi kunci router di panel Router & BYOK.");
    }
    this.startedAt = typeof performance !== "undefined" ? performance.now() : 0;
    this.invocations = 0;
    const state = this.store.getState();
    const agentList = this.network.tools
      .map((a) => `- ${a.name}: ${a.function.description}`)
      .join("\n");
    const system = [
      `Kamu adalah ${this.frontAgent}, agen depan Warung Agent (warung/toko kelontong, Bahasa Indonesia).`,
      "Agen yang tersedia:",
      agentList,
      "Aturan: semua harga dan stok HANYA dari aksi situs yang terdaftar; jangan mengarang angka. Aksi tulis (catat_penjualan, tambah_stok, kurangi_stok) wajib dikonfirmasi pengguna — runtime akan memintanya. Jawab dalam Bahasa Indonesia, singkat.",
      `Barang yang ada: ${state.inventory.map((it) => `${it.nama} ${formatRupiah(it.harga)} (stok ${it.stok})`).join("; ")}.`,
    ].join("\n");
    const tools = ACTION_DEFS.filter((a) => a.name !== "cek_harga_pemasok").map((a) => ({
      function: { description: a.description, name: a.name, parameters: ACTION_SCHEMAS[a.name] },
      type: "function",
    }));
    const result = await callByokChat({
      baseUrl: this.byok.baseUrl,
      fetchImpl: this.fetchImpl,
      key: this.byok.key,
      messages: [
        { content: system, role: "system" },
        { content: text, role: "user" },
      ],
      model: this.byok.model,
      tools,
      onToolCall: async (name, args) => {
        this.invocations += 1;
        this.elapsedGuard();
        const def = ACTION_DEFS.find((a) => a.name === name);
        if (def && def.effect === "write") {
          const approved = await this.confirm({ action: name, args, origin: "local", summary: `Aksi tulis ${name} dengan argumen ${JSON.stringify(args)}` });
          if (!approved) return { error: "Pengguna menolak aksi tulis.", ok: false };
          const out = await this.executeAction(name, args, { preApproved: true });
          return out;
        }
        return this.executeAction(name, args, { preApproved: true });
      },
    });
    this.log("result", "Jawaban BYOK selesai.");
    return { answer: result.text || "(router tidak mengembalikan teks)", tool: "byok", trace: this.trace };
  }

  async ask(text) {
    this.trace = [];
    if (this.routerMode === "byok") return this.askByok(text);
    return this.askLocal(text);
  }
}
