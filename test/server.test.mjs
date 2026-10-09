// Tests for the leaderboard API against an in-memory stand-in for Netlify Blobs.
process.env.HOOPS_TK_SECRET = "test-secret";
process.env.HOOPS_OWNER_HASH = "6ac7d958de501c93a3300a8551c85a0fadf2637b60d8d7da425459137862fdcb";
import { handle, dayPT } from "../netlify/functions/lb/lb.mjs";
import { botDraft, botFinish } from "../netlify/functions/lb/engine.mjs";
import assert from "node:assert/strict";
import { memoryStore } from "./memory-store.mjs";


const store = memoryStore();
const call = async (method, query = "", body) => {
  const req = new Request("http://test/api/lb" + query, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
  const res = await handle(req, store);
  return { status: res.status, body: await res.json() };
};
const tok = c => c.repeat(32);
const SL = ["PG", "SG", "SF", "PF", "C"];
// The two seasons on the current Claude board (ratings deliberately inflated to 99: the server must ignore them)
const bobNormal = {"w": 79, "l": 3, "champ": true, "hard": false, "date": "Oct 3", "reached": 3, "pw": 16, "pl": 3, "pf": 9930, "pa": 8134, "players": [{"slot": "PG", "name": "Damian Lillard", "dec": "2020s", "team": "Trail Blazers", "ovr": 99}, {"slot": "SG", "name": "Nikola Jokić", "dec": "2020s", "team": "Nuggets", "ovr": 99}, {"slot": "SF", "name": "Elton Brand", "dec": "2000s", "team": "Clippers", "ovr": 99}, {"slot": "PF", "name": "Andre Drummond", "dec": "2010s", "team": "Pistons", "ovr": 99}, {"slot": "C", "name": "Kevin Love", "dec": "2010s", "team": "Timberwolves", "ovr": 99}], "box": [{"ppg": 25, "rpg": 4.5, "apg": 7.4, "spg": 1.1, "bpg": 0.4}, {"ppg": 21.4, "rpg": 11.8, "apg": 9.9, "spg": 1.6, "bpg": 0.9}, {"ppg": 16.1, "rpg": 9.8, "apg": 2.5, "spg": 1.1, "bpg": 2.2}, {"ppg": 11.6, "rpg": 13.7, "apg": 1.3, "spg": 1.3, "bpg": 1.7}, {"ppg": 20.3, "rpg": 13.3, "apg": 3, "spg": 0.8, "bpg": 0.5}]};
const bobHard = {"w": 79, "l": 3, "champ": true, "hard": true, "date": "Oct 3", "reached": 3, "pw": 16, "pl": 6, "pf": 9586, "pa": 8241, "players": [{"slot": "PG", "name": "Tiny Archibald", "dec": "1970s", "team": "Nets", "ovr": 99}, {"slot": "SG", "name": "Kevin Garnett", "dec": "1990s", "team": "Timberwolves", "ovr": 99}, {"slot": "SF", "name": "Elton Brand", "dec": "2000s", "team": "Clippers", "ovr": 99}, {"slot": "PF", "name": "Elvin Hayes", "dec": "1960s", "team": "Rockets", "ovr": 99}, {"slot": "C", "name": "Joel Embiid", "dec": "2020s", "team": "76ers", "ovr": 99}], "box": [{"ppg": 17.1, "rpg": 2.2, "apg": 7.3, "spg": 1.7, "bpg": 0.4}, {"ppg": 14.2, "rpg": 9.2, "apg": 3.4, "spg": 1.5, "bpg": 2.1}, {"ppg": 15.4, "rpg": 10, "apg": 2.5, "spg": 1.1, "bpg": 2.4}, {"ppg": 19.2, "rpg": 12.6, "apg": 1.8, "spg": 1, "bpg": 2.4}, {"ppg": 24.8, "rpg": 10.7, "apg": 4.4, "spg": 1.1, "bpg": 1.5}]};
const results = [];
const t = async (name, fn) => { try { await fn(); results.push("PASS " + name); } catch (e) { results.push("FAIL " + name + ": " + e.message); } };


// Real seasons: a ticket from the server, then a bot drafts and plays it exactly the way the page does
const ticket = async () => (await call("GET", "?ticket=1")).body.tk;
const seedOf = tk => tk.split(".")[0];
let rnd = 1; const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
// The page tips off by sending its finished draft for its season seed, then plays the season from it
const tipOff = async proof => { const r = await call("POST", "", { action: "season", ...proof }); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body.ss; };
const playSeason = async (mode, opts = {}) => {
  const tk = mode === "monthly" ? null : await ticket(), seed = tk && seedOf(tk);
  const proof = botDraft(mode, seed, { ...opts, tk });
  return botFinish(proof, seed, await tipOff(proof));
};
const real = (opts = {}) => playSeason("free", opts);
const pts = r => r.w * 10 + (r.champ ? 500 + (12 - Math.min(12, r.pl)) * 10 : Math.min(15, r.pw) * 10) + (r.w === 82 ? 1000 : 0) + (r.hard ? 200 : 0);
// A handful of real seasons, best first
const pool = [];
for (let i = 0; i < 8; i++) pool.push(await real({ random: i % 2 ? rand : null }));
pool.sort((a, b) => pts(b) - pts(a));
const [top, second] = pool, low = pool[pool.length - 1];

await t("empty board", async () => { const r = await call("GET", "?board=normal"); assert.equal(r.status, 200); assert.deepEqual(r.body.entries, []); });
await t("a ticket is handed out", async () => { const tk = await ticket(); assert.match(tk, /^[0-9a-f]{32}\.[0-9a-z]+\.[0-9a-f]{32}$/); });
await t("a real season goes on the board with the game's own score", async () => {
  const r = await call("POST", "", { board: "normal", token: tok("b"), name: "bob", run: second });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, pts(second)); assert.equal(r.body.rank, 1);
});
await t("a real hard mode season goes on the Hard Mode board, +200", async () => {
  const run = await real({ hard: true });
  const r = await call("POST", "", { board: "hard", token: tok("b"), name: "bob", run });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, pts(run));
});
await t("hard season can't go on the normal board, and normal can't go on the hard one", async () => {
  let r = await call("POST", "", { board: "normal", token: tok("c"), name: "Cat", run: await real({ hard: true }) }); assert.equal(r.status, 400); assert.match(r.body.error, /Hard Mode board/);
  r = await call("POST", "", { board: "hard", token: tok("c"), name: "Cat", run: await real() }); assert.equal(r.status, 400); assert.match(r.body.error, /Only hard mode/);
});
await t("same name with different capitals/dots is taken", async () => {
  const r = await call("POST", "", { board: "normal", token: tok("c"), name: "B.O.B", run: await real() });
  assert.equal(r.status, 409); assert.match(r.body.error, /already uses the name/);
});
await t("CHEAT: a faked record is refused", async () => {
  const run = await real();
  for (const fake of [{ ...run, w: 82, l: 0 }, { ...run, w: run.w + 1, l: run.l - 1 }, { ...run, champ: true, reached: 3, pw: 16, pl: 0 }, { ...run, pw: Math.min(15, run.pw + 1) }]) {
    if (fake.w > 82 || fake.l < 0) continue;
    const r = await call("POST", "", { board: "normal", token: tok("d"), name: "Dee", run: fake });
    assert.equal(r.status, 400, JSON.stringify(fake.w)); assert.match(r.body.error, /replay|playoff|impossible/);
  }
});
await t("CHEAT: a dream lineup that was never rolled is refused", async () => {
  const run = await real();
  const fake = { ...run, players: run.players.map((p, i) => i ? p : { slot: "PG", name: "Michael Jordan", dec: "1990s", team: "Bulls" }) };
  const r = await call("POST", "", { board: "normal", token: tok("d"), name: "Dee", run: fake });
  assert.equal(r.status, 400); assert.match(r.body.error, /rolls|tip off/);
});
await t("CHEAT: picks that weren't on the roll, extra re-draws or a short draft are refused", async () => {
  const run = await real();
  for (const log of [["jordami01", ...run.log.slice(1)], ["T", "T", "T", ...run.log], run.log.slice(0, 4), [...run.log, "E"]]) {
    const r = await call("POST", "", { board: "normal", token: tok("d"), name: "Dee", run: { ...run, log } });
    assert.equal(r.status, 400, log.join()); assert.match(r.body.error, /rolls|couldn't be read|tip off/);
  }
});
await t("CHEAT: a forged, missing or made-up ticket is refused", async () => {
  const run = await real();
  const [s, ts, sig] = run.tk.split(".");
  for (const tk of [undefined, "", `${s}.${ts}.${"0".repeat(32)}`, `${"a".repeat(32)}.${ts}.${sig}`, "x".repeat(80)]) {
    const r = await call("POST", "", { board: "normal", token: tok("d"), name: "Dee", run: { ...run, tk } });
    assert.equal(r.status, 400, String(tk)); assert.match(r.body.error, /ticket/);
  }
});
await t("CHEAT: impossible card levels are refused", async () => {
  const run = await real();
  const r = await call("POST", "", { board: "normal", token: tok("d"), name: "Dee", run: { ...run, cb: [15, 0, 0, 0, 0] } });
  assert.equal(r.status, 400); assert.match(r.body.error, /card levels|tip off/);
});
await t("Diamond cards are real: a season played with +3 cards replays with them", async () => {
  const run = await playSeason("free", { cb: [3, 3, 2.4, 0.3, 0] });
  const r = await call("POST", "", { board: "normal", token: tok("d"), name: "Dee", run });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
await t("CHEAT: someone else's season (its ticket) can't be posted as yours", async () => {
  const r = await call("POST", "", { board: "normal", token: tok("e"), name: "Eve", run: second });
  assert.equal(r.status, 409); assert.match(r.body.error, /already posted/);
});
await t("CHEAT: the season seed only comes once the lineup is set, and only for one lineup a draft", async () => {
  const tk = await ticket(), seed = seedOf(tk);
  const proof = botDraft("free", seed, { tk });
  const ss = await tipOff(proof);
  assert.equal(await tipOff(proof), ss); // asking again for the same lineup is fine
  const moved = { ...proof, players: [proof.players[1], proof.players[0], ...proof.players.slice(2)].map((p, i) => ({ ...p, slot: ["PG", "SG", "SF", "PF", "C"][i] })) };
  let r = await call("POST", "", { action: "season", ...moved });
  assert.equal(r.status, 409); assert.match(r.body.error, /different lineup/);
  r = await call("POST", "", { action: "season", ...proof, cb: [3, 3, 3, 3, 3] });
  assert.equal(r.status, 409);
  // a season played from a seed the page made up doesn't match
  const fake = botFinish(proof, seed, "f".repeat(32));
  r = await call("POST", "", { board: "normal", token: tok("d"), name: "Dee", run: fake });
  assert.equal(r.status, 400); assert.match(r.body.error, /replay/);
  // and one that never tipped off with the server can't go up
  const tk2 = await ticket(), p2 = botDraft("free", seedOf(tk2), { tk: tk2 });
  r = await call("POST", "", { board: "normal", token: tok("d"), name: "Dee", run: botFinish(p2, seedOf(tk2), "a".repeat(32)) });
  assert.equal(r.status, 400); assert.match(r.body.error, /tip off/);
});
await t("the owner key posts any season, and a wrong key doesn't", async () => {
  const old = { w: 82, l: 0, champ: true, hard: true, reached: 3, pw: 16, pl: 0, pf: 9900, pa: 8000, date: "Oct 8",
    players: [["PG", "Michael Jordan", "1990s", "Bulls"], ["SG", "Kobe Bryant", "2000s", "Lakers"], ["SF", "LeBron James", "2010s", "Heat"], ["PF", "Tim Duncan", "2000s", "Spurs"], ["C", "Shaquille O'Neal", "2000s", "Lakers"]].map(([slot, name, dec, team]) => ({ slot, name, dec, team })) };
  let r = await call("POST", "", { board: "hard", token: tok("b"), name: "bob", run: old, owner: "nope" });
  assert.equal(r.status, 400);
  r = await call("POST", "", { board: "hard", token: tok("b"), name: "bob", run: old, owner: "bob-3FVDTVdJfohwVolNN38D", replace: true });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 820 + 620 + 1000 + 200);
});
await t("challenge rules replay too", async () => {
  for (const rules of [["eralock"], ["franlock"], ["budget", "onestar"], ["noredraw"]]) {
    const run = await playSeason("free", { rules, redraws: rules.includes("noredraw") ? 0 : 1 });
    const r = await call("POST", "", { board: "normal", token: tok("f"), name: "Fay", run, replace: true });
    assert.equal(r.status, 200, rules + JSON.stringify(r.body));
  }
});
await t("re-draws replay", async () => {
  const run = await playSeason("free", { redraws: 1 });
  assert.equal(run.log[0], "T");
  const r = await call("POST", "", { board: "normal", token: tok("f"), name: "Fay", run, replace: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
await t("a better season replaces yours, a worse one is kept out, replace: true puts it up anyway", async () => {
  let r = await call("POST", "", { board: "normal", token: tok("7"), name: "Gil", run: low });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call("POST", "", { board: "normal", token: tok("7"), name: "Gil", run: top });
  assert.equal(r.status, 200); assert.equal(r.body.score, pts(top));
  r = await call("POST", "", { board: "normal", token: tok("7"), name: "Gil", run: low });
  assert.equal(r.body.kept, true); assert.equal(r.body.score, pts(top));
  r = await call("POST", "", { board: "normal", token: tok("7"), name: "Gil", run: low, replace: true });
  assert.equal(r.status, 200); assert.equal(r.body.score, pts(low));
});
await t("the board shows the replayed numbers and the game's own ratings, not the page's", async () => {
  const doctored = { ...top, pf: 99999, box: top.box.map(b => ({ ...b, ppg: 99 })), players: top.players.map(p => ({ ...p, ovr: 99 })) };
  const r = await call("POST", "", { board: "normal", token: tok("7"), name: "Gil", run: doctored, replace: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const e = (await call("GET", `?board=normal&id=${r.body.id}`)).body;
  assert.equal(e.box[0].ppg, top.box[0].ppg); assert.notEqual(e.players[0].ovr, 99); assert.ok(!("idx" in e) && !("ts" in e));
});
await t("the owner's password puts a season up without a replay; a wrong one doesn't", async () => {
  const run = await real({ hard: true }), fake = { ...run, w: 82, l: 0, champ: true, reached: 3, pw: 16, pl: 0 };
  let r = await call("POST", "", { board: "hard", token: tok("5"), name: "Owner", run: fake, owner: "nope" });
  assert.equal(r.status, 400);
  r = await call("POST", "", { board: "hard", token: tok("5"), name: "Owner", run: { ...fake, tk: undefined }, owner: "test-owner", replace: true });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 820 + 500 + 120 + 1000 + 200);
  r = await call("POST", "", { board: "monthly", month: dayPT().slice(0, 7), token: tok("5"), name: "Owner", entry: fake, owner: "test-owner" });
  assert.equal(r.status, 400);
  r = await call("POST", "", { board: "hard", token: tok("5"), name: "Owner", run: { ...fake, w: 83, l: -1 }, owner: "test-owner" });
  assert.equal(r.status, 400);
});
await t("an old season without a ticket can't go up", async () => {
  const { tk, ...old } = await real();
  const r = await call("POST", "", { board: "normal", token: tok("8"), name: "Hank", run: old });
  assert.equal(r.status, 400); assert.match(r.body.error, /ticket/);
});
await t("the old Daily Draft board is closed", async () => {
  const r = await call("POST", "", { board: "daily", day: dayPT(), token: tok("1"), name: "Gus", entry: await real() });
  assert.equal(r.status, 400); assert.match(r.body.error, /Daily Draft is over/);
});
await t("Speed Draft: a replayed season plus the time bonus, which can't be more than 400", async () => {
  const run = await playSeason("speed");
  let r = await call("POST", "", { board: "speed", token: tok("1"), name: "Gus", entry: { ...run, bonus: 215 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, pts(run) + 215);
  for (const bonus of [401, -5, 2.5, undefined]) assert.equal((await call("POST", "", { board: "speed", token: tok("1"), name: "Gus", entry: { ...run, bonus } })).status, 400, String(bonus));
  // a free-play season isn't a Speed Draft (it had re-draws to use, so its rolls don't match)
  const free = await real({ redraws: 1 });
  r = await call("POST", "", { board: "speed", token: tok("2"), name: "Hal", entry: { ...free, bonus: 0 } });
  assert.equal(r.status, 400);
});
await t("Monthly Draft: this month's board replays the try from its day; other months are refused", async () => {
  const day = dayPT(), month = day.slice(0, 7);
  const a = await playSeason("monthly", { day }), b = await playSeason("monthly", { day, random: rand });
  let r = await call("POST", "", { board: "monthly", day: month, token: tok("1"), name: "Gus", entry: a });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, pts({ ...a, hard: false }));
  r = await call("POST", "", { board: "monthly", month, token: tok("2"), name: "Hal", entry: { ...b, hard: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, pts({ ...b, hard: false }));
  r = await call("POST", "", { board: "monthly", month, token: tok("2"), name: "Hal", entry: { ...b, w: 82, l: 0 }, replace: true });
  assert.equal(r.status, 400); assert.match(r.body.error, /replay/);
  r = await call("POST", "", { board: "monthly", month, token: tok("2"), name: "Hal", entry: { ...b, day: "2020-01-05" } });
  assert.equal(r.status, 400); assert.match(r.body.error, /this month/);
  for (const bad of ["2020-01", "2026-13", dayPT(), "", undefined, 202610]) {
    r = await call("POST", "", { board: "monthly", day: bad, token: tok("2"), name: "Hal", entry: a });
    assert.equal(r.status, 400, String(bad)); assert.match(r.body.error, /Monthly Draft is over/);
  }
  const list = (await call("GET", `?board=monthly&month=${month}`)).body.entries;
  assert.equal(list.length, 2);
  for (const q of ["?board=monthly", "?board=monthly&month=2026-13", "?board=monthly&month=26-10", `?board=monthly&day=${dayPT()}`]) assert.equal((await call("GET", q)).status, 400, q);
  assert.deepEqual((await call("GET", "?board=monthly&month=2001-01")).body.entries, []);
});
await t("Monthly Draft: just after midnight on the 1st last month's try still counts, and two weeks later it doesn't", async () => {
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-12-01T09:00:00Z"); // 1am on December 1 in California
    const nov = await playSeason("monthly", { day: "2026-11-30" });
    let r = await call("POST", "", { board: "monthly", day: "2026-11", token: tok("9"), name: "Ivy", entry: nov });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await call("POST", "", { board: "monthly", day: "2026-10", token: tok("9"), name: "Ivy", entry: nov })).status, 400);
    Date.now = () => Date.parse("2026-12-15T20:00:00Z");
    assert.equal((await call("POST", "", { board: "monthly", day: "2026-11", token: tok("9"), name: "Ivy", entry: nov })).status, 400);
    assert.equal((await call("GET", "?board=monthly&month=2026-11")).body.entries.length, 1);
  } finally { Date.now = realNow; }
});
await t("bad token, bad board, blank name, wrong method, huge body", async () => {
  assert.equal((await call("POST", "", { board: "normal", token: "nope", name: "X", run: bobNormal })).status, 400);
  assert.equal((await call("GET", "?board=weird")).status, 400);
  assert.equal((await call("POST", "", { board: "normal", token: tok("e"), name: "   ", run: bobNormal })).status, 400);
  assert.equal((await call("PUT", "")).status, 405);
  assert.equal((await call("POST", "", "x".repeat(30000))).status, 413);
});
await t("Legends Gauntlet: beaten and lost come back on the board; impossible runs refused", async () => {
  const players = bobNormal.players;
  let r = await call("POST", "", { board: "gauntlet", token: tok("1"), name: "Gus", entry: { beat: 19, lost: 30, team: "79–3 Payton…", players } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1969);
  r = await call("POST", "", { board: "gauntlet", token: tok("1"), name: "Gus", entry: { beat: 12, lost: 10, players } });
  assert.equal(r.body.kept, true);
  for (const bad of [{ beat: 25, lost: 0 }, { beat: 3, lost: 40 }, { beat: 0, lost: 0 }]) {
    r = await call("POST", "", { board: "gauntlet", token: tok("1"), name: "Gus", entry: { ...bad, players } });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const b = await call("GET", "?board=gauntlet");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.beat, e.lost]), [["Gus", 19, 30]]);
});
await t("Dynasty: titles and wins are counted by the server", async () => {
  const yr = (w, champ, pl = 4) => ({ w, l: 82 - w, champ, pw: champ ? 16 : 9, pl: champ ? pl : 6 });
  const years = [yr(72, true), yr(74, true), yr(72, false), yr(69, false), yr(75, false)];
  let r = await call("POST", "", { board: "dynasty", token: tok("1"), name: "Gus", entry: { titles: 5, wins: 999, years, players: bobNormal.players } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 2362);
  const b = await call("GET", "?board=dynasty");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.titles, e.wins]), [["Gus", 2, 362]]);
  r = await call("POST", "", { board: "dynasty", token: tok("1"), name: "Gus", entry: { years: years.slice(0, 4), players: bobNormal.players } });
  assert.equal(r.status, 400);
  r = await call("POST", "", { board: "dynasty", token: tok("1"), name: "Gus", entry: { years: [...years.slice(0, 4), { w: 30, l: 52, champ: true, pw: 16, pl: 0 }], players: bobNormal.players } });
  assert.equal(r.status, 400);
});
await t("Higher or Lower: best streak on the board, a shorter one is kept out, silly ones refused", async () => {
  let r = await call("POST", "", { board: "hol", token: tok("1"), name: "Gus", entry: { streak: 14 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 14); assert.equal(r.body.rank, 1);
  r = await call("POST", "", { board: "hol", token: tok("1"), name: "Gus", entry: { streak: 9 } });
  assert.equal(r.body.kept, true); assert.equal(r.body.score, 14);
  r = await call("POST", "", { board: "hol", token: tok("2"), name: "Hal", entry: { streak: 21 } });
  assert.equal(r.body.rank, 1);
  for (const bad of [{ streak: 0 }, { streak: 1.5 }, { streak: 5000 }, {}]) assert.equal((await call("POST", "", { board: "hol", token: tok("2"), name: "Hal", entry: bad })).status, 400, JSON.stringify(bad));
  const b = await call("GET", "?board=hol");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.score, e.streak]), [["Hal", 21, 21], ["Gus", 14, 14]]);
});
await t("Buzzer Beater: points and makes, and points have to fit the makes", async () => {
  const r = await call("POST", "", { board: "buzz", token: tok("1"), name: "Gus", entry: { points: 47, makes: 15 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 47);
  for (const bad of [{ points: 100, makes: 10 }, { points: 10, makes: 6 }, { points: 0, makes: 0 }]) assert.equal((await call("POST", "", { board: "buzz", token: tok("2"), name: "Hal", entry: bad })).status, 400, JSON.stringify(bad));
  const b = await call("GET", "?board=buzz");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.points, e.makes]), [["Gus", 47, 15]]);
});
await t("Survival: wins with the team that got them; too many losses refused; fake players refused", async () => {
  const players = bobNormal.players;
  let r = await call("POST", "", { board: "surv", token: tok("1"), name: "Gus", entry: { wins: 23, losses: 4, players } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 23);
  r = await call("POST", "", { board: "surv", token: tok("2"), name: "Hal", entry: { wins: 5, losses: 9, players } });
  assert.equal(r.status, 400);
  r = await call("POST", "", { board: "surv", token: tok("2"), name: "Hal", entry: { wins: 5, losses: 3, players: players.map((p, i) => i ? p : { ...p, name: "Nobody" }) } });
  assert.equal(r.status, 400); assert.match(r.body.error, /Couldn't find Nobody/);
  const d = await call("GET", `?board=surv&id=${(await call("GET", "?board=surv")).body.entries[0].id}`);
  assert.equal(d.body.wins, 23); assert.equal(d.body.players[0].ovr, 97);
});
await t("Mystery Player: one board a day, fewest guesses first", async () => {
  const { dayPT } = await import("../netlify/functions/lb/lb.mjs");
  const day = dayPT();
  let r = await call("POST", "", { board: "guess", day, token: tok("1"), name: "Gus", entry: { tries: 4 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 3);
  r = await call("POST", "", { board: "guess", day, token: tok("2"), name: "Hal", entry: { tries: 2 } });
  assert.equal(r.body.rank, 1);
  assert.equal((await call("POST", "", { board: "guess", day, token: tok("2"), name: "Hal", entry: { tries: 7 } })).status, 400);
  assert.equal((await call("POST", "", { board: "guess", day: "2020-01-01", token: tok("2"), name: "Hal", entry: { tries: 1 } })).status, 400);
  assert.equal((await call("GET", "?board=guess")).status, 400);
  const b = await call("GET", `?board=guess&day=${day}`);
  assert.deepEqual(b.body.entries.map(e => [e.name, e.tries]), [["Hal", 2], ["Gus", 4]]);
});
await t("Trivia Blitz: best score on the board, correct count travels with it, silly ones refused", async () => {
  let r = await call("POST", "", { board: "quiz", token: tok("1"), name: "Gus", entry: { score: 8, correct: 8 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 8);
  r = await call("POST", "", { board: "quiz", token: tok("1"), name: "Gus", entry: { score: 3, correct: 3 } });
  assert.equal(r.body.kept, true); assert.equal(r.body.score, 8);
  for (const bad of [{ score: -1, correct: 0 }, { score: 1.5, correct: 1 }, { score: 5, correct: 5000 }, {}]) assert.equal((await call("POST", "", { board: "quiz", token: tok("2"), name: "Hal", entry: bad })).status, 400, JSON.stringify(bad));
  const b = await call("GET", "?board=quiz");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.score, e.correct]), [["Gus", 8, 8]]);
});
await t("Trade Up: best streak on the board, silly ones refused", async () => {
  let r = await call("POST", "", { board: "trade", token: tok("1"), name: "Gus", entry: { streak: 6 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 6);
  for (const bad of [{ streak: 0 }, { streak: 1.5 }, { streak: 5000 }, {}]) assert.equal((await call("POST", "", { board: "trade", token: tok("2"), name: "Hal", entry: bad })).status, 400, JSON.stringify(bad));
  const b = await call("GET", "?board=trade");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.streak]), [["Gus", 6]]);
});
await t("Memory Match: best score, with moves and seconds coming along; silly ones refused", async () => {
  let r = await call("POST", "", { board: "memory", token: tok("1"), name: "Gus", entry: { score: 340, moves: 11, seconds: 28 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 340);
  for (const bad of [{ score: 0, moves: 11, seconds: 28 }, { score: 300, moves: 3, seconds: 28 }, { score: 300, moves: 11, seconds: -1 }, {}]) assert.equal((await call("POST", "", { board: "memory", token: tok("2"), name: "Hal", entry: bad })).status, 400, JSON.stringify(bad));
  const b = await call("GET", "?board=memory");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.score, e.moves, e.seconds]), [["Gus", 340, 11, 28]]);
});
await t("Bracket Predictor: best score, correct count and a perfect champ call travel with it; silly ones refused", async () => {
  let r = await call("POST", "", { board: "bracket", token: tok("1"), name: "Gus", entry: { score: 60, correct: 7, champ: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 60);
  for (const bad of [{ score: -1, correct: 7 }, { score: 60, correct: 8 }, {}]) assert.equal((await call("POST", "", { board: "bracket", token: tok("2"), name: "Hal", entry: bad })).status, 400, JSON.stringify(bad));
  const b = await call("GET", "?board=bracket");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.score, e.correct, e.champ]), [["Gus", 60, 7, true]]);
});
await t("Stat Line Showdown: best streak on the board, silly ones refused", async () => {
  let r = await call("POST", "", { board: "statline", token: tok("1"), name: "Gus", entry: { streak: 9 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 9);
  for (const bad of [{ streak: 0 }, { streak: 1.5 }, {}]) assert.equal((await call("POST", "", { board: "statline", token: tok("2"), name: "Hal", entry: bad })).status, 400, JSON.stringify(bad));
  const b = await call("GET", "?board=statline");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.streak]), [["Gus", 9]]);
});
await t("Hot Hand: best streak on the board, silly ones refused", async () => {
  let r = await call("POST", "", { board: "hothand", token: tok("1"), name: "Gus", entry: { streak: 12 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 12);
  for (const bad of [{ streak: 0 }, { streak: 1.5 }, {}]) assert.equal((await call("POST", "", { board: "hothand", token: tok("2"), name: "Hal", entry: bad })).status, 400, JSON.stringify(bad));
  const b = await call("GET", "?board=hothand");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.streak]), [["Gus", 12]]);
});
await t("The Arcade's hundred: x_<id> boards take a whole score up to the game's cap; unknown games are refused", async () => {
  const { default: XG } = await import("../netlify/functions/lb/xgames.mjs");
  assert.ok(Object.keys(XG).length >= 95); assert.equal(XG.popashot, 1000); assert.equal(XG.movinghoop, 2000, "retired games keep their boards");
  let r = await call("POST", "", { board: "x_arc", token: tok("1"), name: "Gus", entry: { score: 31 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 31); assert.equal(r.body.rank, 1);
  r = await call("POST", "", { board: "x_arc", token: tok("1"), name: "Gus", entry: { score: 12 } });
  assert.equal(r.body.kept, true); assert.equal(r.body.score, 31);
  r = await call("POST", "", { board: "x_arc", token: tok("2"), name: "Hal", entry: { score: 44 } });
  assert.equal(r.body.rank, 1);
  for (const bad of [{ score: 0 }, { score: 2.5 }, { score: XG.arc + 1 }, { score: "9" }, {}]) assert.equal((await call("POST", "", { board: "x_arc", token: tok("2"), name: "Hal", entry: bad })).status, 400, JSON.stringify(bad));
  // the cap is each game's own: 30 is the most a 3-Point Contest can score
  assert.equal((await call("POST", "", { board: "x_threecontest", token: tok("2"), name: "Hal", entry: { score: 31 } })).status, 400);
  assert.equal((await call("POST", "", { board: "x_threecontest", token: tok("2"), name: "Hal", entry: { score: 30 } })).status, 200);
  for (const board of ["x_nope", "x_", "x_arc/../normal", "x_constructor", "x___proto__"]) {
    assert.equal((await call("POST", "", { board, token: tok("2"), name: "Hal", entry: { score: 5 } })).status, 400, board);
    assert.equal((await call("GET", `?board=${encodeURIComponent(board)}`)).status, 400, board);
  }
  const b = await call("GET", "?board=x_arc");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.score]), [["Hal", 44], ["Gus", 31]]);
  assert.deepEqual((await call("GET", "?board=x_pinball")).body.entries, []);
});
console.log(results.join("\n"));
process.exitCode = results.some(r => r.startsWith("FAIL")) ? 1 : 0;
