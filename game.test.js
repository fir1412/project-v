// node game.test.js — checks the Pale Moon rules (no browser needed).
const assert = require("assert");
const G = require("./game.js");

// Levels: thresholds grow, leftover XP carries.
assert.deepStrictEqual(G.levelOf(0), { level: 1, into: 0, need: 60 });
assert.strictEqual(G.levelOf(60).level, 2);
assert.strictEqual(G.levelOf(59).level, 1);
assert.strictEqual(G.levelOf(60 + G.need(2)).level, 3);

// Route: last group is the boss, gated groups are elites, a rest stop after every third foe.
const card = (gid, i, extra) => ({ key: `${gid}#${i}`, group: { groupId: gid, ...extra }, item: { itemIndex: i }, photos: [] });
const cards = [];
for (const g of ["a", "b", "c", "d", "e"]) for (let i = 0; i < 2; i++) cards.push(card(g, i, g === "b" ? { gates: [{ action: "yes", level: "block" }] } : {}));
const route = G.buildMap(cards);
assert.deepStrictEqual(route.map(n => n.type), ["foe", "elite", "foe", "foe", "boss"]);
// Paths: the next open groups in order; the boss only when nothing else is left.
assert.deepStrictEqual(G.pathChoices(route, () => true, 3).map(n => n.groupId), ["a", "b", "c"]);
assert.deepStrictEqual(G.pathChoices(route, gid => gid === "e", 3).map(n => n.type), ["boss"]);
assert.deepStrictEqual(G.pathChoices(route, gid => gid === "d" || gid === "e", 3).map(n => n.groupId), ["d"]);
// Stops come after every second foe.
assert.deepStrictEqual([1, 2, 3, 4, 6].map(G.eventAfter), [null, "camp", null, "mystery", "shop"]);
// Light costs: upgrade and thimble make it cheaper but never free; the wax seal makes the first one free.
assert.strictEqual(G.costOf("surge", false, [], false), 4);
assert.strictEqual(G.costOf("surge", true, ["thimble"], false), 2);
assert.strictEqual(G.costOf("wind", true, ["thimble"], false), 1);
assert.strictEqual(G.costOf("surge", false, ["seal"], true), 0);
assert.strictEqual(G.lightCap(["moth"]), 15);
// Grades reward looking closely, nothing else.
assert.deepStrictEqual([[9, 10], [7, 10], [5, 10], [4, 10], [0, 0]].map(([c, n]) => G.gradeOf(c, n)), ["S", "A", "B", "C", "-"]);
// Every foe has a known trait.
assert.ok(["g1", "g2", "zz"].every(g => G.TRAITS[G.traitOf(g)]));
assert.strictEqual(G.buildMap([card("solo", 0)])[0].type, "boss");

// Deck: drawing and playing never creates or loses cards.
const run = G.newRun("p", 7);
const total = () => run.draw.length + run.discard.length + run.hand.length;
assert.strictEqual(total(), 5);
G.refillHand(run, Math.random);
assert.strictEqual(run.hand.length, 3);
for (let i = 0; i < 20; i++) { G.playCard(run, run.hand[0], Math.random); assert.strictEqual(total(), run.deck.length); }
G.addCard(run, "loupe");
assert.strictEqual(total(), 6);
G.removeCard(run, run.deck[0].uid);
assert.strictEqual(total(), 5);
assert.strictEqual(new Set([...run.draw, ...run.discard, ...run.hand]).size, 5);

// Gains: upgrade and relics stack; momentum multiplies.
assert.strictEqual(G.cardGain("gaze", false, []).xp, 12);
assert.strictEqual(G.cardGain("gaze", true, []).xp, 18);
assert.strictEqual(G.cardGain("gaze", true, ["lens"]).xp, 27);
assert.strictEqual(G.cardGain("ledger", false, ["lens"]).xp, 15);

// Card tests read what the inspector actually did.
assert.ok(G.CARDS.panorama.test({ seen: 3, total: 3 }));
assert.ok(!G.CARDS.panorama.test({ seen: 2, total: 3 }));
assert.ok(!G.CARDS.panorama.test({ seen: 1, total: 1 }));

// Rewards respect unlock level.
assert.ok(G.rewardChoices(Math.random, 1, 20).every(id => G.CARDS[id].unlock <= 1));
// Omens and streaks.
assert.ok(G.OMENS[G.omenOf("2026-11-03")]);
assert.strictEqual(G.dayKey(new Date(2026, 0, 5)), "2026-01-05");
assert.strictEqual(G.streakOf(["2026-11-01", "2026-11-02", "2026-11-03"], new Date(2026, 10, 3)), 3);
assert.strictEqual(G.streakOf(["2026-11-01", "2026-11-02"], new Date(2026, 10, 3)), 2);
assert.strictEqual(G.streakOf(["2026-10-30"], new Date(2026, 10, 3)), 0);
assert.ok(G.LANTERNS.amber.need({ xp: 0 }) && !G.LANTERNS.rose.need({ xp: 0 }));
console.log("game rules ok");
