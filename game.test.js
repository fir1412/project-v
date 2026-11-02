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
// Bounties never depend on a verdict; single-photo items never ask for every photo.
assert.ok(["zoom", "details", "every"].includes(G.bountyOf("g#1", 3)));
assert.ok(Array.from({ length: 20 }, (_, i) => G.bountyOf(`k${i}`, 1)).every(b => b !== "every"));
assert.ok(Object.keys(G.FLAVOR).every(id => G.CARDS[id]));
// Long packs split into acts (max 5), each ending in its own boss; paths finish an act first.
const mk = n => { const a = []; for (let g = 0; g < n; g++) for (let i = 0; i < 2; i++) a.push(card(`b${g}`, i)); return G.buildMap(a); };
const r2 = mk(10);
assert.deepStrictEqual(r2.filter(n => n.type === "boss").map(n => [n.groupId, n.act]), [["b4", 1], ["b9", 2]]);
assert.ok(G.pathChoices(r2, () => true, 9).every(n => n.act === 1 && n.type !== "boss"));
assert.deepStrictEqual(G.pathChoices(r2, gid => gid === "b4" || gid === "b5", 3).map(n => n.groupId), ["b4"]);
assert.deepStrictEqual(mk(20).filter(n => n.type === "boss").map(n => n.act), [1, 2, 3, 4, 5]);
assert.strictEqual(Math.max(...mk(40).map(n => n.act)), 5);
assert.strictEqual(mk(6).filter(n => n.type === "boss").length, 1);
assert.strictEqual(G.speciesOf("x", "boss", 2).id, "lamplighter");
assert.ok(G.REGIONS[4].species.some(([id]) => id === G.speciesOf("x", "foe", 5).id));
console.log("game rules ok");

// Weekly rotation: 24 kinds per region, no kind repeats while unseen ones remain, wanderers come from other regions.
{
    for (const R of G.REGIONS) assert.strictEqual(R.species.length, 24, R.name);
    const all = G.REGIONS.flatMap(R => R.species.map(x => x[0]));
    assert.strictEqual(new Set(all).size, 120, "120 distinct kinds");
    const seen = new Set();
    for (let i = 0; i < 120; i++) { const sp = G.speciesOf(`g${i}`, "foe", 1, seen); assert.ok(!seen.has(sp.id), `repeat at ${i}`); seen.add(sp.id); }
    assert.strictEqual(seen.size, 120, "a week of 120 vehicles meets 120 different kinds");
    assert.strictEqual(G.speciesOf("x", "elite", 1, new Set()).name.startsWith("Elder "), true);
    assert.strictEqual(G.weekKey(new Date(2026, 10, 4)), "2026-11-02");
    assert.strictEqual(G.weekKey(new Date(2026, 10, 8)), "2026-11-02");
}
console.log("rotation ok");

// 300+ cards: six hero families, every card well-formed, active cards carry an effect, rewards stay in the family.
{
    const ids = Object.keys(G.CARDS);
    assert.ok(ids.length >= 300, `only ${ids.length} cards`);
    const KINDS = new Set(["verdict", "defeat", "viewer", "details", "check", "ai", "play", "active", "overflow", "path", "event", "upgrade", "burn", "wager"]);
    const t = { seen: 3, total: 3, zoom: true, details: true, ai: true, checks: 2, elite: true, boss: true, wager: true, scrap: 99, light: 10, played: 6,
        photoFired: 4, firstOfFoe: true, last: true, wasLater: true, ups: 12, deck: 6, act: 5, defeats: 6, burned: 3, events: 3, paths: 5 };
    for (const id of ids) {
        const c = G.CARDS[id];
        assert.ok(c.name && c.text && KINDS.has(c.on) && c.unlock >= 1 && c.unlock <= 10, id);
        if (c.on === "play") assert.ok(c.cost >= 1 && c.fx && Object.keys(c.fx).length, `${id} needs cost and fx`);
        else { assert.ok(c.xp || c.light || c.scrap, `${id} gives nothing`); if (c.test) assert.strictEqual(typeof c.test(t), "boolean", id); }
    }
    for (const [hero, cls] of Object.entries(G.CLASSES)) {
        cls.deck.forEach(id => assert.ok(G.CARDS[id], `${hero} deck ${id}`));
        assert.ok(ids.filter(id => G.CARDS[id].hero === hero).length >= 30, `${hero} family too small`);
        const pool = G.rewardChoices(() => 0.5, 10, 400, hero);
        assert.ok(pool.every(id => !G.CARDS[id].hero || G.CARDS[id].hero === hero), `${hero} offered another family`);
    }
    assert.strictEqual(Object.keys(G.CLASSES).length, 6);
}
console.log("cards ok");
