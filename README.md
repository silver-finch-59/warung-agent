# Warung Agent — Open Agentic Web Challenge (Devpost)

Situs agen terbuka untuk warung / toko kelontong: jaringan agen yang berjalan di
browser, sesuai **Spesifikasi Minimum Worldwide Agentic Web, MVP Profile 0.2**
(Cognizant AI Lab, 6 Nov 2026).

## Kompetisi

- **Platform:** Devpost — https://cognizant-agenticweb.devpost.com/
- **Kompetisi:** Open Agentic Web Challenge (host: Cognizant; kontribusi teknologi:
  Cognizant AI Lab, MIT Media Lab NANDA, Mozilla Otari, AWS)
- **Hadiah:** $10.000 tunai di halaman Devpost (juara 1 $5.000, juara 2 $3.000,
  juara 3 $2.000) + kredit Mozilla Otari; siaran pers menyebut dana hadiah
  $13.000 (termasuk hadiah karyawan $250 + kredit).
- **Deadline submit:** **11 Januari 2027, 16:00 UTC** (23:00 WIB) — 55 hari dari
  17 Nov 2026.
- **Biaya masuk:** gratis (tidak ada biaya / kripto untuk masuk).
- **Solo:** boleh (agregator aihackathon.app mencatat "Solo OK"; konfirmasi akhir
  di halaman rules resmi sebelum submit — lihat NOTES.md).
- **Penilaian:** juri, 4 kriteria — Technological Implementation, Design,
  Potential Impact, Quality of the Idea. Bukan vote sosial.
- **Wajib open source.** Video demo < 2 menit harus menampilkan Entrant yang
  menjelaskan proyek (bukan AI-generated) — jadi video harus direkam Zani sendiri.

## Yang dibangun

Situs statis tanpa dependensi (HTML/CSS/JavaScript vanilla, nol panggilan
jaringan kecuali router BYOK dan peer yang disetujui pengguna):

| Berkas | Isi |
|---|---|
| `index.html` | UI: chat agen, grafik jaringan, buku stok, panel Router & BYOK, panel peer, jejak eksekusi, panel kesesuaian |
| `styles.css` | Gaya situs (tanpa aset eksternal) |
| `runtime.js` | Runtime browser: validasi jaringan, router lokal deterministik, loop agen, aksi situs, pemuat peer + persetujuan, klien BYOK OpenAI-compatible |
| `agents/agent-manifest.json` | Manifest situs: jaringan `warung`, router default lokal + BYOK, kebijakan peer |
| `agents/warung.network.json` | Jaringan agen: `pelayan` (depan) → `kasir`, `stok`, `promo`; rujukan peer `gudang` |
| `agents/links.json` | Peta tautan peer: `warung.gudang` → `../agents-peer/gudang` |
| `agents-peer/agent-manifest.json` | Manifest peer: jaringan `gudang` |
| `agents-peer/gudang.network.json` | Jaringan peer: `gudang` (depan) → `pemasok` → aksi `cek_harga_pemasok` |
| `agents-peer/harga-pemasok.json` | Daftar harga beli grosir (data publik untuk aksi peer) |
| `tools/build.mjs` | Validasi artefak + snapshot deploy `dist/` |
| `tools/check.mjs` | Uji mandiri: 43 pemeriksaan (lihat bawah) |
| `tools/serve.mjs` | Server statis lokal untuk uji coba |

### Ide

Warung adalah masalah nyata untuk audiens nyata (jutaan warung di Indonesia),
bukan turunan contoh "local services guide" di spesifikasi. Agen `pelayan`
mendelegasikan ke `kasir` (hitung total/kembalian, catat penjualan),
`stok` (cek/tambah/kurangi stok), dan `promo` (saran paket + laporan harian).
Semua angka berasal dari aksi situs lokal yang deterministik — agen tidak
pernah mengarang harga atau stok. Jaringan peer `gudang` (pemasok grosir)
didemonstrasikan lewat pemuatan lintas origin dengan persetujuan pengguna.

### Router

- **Bawaan: router lokal deterministik** — klasifikasi maksud berbasis aturan
  (Bahasa Indonesia), tanpa panggilan jaringan dan tanpa kunci. Input yang sama
  selalu menghasilkan keluaran yang sama.
- **BYOK (opsional):** pengguna bisa menyambungkan router OpenAI-compatible
  miliknya sendiri. Kunci hanya tersimpan di browser pengguna (localStorage)
  dan hanya dikirim ke router pilihannya; kunci tidak pernah dikirim ke situs
  peer dan tidak pernah muncul di jejak.

### Aksi situs (grounded capabilities)

`hitung_total`, `catat_penjualan`, `cek_stok`, `tambah_stok`,
`kurangi_stok`, `saran_promo`, `laporan_harian` (lokal) dan
`cek_harga_pemasok` (peer, didukung data). Aksi tulis wajib konfirmasi pengguna
sebelum dieksekusi; runtime yang memiliki konfirmasi, bukan model. Kegagalan
ditutup dengan aman (fail closed) dan dilaporkan sebagai error yang terlihat
— bukan sebagai sukses.

## Menjalankan & memverifikasi (lokal, tanpa biaya)

```sh
node tools/build.mjs   # validasi artefak + snapshot dist/ — harus LOLOS
node tools/check.mjs   # 43 pemeriksaan — harus LOLOS
node tools/serve.mjs 8131   # buka http://127.0.0.1:8131/
```

`tools/check.mjs` menguji: artefak termuat lewat HTTP dan sah; determinisme
router (input sama → jawaban sama persis, 6 kasus); keluaran eksak (total +
kembalian, stok, promo, laporan); alur tulis (konfirmasi dulu, stok belum
berubah sebelum konfirmasi, pencatatan + stok + laporan konsisten); peer satu
origin dan lintas origin (persetujuan diminta, data terbaca, penolakan
ditolak dengan jelas); penolakan jaringan tak sah (nama ganda, referensi tak
dikenal, siklus, profil salah); BYOK terhadap mock router (tool-call
didispatch, Authorization terkirim, kunci tidak ada di jejak, tanpa kunci
error jelas).

## Checklist pengiriman (yang masih butuh Zani / agen browser)

- [ ] Buat repositori GitHub publik (mis. `silver-finch-59/warung-agent`) —
      pembuatan repo lewat web UI (MCP create gagal 403); lalu push isi
      direktori ini.
- [ ] Aktifkan GitHub Pages untuk repo itu (sumber: branch utama, root) agar
      situs punya URL publik. URL inilah yang dimasukkan ke formulir Devpost.
- [ ] Daftar di halaman Devpost kompetisi (akun Devpost Zani).
- [ ] Rekam video demo < 2 menit (Zani sendiri yang menjelaskan, menampilkan
      proyek berjalan di browser) dan unggah ke YouTube sebagai publik.
- [ ] Ambil screenshot situs (tampilan chat, jaringan, stok) — tidak ada
      browser headless di VM ini; perlu browser (agen browser / Zani).
- [ ] Isi formulir submit Devpost: URL situs + deskripsi + link video YouTube
      + screenshot, sebelum 11 Jan 2027 16:00 UTC.
- [ ] Konfirmasi akhir halaman rules resmi (eligibilitas Indonesia, solo,
      kebijakan AI) sebelum submit — lihat NOTES.md.

## Catatan

- Tidak ada pendaftaran, pembayaran, atau submit yang dilakukan atas nama Zani
  dalam pekerjaan ini — semua langkah di atas menunggu Zani.
- Detail riset kandidat lain, verdict filter, dan hal yang belum terverifikasi:
  lihat NOTES.md.
