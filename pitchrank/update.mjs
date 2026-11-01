#!/usr/bin/env node
// PitchRank updater: fetches every newly finished match from Sofascore, adds it to pitchrank/data,
// then rebuilds site/data.json (this season) and site/history/*.json (1999/00 onwards) for the website.
//
//   node pitchrank/update.mjs            update matches (and photos once a day)
//   node pitchrank/update.mjs --images   also re-match photos and badges now
//   node pitchrank/update.mjs --build    only rebuild data.json from what is stored
//
// Runs in GitHub Actions (.github/workflows/pitchrank-update.yml) every few hours, or on your own computer.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapImages } from '../site/lib/images.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'data');
const OUT = join(HERE, '..', 'site', 'data.json');
const args = new Set(process.argv.slice(2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Competitions: [sofascore id, L = league, C = domestic cup, E = continental]
export const COMPS = [[17,'L'],[18,'L'],[8,'L'],[23,'L'],[35,'L'],[34,'L'],[37,'L'],[238,'L'],[38,'L'],[36,'L'],[52,'L'],[45,'L'],[215,'L'],[39,'L'],[20,'L'],[40,'L'],[185,'L'],[172,'L'],[170,'L'],[210,'L'],[202,'L'],[218,'L'],[152,'L'],[187,'L'],[211,'L'],[212,'L'],[247,'L'],[192,'L'],[41,'L'],[203,'L'],[11621,'L'],[955,'L'],[266,'L'],[242,'L'],[19,'C'],[21,'C'],[329,'C'],[328,'C'],[217,'C'],[335,'C'],[336,'C'],[330,'C'],[96,'C'],[332,'C'],[7,'E'],[679,'E'],[17015,'E'],[463,'E'],[13783,'E'],
  [44,'L'],[54,'L'],[53,'L'],[182,'L'],[24,'L'],[25,'L'],[131,'L'],[239,'L'],[325,'L'],[155,'L'],[11539,'L'],[196,'L'],[410,'L'],[136,'L'],[649,'L'],[825,'L'],[971,'L'],[808,'L'],[937,'L'],[406,'L'],[278,'L'],[13363,'L'],[384,'E'],[480,'E'],[498,'E'],[668,'E']];
const AMERICAS = new Set([11621, 242, 13783, 325, 155, 11539, 406, 278, 13363, 384, 480, 498]);
const ASIA = new Set([955, 463, 196, 410, 136, 649, 825, 971, 668]);
const AFRICA = new Set([808, 937]);
const region = (id) => (AMERICAS.has(id) ? 'am' : ASIA.has(id) ? 'as' : AFRICA.has(id) ? 'af' : 'eu');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-GB,en;q=0.9',
  Referer: 'https://www.sofascore.com/',
};
let blocked = 0;
async function get(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch('https://www.sofascore.com/api/v1/' + path, { headers: HEADERS });
      if (r.status === 404) return null;
      if (r.ok) return await r.json();
      if (r.status === 403) blocked++;
    } catch {}
    await sleep(1500 * (i + 1));
  }
  return null;
}
async function getJson(url) {
  try { const r = await fetch(url, { headers: HEADERS }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); await sleep(120); } }));
}

