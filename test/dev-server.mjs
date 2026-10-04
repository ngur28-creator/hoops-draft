// Local run of the site: serves site/ and the real /api/lb function on an in-memory store.
//   node test/dev-server.mjs [port]
import http from "node:http";
import { readFile } from "node:fs/promises";
import { handle } from "../netlify/functions/lb/lb.mjs";
import { memoryStore } from "./memory-store.mjs";

const store = memoryStore();
const port = +(process.argv[2] || 8888);
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === "/api/lb") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : body }), store);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await readFile(new URL("../site/index.html", import.meta.url)));
    return;
  }
  res.writeHead(404); res.end("not found");
}).listen(port, () => console.log(`http://localhost:${port}`));
