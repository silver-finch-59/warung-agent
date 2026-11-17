# Catatan Riset — Open Agentic Web Challenge

Tanggal riset: 17 November 2026. Sumber utama: laporan riset platform
(`~/workspace/research_notes/platform-seperti-makefun-20261117-1449/report.md`)
+ verifikasi langsung halaman Devpost dan spesifikasi GitHub pada hari yang sama.

## Keputusan: Open Agentic Web Challenge (Devpost)

Dipilih karena paling lolos semua filter + batasan build Zani (Node/Python
stdlib saja, deterministik, tanpa API berbayar, tanpa biaya):

| Filter | Verdict |
|---|---|
| (a) Gratis, tanpa biaya masuk/kripto | LOLOS — tidak ada biaya yang tercantum di halaman Devpost; event Devpost standar memakai klausul "NO PURCHASE NECESSARY" (terverifikasi polanya di Codegeist/Splunk/GitLab; teks rules event ini belum terbaca verbatim — lihat "Belum terverifikasi") |
| (b) Deadline minimal 4–5 hari lagi | LOLOS — 11 Jan 2027 16:00 UTC, 55 hari dari 17 Nov 2026 |
| (c) Boleh ikut solo | LOLOS (dengan catatan) — agregator aihackathon.app mencatat "Solo OK, Country rules checked"; siaran pers: "developers, researchers, startups, businesses and students worldwide" |
| (d) AI-assisted building tidak dilarang total | LOLOS — tantangan ini TENTANG membangun agen AI; tidak ada larangan pemakaian AI dalam materi yang dibaca. Satu-satunya larangan AI: video demo harus menampilkan Entrant yang menjelaskan (not AI generated) |
| (e) Dinilai dari artefak, bukan vote sosial | LOLOS — 4 kriteria juri di halaman Devpost: Technological Implementation, Design, Potential Impact, Quality of the Idea |

## Fakta kompetisi (terverifikasi 17 Nov 2026)

- Halaman Devpost: http://cognizant-agenticweb.devpost.com/ (dibaca langsung).
  - "What to Build": situs agen terbuka yang berfungsi, dibangun dengan teknologi
    web terbuka standar, sesuai spesifikasi open agentic web.
  - "What to Submit": URL situs publik berisi (1) file `.json` yang sesuai dan
    mendeskripsikan jaringan agen + kemampuannya, (2) file `runtime` yang bisa
    menjalankan jaringan agen di browser, (3) antarmuka untuk pengguna/agen
    berinteraksi, (4) antarmuka opsional untuk konfigurasi LLM/kunci, (5)
    jaringan agen bisa berinteraksi dengan situs, opsional dengan situs agen
    lain, dan/atau dipanggil situs lain. Plus deskripsi teks, video < 2 menit
    (Entrant menjelaskan, bukan AI-generated, publik di YouTube), dan screenshot.
  - Hadiah di halaman Devpost: $10.000 (1st $5.000, 2nd $3.000, 3rd $2.000) +
    kredit Mozilla Otari + SWAG + promosi sosial. Siaran pers PR Newswire
    menyebut dana hadiah $13.000 (selisihnya: hadiah karyawan $250 + kredit).
  - Periode: 11 Nov 2026 – 11 Jan 2027. Pemenang diumumkan di Davos, Jan 2027.
  - Sponsor prototypes (Neuro SAN, NANDA, Otari) TIDAK wajib dipakai.
- Spesifikasi: `cognizant-ai-labs/agentic-web`, `docs/worldwide_agentic_web_mvp_spec.md`
  (MVP Profile 0.2, 6 Nov 2026) — dibaca SELURUHNYA (762 baris, §1–§8).
  Poin kesesuaian yang diimplementasikan: agent-manifest.json, definisi jaringan
  JSON (model data Neuro SAN), links.json, runtime browser (parse/validasi,
  loop agen, aksi situs, BYOK, pemuatan peer + persetujuan), batas eksekusi,
  fail-closed, konteks privat deny-by-default, jejak tanpa rahasia, dan
  checklist interoperabilitas §6 (dua agen minimum terpenuhi: jaringan warung
  4 agen + jaringan peer 2 agen; aksi lokal + aksi peer berbasis data;
  pemuatan peer lintas origin setelah persetujuan; kunci tak pernah ke peer).
