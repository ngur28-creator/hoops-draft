// Leaderboard API for 82-0 Hoops Draft.
//
//   GET  /api/lb?board=normal|hard           top 500: { entries: [{ id, name, score, w, l, champ, hard }] }
//   GET  /api/lb?board=normal|hard&id=<id>   one entry with its full team and season stats
//   POST /api/lb  { board, token, name, run, replace? } submit your best season for that board
// The game modes have boards too:
//   board=monthly&month=YYYY-MM  the Monthly Draft: your best try of the month (POST { board, day: "YYYY-MM", token, name,
//                                entry }: a season, like run; GET and POST take day= or month=)
//   board=daily&day=YYYY-MM-DD   the old Daily Draft, which the Monthly Draft replaced (kept for pages that haven't reloaded)
//   board=gauntlet               Legends Gauntlet runs (entry: { beat, lost, team, players })
//   board=dynasty                five-season dynasties (entry: { years: [5 seasons], players })
// and so do the Arcade games:
//   board=hol                    Higher or Lower: best streak (entry: { streak })
//   board=buzz                   Buzzer Beater: best game (entry: { points, makes })
//   board=surv                   Survival: most wins in a run (entry: { wins, losses, players })
//   board=guess&day=YYYY-MM-DD   the day's Mystery Player: fewest guesses (entry: { tries })
//   board=speed                  Speed Draft: a season plus its time bonus (entry: a season, like run, and bonus)
//   board=quiz                   Trivia Blitz: best score (entry: { score, correct })
//   board=trade                  Trade Up: best streak (entry: { streak })
//   board=memory                 Memory Match: best score (entry: { score, moves, seconds })
//   board=bracket                Bracket Predictor: best score (entry: { score, correct, champ })
//   board=statline               Stat Line Showdown: best streak (entry: { streak })
//   board=hothand                Hot Hand: best streak (entry: { streak })
//   (those six were replaced in version 40; their boards stay readable and still take entries from old pages)
//   board=x_<id>                 the Arcade's 95 canvas games, listed in xgames.mjs: best score (entry: { score })
//
// Anyone can submit. Each browser keeps a secret token; your player id is a hash of it, so only you can
// replace your own entry. One entry per player per board, and a lower score never replaces a higher one
// unless you ask for it (replace: true, when you pick a season to show from your record book).
// The server never trusts the page's score. Every season starts from a ticket the server signs (GET ?ticket=1: a
// random seed); the page draws its rolls, sims its season and plays its playoffs from that seed and sends back
// its picks. The server replays the whole draft and season with the game's own code (engine.mjs) and posts what
// really happened: a record, a lineup that wasn't rolled, or a forged or borrowed ticket gets turned away. The
// Monthly Draft is seeded by its day, so it replays the same way without a ticket.
// The season itself is seeded separately, and only once the lineup is final: the page sends its finished draft
// (POST { action: "season", ... }) and gets back a season seed only the server can work out. One lineup per draft
// ticket, so nobody can try lineups against a known seed. The owner can post any season with the owner key
// (only its SHA-256 is kept here).
//
// Storage (one Netlify Blobs store):
//   e/<board>/<id>                                        full entry (each player only ever writes their own)
//   i/<board>/<id>~<score>~<w>~<l>~<champ>~<ts>~<name>    empty marker; listing this prefix reads the whole board at once
//   n/<name>                                              { id } so two players can't share a name
import { getStore, getDeployStore } from "@netlify/blobs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { replaySeason } from "./engine.mjs";
import VALID from "./valid.mjs";
import XGAMES from "./xgames.mjs";