// ---------- load ----------
const meta = JSON.parse(readFileSync(join(DATA, 'meta.json'), 'utf8'));
const matches = readFileSync(join(DATA, 'matches.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byId = new Map(matches.map((m) => [m.id, m]));
const K = meta.K;
const compMeta = new Map(meta.comps.map((c) => [c.id, c]));

// ---------- fetch one match ----------
async function fetchMatch(id) {
  const [lu, inc] = await Promise.all([get(`event/${id}/lineups`), get(`event/${id}/incidents`)]);
  const cards = {}, pmiss = {}, subIn = {}, subOut = {}, goals = [];
  for (const x of (inc && inc.incidents) || []) {
    if (x.incidentType === 'card' && x.player) { const c = (cards[x.player.id] ||= [0, 0]); if (x.incidentClass === 'yellow') c[0]++; else c[1]++; }
    else if (x.incidentType === 'inGamePenalty' && x.incidentClass === 'missed' && x.player) pmiss[x.player.id] = (pmiss[x.player.id] || 0) + 1;
    else if (x.incidentType === 'substitution') { if (x.playerIn) subIn[x.playerIn.id] = x.time; if (x.playerOut) subOut[x.playerOut.id] = x.time; }
    else if (x.incidentType === 'goal') goals.push([x.isHome ? 1 : 0, x.time]);
  }
  if (!lu || !lu.home) return null;
  const rows = [];
  for (const side of ['home', 'away']) {
    const home = side === 'home';
    for (const pl of lu[side].players || []) {
      const st = pl.statistics || {};
      const min = st.minutesPlayed || 0;
      if (!min) continue;
      const p = pl.player;
      if (!meta.players[p.id]) meta.players[p.id] = [p.name, pl.position || p.position || '', p.dateOfBirthTimestamp || null, p.country ? p.country.alpha2 : '', p.shortName || ''];
      const from = pl.substitute ? (subIn[p.id] || 90 - min) : 0, to = subOut[p.id] || 200;
      let gc = 0; for (const [gh, t] of goals) if (gh !== (home ? 1 : 0) && t > from && t <= to) gc++;
      const c = cards[p.id] || [0, 0];
      rows.push([p.id, home ? 1 : 0, pl.substitute ? 1 : 0, ...K.map((k) => { const v = st[k]; return v == null ? 0 : k === 'expectedGoals' ? Math.round(v * 100) : k === 'rating' ? Math.round(v * 10) : v; }), c[0], c[1], pmiss[p.id] || 0, gc]);
    }
  }
  return rows;
}

// ---------- update ----------
async function update() {
  const now = Date.now() / 1000;
  const fresh = [];
  for (const [id, type] of COMPS) {
    let cm = compMeta.get(id);
    const ss = await get(`unique-tournament/${id}/seasons`);
    if (!ss || !ss.seasons) { log(`competition ${id}: seasons unavailable`); continue; }
    // newest season with a finished match
    let season = null, firstPage = null;
    for (const s of ss.seasons.slice(0, 2)) {
      const j = await get(`unique-tournament/${id}/season/${s.id}/events/last/0`);
      if (j && j.events && j.events.some((e) => e.status && e.status.type === 'finished')) { season = s; firstPage = j; break; }
    }
    if (!season) continue;
    if (!cm) {
      const info = await get(`unique-tournament/${id}`);
      const ut = info && info.uniqueTournament;
      cm = { id, type, name: ut ? ut.name : String(id), country: ut ? ut.category.name : '', alpha2: (ut && ut.category.alpha2) || '', season: season.name, seasonId: season.id };
      meta.comps.push(cm); compMeta.set(id, cm);
    } else if (cm.seasonId !== season.id) {
      log(`competition ${id}: new season ${season.name}`);
      cm.season = season.name; cm.seasonId = season.id;
    }
    let added = 0;
    for (let p = 0; p < 40; p++) {
      const j = p === 0 ? firstPage : await get(`unique-tournament/${id}/season/${season.id}/events/last/${p}`);
      if (!j || !j.events) break;
      let newOnPage = 0;
      for (const e of j.events) {
        if (!(e.status && e.status.type === 'finished')) continue;
        const old = byId.get(e.id);
        if (old && !(old.rows.length === 0 && now - e.startTimestamp < 4 * 86400)) continue;
        newOnPage++;
        meta.teams[e.homeTeam.id] = e.homeTeam.name; meta.teams[e.awayTeam.id] = e.awayTeam.name;
        if (e.homeTeam.teamColors && !meta.colors[e.homeTeam.id]) meta.colors[e.homeTeam.id] = [e.homeTeam.teamColors.primary, e.homeTeam.teamColors.secondary];
        if (e.awayTeam.teamColors && !meta.colors[e.awayTeam.id]) meta.colors[e.awayTeam.id] = [e.awayTeam.teamColors.primary, e.awayTeam.teamColors.secondary];
        const m = old || { id: e.id, t: id, s: season.id, ts: e.startTimestamp, h: e.homeTeam.id, a: e.awayTeam.id, hs: 0, as: 0, rows: [] };
        m.hs = e.homeScore.current ?? 0; m.as = e.awayScore.current ?? 0;
        if (!old) { matches.push(m); byId.set(m.id, m); }
        fresh.push(m); added++;
      }
      if (!j.hasNextPage || (p > 0 && newOnPage === 0)) break;
    }
    if (added) log(`competition ${id} (${cm.name}): ${added} new`);
  }
  log(`fetching ${fresh.length} match lineups`);
  let got = 0;
  await pool(fresh, 4, async (m) => { const rows = await fetchMatch(m.id); if (rows) { m.rows = rows; got++; } });
  log(`lineups saved for ${got}/${fresh.length}`);
  if (blocked > 20 && fresh.length === 0) log('Sofascore refused most requests (403). Run the updater from your own computer instead; see pitchrank/README.md.');
  meta.updated = new Date().toISOString();
  return fresh.length;
}

// ---------- photos & badges ----------
async function images() {
  const last = meta.imagesAt ? Date.parse(meta.imagesAt) : 0;
  if (!args.has('--images') && Date.now() - last < 20 * 3600 * 1000) return;
  meta.images ||= { t: {}, p: {} };
  const tried = new Set(meta.imagesTried || []);
  const leagues = [];
  for (const cm of meta.comps) {
    if (cm.type !== 'L') continue;
    const teams = new Map();
    for (const m of matches) {
      if (m.t !== cm.id) continue;
      for (const tid of [m.h, m.a]) if (!teams.has(tid)) teams.set(tid, { id: tid, name: meta.teams[tid], players: new Map() });
      for (const r of m.rows) {
        const tid = r[1] ? m.h : m.a, pid = r[0];
        if (!meta.images.p[pid] && (args.has('--images') || !tried.has(pid))) teams.get(tid).players.set(pid, meta.players[pid][0]);
      }
    }
    leagues.push({ sofaId: cm.id, teams: [...teams.values()].map((t) => ({ ...t, players: [...t.players.entries()] })) });
  }
  const before = Object.keys(meta.images.p).length;
  meta.images = await mapImages({ leagues }, meta.images, { fetchJson: getJson, log });
  for (const lg of leagues) for (const t of lg.teams) for (const [pid] of t.players) tried.add(pid);
  meta.imagesTried = [...tried];
  meta.imagesAt = new Date().toISOString();
  log(`photos matched: ${Object.keys(meta.images.p).length} (+${Object.keys(meta.images.p).length - before}), badges: ${Object.keys(meta.images.t).length}`);
}

// ---------- build site data ----------
function b36(x) { return Math.trunc(x).toString(36); }
function build() {
  const ki = Object.fromEntries(K.map((k, i) => [k, i + 3])); // row: pid, home, sub, ...K, yc, rc, pmi, gc
  const n = 3 + K.length, YC = n, RC = n + 1, PMI = n + 2, GC = n + 3;
  const cur = matches.filter((m) => { const c = compMeta.get(m.t); return c && (m.s == null || m.s === c.seasonId); }).sort((a, b) => a.ts - b.ts);
  const compIdx = new Map(meta.comps.map((c, i) => [c.id, i]));
  const t0 = cur.length ? cur[0].ts : 0;
  const ev = [];
  const best = new Map();
  cur.forEach((m, i) => {
    ev.push(compIdx.get(m.t), Math.round((m.ts - t0) / 60), m.h, m.a, m.hs, m.as);
    for (const r of m.rows) { const rt = r[ki.rating]; if (rt && (!best.has(i) || rt > best.get(i)[0])) best.set(i, [rt, r[0]]); }
  });
  const byPl = new Map();
  cur.forEach((m, i) => { for (const r of m.rows) { if (!byPl.has(r[0])) byPl.set(r[0], []); byPl.get(r[0]).push([i, m, r]); } });
  const pl = [], ap = [];
  for (const [pid, list] of byPl) {
    const info = meta.players[pid] || ['?', 'M', null, '', ''];
    let [name, pos, dob, cc, short] = info;
    if (!'GDMF'.includes(pos) || !pos) pos = 'M';
    const [, lm, lr] = list[list.length - 1];
    const team = lr[1] ? lm.h : lm.a;
    let dobi = 0;
    if (dob) { const d = new Date(dob * 1000); dobi = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }
    pl.push([pid, name, short || name, pos, dobi, cc || '', team]);
    const parts = [];
    for (const [i, m, r] of list) {
      const g = (k) => r[ki[k]] || 0;
      const goals = g('goals');
      const sot = Math.max(g('onTargetScoringAttempt'), goals);
      const shots = Math.max(g('onTargetScoringAttempt') + g('shotOffTarget') + g('blockedScoringAttempt') + g('hitWoodwork'), sot);
      const tid = r[1] ? m.h : m.a;
      const f = [i, g('minutesPlayed'), g('rating'), goals, g('goalAssist'), sot, shots, g('totalClearance'), g('totalTackle') + g('interceptionWon'),
        g('saves'), g('expectedGoals'), g('keyPass'), r[YC] || 0, r[RC] || 0, g('ownGoals'), Math.max(g('penaltyMiss'), r[PMI] || 0), g('penaltySave'),
        r[GC] || 0, best.has(i) && best.get(i)[1] === pid ? 1 : 0, g('bigChanceCreated'), g('wonContest'), tid === team ? 0 : tid,
        g('accuratePass'), g('totalPass'), g('errorLeadToAGoal')];
      while (f.length > 2 && f[f.length - 1] === 0) f.pop();
      parts.push(f.map(b36).join(','));
    }
    ap.push(parts.join(';'));
  }
  const teams = {};
  const usedT = new Set(); cur.forEach((m) => { usedT.add(m.h); usedT.add(m.a); });
  for (const tid of usedT) teams[tid] = [meta.teams[tid] || '?', ...(meta.colors[tid] || [])];
  const img = { t: {}, p: {} };
  for (const tid of usedT) if (meta.images && meta.images.t[tid]) img.t[tid] = meta.images.t[tid];
  for (const [pid] of byPl) if (meta.images && meta.images.p[pid]) img.p[pid] = meta.images.p[pid];
  const data = {
    updated: meta.updated, t0,
    comps: meta.comps.map((c) => [c.id, c.type, c.name, c.country, c.alpha2 || '', c.season, region(c.id)]),
    teams, ev, pl, ap, img,
  };
  // split players across two files so each stays well under 10 MB
  const half = Math.ceil(pl.length / 2);
  writeFileSync(OUT, JSON.stringify({ ...data, pl: pl.slice(0, half), ap: ap.slice(0, half), parts: 2 }));
  writeFileSync(OUT.replace('data.json', 'data-2.json'), JSON.stringify({ pl: pl.slice(half), ap: ap.slice(half) }));
  log(`data.json: ${pl.length} players, ${cur.length} matches, ${(JSON.stringify(data).length / 1e6).toFixed(1)} MB`);
}


// ---------- world season stats: every player in every crawled competition ----------
const AM2 = new Set('us ca mx gt hn sv ni cr pa cu do ht jm tt bb bs bz ag dm gd kn lc vc pr aw cw bm gy sr gf br ar uy py cl bo pe ec co ve gp mq'.split(' '));
const AF2 = new Set('dz eg ly ma tn sd ss et er dj so ke ug tz rw bi cd cg ga gq cm cf td ne ng bj tg gh ci bf ml sn gm gw gn sl lr mr cv st ao zm zw mw mz na bw za ls sz mg mu sc km re'.split(' '));
const AS2 = new Set('sa ae qa bh kw om ye iq ir jo lb sy ps af pk in bd lk np bt mv mm th la kh vn my sg id ph bn tl cn hk mo tw kr kp jp mn uz kg tj tm'.split(' '));
const OC2 = new Set('au nz fj pg sb vu nc pf ws to'.split(' '));
const REGION_NAME = { europe: 'eu', 'south america': 'am', 'north & central america': 'am', 'north america': 'am', asia: 'as', africa: 'af', oceania: 'oc', world: 'eu' };
const COUNTRY2 = existsSync(join(DATA, 'countries.json')) ? JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8')) : {};
function country2(name) { if (!name) return ''; const k = String(name).toLowerCase(); return COUNTRY2[k] || ''; }
function regionOf(country, a2) {
  const n = String(country || '').toLowerCase(); if (REGION_NAME[n]) return REGION_NAME[n];
  const c = (country2(country) || String(a2 || '')).toLowerCase();
  return AM2.has(c) ? 'am' : AF2.has(c) ? 'af' : AS2.has(c) ? 'as' : OC2.has(c) ? 'oc' : 'eu';
}
const CUP_IDS = new Set([19, 21, 329, 328, 217, 335, 336, 330, 96, 332]);
const CONT_IDS = new Set([7, 679, 17015, 463, 13783, 384, 480, 498, 668]);
async function worldUpdate() {
  const file = join(DATA, 'world.json');
  if (!existsSync(file)) return;
  const W = JSON.parse(readFileSync(file, 'utf8'));
  const last = W.at ? Date.parse(W.at) : 0;
  if (!args.has('--world') && Date.now() - last < 20 * 3600 * 1000) return;
  const F = W.FK.join(',');
  let n = 0;
  await pool(W.plan, 3, async (t) => {
    const prev = W.tourn[t.id];
    if (!prev || !prev.seasonId) return;
    const rows = [];
    for (let off = 0; off < 8000; off += 100) {
      const j = await get(`unique-tournament/${t.id}/season/${prev.seasonId}/statistics?limit=100&offset=${off}&order=-minutesPlayed&accumulation=total&fields=${F}`);
      if (!j || !j.results || !j.results.length) break;
      for (const r of j.results) {
        if (!r.player) continue; const p = r.player, tm = r.team || {};
        if (tm.id) prev.teams[tm.id] = tm.name;
        rows.push([p.id, p.name, p.position || '', tm.id || 0, ...W.FK.map((k) => { const v = r[k]; return v == null ? -1 : (['rating', 'expectedGoals', 'expectedAssists', 'goalsPrevented'].includes(k) ? Math.round(v * 100) : v); })]);
      }
      if (off / 100 + 1 >= (j.pages || 1)) break;
    }
    if (rows.length) { prev.rows = rows; n++; }
  });
  W.at = new Date().toISOString();
  writeFileSync(file, JSON.stringify(W));
  log(`world stats refreshed for ${n} competitions`);
}
function buildWorld() {
  const file = join(DATA, 'world.json');
  if (!existsSync(file)) return;
  const W = JSON.parse(readFileSync(file, 'utf8'));
  const FK = W.FK, mi = FK.indexOf('minutesPlayed');
  const comps = [], cidx = new Map();
  const NATIONAL = /world cup|nations league|euro 20|european championship|copa am[eé]rica|africa cup|asian cup|gold cup|qualif|friendl|olympic/i;
  const stale = (season) => { const ys = String(season || '').match(/\b(19|20)\d\d\b/g); return !!ys && Math.max(...ys.map(Number)) < new Date().getUTCFullYear() - 1; };
  const tourn = Object.values(W.tourn).filter((t) => t.rows && t.rows.length && String(t.country).toLowerCase() !== 'world' && !NATIONAL.test(t.name) && !/^euro$/i.test(t.name) && !stale(t.season)).sort((a, b) => (b.users || 0) - (a.users || 0));
  for (const t of tourn) {
    const type = CUP_IDS.has(t.id) ? 'C' : CONT_IDS.has(t.id) ? 'E' : 'L';
    cidx.set(t.id, comps.length);
    comps.push([t.id, t.name, t.country, t.alpha2 || '', t.season || '', regionOf(t.country, t.alpha2), t.users || 0, (W.fmLeagues || {})[t.id] || 0, type]);
  }
  const teamLeague = {}, teams = {}, rows = [], used = new Set();
  for (const t of tourn) {
    const ci = cidx.get(t.id);
    for (const r of t.rows) {
      if (!(r[4 + mi] > 0)) continue;
      const vals = r.slice(4).map((x) => (x < 0 ? '' : Math.trunc(x).toString(36)));
      while (vals.length && vals[vals.length - 1] === '') vals.pop();
      rows.push(`${r[0]}|${String(r[1]).replace(/\|/g, ' ')}|${r[2]}|${r[3]}|${ci}|${vals.join(',')}`);
      used.add(r[0]);
      if (r[3]) {
        const c = comps[ci];
        if (c[8] === 'L' && (teamLeague[r[3]] == null || comps[teamLeague[r[3]]][6] < c[6])) teamLeague[r[3]] = ci;
        if (!teams[r[3]]) teams[r[3]] = [t.teams[r[3]] || meta.teams[r[3]] || '?', ...((t.colors || {})[r[3]] || meta.colors[r[3]] || ['', ''])];
      }
    }
  }
  for (const tid in teams) { teams[tid][3] = (W.fm.t[tid] || meta.images.t[tid] || 0); teams[tid][4] = teamLeague[tid] ?? null; }
  const info = {};
  for (const pid of used) {
    const f = W.fm.p[pid];
    if (!f) { const fm = meta.images && meta.images.p[pid]; if (fm) info[pid] = [fm, 0, '', 0, 0, '']; continue; }
    const [fm, dob, ccode, h, val, pd, cname] = f;
    const d = dob ? +dob.replace(/-/g, '') : 0;
    info[pid] = [fm, d, country2(cname) || '', h || 0, val || 0, pd || ''];
  }
  const n = 3, size = Math.ceil(rows.length / n);
  const out = { at: W.at, F: FK, comps, teams, info, rows: rows.slice(0, size), parts: n };
  writeFileSync(join(HERE, '..', 'site', 'world.json'), JSON.stringify(out));
  for (let k = 1; k < n; k++) writeFileSync(join(HERE, '..', 'site', `world-${k + 1}.json`), JSON.stringify({ rows: rows.slice(k * size, (k + 1) * size) }));
  log(`world.json: ${rows.length} player rows in ${comps.length} competitions, ${(JSON.stringify(out).length / 1e6).toFixed(1)} MB`);
}

// ---------- history (season totals since 1999/00) ----------
const GOALP = { F: 5, M: 6, D: 7, G: 7 }, CSP = { G: 4, D: 4, M: 1, F: 0 };
function buildHistory() {
  const file = join(DATA, 'history.ndjson');
  if (!existsSync(file)) return;
  const FK = meta.histFields;
  const fi = Object.fromEntries(FK.map((k, i) => [k, i + 5]));
  const posOf = {};
  for (const [pid, info] of Object.entries(meta.players)) if ('GDMF'.includes(info[1]) && info[1]) posOf[pid] = info[1];
  for (const [pid, p] of Object.entries(meta.histPos || {})) if (!posOf[pid]) posOf[pid] = p;
  const compType = new Map(meta.comps.map((c) => [c.id, c.type]));
  for (const c of meta.histComps || []) if (!compType.has(c.id)) compType.set(c.id, c.type);
  const names = {}, teams = {}, byYear = new Map(), all = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const cs = JSON.parse(line);
    const type = compType.get(cs.t) || 'L';
    const out = [];
    for (const r of cs.rows) {
      const v = (k) => { const x = r[fi[k]]; return x == null || x < 0 ? 0 : x; };
      const has = (k) => r[fi[k]] != null && r[fi[k]] >= 0;
      const apps = v('appearances'); if (!apps) continue;
      const pid = r[0];
      let pos = r[2] || posOf[pid] || '';
      if (!'GDMF'.includes(pos) || !pos) pos = v('saves') > 0 ? 'G' : 'M';
      names[pid] = r[1]; if (r[3]) teams[r[3]] = r[4];
      const min = v('minutesPlayed');
      const starts = has('matchesStarted') ? v('matchesStarted') : Math.min(apps, Math.round(min / 85));
      const g = v('goals'), a = v('assists');
      const pts = apps + starts + g * GOALP[pos] + a * 3 + v('cleanSheet') * CSP[pos] + Math.floor(v('clearances') / 3)
        + Math.floor((v('tackles') + v('interceptions')) / 4) + Math.floor(v('shotsOnTarget') / 2) + Math.floor(v('saves') / 3)
        + v('penaltySave') * 5 + (type === 'E' ? g + a : 0) - v('yellowCards') - 3 * v('redCards') - 2 * v('ownGoals')
        - (pos === 'G' ? Math.floor(v('goalsConceded') / 2) : 0);
      const rt = has('rating') ? v('rating') : 0;
      out.push([pid, r[3] || 0, pos, apps, min, g, a, pts, v('cleanSheet'), rt, v('expectedGoals')]);
      const A = all.get(pid) || { pts: 0, apps: 0, g: 0, a: 0, min: 0, seasons: new Set(), best: 0, bestY: '', pos, teams: new Map() };
      A.pts += pts; A.apps += apps; A.g += g; A.a += a; A.min += min; A.seasons.add(cs.y); A.pos = pos;
      A.teams.set(r[3], (A.teams.get(r[3]) || 0) + apps);
      if (pts > A.best) { A.best = pts; A.bestY = cs.year; }
      all.set(pid, A);
    }
    if (!out.length) continue;
    if (!byYear.has(cs.y)) byYear.set(cs.y, []);
    byYear.get(cs.y).push({ t: cs.t, label: cs.year, rows: out });
  }
  const dir = join(HERE, '..', 'site', 'history');
  mkdirSync(dir, { recursive: true });
  const years = [...byYear.keys()].sort((a, b) => b - a);
  for (const y of years) {
    const comps = byYear.get(y);
    const pids = new Set(); const tids = new Set();
    for (const c of comps) for (const r of c.rows) { pids.add(r[0]); tids.add(r[1]); }
    const n = {}; for (const pid of pids) n[pid] = names[pid];
    const tm = {}; for (const tid of tids) if (teams[tid]) tm[tid] = teams[tid];
    writeFileSync(join(dir, `${y}.json`), JSON.stringify({ y, comps, names: n, teams: tm }));
  }
  const top = [...all.entries()].filter(([, A]) => A.pts >= 40).sort((a, b) => b[1].pts - a[1].pts);
  const tm = {};
  const rows = top.map(([pid, A]) => {
    const mainTeam = [...A.teams.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (teams[mainTeam]) tm[mainTeam] = teams[mainTeam];
    const ys = [...A.seasons].sort();
    return [+pid, names[pid], A.pos, A.pts, A.apps, A.g, A.a, A.min, ys.length, ys[0], ys[ys.length - 1], A.best, A.bestY, mainTeam];
  });
  const comps = {}; for (const c of meta.histComps || []) comps[c.id] = [c.name, c.country, c.alpha2 || '', c.type];
  for (const c of meta.comps) comps[c.id] ||= [c.name, c.country, c.alpha2 || '', c.type];
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ years, comps, teams: tm, all: rows }));
  log(`history: ${years.length} seasons, ${rows.length} players in the all-time table`);
}

function save() {
  writeFileSync(join(DATA, 'meta.json'), JSON.stringify(meta));
  matches.sort((a, b) => a.ts - b.ts || a.id - b.id);
  writeFileSync(join(DATA, 'matches.ndjson'), matches.map((m) => JSON.stringify(m)).join('\n') + '\n');
}

if (!args.has('--build')) {
  await update();
  await images();
  await worldUpdate();
  save();
}
build();
buildHistory();
buildWorld();
