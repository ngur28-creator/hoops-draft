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
await t("Bob's normal season scores 1,483 like on Claude (ignores inflated ratings)", async () => {
  const r = await call("POST", "", { board: "normal", token: tok("b"), name: "bob", run: bobNormal });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1483); assert.equal(r.body.rank, 1);
});
await t("Bob's hard season scores 1,666 like on Claude", async () => {
  const r = await call("POST", "", { board: "hard", token: tok("b"), name: "bob", run: bobHard });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.score, 1666);
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
  assert.deepEqual(b.body.entries.map(e => [e.name, e.score]), [["bob", 1666], ["Fay", 1666]]);
});
await t("names with emoji and non-English letters work", async () => {
  const r = await call("POST", "", { board: "hard", token: tok("a"), name: "Zoë 🏀", run: { ...bobHard, w: 70, l: 12, champ: false, reached: 2, pw: 8, pl: 6 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok((await call("GET", "?board=hard")).body.entries.some(e => e.name === "Zoë 🏀"));
});
console.log(results.join("\n"));
process.exitCode = results.some(r => r.startsWith("FAIL")) ? 1 : 0;
