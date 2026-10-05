// Leaderboard API for 82-0 Hoops Draft.
//
//   GET  /api/lb?board=normal|hard           top 500: { entries: [{ id, name, score, w, l, champ, hard }] }
//   GET  /api/lb?board=normal|hard&id=<id>   one entry with its full team and season stats
//   POST /api/lb  { board, token, name, run, replace? } submit your best season for that board
//
// Anyone can submit. Each browser keeps a secret token; your player id is a hash of it, so only you can
// replace your own entry. One entry per player per board, and a lower score never replaces a higher one
// unless you ask for it (replace: true, when you pick a season to show from your record book).
// The server never trusts the page's score: it recalculates it from the record, checks the playoff
// result adds up, and looks every player up in the game's own data.
//
// Storage (one Netlify Blobs store):
//   e/<board>/<id>                                        full entry (each player only ever writes their own)
//   i/<board>/<id>~<score>~<w>~<l>~<champ>~<ts>~<name>    empty marker; listing this prefix reads the whole board at once
//   n/<name>                                              { id } so two players can't share a name
import { getStore, getDeployStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import VALID from "./valid.mjs";

const SLOTS = ["PG", "SG", "SF", "PF", "C"];
const BOARDS = new Set(["normal", "hard"]);
const SHOWN = 500;

export default async (req, context) => {
  // Deploy previews and branch deploys get their own throwaway store, so testing never touches the real board
  const deployContext = context?.deploy?.context ?? globalThis.Netlify?.context?.deploy?.context;
  const preview = deployContext === "deploy-preview" || deployContext === "branch-deploy";
  const opts = { name: "hoops-lb", consistency: "strong" };
  return handle(req, preview ? getDeployStore(opts) : getStore(opts));
};

export const config = { path: "/api/lb" };

export async function handle(req, store) {
  try {
    if (req.method === "GET") return await readBoard(new URL(req.url), store);
    if (req.method === "POST") return await submit(req, store);
    return reply({ error: "Method not allowed" }, 405);
  } catch (e) {
    console.error(e);
    return reply({ error: "Something went wrong on the server. Try again in a moment." }, 500);
  }
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

async function readBoard(url, store) {
  const board = url.searchParams.get("board");
  if (!BOARDS.has(board)) return reply({ error: "Unknown board" }, 400);
  const id = url.searchParams.get("id");
  if (id !== null) {
    if (!/^[0-9a-f]{20}$/.test(id)) return reply({ error: "Bad player id" }, 400);
    const e = await store.get(`e/${board}/${id}`, { type: "json" });
    return e ? reply(publicEntry(e, board)) : reply({ error: "Not found" }, 404);
  }
  return reply({ entries: (await listBoard(store, board)).slice(0, SHOWN) });
}

async function listBoard(store, board) {
  const prefix = `i/${board}/`;
  const { blobs } = await store.list({ prefix });
  const best = new Map();
  for (const { key } of blobs) {
    const e = parseIndexKey(key.slice(prefix.length), board);
    if (!e) continue;
    const cur = best.get(e.id);
    if (!cur || e.score > cur.score || (e.score === cur.score && e.ts > cur.ts)) best.set(e.id, e);
  }
  // Higher score first; on a tie, whoever got there first
  return [...best.values()].sort((a, b) => b.score - a.score || a.ts - b.ts).map(({ ts, ...e }) => e);
}

function indexKey(board, e) {
  return `i/${board}/${e.id}~${e.score}~${e.w}~${e.l}~${e.champ ? 1 : 0}~${e.ts.toString(36)}~${Buffer.from(e.name, "utf8").toString("base64url")}`;
}

function parseIndexKey(k, board) {
  const p = k.split("~");
  if (p.length !== 7 || !/^[0-9a-f]{20}$/.test(p[0])) return null;
  const name = Buffer.from(p[6], "base64url").toString("utf8");
  return { id: p[0], name, score: +p[1], w: +p[2], l: +p[3], champ: p[4] === "1", hard: board === "hard", ts: parseInt(p[5], 36) };
}

function publicEntry(e, board) {
  const { idx, ts, token, ...rest } = e;
  return { ...rest, hard: board === "hard" };
}

async function submit(req, store) {
  const text = await req.text();
  if (text.length > 20000) return reply({ error: "That submission is too big." }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return reply({ error: "Bad request" }, 400); }
  const { board, token } = body || {};
  if (!BOARDS.has(board)) return reply({ error: "Unknown board" }, 400);
  if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token)) return reply({ error: "Bad player token. Reload the page and try again." }, 400);
  const id = createHash("sha256").update(token).digest("hex").slice(0, 20);

  const name = cleanName(body.name);
  if (!name) return reply({ error: "Type the name you want on the board (up to 24 characters)." }, 400);
  const nameId = nameKey(name);
  if (!nameId) return reply({ error: "Use at least one letter or number in your name." }, 400);

  let run;
  try { run = checkRun(body.run); } catch (msg) { return reply({ error: typeof msg === "string" ? msg : "That season couldn't be read." }, 400); }
  if (run.hard !== (board === "hard")) {
    return reply({ error: board === "hard" ? "Only hard mode (blind picks) seasons go on the Hard Mode board." : "Hard mode seasons go on the Hard Mode board." }, 400);
  }
  const score = scoreOf(run);

  // One entry per player per board, and a lower score never replaces a higher one unless you ask
  const prev = await store.get(`e/${board}/${id}`, { type: "json" });
  if (prev && prev.score > score && body.replace !== true) {
    return reply({ ok: true, kept: true, id, score: prev.score, rank: await rankOf(store, board, id) });
  }

  // Names are first come, first served (the conditional write makes two people grabbing one name at once safe)
  const claim = await store.setJSON(`n/${nameId}`, { id }, { onlyIfNew: true });
  if (!claim.modified) {
    const owner = await store.get(`n/${nameId}`, { type: "json" });
    if (owner && owner.id !== id) return reply({ error: `Someone already uses the name "${name}". Pick another one.` }, 409);
  }

  const ts = Date.now();
  const sum = run.players.reduce((a, p) => a + p.ovr, 0);
  const entry = {
    id, name, score, ts, ...run,
    avgOvr: Math.round(sum / 5),
    ppg: run.pf ? Math.round(run.pf / 82 * 10) / 10 : null,
    papg: run.pa ? Math.round(run.pa / 82 * 10) / 10 : null,
  };
  entry.idx = indexKey(board, entry);
  await store.setJSON(`e/${board}/${id}`, entry);
  await store.set(entry.idx, "1");
  if (prev && prev.idx && prev.idx !== entry.idx) await store.delete(prev.idx);
  return reply({ ok: true, id, score, rank: await rankOf(store, board, id) });
}

