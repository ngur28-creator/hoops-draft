// Tests for the leaderboard API against an in-memory stand-in for Netlify Blobs.
import { handle } from "../netlify/functions/lb/lb.mjs";
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

await t("empty board", async () => { const r = await call("GET", "?board=normal"); assert.equal(r.status, 200); assert.deepEqual(r.body.entries, []); });
await t("Bob's normal season scores 1,380 like in the game: 790 + title 500 + 90 for 16–3", async () => {
  const r = await call("POST", "", { board: "normal", token: tok("b"), name: "bob", run: bobNormal });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1380); assert.equal(r.body.rank, 1);
});
await t("Bob's hard season scores 1,550 like in the game (16–6 title, +200 hard)", async () => {
  const r = await call("POST", "", { board: "hard", token: tok("b"), name: "bob", run: bobHard });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1550);
});
await t("hard season can't go on the normal board", async () => { const r = await call("POST", "", { board: "normal", token: tok("c"), name: "Cat", run: bobHard }); assert.equal(r.status, 400); assert.match(r.body.error, /Hard Mode board/); });
await t("normal season can't go on the hard board", async () => { const r = await call("POST", "", { board: "hard", token: tok("c"), name: "Cat", run: bobNormal }); assert.equal(r.status, 400); assert.match(r.body.error, /Only hard mode/); });
await t("same name with different capitals/dots is taken", async () => {
  const r = await call("POST", "", { board: "normal", token: tok("c"), name: "B.O.B", run: { ...bobNormal, w: 60, l: 22, champ: false, reached: 1, pw: 4, pl: 4 } });
  assert.equal(r.status, 409); assert.match(r.body.error, /already uses the name/);
});
await t("friend submits and ranks #2", async () => {
  const r = await call("POST", "", { board: "normal", token: tok("c"), name: "Alex", run: { ...bobNormal, w: 60, l: 22, champ: false, reached: 1, pw: 4, pl: 4 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.rank, 2);
});
await t("lower score never replaces a higher one", async () => {
  const r = await call("POST", "", { board: "normal", token: tok("c"), name: "Alex", run: { ...bobNormal, w: 41, l: 41, champ: false, reached: 0, pw: 0, pl: 0 } });
  assert.equal(r.status, 200); assert.equal(r.body.kept, true);
});
await t("higher score replaces, and the board still has one row for that player", async () => {
  const r = await call("POST", "", { board: "normal", token: tok("c"), name: "Alex", run: { ...bobNormal, w: 81, l: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.rank, 1);
  const b = await call("GET", "?board=normal");
  assert.deepEqual(b.body.entries.map(e => e.name), ["Alex", "bob"]);
  assert.equal([...store._m.keys()].filter(k => k.startsWith("i/normal/")).length, 2);
});
await t("detail view returns team + stats but not internal fields", async () => {
  const id = (await call("GET", "?board=normal")).body.entries[1].id;
  const r = await call("GET", `?board=normal&id=${id}`);
  assert.equal(r.status, 200); assert.equal(r.body.name, "bob"); assert.equal(r.body.box.length, 5); assert.equal(r.body.box[0].ppg, 25);
  assert.equal(r.body.players[0].ovr, 97); assert.equal(r.body.ppg, 121.1); assert.equal(r.body.avgOvr, 96);
  assert.ok(!("idx" in r.body) && !("ts" in r.body));
});
await t("made-up player is rejected", async () => {
  const run = { ...bobNormal, players: bobNormal.players.map((p, i) => i ? p : { ...p, name: "Fake Guy" }) };
  const r = await call("POST", "", { board: "normal", token: tok("d"), name: "Dee", run }); assert.equal(r.status, 400); assert.match(r.body.error, /Couldn't find Fake Guy/);
});
await t("impossible record is rejected", async () => { const r = await call("POST", "", { board: "normal", token: tok("d"), name: "Dee", run: { ...bobNormal, w: 83, l: 0 } }); assert.equal(r.status, 400); });
await t("title without the playoff wins is rejected", async () => { const r = await call("POST", "", { board: "normal", token: tok("d"), name: "Dee", run: { ...bobNormal, pw: 3 } }); assert.equal(r.status, 400); assert.match(r.body.error, /playoff/); });
await t("out-of-order lineup is rejected", async () => { const r = await call("POST", "", { board: "normal", token: tok("d"), name: "Dee", run: { ...bobNormal, players: [...bobNormal.players].reverse() } }); assert.equal(r.status, 400); });
await t("bad token, bad board, blank name, wrong method, huge body", async () => {
  assert.equal((await call("POST", "", { board: "normal", token: "nope", name: "X", run: bobNormal })).status, 400);
  assert.equal((await call("GET", "?board=weird")).status, 400);
  assert.equal((await call("POST", "", { board: "normal", token: tok("e"), name: "   ", run: bobNormal })).status, 400);
  assert.equal((await call("PUT", "")).status, 405);
  assert.equal((await call("POST", "", "x".repeat(30000))).status, 413);
});
await t("ties: earlier submission ranks first", async () => {
  await call("POST", "", { board: "hard", token: tok("f"), name: "Fay", run: bobHard });
  const b = await call("GET", "?board=hard");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.score]), [["bob", 1550], ["Fay", 1550]]);
});
await t("names with emoji and non-English letters work", async () => {
  const r = await call("POST", "", { board: "hard", token: tok("a"), name: "Zoë 🏀", run: { ...bobHard, w: 70, l: 12, champ: false, reached: 2, pw: 8, pl: 6 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok((await call("GET", "?board=hard")).body.entries.some(e => e.name === "Zoë 🏀"));
});
await t("same record, cleaner title run scores more and replaces the entry (79–3, 16–1 beats 16–3)", async () => {
  const r = await call("POST", "", { board: "normal", token: tok("b"), name: "bob", run: { ...bobNormal, pl: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.kept, undefined); assert.equal(r.body.score, 1400);
});
await t("team rating doesn't change the score", async () => {
  const low = { ...bobNormal, players: bobHard.players };
  const r = await call("POST", "", { board: "normal", token: tok("1"), name: "Gus", run: low });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1380);
});
await t("replace: true puts a lower season up on purpose", async () => {
  const r = await call("POST", "", { board: "normal", token: tok("1"), name: "Gus", run: { ...bobNormal, w: 70, l: 12, champ: false, reached: 2, pw: 9, pl: 6 }, replace: true });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.kept, undefined); assert.equal(r.body.score, 790);
  const b = await call("GET", "?board=normal");
  assert.equal(b.body.entries.find(e => e.name === "Gus").score, 790);
});
await t("without replace, the lower season is kept out", async () => {
  await call("POST", "", { board: "normal", token: tok("1"), name: "Gus", run: bobNormal });
  const r = await call("POST", "", { board: "normal", token: tok("1"), name: "Gus", run: { ...bobNormal, w: 70, l: 12, champ: false, reached: 2, pw: 9, pl: 6 } });
  assert.equal(r.body.kept, true); assert.equal(r.body.score, 1380);
});
await t("impossible playoff records are rejected", async () => {
  const bad = [{ ...bobNormal, pl: 13 }, { ...bobNormal, champ: false, reached: 3, pw: 16, pl: 4 }];
  for (const run of bad) { const r = await call("POST", "", { board: "normal", token: tok("2"), name: "Hal", run }); assert.equal(r.status, 400, JSON.stringify(r.body)); }
});
await t("a 16–0 title adds the full 120", async () => {
  const r = await call("POST", "", { board: "normal", token: tok("2"), name: "Hal", run: { ...bobNormal, pl: 0 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1410);
});
await t("Daily Draft: today's board takes a season, wrong days are refused", async () => {
  const { dayPT } = await import("../netlify/functions/lb/lb.mjs");
  const day = dayPT();
  const entry = { ...bobNormal, pl: 2 };
  let r = await call("POST", "", { board: "daily", day, token: tok("1"), name: "Gus", entry });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1390);
  r = await call("POST", "", { board: "daily", day: "2020-01-01", token: tok("1"), name: "Gus", entry });
  assert.equal(r.status, 400); assert.match(r.body.error, /over/);
  const b = await call("GET", `?board=daily&day=${day}`);
  assert.deepEqual(b.body.entries.map(e => [e.name, e.score, e.w, e.l, e.champ]), [["Gus", 1390, 79, 3, true]]);
  assert.equal((await call("GET", "?board=daily")).status, 400);
  // a hard mode flag can't sneak a season in: Daily seasons are always normal
  r = await call("POST", "", { board: "daily", day, token: tok("2"), name: "Hal", entry: { ...bobHard } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1350);
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
await t("Speed Draft: the season's points plus the time bonus, which can't be more than 400", async () => {
  let r = await call("POST", "", { board: "speed", token: tok("1"), name: "Gus", entry: { ...bobNormal, bonus: 215 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1380 + 215);
  for (const bonus of [401, -5, 2.5, undefined]) assert.equal((await call("POST", "", { board: "speed", token: tok("2"), name: "Hal", entry: { ...bobNormal, bonus } })).status, 400, String(bonus));
  // a hard mode flag doesn't add 200 here either
  r = await call("POST", "", { board: "speed", token: tok("2"), name: "Hal", entry: { ...bobHard, bonus: 0 } });
  assert.equal(r.body.score, 1350);
  const b = await call("GET", "?board=speed");
  assert.deepEqual(b.body.entries.map(e => [e.name, e.score, e.w, e.l, e.champ]), [["Gus", 1595, 79, 3, true], ["Hal", 1350, 79, 3, true]]);
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
  assert.equal(Object.keys(XG).length, 95);
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
await t("Monthly Draft: this month's board takes a season and keeps your best try; other months are refused", async () => {
  const { dayPT } = await import("../netlify/functions/lb/lb.mjs");
  const month = dayPT().slice(0, 7);
  let r = await call("POST", "", { board: "monthly", day: month, token: tok("1"), name: "Gus", entry: { ...bobNormal, w: 70, l: 12, champ: false, reached: 2, pw: 9, pl: 6 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 790); assert.equal(r.body.rank, 1);
  // a better try later in the month replaces it, and a worse one is kept out
  r = await call("POST", "", { board: "monthly", day: month, token: tok("1"), name: "Gus", entry: { ...bobNormal, pl: 2 } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1390); assert.equal(r.body.kept, undefined);
  r = await call("POST", "", { board: "monthly", day: month, token: tok("1"), name: "Gus", entry: { ...bobNormal, w: 40, l: 42, champ: false, reached: 0, pw: 0, pl: 0 } });
  assert.equal(r.body.kept, true); assert.equal(r.body.score, 1390);
  // month= works as well as day=, and a hard mode flag doesn't add 200
  r = await call("POST", "", { board: "monthly", month, token: tok("2"), name: "Hal", entry: { ...bobHard } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1350); assert.equal(r.body.rank, 2);
  for (const bad of ["2020-01", "2026-13", dayPT(), "", undefined, 202610]) {
    r = await call("POST", "", { board: "monthly", day: bad, token: tok("2"), name: "Hal", entry: bobNormal });
    assert.equal(r.status, 400, String(bad)); assert.match(r.body.error, /Monthly Draft is over/);
  }
  for (const q of [`?board=monthly&month=${month}`, `?board=monthly&day=${month}`]) {
    const b = await call("GET", q);
    assert.equal(b.status, 200, q);
    assert.deepEqual(b.body.entries.map(e => [e.name, e.score, e.w, e.l, e.champ]), [["Gus", 1390, 79, 3, true], ["Hal", 1350, 79, 3, true]], q);
  }
  // the detail view has the team, with the game's own ratings
  const id = (await call("GET", `?board=monthly&month=${month}`)).body.entries[0].id;
  const d = await call("GET", `?board=monthly&month=${month}&id=${id}`);
  assert.equal(d.status, 200); assert.equal(d.body.players[0].name, "Damian Lillard"); assert.equal(d.body.players[0].ovr, 97);
  for (const q of ["?board=monthly", "?board=monthly&month=2026-13", "?board=monthly&month=26-10", `?board=monthly&day=${dayPT()}`]) assert.equal((await call("GET", q)).status, 400, q);
  assert.deepEqual((await call("GET", "?board=monthly&month=2001-01")).body.entries, []);
  // its own board, apart from the old Daily Draft's
  assert.equal([...store._m.keys()].filter(k => k.startsWith(`i/monthly-${month}/`)).length, 2);
});
await t("Monthly Draft: just after midnight on the 1st last month's try still counts, and two weeks later it doesn't", async () => {
  const real = Date.now;
  try {
    Date.now = () => Date.parse("2026-12-01T09:00:00Z"); // 1am on December 1 in California
    let r = await call("POST", "", { board: "monthly", day: "2026-11", token: tok("9"), name: "Ivy", entry: bobNormal });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1380);
    r = await call("POST", "", { board: "monthly", day: "2026-12", token: tok("9"), name: "Ivy", entry: bobNormal });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await call("POST", "", { board: "monthly", day: "2026-10", token: tok("9"), name: "Ivy", entry: bobNormal })).status, 400);
    Date.now = () => Date.parse("2026-12-15T20:00:00Z");
    assert.equal((await call("POST", "", { board: "monthly", day: "2026-11", token: tok("9"), name: "Ivy", entry: bobNormal })).status, 400);
    assert.deepEqual((await call("GET", "?board=monthly&month=2026-11")).body.entries.map(e => [e.name, e.score]), [["Ivy", 1380]]);
  } finally { Date.now = real; }
});
console.log(results.join("\n"));
process.exitCode = results.some(r => r.startsWith("FAIL")) ? 1 : 0;