const SLOTS = ["PG", "SG", "SF", "PF", "C"];
const BOARDS = new Set(["normal", "hard"]);
const KINDS = new Set(["normal", "hard", "monthly", "daily", "gauntlet", "dynasty", "hol", "buzz", "surv", "guess", "speed", "quiz", "trade", "memory", "bracket", "statline", "hothand"]);
// Boards kept one per day (California time), and the Monthly Draft's one per month
const DAILY = new Set(["daily", "guess"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// The date in California, the same as the game uses (the Monthly Draft's new month starts at midnight there)
export function dayPT(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
// One of the Arcade's hundred: x_<id>. Gives the highest score its board takes, or 0 for anything else
export const xCap = kind => typeof kind === "string" && kind.startsWith("x_") && Object.hasOwn(XGAMES, kind.slice(2)) ? XGAMES[kind.slice(2)] : 0;
// Where a board's entries live: most boards by name, the Mystery Player one per day, the Monthly Draft one per month
function boardKey(kind, day) {
  if (xCap(kind)) return kind;
  if (!KINDS.has(kind)) return null;
  if (kind === "monthly") return typeof day === "string" && MONTH.test(day) ? `monthly-${day}` : null;
  if (!DAILY.has(kind)) return kind;
  return typeof day === "string" && DAY.test(day) ? `${kind}-${day}` : null;
}
const SHOWN = 500;
// The page version the server expects; older pages get a bar asking them to reload
const PAGE_V = 50;

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

/* ---------- Season tickets ---------- */
let SECRET = null;
async function secret(store) {
  if (SECRET) return SECRET;
  if (process.env.HOOPS_TK_SECRET) return (SECRET = process.env.HOOPS_TK_SECRET);
  await store.set("k/secret", randomBytes(32).toString("hex"), { onlyIfNew: true });
  return (SECRET = await store.get("k/secret"));
}
const OWNER_HASH = "8764e8fb64200365ce42422f114898120026aa3f408f1189600d85ab58346fe5";
// The site owner can put a season on the Normal or Hard Mode board without a replay (only the key's hash lives here)
const isOwner = k => typeof k === "string" && k.length < 100 && [OWNER_HASH, process.env.HOOPS_OWNER_HASH].includes(createHash("sha256").update(k).digest("hex"));
// What fixes a season: the mode, the Monthly day, every roll and pick, the five in their spots and their card boosts
function canonOf(r, mode) {
  const players = Array.isArray(r.players) ? r.players.slice(0, 5).map(p => [p && p.slot, p && p.dec, p && p.team, p && p.name].map(v => String(v ?? "").slice(0, 60))) : [];
  const log = Array.isArray(r.log) ? r.log.slice(0, 40).map(v => String(v).slice(0, 20)) : [];
  const cb = Array.isArray(r.cb) ? r.cb.slice(0, 5).map(Number) : [];
  return JSON.stringify({ m: mode, d: mode === "monthly" ? String(r.day ?? "").slice(0, 10) : "", log, players, cb });
}
async function seasonSeedFor(store, seed, c) { return sign(await secret(store), "season|" + (seed || "") + "|" + c); }
// The page's finished draft in, its season seed out
async function seasonSeed(store, body) {
  const mode = ["free", "speed", "monthly"].includes(body.mode) ? body.mode : null;
  if (!mode) return reply({ error: "Bad request" }, 400);
  let seed = null;
  try {
    if (mode === "monthly") { if (![dayPT(-1), dayPT(0), dayPT(1)].includes(body.day)) throw "That Monthly Draft day is over."; }
    else seed = await ticketSeed(store, body.tk);
  } catch (msg) { return reply({ error: msg }, 400); }
  const c = canonOf(body, mode);
  if (seed) {
    const prev = await store.get(`ss/${seed}`, { type: "json" });
    if (prev && prev.c !== c) return reply({ error: "That draft already tipped off with a different lineup." }, 409);
    if (!prev) await store.setJSON(`ss/${seed}`, { c });
  }
  return reply({ ss: await seasonSeedFor(store, seed, c) });
}
const sign = (key, msg) => createHmac("sha256", key).update(msg).digest("hex").slice(0, 32);
async function newTicket(store) {
  const seed = randomBytes(16).toString("hex"), ts = Date.now().toString(36);
  return `${seed}.${ts}.${sign(await secret(store), seed + "." + ts)}`;
}
// The seed of a genuine ticket, or a message
async function ticketSeed(store, tk) {
  const m = typeof tk === "string" && /^([0-9a-f]{32})\.([0-9a-z]{1,12})\.([0-9a-f]{32})$/.exec(tk);
  if (!m) throw "That season has no ticket from the server, so it can't be checked. Seasons drafted after this update can.";
  if (sign(await secret(store), m[1] + "." + m[2]) !== m[3]) throw "That season's ticket isn't one the server gave out.";
  return m[1];
}

async function readBoard(url, store) {
  if (url.searchParams.get("ticket") !== null) return reply({ tk: await newTicket(store), v: PAGE_V });
  const kind = url.searchParams.get("board"), q = url.searchParams;
  const key = boardKey(kind, kind === "monthly" ? q.get("month") ?? q.get("day") : q.get("day"));
  if (!key) return reply({ error: kind === "monthly" ? "Which month? Use month=YYYY-MM." : DAILY.has(kind) ? "Which day? Use day=YYYY-MM-DD." : "Unknown board" }, 400);
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
  if (kind === "hol") return { ...base, streak: +p[2] };
  if (kind === "buzz") return { ...base, points: +p[2], makes: +p[3] };
  if (kind === "surv") return { ...base, wins: +p[2], losses: +p[3] };
  if (kind === "guess") return { ...base, tries: +p[2] };
  if (kind === "quiz") return { ...base, correct: +p[2] };
  if (kind === "trade" || kind === "statline" || kind === "hothand") return { ...base, streak: +p[2] };
  if (kind === "memory") return { ...base, moves: +p[2], seconds: +p[3] };
  if (kind === "bracket") return { ...base, correct: +p[2], champ: p[3] === "1" };
  if (xCap(kind)) return base;
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
  if (body && body.action === "season") return seasonSeed(store, body);
  if (body && body.action === "claim") return claimName(store, body);
  const { board: kind, token } = body || {};
  if (!KINDS.has(kind) && !xCap(kind)) return reply({ error: "Unknown board" }, 400);
  // A Daily Draft or Mystery Player entry is for today (in California), or the day either side of it; a Monthly
  // Draft entry for this month, or the month either side of it (a try finished just after midnight on the 1st)
  if (DAILY.has(kind) && ![dayPT(-1), dayPT(0), dayPT(1)].includes(body.day)) return reply({ error: kind === "guess" ? "That Mystery Player is over." : "That Daily Draft is over." }, 400);
  const month = kind === "monthly" ? body.month ?? body.day : null;
  if (kind === "monthly" && !(typeof month === "string" && MONTH.test(month) && [dayPT(-1), dayPT(0), dayPT(1)].some(d => d.slice(0, 7) === month))) return reply({ error: "That Monthly Draft is over." }, 400);
  const board = boardKey(kind, kind === "monthly" ? month : body.day);
  if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token)) return reply({ error: "Bad player token. Reload the page and try again." }, 400);
  const id = createHash("sha256").update(token).digest("hex").slice(0, 20);

  const name = cleanName(body.name);
  if (!name) return reply({ error: "Type the name you want on the board (up to 24 characters)." }, 400);
  const nameId = nameKey(name);
  if (!nameId) return reply({ error: "Use at least one letter or number in your name." }, 400);

  // What goes on the board, its score, and the three numbers its row shows
  let rec, seed = null;
  try {
    if (kind === "daily") throw "The Daily Draft is over. Play the Monthly Draft.";
    if (kind === "gauntlet") rec = checkGauntlet(body.entry);
    else if (kind === "dynasty") rec = checkDynasty(body.entry);
    else if (ARCADE.has(kind)) rec = checkArcade(kind, body.entry);
    else if (xCap(kind)) rec = checkX(kind, body.entry);
    else {
      // Monthly, Daily and Speed Draft seasons are always normal mode
      const daily = kind === "monthly" || kind === "daily" || kind === "speed";
      const sent = daily ? { ...(body.entry || body.run), hard: false } : body.run;
      const run = checkRun(sent);
      // Replay the draft and season and use what really happened
      const mode = kind === "monthly" ? "monthly" : kind === "speed" ? "speed" : "free";
      if (mode === "monthly" && !(typeof sent.day === "string" && sent.day.slice(0, 7) === month)) throw "That try isn't from this month's Monthly Draft.";
      // The owner's season goes up as sent (still checked for real players and a possible record)
      if (!(BOARDS.has(kind) && isOwner(body.owner))) {
        if (mode !== "monthly") seed = await ticketSeed(store, sent.tk);
        const c = canonOf(sent, mode);
        if (seed) {
          const tipped = await store.get(`ss/${seed}`, { type: "json" });
          if (!tipped && !(sent.pv >= 48)) throw "An update came out and this page is old. Reload the page (close the tab and open the game again), then play a new season and it will post.";
          if (!tipped || tipped.c !== c) throw "That season didn't tip off with the server, so it can't be checked.";
        }
        const real = replaySeason(sent, mode, seed, await seasonSeedFor(store, seed, c));
        if (real.w !== run.w || (sent.po === true && (real.champ !== run.champ || real.pw !== run.pw || real.pl !== run.pl))) throw "That season doesn't match its replay, so it can't go on the board.";
        Object.assign(run, { w: real.w, l: real.l, pf: real.pf, pa: real.pa, pw: real.pw, pl: real.pl, reached: real.reached, champ: real.champ, players: real.players,
          box: real.players.map((p, i) => ({ ...p, ...real.box[i] })) });
      }
      if (!daily && run.hard !== (kind === "hard")) {
        return reply({ error: kind === "hard" ? "Only hard mode (blind picks) seasons go on the Hard Mode board." : "Hard mode seasons go on the Hard Mode board." }, 400);
      }
      const sum = run.players.reduce((a, p) => a + p.ovr, 0);
      // A Speed Draft adds its time bonus: up to 10 points for each of 8 seconds left on each of 5 picks
      const bonus = kind === "speed" ? (body.entry && body.entry.bonus) : 0;
      if (kind === "speed" && !(Number.isInteger(bonus) && bonus >= 0 && bonus <= 400)) throw "That time bonus isn't possible.";
      rec = {
        score: scoreOf(run) + bonus, row: [run.w, run.l, run.champ ? 1 : 0],
        data: { ...run, ...(kind === "speed" ? { bonus } : {}), avgOvr: Math.round(sum / 5), ppg: run.pf ? Math.round(run.pf / 82 * 10) / 10 : null, papg: run.pa ? Math.round(run.pa / 82 * 10) / 10 : null },
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

  // A ticket belongs to whoever posts it first
  if (seed) {
    const t = await store.get(`t/${seed}`, { type: "json" });
    if (t && t.id !== id) return reply({ error: "That season was already posted by someone else." }, 409);
    if (!t) await store.setJSON(`t/${seed}`, { id });
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

// The owner moves their name, and every board entry under it, to the browser they're on now (each browser has
// its own token, so a new phone or a cleared browser would otherwise be a stranger to its own name)
async function claimName(store, body) {
  if (!isOwner(body.owner)) return reply({ error: "That owner key isn't right." }, 403);
  const { token } = body;
  if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token)) return reply({ error: "Bad player token. Reload the page and try again." }, 400);
  const id = createHash("sha256").update(token).digest("hex").slice(0, 20);
  const name = cleanName(body.name), nk = nameKey(name);
  if (!nk) return reply({ error: "Type your name for the board first." }, 400);
  const owner = await store.get(`n/${nk}`, { type: "json" });
  const old = owner && owner.id;
  let moved = 0;
  if (old && old !== id) {
    const { blobs } = await store.list({ prefix: "e/" });
    for (const { key } of blobs) {
      if (!key.endsWith("/" + old)) continue;
      const board = key.slice(2, -old.length - 1);
      const e = await store.get(key, { type: "json" });
      if (!e) continue;
      const mine = await store.get(`e/${board}/${id}`, { type: "json" });
      // Keep whichever entry is better; the other goes
      if (!mine || (e.score || 0) > (mine.score || 0)) {
        if (mine && mine.idx) await store.delete(mine.idx);
        const ne = { ...e, id, name };
        ne.idx = typeof e.idx === "string" ? e.idx.replace(`i/${board}/${old}~`, `i/${board}/${id}~`) : null;
        if (ne.idx) { const p = ne.idx.split("~"); p[6] = Buffer.from(name, "utf8").toString("base64url"); ne.idx = p.join("~"); }
        await store.setJSON(`e/${board}/${id}`, ne);
        if (ne.idx) await store.set(ne.idx, "1");
      }
      if (e.idx) await store.delete(e.idx);
      await store.delete(key);
      moved++;
    }
  }
  await store.setJSON(`n/${nk}`, { id });
  return reply({ ok: true, id, moved });
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

// The Arcade's quick games are played in the page, so all the server can do is check the numbers are possible
const ARCADE = new Set(["hol", "buzz", "surv", "guess", "quiz", "trade", "memory", "bracket", "statline", "hothand"]);
function checkArcade(kind, e) {
  if (!e || typeof e !== "object") throw "That result couldn't be read.";
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (kind === "hol") {
    if (!int(e.streak, 1, 1000)) throw "That streak isn't possible.";
    return { score: e.streak, row: [e.streak, 0, 0], data: { streak: e.streak } };
  }
  if (kind === "buzz") {
    // Every make is worth 2 to 5, plus 1 when you're on fire
    if (!int(e.makes, 1, 1000) || !int(e.points, 2, 6000) || e.points < e.makes * 2 || e.points > e.makes * 6) throw "That game isn't possible.";
    return { score: e.points, row: [e.points, e.makes, 0], data: { points: e.points, makes: e.makes } };
  }
  if (kind === "surv") {
    // Three lives, and a boss win (one game in ten) can win one back
    if (!int(e.wins, 1, 2000) || !int(e.losses, 0, 2000) || e.losses > 3 + Math.floor((e.wins + e.losses) / 10)) throw "That run isn't possible.";
    const players = checkPlayers(e.players, "That team");
    return { score: e.wins, row: [e.wins, e.losses, 0], data: { wins: e.wins, losses: e.losses, players } };
  }
  if (kind === "guess") {
    if (!int(e.tries, 1, 6)) throw "That isn't a possible number of guesses.";
    return { score: 7 - e.tries, row: [e.tries, 0, 0], data: { tries: e.tries } };
  }
  if (kind === "quiz") {
    if (!int(e.correct, 0, 500) || !int(e.score, 0, 500)) throw "That score isn't possible.";
    return { score: e.score, row: [e.correct, 0, 0], data: { correct: e.correct } };
  }
  if (kind === "trade" || kind === "statline" || kind === "hothand") {
    if (!int(e.streak, 1, 1000)) throw "That streak isn't possible.";
    return { score: e.streak, row: [e.streak, 0, 0], data: { streak: e.streak } };
  }
  if (kind === "memory") {
    if (!int(e.score, 1, 400) || !int(e.moves, 8, 500) || !int(e.seconds, 0, 6000)) throw "That result isn't possible.";
    return { score: e.score, row: [e.moves, e.seconds, 0], data: { moves: e.moves, seconds: e.seconds } };
  }
  // bracket
  if (!int(e.score, 0, 150) || !int(e.correct, 0, 7)) throw "That bracket isn't possible.";
  return { score: e.score, row: [e.correct, e.champ ? 1 : 0, 0], data: { correct: e.correct, champ: !!e.champ } };
}

// One of the hundred: a whole-number score from 1 up to what that game can reach
function checkX(kind, e) {
  if (!e || typeof e !== "object") throw "That result couldn't be read.";
  if (!Number.isInteger(e.score) || e.score < 1 || e.score > xCap(kind)) throw "That score isn't possible.";
  return { score: e.score, row: [e.score, 0, 0], data: {} };
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