async function rankOf(store, board, id) {
  const list = await listBoard(store, board);
  const i = list.findIndex(e => e.id === id);
  return i >= 0 ? i + 1 : null;
}

function cleanName(n) {
  // drop control and invisible characters, squeeze spaces
  return String(n ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
}

// "Bob", "bob" and "B.o.b" count as the same name
function nameKey(name) {
  const k = name.toLowerCase().normalize("NFKC").replace(/[\s.,_'"`~!?*\-]+/g, "");
  return k ? Buffer.from(k, "utf8").toString("base64url") : "";
}

// Same points as the game: 10 a win; a title is 500 plus 10 for every playoff loss under 12 (16–0 adds 120),
// otherwise 10 a playoff win; 82–0 adds 1,000 and hard mode 200. Team rating doesn't count.
function scoreOf(r) {
  const pw = Math.min(16, r.pw), pl = Math.min(12, r.pl);
  return r.w * 10 + (r.champ ? 500 + (12 - pl) * 10 : Math.min(15, pw) * 10) + (r.w === 82 ? 1000 : 0) + (r.hard ? 200 : 0);
}

function checkRun(r) {
  if (!r || typeof r !== "object") throw "That season couldn't be read.";
  const { w, l } = r;
  if (!Number.isInteger(w) || !Number.isInteger(l) || w < 0 || l < 0 || w + l !== 82) throw "That season has an impossible record.";
  if (!Array.isArray(r.players) || r.players.length !== 5) throw "That season is missing players.";
  const players = r.players.map((p, i) => {
    if (!p || typeof p !== "object" || p.slot !== SLOTS[i]) throw "That lineup is out of order.";
    const ovr = VALID[`${p.dec}|${p.team}|${p.name}`];
    if (typeof ovr !== "number") throw `Couldn't find ${String(p.name).slice(0, 40)} on the ${String(p.dec).slice(0, 8)} ${String(p.team).slice(0, 40)}.`;
    return { slot: p.slot, name: p.name, dec: p.dec, team: p.team, ovr };
  });
  const stat = v => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 100) ? Math.round(v * 10) / 10 : null;
  const box = players.map((p, i) => {
    const s = Array.isArray(r.box) && r.box[i] && typeof r.box[i] === "object" ? r.box[i] : {};
    return { ...p, ppg: stat(s.ppg), rpg: stat(s.rpg), apg: stat(s.apg), spg: stat(s.spg), bpg: stat(s.bpg) };
  });
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi) ? v : 0;
  const champ = r.champ === true;
  const run = {
    w, l, champ, hard: r.hard === true, players, box, date: String(r.date ?? "").slice(0, 20),
    pf: int(r.pf, 0, 20000), pa: int(r.pa, 0, 20000), reached: int(r.reached, 0, 3), pw: int(r.pw, 0, 16), pl: int(r.pl, 0, 16),
    rid: Number.isSafeInteger(r.rid) && r.rid > 0 ? r.rid : null,
  };
  // A champion wins 16 and loses at most 3 a round; anyone else wins at most 15
  if (champ ? (run.reached !== 3 || run.pw !== 16 || run.pl > 12) : run.pw > 15) throw "That season's playoff result doesn't add up.";
  return run;
}
