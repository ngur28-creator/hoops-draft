// Matches PitchRank clubs and players to FotMob ids so the site can show club badges and player photos.
// Used by pitchrank/update.mjs (Node) and runnable in a browser. Pure: give it data and a fetch function.

// Sofascore tournament id -> FotMob league id
export const FOTMOB_LEAGUES = {
  17: 47, 18: 48, 8: 87, 23: 55, 35: 54, 34: 53, 37: 57, 238: 61, 38: 40, 36: 64, 52: 71, 45: 38, 215: 69,
  39: 46, 20: 59, 40: 67, 185: 135, 172: 122, 170: 252, 210: 182, 202: 196, 218: 441, 152: 189, 187: 212,
  211: 176, 212: 173, 247: 270, 192: 126, 41: 51, 203: 63, 11621: 230, 955: 536, 266: 127, 242: 130,
};

const STOP = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'as', 'club', 'de', 'del', 'cd', 'ud', 'sv', 'fk', 'nk', 'sk', 'if', 'bk', 'ff',
  'ss', 'us', 'rc', 'rcd', 'ca', 'cs', 'sd', 'kv', 'krc', 'vfl', 'vfb', 'tsg', 'fsv', 'ssc', 'calcio', 'football', 'futbol',
  'the', 'and', 'city', 'united', 'utd', '1', 'real', 'sporting', 'clube', 'athletic', 'atletico', 'olympique', 'stade', 'sl', 'gnk', 'hnk', 'pfc', 'fkk', 'mfk', 'jk', 'ik', 'aik', 'sfc']);
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ł/g, 'l').replace(/ß/g, 'ss').replace(/đ/g, 'd').replace(/ı/g, 'i')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter((t) => t && !STOP.has(t));

function teamScore(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  const ta = toks(a), tb = toks(b);
  if (!ta.length || !tb.length) return na.includes(nb) || nb.includes(na) ? 0.7 : 0;
  let hit = 0;
  for (const x of ta) if (tb.some((y) => y === x || (x.length >= 4 && y.length >= 4 && (y.startsWith(x) || x.startsWith(y))))) hit++;
  const j = hit / Math.max(ta.length, tb.length);
  return Math.max(j, ta.join('') === tb.join('') ? 1 : 0);
}

function playerKey(name) {
  const t = norm(name).split(' ').filter(Boolean);
  return { full: t.join(' '), last: t[t.length - 1] || '', first: t[0] || '', toks: t };
}
function matchPlayers(ours, theirs) {
  // ours: [[pid, name]], theirs: [{id, name}] -> {pid: fmId}
  const out = {};
  const T = theirs.map((x) => ({ id: x.id, k: playerKey(x.name) }));
  const used = new Set();
  const pass = (test) => {
    for (const [pid, name] of ours) {
      if (out[pid]) continue;
      const k = playerKey(name);
      const c = T.filter((x) => !used.has(x.id) && test(k, x.k));
      if (c.length === 1) { out[pid] = c[0].id; used.add(c[0].id); }
    }
  };
  pass((a, b) => a.full === b.full);
  pass((a, b) => a.toks.length > 1 && b.toks.length > 1 && a.last === b.last && a.first[0] === b.first[0]);
  pass((a, b) => a.toks.every((t) => b.toks.includes(t)) || b.toks.every((t) => a.toks.includes(t)));
  pass((a, b) => a.last.length > 3 && a.last === b.last);
  return out;
}

function tableTeams(j) {
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o.all && Array.isArray(o.all)) for (const r of o.all) if (r && r.id && r.name) out.push({ id: r.id, name: r.name, short: r.shortName });
    for (const k of ['table', 'tables', 'data']) if (o[k]) walk(o[k]);
  };
  walk(j.table);
  const seen = new Set();
  return out.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
}

/**
 * input.leagues: [{ sofaId, teams: [{ id, name, players: [[pid, name], ...] }] }]
 * existing: { t: {teamId: fmId}, p: {pid: fmId} } — already-matched ids are kept and teams fully matched are skipped
 * opts.fetchJson(url) -> parsed JSON (or null); opts.log(msg)
 */
export async function mapImages(input, existing = { t: {}, p: {} }, opts = {}) {
  const fetchJson = opts.fetchJson;
  const log = opts.log || (() => {});
  const res = { t: { ...existing.t }, p: { ...existing.p } };
  for (const lg of input.leagues) {
    const fm = FOTMOB_LEAGUES[lg.sofaId];
    if (!fm) continue;
    const pending = lg.teams.filter((tm) => !res.t[tm.id] || tm.players.some(([pid]) => !res.p[pid]));
    if (!pending.length) continue;
    const j = await fetchJson(`https://www.fotmob.com/api/data/leagues?id=${fm}`);
    if (!j) { log(`league ${lg.sofaId}: no data`); continue; }
    const theirs = tableTeams(j);
    // greedy best pairs
    const pairs = [];
    for (const tm of lg.teams) for (const f of theirs) {
      const s = Math.max(teamScore(tm.name, f.name), f.short ? teamScore(tm.name, f.short) : 0);
      if (s >= 0.5) pairs.push([s, tm.id, f.id]);
    }
    pairs.sort((a, b) => b[0] - a[0]);
    const usedT = new Set(), usedF = new Set();
    for (const [, tid, fid] of pairs) {
      if (usedT.has(tid) || usedF.has(fid)) continue;
      usedT.add(tid); usedF.add(fid);
      if (!res.t[tid]) res.t[tid] = fid;
    }
    for (const tm of pending) {
      const fid = res.t[tm.id];
      if (!fid) continue;
      const need = tm.players.filter(([pid]) => !res.p[pid]);
      if (!need.length) continue;
      const tj = await fetchJson(`https://www.fotmob.com/api/data/teams?id=${fid}`);
      const groups = (tj && tj.squad && tj.squad.squad) || [];
      const members = [];
      for (const g of groups) for (const m of g.members || []) if (m && m.id && m.name) members.push({ id: m.id, name: m.name });
      Object.assign(res.p, matchPlayers(need, members));
    }
    log(`league ${lg.sofaId}: ${usedT.size}/${lg.teams.length} clubs`);
  }
  return res;
}
