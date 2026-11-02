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
assert.deepStrictEqual(route.map(n => n.type), ["foe", "elite", "foe", "camp", "foe", "boss"]);
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
assert.strictEqual(G.withMomentum(10, 5), 15);
assert.strictEqual(G.withMomentum(10, 99), 20);

// Card tests read what the inspector actually did.
assert.ok(G.CARDS.panorama.test({ seen: 3, total: 3 }));
assert.ok(!G.CARDS.panorama.test({ seen: 2, total: 3 }));
assert.ok(!G.CARDS.panorama.test({ seen: 1, total: 1 }));

// Rewards respect unlock level.
assert.ok(G.rewardChoices(Math.random, 1, 20).every(id => G.CARDS[id].unlock <= 1));
console.log("game rules ok");
