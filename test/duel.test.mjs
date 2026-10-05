// Tests for Draft vs Friend over the internet, against an in-memory stand-in for Netlify Blobs.
import { handle, pickerAt } from "../netlify/functions/duel/duel.mjs";
import VALID from "../netlify/functions/lb/valid.mjs";
import assert from "node:assert/strict";
import { memoryStore } from "./memory-store.mjs";

const store = memoryStore();
const call = async (method, query = "", body) => {
  const req = new Request("http://test/api/duel" + query, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handle(req, store);
  return { status: res.status, body: await res.json() };
};
const tok = c => c.repeat(32);
const results = [];
const t = async (name, fn) => { try { await fn(); results.push("PASS " + name); } catch (e) { results.push("FAIL " + name + ": " + e.message); } };
const rosterOf = roll => Object.keys(VALID).filter(k => k.startsWith(`${roll.dec}|${roll.team}|`)).map(k => k.split("|")[2]);
let st;

await t("pick order swaps every roll", async () => {
  assert.deepEqual(Array.from({ length: 10 }, (_, i) => pickerAt(i)), [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
});
await t("create: five different rolls, you are player A", async () => {
  const r = await call("POST", "", { action: "create", token: tok("a"), name: "Bob" });
  assert.equal(r.status, 200, JSON.stringify(r.body)); st = r.body;
  assert.match(st.code, /^[A-Z2-9]{5}$/); assert.equal(st.rolls.length, 5); assert.equal(st.a.name, "Bob"); assert.equal(st.b, null);
  assert.equal(new Set(st.rolls.map(x => x.dec + x.team)).size, 5);
  for (const roll of st.rolls) assert.ok(rosterOf(roll).length >= 8);
});
await t("no picks before a friend joins", async () => {
  const r = await call("POST", "", { action: "pick", token: tok("a"), name: "Bob", code: st.code, slot: "PG", player: rosterOf(st.rolls[0])[0] });
  assert.equal(r.status, 409); assert.match(r.body.error, /Wait for your friend/);
});
await t("you can't join your own duel, or a name with no duel", async () => {
  assert.equal((await call("POST", "", { action: "join", token: tok("a"), name: "Bob", host: "bob" })).status, 400);
  const r = await call("POST", "", { action: "join", token: tok("b"), name: "Frank", host: "Nobody" });
  assert.equal(r.status, 404); assert.match(r.body.error, /hasn't created a duel/);
});
await t("friend joins by username (any capitals)", async () => {
  const r = await call("POST", "", { action: "join", token: tok("b"), name: "Frank", host: "BOB" });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.b.name, "Frank"); st = r.body;
});
await t("a third player can't take the seat", async () => {
  const r = await call("POST", "", { action: "join", token: tok("c"), name: "Cat", host: "bob" });
  assert.equal(r.status, 409); assert.match(r.body.error, /already has two players/);
});
await t("someone else can't take Bob's name", async () => {
  const r = await call("POST", "", { action: "create", token: tok("c"), name: "b.o.b" });
  assert.equal(r.status, 409); assert.match(r.body.error, /already uses the name/);
});
await t("turns, roster, taken players and filled spots are checked", async () => {
  const roll = st.rolls[0], names = rosterOf(roll);
  assert.match((await call("POST", "", { action: "pick", token: tok("b"), name: "Frank", code: st.code, slot: "PG", player: names[0] })).body.error, /not your pick/);
  assert.match((await call("POST", "", { action: "pick", token: tok("a"), name: "Bob", code: st.code, slot: "PG", player: "Fake Guy" })).body.error, /isn't on this roll/);
  assert.equal((await call("POST", "", { action: "pick", token: tok("a"), name: "Bob", code: st.code, slot: "PG", player: names[0] })).status, 200);
  assert.match((await call("POST", "", { action: "pick", token: tok("b"), name: "Frank", code: st.code, slot: "C", player: names[0] })).body.error, /already took him/);
  assert.equal((await call("POST", "", { action: "pick", token: tok("b"), name: "Frank", code: st.code, slot: "C", player: names[1] })).status, 200);
  // roll 2: Frank picks first; Frank tries his filled C spot
  const n2 = rosterOf(st.rolls[1]);
  assert.match((await call("POST", "", { action: "pick", token: tok("b"), name: "Frank", code: st.code, slot: "C", player: n2[0] })).body.error, /already filled/);
});
await t("a full draft: ten picks, then it's over", async () => {
  let cur = (await call("GET", `?code=${st.code}`)).body;
  const tokens = [tok("a"), tok("b")], who = ["Bob", "Frank"];
  while (cur.picks.length < 10) {
    const i = cur.picks.length, by = pickerAt(i), roll = cur.rolls[Math.floor(i / 2)];
    const taken = cur.picks.filter((p, j) => Math.floor(j / 2) === Math.floor(i / 2)).map(p => p.name);
    const player = rosterOf(roll).find(n => !taken.includes(n));
    const slot = ["PG", "SG", "SF", "PF", "C"].find(k => !cur.picks.some(p => p.by === by && p.slot === k));
    const r = await call("POST", "", { action: "pick", token: tokens[by], name: who[by], code: cur.code, slot, player });
    assert.equal(r.status, 200, JSON.stringify(r.body)); cur = r.body;
  }
  assert.equal(cur.picks.filter(p => p.by === 0).length, 5); assert.equal(cur.picks.filter(p => p.by === 1).length, 5);
  assert.match((await call("POST", "", { action: "pick", token: tok("a"), name: "Bob", code: cur.code, slot: "PG", player: "x" })).body.error, /draft is over/);
  assert.equal(typeof cur.seed, "number");
});
await t("bad codes and old duels", async () => {
  assert.equal((await call("GET", "?code=nope")).status, 400);
  assert.equal((await call("GET", "?code=ZZZZZ")).status, 404);
  const old = JSON.parse(store._m.get(`d/${st.code}`)); old.ts -= 7 * 3600e3; store._m.set(`d/${st.code}`, JSON.stringify(old));
  assert.equal((await call("GET", `?code=${st.code}`)).status, 404);
});
await t("a new duel by the same host replaces the old one for joining", async () => {
  const a = (await call("POST", "", { action: "create", token: tok("a"), name: "Bob" })).body;
  const r = await call("POST", "", { action: "join", token: tok("d"), name: "Dee", host: "Bob" });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.code, a.code);
});
console.log(results.join("\n"));
process.exitCode = results.some(r => r.startsWith("FAIL")) ? 1 : 0;
