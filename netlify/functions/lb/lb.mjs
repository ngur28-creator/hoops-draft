// Leaderboard API for 82-0 Hoops Draft.
//
//   GET  /api/lb?board=normal|hard           top 500: { entries: [{ id, name, score, w, l, champ, hard }] }
//   GET  /api/lb?board=normal|hard&id=<id>   one entry with its full team and season stats
//   POST /api/lb  { board, token, name, run, replace? } submit your best season for that board
// The game modes have boards too:
//   board=daily&day=YYYY-MM-DD   the Daily Draft (POST { board, day, token, name, entry }: a season, like run)
//   board=gauntlet               Legends Gauntlet runs (entry: { beat, lost, team, players })
//   board=dynasty                five-season dynasties (entry: { years: [5 seasons], players })
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
const KINDS = new Set(["normal", "hard", "daily", "gauntlet", "dynasty"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The date in California: the Daily Draft day, the same as the game uses
export function dayPT(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
// Where a board's entries live: the season boards by name, the Daily Draft one per day
function boardKey(kind, day) {
  if (!KINDS.has(kind)) return null;
  if (kind !== "daily") return kind;
  return typeof day === "string" && DAY.test(day) ? `daily-${day}` : null;
}
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
  const kind = url.searchParams.get("board"), key = boardKey(kind, url.searchParams.get("day"));
  if (!key) return reply({ error: kind === "daily" ? "Which day? Use day=YYYY-MM-DD." : "Unknown board" }, 400);
  const id = url.searchParams.get("id");
  if (id !== null) {
    if (!/^[0-9a-f]{20}$/.test(id)) return reply({ error: "Bad player id" }, 400);
    const e = await store.get(`e/${key}/${id}`, { type: "json" });
    return e ? reply(publicEntry(e, kind)) : reply({ error: "Not found" }, 404);
  }
  return reply({ entries: (await listBoard(store, key, kind)).slice(0, SHOWN) });
}

async function listBoard(store, board, kind = board) {
  const prefix = `i/${board}/`;
  const { blobs } = await store.list({ prefix });
  const best = new Map();
  for (const { key } of blobs) {
    const e = parseIndexKey(key.slice(prefix.length), kind);
    if (!e) continue;
    const cur = best.get(e.id);
    if (!cur || e.score > cur.score || (e.score === cur.score && e.ts > cur.ts)) best.set(e.id, e);
  }
  // Higher score first; on a tie, whoever got there first
  return [...best.values()].sort((a, b) => b.score - a.score || a.ts - b.ts).map(({ ts, ...e }) => e);
}

// The index marker carries what a board row shows: for seasons the record, for the Gauntlet the legends
// beaten and games lost, for a dynasty the titles and wins
function indexKey(board, e, [a, b, c]) {
  return `i/${board}/${e.id}~${e.score}~${a}~${b}~${c}~${e.ts.toString(36)}~${Buffer.from(e.name, "utf8").toString("base64url")}`;
}

function parseIndexKey(k, kind) {
  const p = k.split("~");
  if (p.length !== 7 || !/^[0-9a-f]{20}$/.test(p[0])) return null;
  const name = Buffer.from(p[6], "base64url").toString("utf8");
  const base = { id: p[0], name, score: +p[1], ts: parseInt(p[5], 36) };
  if (kind === "gauntlet") return { ...base, beat: +p[2], lost: +p[3] };
  if (kind === "dynasty") return { ...base, titles: +p[2], wins: +p[3] };
  return { ...base, w: +p[2], l: +p[3], champ: p[4] === "1", hard: kind === "hard" };
}

function publicEntry(e, kind) {
  const { idx, ts, token, ...rest } = e;
  return kind === "normal" || kind === "hard" ? { ...rest, hard: kind === "hard" } : rest;
}

async function submit(req, store) {
  const text = await req.text();
  if (text.length > 20000) return reply({ error: "That submission is too big." }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return reply({ error: "Bad request" }, 400); }
  const { board: kind, token } = body || {};
  if (!KINDS.has(kind)) return reply({ error: "Unknown board" }, 400);
  // A Daily Draft entry is for today (in California), or the day either side of it
  if (kind === "daily" && ![dayPT(-1), dayPT(0), dayPT(1)].includes(body.day)) return reply({ error: "That Daily Draft is over." }, 400);
  const board = boardKey(kind, body.day);
  if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token)) return reply({ error: "Bad player token. Reload the page and try again." }, 400);
  const id = createHash("sha256").update(token).digest("hex").slice(0, 20);

  const name = cleanName(body.name);
  if (!name) return reply({ error: "Type the name you want on the board (up to 24 characters)." }, 400);
  const nameId = nameKey(name);
  if (!nameId) return reply({ error: "Use at least one letter or number in your name." }, 400);

  // What goes on the board, its score, and the three numbers its row shows
  let rec;
  try {
    if (kind === "gauntlet") rec = checkGauntlet(body.entry);
    else if (kind === "dynasty") rec = checkDynasty(body.entry);
    else {
      const run = checkRun(kind === "daily" ? { ...(body.entry || body.run), hard: false } : body.run);
      if (kind !== "daily" && run.hard !== (kind === "hard")) {
        return reply({ error: kind === "hard" ? "Only hard mode (blind picks) seasons go on the Hard Mode board." : "Hard mode seasons go on the Hard Mode board." }, 400);
      }
      const sum = run.players.reduce((a, p) => a + p.ovr, 0);
      rec = {
        score: scoreOf(run), row: [run.w, run.l, run.champ ? 1 : 0],
        data: { ...run, avgOvr: Math.round(sum / 5), ppg: run.pf ? Math.round(run.pf / 82 * 10) / 10 : null, papg: run.pa ? Math.round(run.pa / 82 * 10) / 10 : null },
      };
    }
  } catch (msg) { return reply({ error: typeof msg === "string" ? msg : "That couldn't be read." }, 400); }
  const score = rec.score;

  // One entry per player per board, and a lower score never replaces a higher one unless you ask
  // (you can pick which season shows on the season boards)
  const prev = await store.get(`e/${board}/${id}`, { type: "json" });
  if (prev && prev.score > score && !(body.replace === true && BOARDS.has(kind))) {
    return reply({ ok: true, kept: true, id, score: prev.score, rank: await rankOf(store, board, id, kind) });
  }

  // Names are first come, first served (the conditional write makes two people grabbing one name at once safe)
  const claim = await store.setJSON(`n/${nameId}`, { id }, { onlyIfNew: true });
  if (!claim.modified) {
    const owner = await store.get(`n/${nameId}`, { type: "json" });
    if (owner && owner.id !== id) return reply({ error: `Someone already uses the name "${name}". Pick another one.` }, 409);
  }

  const ts = Date.now();
  const entry = { id, name, score, ts, ...rec.data };
  entry.idx = indexKey(board, entry, rec.row);
  await store.setJSON(`e/${board}/${id}`, entry);
  await store.set(entry.idx, "1");
  if (prev && prev.idx && prev.idx !== entry.idx) await store.delete(prev.idx);
  return reply({ ok: true, id, score, rank: await rankOf(store, board, id, kind) });
}