- Ekstensi yang dipakai (didokumentasikan di README + manifest):
  - `parameters` (JSON Schema) per agen untuk skema pemanggilan.
  - Aksi peer berbasis data (`data` di katalog aksi peer): penangan runtime
    memuat berkas data publik dan mencocokkan nama secara deterministik —
    tanpa mengeksekusi kode penerbit (sesuai tenet data-only profil).

## Kandidat lain yang diperiksa dan alasannya ditolak

- **Reddit's Game of the Day Hackathon** ($35.000, deadline 8 Des 2026) —
  WAJIB Devvit Web: game harus berjalan di Reddit ("you simply cannot place if
  your game isn't running on Reddit"). Butuh akun developer Reddit + Devvit CLI
  + deploy ke infra Reddit. Tidak sesuai build stdlib-only dan butuh langkah
  akun Zani yang berat. Cadangan kedua bila jalur Devpost ini batal.
- **Kiroween 2026** ($100.000+, deadline 4 Des) — wajib dibangun dengan Kiro
  (IDE AI AWS). Tidak bisa dijalankan agen; butuh instalasi + pemakaian Kiro
  oleh Zani. Ditolak.
- **Codegeist 2026** ($120.000+, deadline 22 Des) — wajib Atlassian Forge +
  integrasi Jira/Confluence. Stack sponsor terkunci, bukan stdlib. Ditolak.
- **#BuildHybridAI 2026** ($30.000, deadline 30 Nov) — wajib Firebase AI Logic /
  Gemini (API sponsor). Ditolak (tanpa API berbayar).
- **QNX Global Hackathon** ($50.000, deadline 15 Des) — wajib QNX 8.0 (RTOS
  embedded). Ditolak.
- **Neo4j Relate AI Agent Hackathon** (deadline 11 Des) — wajib Relate DB.
  Ditolak (stack sponsor).
- **Deck the Pixels** ($25.000, deadline 7 Des) — kontes DESAIN (Photoshop +
  Nano Banana), tanpa coding. Bukan build software. Ditolak.
- **AWS MSP AI Hackathon** ($64.000, deadline 11 Des) — syarat: bekerja di /
  mewakili organisasi terdaftar AWS Partner Network. Zani tidak memenuhi.
  Ditolak (eligibilitas).
- **Meta VR Start** ($1.000.000) — deadline 18 Nov 2026 (besok) + butuh VR.
  Ditolak.
- **ML Empowerment Build Challenge 4.0** (deadline 1 Des) — hanya untuk
  pelajar SMA/kuliah. Ditolak (eligibilitas).
- **Kaggle / Zindi** — tidak dicek mendalam karena Devpost sudah menghasilkan
  kandidat yang lolos semua filter; keduanya tetap cadangan (Kaggle: Name That
  LLM $50.000 s.d. 13 Jan 2027; Zindi: GenAI for Good $40.000).

## Belum terverifikasi (wajib konfirmasi sebelum submit)

1. **Teks rules resmi event ini** (eligibilitas negara, solo, kebijakan AI,
   "NO PURCHASE NECESSARY") — halaman rules tidak berhasil dibaca lewat
   text-fetch pada 17 Nov 2026 (pencarian tidak mengembalikan URL rules
   verbatim). Bukti sekunder kuat: halaman Devpost ("developers everywhere"),
   siaran pers PR Newswire ("worldwide"), aihackathon.app ("Solo OK, Country
   rules checked"). Konfirmasi akhir: buka halaman rules lewat browser
   (agen browser / Zani) sebelum submit.
2. **Metode payout ke Indonesia** — Devpost umumnya membayar via PayPal /
   Payoneer / Wise (s.d. 60 hari) + form pajak W-8BEN; belum dikonfirmasi
   spesifik untuk event ini.
3. **Screenshot & video** — belum dibuat (butuh browser untuk screenshot dan
   Zani untuk video demo).
4. **Hosting publik + repo GitHub + registrasi Devpost** — belum dilakukan
   (butuh langkah Zani / agen browser; bukan bagian dari build ini).
