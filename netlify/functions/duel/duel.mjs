// Draft vs Friend over the internet: two players draft from the same five rolls, taking turns.
//
//   POST /api/duel { action: "create", token, name }               a new duel; you are player A
//   POST /api/duel { action: "join", token, name, host }           join the newest open duel of the player named host
//   POST /api/duel { action: "pick", token, code, slot, player }   your pick, when it's your turn
//   GET  /api/duel?code=XXXXX                                      the duel as it stands
//
// A duel: { code, a: { id, name }, b: { id, name } | null, rolls: [{ dec, team }] x5, picks: [{ by: 0|1, slot, name }], seed, ts }
// Each roll gives two picks; who picks first swaps every roll (A B, B A, A B, B A, A B). Player ids are the same
// public ids the leaderboard shows (a hash of each browser's secret token). Both phones work out the series
// from the seed, so they show the same games.
import { getStore, getDeployStore } from "@netlify/blobs";
import { createHash, randomInt } from "node:crypto";
import VALID from "../lb/valid.mjs";
import { cleanName, nameKey } from "../lb/lb.mjs";

const SLOTS = ["PG", "SG", "SF", "PF", "C"];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_AGE = 6 * 3600e3; // a duel lasts six hours
// Every roster with at least eight players can be rolled
const TEAMS = (() => {
  const n = new Map();
  for (const k of Object.keys(VALID)) { const [dec, team] = k.split("|"); const t = `${dec}|${team}`; n.set(t, (n.get(t) || 0) + 1); }
  return [...n].filter(([, c]) => c >= 8).map(([t]) => { const [dec, team] = t.split("|"); return { dec, team }; });
})();

export default async (req, context) => {
  const deployContext = context?.deploy?.context ?? globalThis.Netlify?.context?.deploy?.context;
  const preview = deployContext === "deploy-preview" || deployContext === "branch-deploy";
  const opts = { name: "hoops-lb", consistency: "strong" };
  return handle(req, preview ? getDeployStore(opts) : getStore(opts));
};

export const config = { path: "/api/duel" };

export async function handle(req, store) {
  try {
    if (req.method === "GET") {
      const code = new URL(req.url).searchParams.get("code") || "";
      if (!/^[A-Z2-9]{5}$/.test(code)) return reply({ error: "Bad duel code" }, 400);
      const st = await store.get(`d/${code}`, { type: "json" });
      return st && !expired(st) ? reply(publicState(st)) : reply({ error: "That duel is over or doesn't exist." }, 404);
    }
    if (req.method === "POST") return await post(req, store);
    return reply({ error: "Method not allowed" }, 405);
  } catch (e) {
    console.error(e);
    return reply({ error: "Something went wrong on the server. Try again in a moment." }, 500);
  }
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
const expired = st => Date.now() - st.ts > MAX_AGE;
const publicState = st => ({ code: st.code, a: st.a, b: st.b, rolls: st.rolls, picks: st.picks, seed: st.seed, ts: st.ts });
// Who picks the i-th pick: the first pick of each roll swaps between A (0) and B (1)
export const pickerAt = i => { const first = Math.floor(i / 2) % 2; return i % 2 === 0 ? first : 1 - first; };

async function post(req, store) {
  const text = await req.text();
  if (text.length > 4000) return reply({ error: "That's too big." }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return reply({ error: "Bad request" }, 400); }
  const { action, token } = body || {};
  if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token)) return reply({ error: "Bad player token. Reload the page and try again." }, 400);
  const id = createHash("sha256").update(token).digest("hex").slice(0, 20);
  const name = cleanName(body.name);
  if (!name || !nameKey(name)) return reply({ error: "Pick a username first." }, 400);

  if (action === "create") {
    if (!(await claimName(store, name, id))) return reply({ error: `Someone already uses the name "${name}". Pick another one.` }, 409);
    const rolls = [];
    while (rolls.length < 5) { const t = TEAMS[randomInt(TEAMS.length)]; if (!rolls.some(r => r.dec === t.dec && r.team === t.team)) rolls.push(t); }
    for (let tries = 0; tries < 8; tries++) {
      const code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
      const st = { code, a: { id, name }, b: null, rolls, picks: [], seed: randomInt(2147483647), ts: Date.now() };
      const w = await store.setJSON(`d/${code}`, st, { onlyIfNew: true });
      if (!w.modified) continue;
      await store.setJSON(`dh/${nameKey(name)}`, { code });
      return reply(publicState(st));
    }
    return reply({ error: "Couldn't start a duel. Try again." }, 503);
  }

  if (action === "join") {
    const host = cleanName(body.host);
    if (!host || !nameKey(host)) return reply({ error: "Type your friend's username." }, 400);
    if (nameKey(host) === nameKey(name)) return reply({ error: "That's your own name. Type your friend's username." }, 400);
    const ref = await store.get(`dh/${nameKey(host)}`, { type: "json" });
    if (!ref) return reply({ error: `${host} hasn't created a duel. Ask them to tap Create a duel first.` }, 404);
    if (!(await claimName(store, name, id))) return reply({ error: `Someone already uses the name "${name}". Pick another one.` }, 409);
    return await update(store, ref.code, st => {
      if (st.a.id === id) return "That's your own duel.";
      if (st.b && st.b.id !== id) return `${host}'s duel already has two players. Ask them to create a new one.`;
      st.b = { id, name };
    });
  }

  if (action === "pick") {
    const code = String(body.code || "");
    if (!/^[A-Z2-9]{5}$/.test(code)) return reply({ error: "Bad duel code" }, 400);
    const { slot, player } = body;
    return await update(store, code, st => {
      const me = st.a.id === id ? 0 : st.b && st.b.id === id ? 1 : null;
      if (me === null) return "You're not in this duel.";
      if (!st.b) return "Wait for your friend to join.";
      const i = st.picks.length;
      if (i >= 10) return "The draft is over.";
      if (pickerAt(i) !== me) return "It's not your pick yet.";
      const round = Math.floor(i / 2), roll = st.rolls[round];
      if (typeof player !== "string" || typeof VALID[`${roll.dec}|${roll.team}|${player}`] !== "number") return "That player isn't on this roll.";
      if (st.picks.some((p, j) => Math.floor(j / 2) === round && p.name === player)) return "Your friend already took him.";
      if (!SLOTS.includes(slot) || st.picks.some(p => p.by === me && p.slot === slot)) return "That spot on your team is already filled.";
      st.picks.push({ by: me, slot, name: player });
    });
  }
  return reply({ error: "Unknown action" }, 400);
}

// Read, change and write back a duel; if someone else changed it in between, try again
async function update(store, code, change) {
  for (let tries = 0; tries < 4; tries++) {
    const got = await store.getWithMetadata(`d/${code}`, { type: "json" });
    if (!got || !got.data || expired(got.data)) return reply({ error: "That duel is over or doesn't exist." }, 404);
    const st = got.data, err = change(st);
    if (typeof err === "string") return reply({ error: err }, 409);
    const w = await store.setJSON(`d/${code}`, st, { onlyIfMatch: got.etag });
    if (w.modified) return reply(publicState(st));
  }
  return reply({ error: "Lots going on. Try again." }, 503);
}

// Usernames are shared with the leaderboard: first come, first served
async function claimName(store, name, id) {
  const k = `n/${nameKey(name)}`;
  const w = await store.setJSON(k, { id }, { onlyIfNew: true });
  if (w.modified) return true;
  const owner = await store.get(k, { type: "json" });
  return !owner || owner.id === id;
}