async function rankOf(store, board, id, kind = board) {
  const list = await listBoard(store, board, kind);
  const i = list.findIndex(e => e.id === id);
  return i >= 0 ? i + 1 : null;
}

export function cleanName(n) {
  // drop control and invisible characters, squeeze spaces
  return String(n ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
}

// "Bob", "bob" and "B.o.b" count as the same name
export function nameKey(name) {
  const k = name.toLowerCase().normalize("NFKC").replace(/[\s.,_'"`~!?*\-]+/g, "");
  return k ? Buffer.from(k, "utf8").toString("base64url") : "";
}

// Same points as the game: 10 a win; a title is 500 plus 10 for every playoff loss under 12 (16–0 adds 120),
// otherwise 10 a playoff win; 82–0 adds 1,000 and hard mode 200. Team rating doesn't count.
function scoreOf(r) {
  const pw = Math.min(16, r.pw), pl = Math.min(12, r.pl);
  return r.w * 10 + (r.champ ? 500 + (12 - pl) * 10 : Math.min(15, pw) * 10) + (r.w === 82 ? 1000 : 0) + (r.hard ? 200 : 0);
}

// Five players in lineup order, each looked up in the game's data (the rating comes from there, not the page)
function checkPlayers(list, what = "That season") {
  if (!Array.isArray(list) || list.length !== 5) throw `${what} is missing players.`;
  return list.map((p, i) => {
    if (!p || typeof p !== "object" || p.slot !== SLOTS[i]) throw "That lineup is out of order.";
    const ovr = VALID[`${p.dec}|${p.team}|${p.name}`];
    if (typeof ovr !== "number") throw `Couldn't find ${String(p.name).slice(0, 40)} on the ${String(p.dec).slice(0, 8)} ${String(p.team).slice(0, 40)}.`;
    return { slot: p.slot, name: p.name, dec: p.dec, team: p.team, ovr };
  });
}

// A Legends Gauntlet run: legends beaten in a row (1–24) and games lost along the way
function checkGauntlet(e) {
  if (!e || typeof e !== "object") throw "That run couldn't be read.";
  const { beat, lost } = e;
  if (!Number.isInteger(beat) || beat < 1 || beat > 24) throw "That run has an impossible result.";
  // Each series won allows up to 3 losses, plus the 4 of a series lost at the end
  if (!Number.isInteger(lost) || lost < 0 || lost > beat * 3 + 4) throw "That run has an impossible result.";
  const players = checkPlayers(e.players, "That run");
  return { score: beat * 100 + Math.max(0, 99 - lost), row: [beat, lost, beat === 24 ? 1 : 0], data: { beat, lost, team: String(e.team ?? "").slice(0, 120), players } };
}

// A dynasty: five seasons with one team; titles and wins are counted here, not taken from the page
function checkDynasty(e) {
  if (!e || typeof e !== "object" || !Array.isArray(e.years) || e.years.length !== 5) throw "That dynasty couldn't be read.";
  const years = e.years.map(y => {
    const w = y && y.w, champ = !!(y && y.champ === true);
    if (!Number.isInteger(w) || w < 0 || w > 82 || y.l !== 82 - w) throw "That dynasty has an impossible record.";
    const pw = Number.isInteger(y.pw) ? y.pw : 0, pl = Number.isInteger(y.pl) ? y.pl : 0;
    if (champ ? (pw !== 16 || pl < 0 || pl > 12 || w < 42) : (pw < 0 || pw > 15 || pl < 0 || pl > 13)) throw "That dynasty's playoffs don't add up.";
    return { w, l: 82 - w, champ, pw, pl };
  });
  const titles = years.filter(y => y.champ).length, wins = years.reduce((a, y) => a + y.w, 0);
  const players = checkPlayers(e.players, "That dynasty");
  return { score: titles * 1000 + wins, row: [titles, wins, 0], data: { titles, wins, years, players } };
}

function checkRun(r) {
  if (!r || typeof r !== "object") throw "That season couldn't be read.";
  const { w, l } = r;
  if (!Number.isInteger(w) || !Number.isInteger(l) || w < 0 || l < 0 || w + l !== 82) throw "That season has an impossible record.";
  const players = checkPlayers(r.players);
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
