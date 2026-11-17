// tools/serve.mjs — Server statis kecil untuk uji lokal Warung Agent.
// Node 22 stdlib saja. Pemakaian: node tools/serve.mjs [port] [root]
// Mengirim header CORS untuk artefak agen agar pemuatan peer lintas origin bisa diuji.

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const port = Number(process.argv[2] || 8131);
const root = resolve(process.argv[3] || ".");

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  let path = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!path.startsWith(root)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (path.endsWith("/")) path = join(path, "index.html");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!existsSync(path)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Warung Agent disajikan di http://127.0.0.1:${port}/ (root: ${root})`);
});
