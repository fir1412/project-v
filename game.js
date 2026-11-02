"use strict";

// Pale Moon: an optional roguelite deckbuilder layer over VINder.
// It only listens to app events and never touches decisions, so the exported file is unchanged.
// Every verdict strikes the same blow; rewards come only from looking closely (photos, values, details).
(function (root) {
    // ---------- rules (pure, checked by game.test.js) ----------
    const hash = s => {
        let h = 2166136261;
        const t = String(s);
        for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    };
    function rng(seed) {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const pick = (r, list) => list[Math.floor(r() * list.length)];
    function shuffle(r, list) {
        const a = list.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    }

    // on: when the card can fire. verdict/defeat fire on those moments; viewer/details/check/ai fire once per item.
    const CARDS = {
        gaze: { name: "Steady Gaze", icon: "👁️", on: "verdict", test: t => t.seen >= 2, xp: 12, text: "Verdict after seeing 2+ photos", unlock: 1 },
        dawn: { name: "First Light", icon: "🌅", on: "verdict", test: t => t.firstOfFoe, xp: 10, mom: 1, text: "Your first verdict on a foe", unlock: 1 },
        ledger: { name: "Ledger Spark", icon: "🪶", on: "check", xp: 15, text: "Confirm or correct a value", unlock: 1 },
        closer: { name: "Last Word", icon: "🗝️", on: "defeat", xp: 20, scrap: 3, text: "Vanquish a foe", unlock: 1 },
        panorama: { name: "Panorama", icon: "🌄", on: "verdict", test: t => t.total > 1 && t.seen >= t.total, xp: 25, text: "Verdict after seeing every photo", unlock: 1 },
        loupe: { name: "Loupe", icon: "🔍", on: "viewer", xp: 10, mom: 1, text: "Open a photo full screen", unlock: 1 },
        notes: { name: "Field Notes", icon: "📜", on: "details", xp: 10, text: "Read the details", unlock: 1 },
        bounty: { name: "Bounty", icon: "💰", on: "defeat", scrap: 8, text: "Vanquish a foe", unlock: 2 },
        revisit: { name: "Return Visit", icon: "🔁", on: "verdict", test: t => t.wasLater, xp: 25, text: "Decide one you set aside", unlock: 2 },
        oracle: { name: "Second Sight", icon: "🔮", on: "ai", xp: 15, text: "Ask the AI about it", unlock: 3 },
        surge: { name: "Moonsurge", icon: "⚡", on: "verdict", test: t => t.momentum >= 4, xp: 30, momReset: true, text: "Verdict with 4+ Momentum (spends it)", unlock: 4 },
        deep: { name: "Deep Scan", icon: "🛰️", on: "verdict", test: t => t.seen >= 4, xp: 30, text: "Verdict after seeing 4+ photos", unlock: 5 },
        rally: { name: "War Drum", icon: "🥁", on: "verdict", test: t => t.played >= 3, xp: 5, mom: 3, text: "Verdict after 3+ cards played on a foe", unlock: 6 }
    };
    const PHOTO_CARDS = new Set(["gaze", "panorama", "deep", "loupe"]);
    const INK_CARDS = new Set(["ledger", "notes"]);
    const STARTER = ["gaze", "gaze", "dawn", "ledger", "closer"];
    const RELICS = {
        lens: { name: "Brass Lens", icon: "🧿", text: "Photo cards give +50% XP" },
        ink: { name: "Ink of Night", icon: "🫙", text: "Ledger & Notes cards give +50% XP" },
        lamp: { name: "Lantern", icon: "🏮", text: "Start each foe with 2 Momentum" },
        pouch: { name: "Deep Pouch", icon: "👝", text: "+1 card in hand" },
        gear: { name: "Moon Gear", icon: "⚙️", text: "+3 Moonshards per foe" },
        bolt: { name: "Lucky Bolt", icon: "🔩", text: "Cards have a 20% chance to crit for double" }
    };
    const RANKS = ["Lantern-bearer", "Wayfarer", "Seer", "Moonwarden", "Thornknight", "Elder of the Wood", "Legend of the Pale Moon"];
    const rankOf = level => RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 3))];

    const need = level => Math.round(60 * Math.pow(level, 1.5));
    function levelOf(xp) {
        let level = 1, rest = Math.max(0, xp || 0);
        while (rest >= need(level)) { rest -= need(level); level++; }
        return { level, into: rest, need: need(level) };
    }

    const BASE_XP = 10;
    function cardGain(id, up, relics) {
        const def = CARDS[id];
        let xp = def.xp || 0;
        if (up) xp = Math.round(xp * 1.5);
        if (relics.includes("lens") && PHOTO_CARDS.has(id)) xp = Math.round(xp * 1.5);
        if (relics.includes("ink") && INK_CARDS.has(id)) xp = Math.round(xp * 1.5);
        return { xp, mom: def.mom ? def.mom + (up ? 1 : 0) : 0, scrap: def.scrap ? Math.round(def.scrap * (up ? 1.5 : 1)) : 0 };
    }
    const withMomentum = (xp, mom) => Math.round(xp * (1 + 0.1 * Math.min(10, Math.max(0, mom))));

    function groupsOf(cards) {
        const seen = new Map();
        for (const c of cards) {
            const id = String(c.group.groupId);
            if (!seen.has(id)) seen.set(id, { group: c.group, count: 0 });
            seen.get(id).count++;
        }
        return [...seen.values()];
    }

    // The route: one node per group in pack order; an elite where a group is gated or big; the last is the boss.
    // A rest stop follows every third foe.
    function buildMap(cards) {
        const gs = groupsOf(cards);
        const avg = gs.reduce((n, g) => n + g.count, 0) / (gs.length || 1);
        const nodes = [];
        let k = 0;
        gs.forEach((g, i) => {
            const gr = g.group;
            const blocked = (Array.isArray(gr.gates) && gr.gates.some(x => x && x.level === "block")) || Boolean(gr.flag && gr.flag.tone === "block");
            const type = i === gs.length - 1 ? "boss" : (blocked || (g.count >= 4 && g.count >= avg * 1.6)) ? "elite" : "foe";
            nodes.push({ type, groupId: String(gr.groupId), count: g.count });
            if (i % 3 === 2 && i < gs.length - 1) { k++; nodes.push({ type: ["camp", "shop", "cache"][(k - 1) % 3], id: `ev${k}` }); }
        });
        return nodes;
    }

    let uidSeq = 0;
    const inst = (id, up) => ({ uid: `c${Date.now().toString(36)}${(uidSeq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, id, up: Boolean(up) });
    function newRun(packId, seed) {
        const deck = STARTER.map(id => inst(id));
        return { packId, deck, draw: shuffle(rng(seed), deck.map(c => c.uid)), discard: [], hand: [], relics: [], scrap: 0, xp: 0,
            momentum: 0, played: 0, first: true, foe: null, scored: {}, later: {}, defeated: {}, met: {}, events: {}, done: false, introduced: false, startedAt: Date.now() };
    }
    function drawOne(run, r) {
        if (!run.draw.length) { run.draw = shuffle(r, run.discard); run.discard = []; }
        const uid = run.draw.shift();
        if (uid) run.hand.push(uid);
        return uid || null;
    }
    const handSize = run => 3 + (run.relics.includes("pouch") ? 1 : 0);
    function refillHand(run, r) {
        const got = [];
        while (run.hand.length < handSize(run)) { const u = drawOne(run, r); if (!u) break; got.push(u); }
        return got;
    }
    function discardHand(run) { run.discard.push(...run.hand); run.hand = []; }
    function playCard(run, uid, r) {
        run.hand = run.hand.filter(u => u !== uid);
        run.discard.push(uid);
        run.played++;
        return refillHand(run, r);
    }
    function addCard(run, id, up) { const c = inst(id, up); run.deck.push(c); run.discard.push(c.uid); return c; }
    function removeCard(run, uid) {
        run.deck = run.deck.filter(c => c.uid !== uid);
        for (const pile of ["draw", "discard", "hand"]) run[pile] = run[pile].filter(u => u !== uid);
    }
    const rewardChoices = (r, level, n) => shuffle(r, Object.keys(CARDS).filter(id => CARDS[id].unlock <= level)).slice(0, n);

    const rules = { hash, rng, shuffle, CARDS, RELICS, STARTER, BASE_XP, levelOf, need, rankOf, cardGain, withMomentum, buildMap, newRun, drawOne, refillHand, discardHand, playCard, addCard, removeCard, rewardChoices, handSize };
    root.PaleMoonRules = rules;
    if (typeof module !== "undefined" && module.exports) module.exports = rules;
    if (typeof document === "undefined") return;

    // ---------- state ----------
    const V = root.VINderCore;
    const reduce = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const store = {
        get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode: progress lives for this visit only */ } }
    };
    const meta = Object.assign({ on: true, music: true, sfx: true, voice: true, vol: 0.7, xp: 0, runs: 0, foes: 0, verdicts: 0 }, store.get("vinderGameMeta", {}));
    const saveMeta = () => store.set("vinderGameMeta", meta);
    const runKey = id => `vinderGameRun:${id}`;
    let ctx = null, run = null, item = null, screen = "home", holdUntil = 0;
    const justDrawn = new Set();
    const saveRun = () => { if (run) store.set(runKey(run.packId), run); };
    const cardOf = uid => run && run.deck.find(c => c.uid === uid);
    const level = () => levelOf(meta.xp).level;

    const h = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    };

    function topCard() {
        if (!ctx || !ctx.pack) return null;
        return V.remainingCards(ctx.cards, ctx.decisions, ctx.actions).filter(c => !V.isDecided(ctx.actions, ctx.decisions[c.key]))[0] || null;
    }
    let mapCache = { cards: null, nodes: [] };
    function nodes() {
        if (ctx && mapCache.cards !== ctx.cards) mapCache = { cards: ctx.cards, nodes: buildMap(ctx.cards) };
        return mapCache.nodes;
    }
    const nodeType = gid => (nodes().find(n => n.groupId === String(gid)) || { type: "foe" }).type;
    const groupById = gid => { const c = ctx && ctx.cards.find(x => String(x.group.groupId) === String(gid)); return c ? c.group : null; };

    const ADJ = ["Rust-Eaten", "Hollow", "Crooked", "Moon-Mad", "Thorned", "Ashen", "Whispering", "Grinning", "Gilded", "Pale", "Cracked", "Mire-Born"];
    const NOUN = ["Gremlin", "Wraith", "Hobgoblin", "Bogle", "Mite", "Golem", "Shade", "Wight", "Kelpie", "Changeling", "Imp", "Barghest"];
    const TITLES = ["the Unblinking", "Keeper of Flaws", "the Many-Toothed", "of the Long Night", "the Scratcher", "Who Hides in Seams"];
    function foeName(gid) {
        const r = rng(hash(`${gid}|name`));
        const type = nodeType(gid);
        const base = `${pick(r, ADJ)} ${pick(r, NOUN)}`;
        if (type === "boss") return `The ${pick(r, ["Pale", "Hollow", "Thorn", "Ash", "Iron", "Silent"])} Sovereign`;
        return type === "elite" ? `${base}, ${pick(r, TITLES)}` : base;
    }

    // ---------- audio: everything synthesised, so it works offline ----------
    const A = { ctx: null, master: null, music: null, sfx: null, timer: 0, step: 0, next: 0, mood: null, noise: null };
    function audio() {
        if (!A.ctx) {
            const C = root.AudioContext || root.webkitAudioContext;
            if (!C) return null;
            A.ctx = new C();
            const comp = A.ctx.createDynamicsCompressor();
            comp.connect(A.ctx.destination);
            A.master = A.ctx.createGain(); A.master.gain.value = meta.vol; A.master.connect(comp);
            A.music = A.ctx.createGain(); A.music.gain.value = 0.5; A.music.connect(A.master);
            A.sfx = A.ctx.createGain(); A.sfx.gain.value = 0.9; A.sfx.connect(A.master);
            const len = A.ctx.sampleRate;
            A.noise = A.ctx.createBuffer(1, len, len);
            const d = A.noise.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        if (A.ctx.state === "suspended" && !document.hidden) A.ctx.resume().catch(() => {});
        return A.ctx;
    }
    const mf = m => 440 * Math.pow(2, (m - 69) / 12);
    function tone(dest, t, f, dur, type, vol, attack, glide, cutoff) {
        const c = A.ctx, o = c.createOscillator(), g = c.createGain();
        o.type = type || "triangle";
        o.frequency.setValueAtTime(f, t);
        if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol || 0.2, t + (attack || 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        let node = o;
        if (cutoff) { const fl = c.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = cutoff; o.connect(fl); node = fl; }
        node.connect(g); g.connect(dest);
        o.start(t); o.stop(t + dur + 0.05);
    }
    function noise(dest, t, dur, vol, type, freq) {
        const c = A.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        s.buffer = A.noise; f.type = type || "lowpass"; f.frequency.value = freq || 1000;
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f); f.connect(g); g.connect(dest);
        s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    }
    function pad(t, f, dur, cutoff) {
        const c = A.ctx, g = c.createGain(), fl = c.createBiquadFilter();
        fl.type = "lowpass"; fl.frequency.value = cutoff;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.022, t + 0.6);
        g.gain.setValueAtTime(0.022, t + Math.max(0.7, dur - 0.4));
        g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.5);
        fl.connect(g); g.connect(A.music);
        for (const det of [-7, 7]) {
            const o = c.createOscillator();
            o.type = "sawtooth"; o.frequency.value = f; o.detune.value = det;
            o.connect(fl); o.start(t); o.stop(t + dur + 0.6);
        }
    }
    // Chords as MIDI notes. Explore is a music box over A minor; battle adds drums; the boss turns to D minor.
    const MOODS = {
        explore: { bpm: 72, prog: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]], drums: 0, cutoff: 900, arpEvery: 2, arpUp: 24, arpWave: "sine", bassEvery: 8 },
        battle: { bpm: 112, prog: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]], drums: 1, cutoff: 1500, arpEvery: 1, arpUp: 12, arpWave: "triangle", bassEvery: 2 },
        boss: { bpm: 126, prog: [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]], drums: 2, cutoff: 2100, arpEvery: 1, arpUp: 12, arpWave: "triangle", bassEvery: 2, lead: true }
    };
    const ARPS = [[0, 1, 2, 1, 2, 0, 1, 2], [0, 2, 1, 2, 0, 2, 1, 0]];
    const LEAD = [0, null, 2, 1, null, 0, 2, null];
    function schedule() {
        const c = A.ctx, m = MOODS[A.mood];
        if (!c || !m) return;
        const sd = 60 / m.bpm / 4;
        while (A.next < c.currentTime + 0.15) {
            const s = A.step % 16, bar = Math.floor(A.step / 16), chord = m.prog[bar % 4], t = A.next;
            if (s === 0) for (const n of chord) pad(t, mf(n), sd * 16, m.cutoff);
            if (s % m.bassEvery === 0) tone(A.music, t, mf(chord[0] - 24 + (m.drums && s % 4 === 2 ? 12 : 0)), sd * m.bassEvery * 0.9, m.drums === 2 ? "sawtooth" : "triangle", m.drums ? 0.13 : 0.09, 0.01, null, 650);
            if (s % m.arpEvery === 0) {
                const idx = ARPS[bar % 2][(s / m.arpEvery) % 8];
                tone(A.music, t, mf(chord[idx] + m.arpUp + (m.drums && s >= 8 && bar % 4 === 3 ? 12 : 0)), m.drums ? sd * 0.9 : sd * 4, m.arpWave, m.drums ? 0.035 : 0.05, 0.004);
            }
            if (m.lead && s % 2 === 0) {
                const n = LEAD[(s / 2 + bar) % 8];
                if (n !== null) tone(A.music, t, mf(chord[n] + 24), sd * 2.2, "square", 0.02, 0.01, null, 2400);
            }
            if (m.drums) {
                if (s % (m.drums === 2 ? 4 : 8) === 0 || (m.drums === 1 && s === 11)) tone(A.music, t, 150, 0.28, "sine", 0.55, 0.002, 40);
                if (s === 4 || s === 12) noise(A.music, t, 0.16, 0.2, "bandpass", 1800);
                if (s % 2 === 0) noise(A.music, t, 0.035, s % 4 === 2 ? 0.08 : 0.04, "highpass", 7000);
            }
            A.step++; A.next += sd;
        }
    }
    function setMood(m) {
        if (!meta.on || !meta.music || document.hidden) m = null;
        if (m === A.mood && (m === null || A.timer)) return;
        A.mood = m;
        if (!m) { clearInterval(A.timer); A.timer = 0; return; }
        if (!audio()) return;
        A.step = 0;
        A.next = A.ctx.currentTime + 0.08;
        if (!A.timer) A.timer = setInterval(schedule, 25);
    }
    function mood() {
        if (screen !== "deck") return setMood("explore");
        const top = topCard();
        setMood(!top ? "explore" : nodeType(top.group.groupId) === "boss" ? "boss" : "battle");
    }

    function sfx(name) {
        if (!meta.on || !meta.sfx || !audio()) return;
        const t = A.ctx.currentTime + 0.01, o = A.sfx;
        switch (name) {
        case "hit": noise(o, t, 0.14, 0.5, "bandpass", 1600); tone(o, t, 140, 0.18, "sine", 0.6, 0.002, 45); break;
        case "crit": noise(o, t, 0.2, 0.55, "bandpass", 2400); tone(o, t, 160, 0.2, "sine", 0.6, 0.002, 40); tone(o, t + 0.05, 1568, 0.4, "triangle", 0.12); tone(o, t + 0.1, 2093, 0.5, "triangle", 0.1); break;
        case "later": noise(o, t, 0.35, 0.12, "highpass", 900); tone(o, t, 500, 0.3, "sine", 0.05, 0.05, 260); break;
        case "flip": noise(o, t, 0.06, 0.08, "highpass", 3000); break;
        case "card": [784, 988, 1319].forEach((f, i) => tone(o, t + i * 0.05, f, 0.22, "triangle", 0.1)); break;
        case "draw": noise(o, t, 0.12, 0.08, "bandpass", 3500); break;
        case "coin": tone(o, t, 1568, 0.08, "square", 0.05); tone(o, t + 0.07, 2093, 0.25, "square", 0.05); break;
        case "defeat": noise(o, t, 0.7, 0.35, "lowpass", 900); tone(o, t, 420, 0.7, "sawtooth", 0.08, 0.005, 50, 1200); break;
        case "victory": [523, 659, 784, 1047].forEach((f, i) => tone(o, t + 0.25 + i * 0.09, f, 0.5, "triangle", 0.14)); break;
        case "level": [392, 523, 659, 784, 1047].forEach((f, i) => tone(o, t + i * 0.1, f, i === 4 ? 1.2 : 0.3, "square", 0.06, 0.01, null, 3000)); [523, 659, 784].forEach(f => tone(o, t + 0.5, f, 1.4, "triangle", 0.08, 0.05)); break;
        case "undo": tone(o, t, 900, 0.3, "sine", 0.1, 0.01, 300); break;
        case "ui": tone(o, t, 880, 0.06, "triangle", 0.06); break;
        case "foe": tone(o, t, 110, 0.6, "sawtooth", 0.08, 0.02, 82, 600); noise(o, t, 0.5, 0.1, "lowpass", 400); break;
        default: break;
        }
    }

    // ---------- narration: browser speech plus on-screen subtitles ----------
    const sub = h("div", "g-sub");
    sub.setAttribute("aria-live", "polite");
    sub.hidden = true;
    let subTimer = 0;
    function voice() {
        const vs = (root.speechSynthesis && root.speechSynthesis.getVoices()) || [];
        const en = vs.filter(v => /^en/i.test(v.lang));
        return en.find(v => /UK English|Daniel|Arthur|George/i.test(v.name)) || en[0] || null;
    }
    function say(text) {
        if (!meta.on || !text) return;
        sub.textContent = text;
        sub.hidden = false;
        sub.classList.remove("g-sub-in"); void sub.offsetWidth; sub.classList.add("g-sub-in");
        clearTimeout(subTimer);
        subTimer = setTimeout(() => { sub.hidden = true; }, 1800 + text.length * 55);
        if (!meta.voice || !root.speechSynthesis || typeof root.SpeechSynthesisUtterance !== "function") return;
        try {
            root.speechSynthesis.cancel();
            const u = new root.SpeechSynthesisUtterance(text);
            const v = voice();
            if (v) u.voice = v;
            u.rate = 0.95; u.pitch = 0.82; u.volume = Math.min(1, meta.vol + 0.2);
            const duck = to => { if (A.music) A.music.gain.setTargetAtTime(to, A.ctx.currentTime, 0.15); };
            u.onstart = () => duck(0.16);
            u.onend = u.onerror = () => duck(0.5);
            root.speechSynthesis.speak(u);
        } catch (_) { /* subtitles still show */ }
    }
    const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k] ?? "");
    const LINES = {
        intro: ["Once, beneath a pale moon, an inspector set out on the road called {pack}. {n} foes waited in the dark.", "The moon rises over {pack}. {n} foes stir in the shadows. Look closely, and none will hide from you."],
        elite: ["A stronger foe bars the road. It hides its flaws well. Look closely.", "This one has teeth. Take your time, and see everything."],
        boss: ["The last foe of {pack} rises. Finish this, and the tale is yours.", "Here waits {foe}. The final page of tonight's story."],
        foe: ["Something stirs.", "{foe} creeps out of the dark.", "Another shape in the moonlight."],
        defeat: ["{foe} falls.", "Cleared, and well seen.", "The road ahead is quiet. For now.", "Clean work, inspector."],
        level: ["Level {lvl}. Your eye grows sharper.", "Level {lvl}. The moon remembers your name.", "Level {lvl}. They will call you {rank}."],
        end: ["And so the tale of {pack} ends. {foes} foes vanquished. Send your report, inspector.", "The night is won. {foes} foes, {xp} experience. Now send the report home."],
        camp: ["A campfire in the woods. Rest, and sharpen one technique."],
        shop: ["A wandering trader lifts their lantern. Moonshards, for wonders."],
        cache: ["A forgotten cache, half buried in moss. Take what calls to you."],
        send: ["The report flies off into the night. Well done.", "Sent. The story of tonight is told."]
    };
    const line = (k, o) => fill(pick(Math.random, LINES[k]), o || {});

    // ---------- VFX: one canvas for particles, DOM for numbers ----------
    const fxCanvas = h("canvas", "g-fx");
    fxCanvas.setAttribute("aria-hidden", "true");
    const fx2 = fxCanvas.getContext("2d");
    const parts = [];
    let raf = 0;
    function sizeFx() {
        const d = root.devicePixelRatio || 1;
        fxCanvas.width = root.innerWidth * d; fxCanvas.height = root.innerHeight * d;
        fx2.setTransform(d, 0, 0, d, 0, 0);
    }
    function burst(x, y, o) {
        const n = Math.max(1, Math.round((o.n || 24) * (reduce ? 0.25 : 1)));
        for (let i = 0; i < n; i++) {
            const a = o.dir !== undefined ? o.dir + (Math.random() - 0.5) * (o.spread || 1) : Math.random() * Math.PI * 2;
            const sp = (o.speed || 4) * (0.35 + Math.random() * 0.9);
            const life = (o.life || 40) * (0.6 + Math.random() * 0.6);
            parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.lift || 0), life, max: life, size: (o.size || 2.5) * (0.6 + Math.random() * 0.8),
                color: o.colors[Math.floor(Math.random() * o.colors.length)], g: o.gravity ?? 0.12, shape: o.shape || "spark" });
        }
        if (!raf) raf = requestAnimationFrame(tick);
    }
    function tick() {
        fx2.clearRect(0, 0, root.innerWidth, root.innerHeight);
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.97; p.life--;
            if (p.life <= 0) { parts.splice(i, 1); continue; }
            fx2.globalAlpha = Math.min(1, p.life / p.max * 1.4);
            fx2.strokeStyle = fx2.fillStyle = p.color;
            if (p.shape === "spark") {
                fx2.lineWidth = p.size; fx2.lineCap = "round";
                fx2.beginPath(); fx2.moveTo(p.x, p.y); fx2.lineTo(p.x - p.vx * 2.5, p.y - p.vy * 2.5); fx2.stroke();
            } else if (p.shape === "star") {
                const s = p.size * 1.6;
                fx2.beginPath();
                fx2.moveTo(p.x, p.y - s); fx2.quadraticCurveTo(p.x, p.y, p.x + s, p.y); fx2.quadraticCurveTo(p.x, p.y, p.x, p.y + s);
                fx2.quadraticCurveTo(p.x, p.y, p.x - s, p.y); fx2.quadraticCurveTo(p.x, p.y, p.x, p.y - s); fx2.fill();
            } else {
                fx2.beginPath(); fx2.arc(p.x, p.y, p.size, 0, Math.PI * 2); fx2.fill();
            }
        }
        fx2.globalAlpha = 1;
        raf = parts.length ? requestAnimationFrame(tick) : 0;
    }
    const center = node => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    function floatAt(node, text, cls) {
        if (!node || !node.isConnected) return;
        const c = center(node);
        const f = h("div", `g-float ${cls || ""}`, text);
        f.style.left = `${c.x}px`; f.style.top = `${c.y}px`;
        f.setAttribute("aria-hidden", "true");
        document.body.appendChild(f);
        setTimeout(() => f.remove(), 1300);
    }
    function restartClass(node, cls, ms) {
        node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls);
        if (ms) setTimeout(() => node.classList.remove(cls), ms);
    }

    // ---------- HUD ----------
    const hud = h("div", "g-hud");
    hud.id = "gHud";
    hud.innerHTML = `
        <button type="button" class="g-route-strip" id="gStrip" aria-label="Open the route map"></button>
        <div class="g-foe">
            <div class="g-portrait" id="gPortrait"><span class="g-slash"></span></div>
            <div class="g-foe-info">
                <div class="g-foe-name"><b id="gFoeName"></b><span class="g-tag" id="gFoeTag"></span></div>
                <div class="g-foe-sub" id="gFoeSub"></div>
                <div class="g-hp" role="meter" aria-label="Left on this foe" id="gHp"><span id="gHpFill"></span><em id="gHpText"></em></div>
            </div>
            <button type="button" class="g-me" id="gMe" aria-label="Your legend">
                <span class="g-lvl" id="gLvl"></span>
                <span class="g-xp"><span id="gXpFill"></span></span>
                <span class="g-res"><span id="gMom" title="Momentum"></span><span id="gScrap" title="Moonshards"></span></span>
            </button>
        </div>
        <div class="g-hand" id="gHand" aria-label="Your hand"></div>
        <div class="g-tip" id="gTip" hidden></div>`;
    const deckbar = document.querySelector("#deck .deckbar");
    if (deckbar) deckbar.after(hud);
    const $ = id => document.getElementById(id);
    const portraitEl = $("gPortrait");

    const overlay = h("div", "g-overlay");
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "gOvTitle");
    document.body.append(fxCanvas, sub, overlay);
    sizeFx();
    root.addEventListener("resize", sizeFx);

    const homeBtn = h("button", "btn btn-block g-home-btn");
    homeBtn.type = "button";
    const checkUpdate = document.getElementById("checkUpdate");
    if (checkUpdate) checkUpdate.before(homeBtn);
    homeBtn.addEventListener("click", () => { sfx("ui"); enqueue(profileOverlay); });
    const tagline = h("p", "g-tagline", "~ Tales of the Pale Moon ~");
    const brand = document.querySelector(".brandbar");
    if (brand) brand.after(tagline);

    function portraitSvg(gid, type) {
        const r = rng(hash(`${gid}|face`));
        const hue = Math.floor(r() * 360);
        const id = `pg${hash(gid).toString(36)}`;
        const eye = type === "boss" ? "#ff4d6d" : type === "elite" ? "#ffd166" : "#bff6ff";
        const pts = [];
        const n = 11, big = type === "boss" ? 4 : 0;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const rad = 27 + big + (r() - 0.5) * 12;
            pts.push([50 + Math.cos(a) * rad, 56 + Math.sin(a) * rad * 0.92]);
        }
        const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        let d = `M${mid(pts[n - 1], pts[0]).map(v => v.toFixed(1)).join(" ")}`;
        for (let i = 0; i < n; i++) { const m = mid(pts[i], pts[(i + 1) % n]); d += ` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`; }
        const horns = type !== "foe" || r() > 0.45
            ? `<path d="M33 36 L${24 - r() * 8} ${12 - r() * 6} L42 31Z M67 36 L${76 + r() * 8} ${12 - r() * 6} L58 31Z" fill="hsl(${hue} 30% 22%)"/>` : "";
        const eyes = 1 + Math.floor(r() * 3);
        const ex = eyes === 1 ? [50] : eyes === 2 ? [40, 60] : [36, 50, 64];
        const eyeSvg = ex.map((x, i) => {
            const y = eyes === 3 && i === 1 ? 44 : 50, s = eyes === 1 ? 8 : 5.5;
            return `<ellipse cx="${x}" cy="${y}" rx="${s}" ry="${s * 0.8}" fill="#0b0a16"/><circle class="g-eye" cx="${x}" cy="${y}" r="${s * 0.45}" fill="${eye}"/>`;
        }).join("");
        let teeth = "M36 66";
        const tn = 4 + Math.floor(r() * 4);
        for (let i = 1; i <= tn; i++) teeth += ` L${36 + (28 / tn) * (i - 0.5)} ${i % 2 ? 73 : 70} L${36 + (28 / tn) * i} 66`;
        const crown = type === "boss" ? `<path d="M34 24 L38 10 L44 20 L50 6 L56 20 L62 10 L66 24Z" fill="#e9c46a" stroke="#7a5a12" stroke-width="1.2"/>` : "";
        return `<svg viewBox="0 0 100 100" aria-hidden="true" class="g-face">
            <defs><radialGradient id="${id}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="hsl(${hue} 55% 52%)"/><stop offset="1" stop-color="hsl(${hue} 50% 18%)"/></radialGradient></defs>
            ${horns}<path d="${d}" fill="url(#${id})" stroke="hsl(${hue} 40% 10%)" stroke-width="1.5"/>${crown}${eyeSvg}
            <path d="${teeth}" fill="none" stroke="#f1e9d2" stroke-width="2" stroke-linejoin="round"/></svg>`;
    }

    const NODE_ICON = { foe: "⚔️", elite: "💀", boss: "🌕", camp: "🔥", shop: "🕯️", cache: "🗝️" };
    const NODE_NAME = { camp: "Campfire", shop: "Wandering trader", cache: "Forgotten cache" };
    const nodeDone = n => n.groupId ? Boolean(run && run.defeated[n.groupId]) : Boolean(run && run.events[n.id]);

    function renderStrip() {
        const strip = $("gStrip");
        strip.replaceChildren();
        for (const n of nodes()) {
            const dot = h("i", `g-dot g-dot-${n.type}${nodeDone(n) ? " done" : ""}${run && n.groupId && n.groupId === run.foe ? " here" : ""}`);
            strip.appendChild(dot);
        }
    }
    function renderMe() {
        const L = levelOf(meta.xp);
        $("gLvl").textContent = `Lv ${L.level}`;
        $("gXpFill").style.width = `${(L.into / L.need) * 100}%`;
        $("gMom").textContent = `⚡${run ? run.momentum : 0}`;
        $("gScrap").textContent = `✧${run ? run.scrap : 0}`;
        homeBtn.textContent = `🌕 Pale Moon · Lv ${L.level} ${rankOf(L.level)}`;
    }
    const gainText = (id, g) => [g.xp && `+${g.xp} XP`, g.mom && `+${g.mom} ⚡`, g.scrap && `+${g.scrap} ✧`, CARDS[id].momReset && "spends ⚡"].filter(Boolean).join(" · ");
    function renderHand() {
        const hand = $("gHand");
        hand.replaceChildren();
        if (!run) return;
        for (const uid of run.hand) {
            const c = cardOf(uid);
            if (!c) continue;
            const def = CARDS[c.id];
            const b = h("button", `g-card${c.up ? " g-up" : ""}${justDrawn.has(uid) ? " g-draw" : ""}`);
            b.type = "button";
            b.dataset.uid = uid;
            b.setAttribute("aria-label", `${def.name}${c.up ? " plus" : ""}: ${def.text}, ${gainText(c.id, cardGain(c.id, c.up, run.relics))}`);
            b.append(h("span", "g-card-icon", def.icon), h("span", "g-card-name", `${def.name}${c.up ? "+" : ""}`));
            b.addEventListener("click", () => {
                const tip = $("gTip");
                const same = !tip.hidden && tip.dataset.uid === uid;
                tip.hidden = same;
                tip.dataset.uid = uid;
                tip.textContent = `${def.icon} ${def.name}${c.up ? "+" : ""}: ${def.text} → ${gainText(c.id, cardGain(c.id, c.up, run.relics))}`;
            });
            hand.appendChild(b);
        }
        justDrawn.clear();
    }
    function renderHud() {
        document.body.classList.toggle("game-on", meta.on);
        hud.hidden = !meta.on || !ctx;
        renderMe();
        if (hud.hidden) return;
        renderStrip();
        const top = topCard();
        if (!top) {
            portraitEl.dataset.gid = "";
            portraitEl.className = "g-portrait g-clear";
            portraitEl.innerHTML = `<span class="g-slash"></span><span class="g-moon" aria-hidden="true">🌕</span>`;
            $("gFoeName").textContent = "The road is clear";
            $("gFoeTag").textContent = "";
            $("gFoeSub").textContent = ctx.pack.title || "";
            $("gHpFill").style.width = "0%";
            $("gHpText").textContent = "";
            renderHand();
            return;
        }
        const gid = String(top.group.groupId), type = nodeType(gid);
        if (portraitEl.dataset.gid !== gid) {
            portraitEl.dataset.gid = gid;
            portraitEl.className = `g-portrait g-${type}`;
            portraitEl.innerHTML = `${portraitSvg(gid, type)}<span class="g-slash"></span>`;
            if (!reduce) restartClass(portraitEl, "g-enter", 700);
        }
        $("gFoeName").textContent = foeName(gid);
        $("gFoeTag").textContent = type === "boss" ? "BOSS" : type === "elite" ? "ELITE" : "";
        $("gFoeTag").className = `g-tag g-tag-${type}`;
        $("gFoeSub").textContent = [top.group.title, top.group.subtitle].filter(Boolean).join(" · ");
        const mine = ctx.cards.filter(c => String(c.group.groupId) === gid);
        const left = mine.filter(c => !V.isDecided(ctx.actions, ctx.decisions[c.key])).length;
        $("gHpFill").style.width = `${(left / mine.length) * 100}%`;
        $("gHpText").textContent = `${left} / ${mine.length}`;
        $("gHp").setAttribute("aria-valuenow", String(left));
        $("gHp").setAttribute("aria-valuemax", String(mine.length));
        renderHand();
    }

    // ---------- overlays, shown one at a time ----------
    const queue = [];
    let showing = false;
    function enqueue(fn) { queue.push(fn); if (!showing) nextOverlay(); }
    function nextOverlay() {
        const fn = queue.shift();
        if (!fn) {
            showing = false;
            overlay.hidden = true;
            document.body.classList.remove("g-modal");
            return;
        }
        showing = true;
        fn();
    }
    // actions: [{ label, primary, onClick }]; onClick returning false keeps the panel open.
    function panel({ kicker, title, body, actions, wide }) {
        overlay.replaceChildren();
        const p = h("div", `g-panel${wide ? " g-wide" : ""}`);
        if (kicker) p.appendChild(h("div", "g-kicker", kicker));
        const t = h("h2", "g-title", title);
        t.id = "gOvTitle";
        p.appendChild(t);
        if (body) p.appendChild(body);
        const row = h("div", "g-actions");
        for (const a of actions || []) {
            const b = h("button", `btn${a.primary ? " btn-primary" : ""}`, a.label);
            b.type = "button";
            if (a.disabled) b.disabled = true;
            b.addEventListener("click", () => { sfx("ui"); if (a.onClick && a.onClick() === false) return; nextOverlay(); });
            row.appendChild(b);
        }
        p.appendChild(row);
        overlay.appendChild(p);
        overlay.hidden = false;
        document.body.classList.add("g-modal");
        const first = p.querySelector("button:not([disabled])");
        if (first) first.focus({ preventScroll: true });
    }
    function bigCard(id, up, note) {
        const def = CARDS[id];
        const b = h("button", `g-big g-r${Math.min(4, def.unlock)}${up ? " g-up" : ""}`);
        b.type = "button";
        b.append(h("span", "g-big-icon", def.icon), h("span", "g-big-name", `${def.name}${up ? "+" : ""}`), h("span", "g-big-text", def.text),
            h("span", "g-big-gain", gainText(id, cardGain(id, up, run ? run.relics : []))));
        if (note) b.appendChild(h("span", "g-big-note", note));
        return b;
    }
    function relicEl(id, note) {
        const r = RELICS[id];
        const b = h("button", "g-relic");
        b.type = "button";
        b.append(h("span", "g-relic-icon", r.icon), h("span", "g-relic-name", r.name), h("span", "g-relic-text", r.text));
        if (note) b.appendChild(h("span", "g-big-note", note));
        return b;
    }
    function routeEl() {
        const list = h("ol", "g-route");
        for (const n of nodes()) {
            const li = h("li", `g-node g-node-${n.type}${nodeDone(n) ? " done" : ""}${run && n.groupId === run.foe ? " here" : ""}`);
            const g = n.groupId ? groupById(n.groupId) : null;
            li.append(h("span", "g-node-icon", NODE_ICON[n.type]));
            const txt = h("span", "g-node-text");
            txt.append(h("b", "", n.groupId ? foeName(n.groupId) : NODE_NAME[n.type]));
            if (g) txt.append(h("small", "", [g.title, `${n.count} to decide`].filter(Boolean).join(" · ")));
            li.appendChild(txt);
            list.appendChild(li);
        }
        return list;
    }
    function introOverlay() {
        const body = h("div", "g-body");
        const fs = nodes().filter(n => n.groupId).length;
        const text = line("intro", { pack: ctx.pack.title || "tonight's pack", n: fs });
        body.append(h("p", "g-lore", text), routeEl(),
            h("p", "g-fine", "Every verdict strikes the same blow, whatever you choose. Cards reward looking closely: flipping photos, zooming, reading details, checking values. Choose what's true."));
        panel({ kicker: "A new tale begins", title: ctx.pack.title || "The Expedition", body, actions: [{ label: "Begin", primary: true, onClick: () => { audio(); mood(); } }] });
        say(text);
    }
    function mapOverlay() {
        const body = h("div", "g-body");
        body.appendChild(routeEl());
        if (run && run.relics.length) {
            const rel = h("div", "g-relic-row");
            for (const id of run.relics) rel.appendChild(h("span", "g-relic-chip", `${RELICS[id].icon} ${RELICS[id].name}`));
            body.appendChild(rel);
        }
        if (run) body.appendChild(h("p", "g-fine", `Deck: ${run.deck.length} cards · ✧${run.scrap} Moonshards`));
        panel({ kicker: "The road", title: ctx.pack.title || "Route", body, actions: [{ label: "Close", primary: true }] });
    }
    function rewardOverlay(gid) {
        const body = h("div", "g-body");
        const choices = rewardChoices(Math.random, level(), 3);
        const row = h("div", "g-big-row");
        for (const id of choices) {
            const b = bigCard(id, false);
            b.addEventListener("click", () => {
                addCard(run, id, false); saveRun(); sfx("card");
                const c = center(b); burst(c.x, c.y, { n: 30, colors: ["#e9c46a", "#fff3c4"], shape: "star", speed: 5 });
                nextOverlay();
            });
            row.appendChild(b);
        }
        body.append(h("p", "g-lore", "Choose a card for your deck."), row);
        panel({ kicker: "Victory", title: `${foeName(gid)} is vanquished`, body, actions: [{ label: "Skip" }] });
    }
    function relicOverlay(kicker, title) {
        const left = Object.keys(RELICS).filter(id => !run.relics.includes(id));
        if (!left.length) { run.scrap += 20; saveRun(); renderMe(); nextOverlay(); return; }
        const body = h("div", "g-body");
        const row = h("div", "g-relic-pick");
        for (const id of shuffle(Math.random, left).slice(0, 2)) {
            const b = relicEl(id);
            b.addEventListener("click", () => { run.relics.push(id); saveRun(); sfx("coin"); renderHud(); nextOverlay(); });
            row.appendChild(b);
        }
        body.append(h("p", "g-lore", "Relics stay with you until this tale ends."), row);
        panel({ kicker, title, body, actions: [{ label: "Leave it" }] });
    }
    function campOverlay() {
        const body = h("div", "g-body");
        const plain = shuffle(Math.random, run.deck.filter(c => !c.up)).slice(0, 3);
        const row = h("div", "g-big-row");
        for (const c of plain) {
            const b = bigCard(c.id, true, "Sharpen");
            b.addEventListener("click", () => { c.up = true; saveRun(); sfx("level"); nextOverlay(); });
            row.appendChild(b);
        }
        body.append(h("p", "g-lore", plain.length ? "Sharpen one card (+50%), or sit by the fire for a while." : "All your cards are sharp. Sit by the fire for a while."), row);
        panel({ kicker: "Campfire", title: "Rest under the trees", body, actions: [{ label: "Rest (+30 XP)", onClick: () => grant(30, homeBtn) }] });
        say(line("camp"));
    }
    function shopOverlay() {
        const prices = { card: 12, relic: 35, remove: 15 };
        const stock = { cards: rewardChoices(Math.random, level(), 3), relic: shuffle(Math.random, Object.keys(RELICS).filter(id => !run.relics.includes(id)))[0] || null, removed: false };
        const draw = () => {
            const body = h("div", "g-body");
            body.appendChild(h("p", "g-lore", `You carry ✧${run.scrap} Moonshards.`));
            const row = h("div", "g-big-row");
            stock.cards.forEach((id, i) => {
                if (!id) return;
                const b = bigCard(id, false, `✧${prices.card}`);
                b.disabled = run.scrap < prices.card;
                b.addEventListener("click", () => { run.scrap -= prices.card; addCard(run, id, false); stock.cards[i] = null; saveRun(); sfx("coin"); draw(); });
                row.appendChild(b);
            });
            body.appendChild(row);
            if (stock.relic) {
                const r = relicEl(stock.relic, `✧${prices.relic}`);
                r.disabled = run.scrap < prices.relic;
                r.addEventListener("click", () => { run.scrap -= prices.relic; run.relics.push(stock.relic); stock.relic = null; saveRun(); sfx("coin"); draw(); });
                body.appendChild(r);
            }
            if (!stock.removed && run.deck.length > 3) {
                body.appendChild(h("h3", "g-h3", `Burn a card from your deck (✧${prices.remove})`));
                const rm = h("div", "g-chip-row");
                for (const c of run.deck) {
                    const b = h("button", "g-chip-btn", `${CARDS[c.id].icon} ${CARDS[c.id].name}${c.up ? "+" : ""}`);
                    b.type = "button";
                    b.disabled = run.scrap < prices.remove;
                    b.addEventListener("click", () => { run.scrap -= prices.remove; removeCard(run, c.uid); stock.removed = true; saveRun(); sfx("defeat"); draw(); });
                    rm.appendChild(b);
                }
                body.appendChild(rm);
            }
            renderMe();
            panel({ kicker: "Wandering trader", title: "Wares by lantern light", body, wide: true, actions: [{ label: "Leave", primary: true, onClick: () => renderHud() }] });
        };
        draw();
        say(line("shop"));
    }
    function cacheOverlay() { relicOverlay("Forgotten cache", "Something glints in the moss"); say(line("cache")); }
    function eventOverlay(type) { (type === "camp" ? campOverlay : type === "shop" ? shopOverlay : cacheOverlay)(); }
    function summaryOverlay() {
        const L = levelOf(meta.xp);
        const foes = Object.keys(run.defeated).length;
        const body = h("div", "g-body");
        const dl = h("dl", "g-stats");
        for (const [k, v] of [["Foes vanquished", foes], ["XP earned", run.xp], ["Deck", `${run.deck.length} cards`], ["Relics", run.relics.map(id => RELICS[id].icon).join(" ") || "none"], ["Rank", `Lv ${L.level} ${rankOf(L.level)}`]]) dl.append(h("dt", "", k), h("dd", "", String(v)));
        const text = line("end", { pack: ctx.pack.title || "tonight", foes, xp: run.xp });
        body.append(h("p", "g-lore", text), dl);
        panel({ kicker: "The tale is told", title: ctx.pack.title || "Expedition complete", body, actions: [{ label: "Onward", primary: true }] });
        say(text);
        sfx("victory");
        if (!reduce) for (let i = 0; i < 4; i++) setTimeout(() => burst(root.innerWidth * (0.2 + Math.random() * 0.6), root.innerHeight * 0.3, { n: 40, colors: ["#e9c46a", "#f8f1d8", "#b9a8ff"], shape: "star", speed: 6 }), i * 250);
    }
    function profileOverlay() {
        const L = levelOf(meta.xp);
        const body = h("div", "g-body");
        const bar = h("div", "g-bigxp");
        const fillEl = h("span");
        fillEl.style.width = `${(L.into / L.need) * 100}%`;
        bar.appendChild(fillEl);
        body.append(h("p", "g-lore", `${rankOf(L.level)} · ${L.into} / ${L.need} XP to Lv ${L.level + 1}`), bar);
        const dl = h("dl", "g-stats");
        for (const [k, v] of [["Tales told", meta.runs], ["Foes vanquished", meta.foes], ["Verdicts", meta.verdicts], ["Total XP", meta.xp]]) dl.append(h("dt", "", k), h("dd", "", String(v)));
        body.appendChild(dl);
        const opts = h("div", "g-opts");
        const toggle = (key, label) => {
            const l = h("label", "g-opt");
            const i = h("input");
            i.type = "checkbox"; i.checked = Boolean(meta[key]);
            i.addEventListener("change", () => { meta[key] = i.checked; saveMeta(); apply(); });
            l.append(i, h("span", "", label));
            opts.appendChild(l);
        };
        toggle("on", "Pale Moon game mode");
        toggle("music", "Music");
        toggle("sfx", "Sound effects");
        toggle("voice", "Narrator voice");
        const vl = h("label", "g-opt g-vol");
        const vi = h("input");
        vi.type = "range"; vi.min = "0"; vi.max = "1"; vi.step = "0.05"; vi.value = String(meta.vol);
        vi.addEventListener("input", () => { meta.vol = Number(vi.value); if (A.master) A.master.gain.value = meta.vol; saveMeta(); });
        vl.append(h("span", "", "Volume"), vi);
        opts.appendChild(vl);
        body.appendChild(opts);
        body.appendChild(h("h3", "g-h3", "Card collection"));
        const grid = h("div", "g-collection");
        for (const id of Object.keys(CARDS)) {
            const def = CARDS[id], open = def.unlock <= L.level;
            grid.appendChild(h("div", `g-coll${open ? "" : " locked"}`, open ? `${def.icon} ${def.name}` : `🔒 Lv ${def.unlock}`));
        }
        body.appendChild(grid);
        panel({ kicker: "Your legend", title: `Lv ${L.level} ${rankOf(L.level)}`, body, wide: true, actions: [{ label: "Close", primary: true }] });
    }
    overlay.addEventListener("keydown", e => {
        if (e.key !== "Escape") return;
        const btns = overlay.querySelectorAll(".g-actions .btn");
        if (btns.length) btns[btns.length - 1].click();
    });

    // ---------- game flow ----------
    function apply() {
        document.body.classList.toggle("game-on", meta.on);
        tagline.hidden = !meta.on;
        if (!meta.on) { setMood(null); try { root.speechSynthesis && root.speechSynthesis.cancel(); } catch (_) { /* fine */ } sub.hidden = true; }
        else mood();
        renderHud();
    }

    function levelUp(lvl) {
        sfx("level");
        const unlocked = Object.keys(CARDS).filter(id => CARDS[id].unlock === lvl).map(id => `${CARDS[id].icon} ${CARDS[id].name}`);
        const banner = h("div", "g-banner");
        banner.setAttribute("aria-hidden", "true");
        banner.append(h("div", "g-rays"), h("b", "", `LEVEL ${lvl}`), h("span", "", unlocked.length ? `New card: ${unlocked.join(", ")}` : rankOf(lvl)));
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 2600);
        burst(root.innerWidth / 2, root.innerHeight * 0.4, { n: 70, colors: ["#e9c46a", "#fff3c4", "#b9a8ff"], shape: "star", speed: 7 });
        say(line("level", { lvl, rank: rankOf(lvl) }));
    }
    function grant(xp, anchor) {
        if (!xp || !run) return;
        const before = level();
        run.xp += xp; meta.xp += xp;
        floatAt(anchor || portraitEl, `+${xp} XP`, "g-f-xp");
        const after = level();
        if (after > before) levelUp(after);
        renderMe();
        saveMeta(); saveRun();
    }
    // Fires matching cards in hand. Item-based kinds fire once per item, and never on an item already scored.
    function trigger(kind, t) {
        let xp = 0;
        for (const uid of run.hand.slice()) {
            const c = cardOf(uid);
            if (!c) continue;
            const def = CARDS[c.id];
            if (def.on !== kind || (def.test && !def.test(t))) continue;
            if (kind !== "verdict" && kind !== "defeat") {
                if (!item || run.scored[item.key] || item.fired.has(kind)) continue;
                item.fired.add(kind);
            }
            const g = cardGain(c.id, c.up, run.relics);
            let gx = g.xp;
            const crit = Boolean(gx) && run.relics.includes("bolt") && Math.random() < 0.2;
            if (crit) gx *= 2;
            xp += gx;
            run.momentum = def.momReset ? 0 : Math.min(10, run.momentum + g.mom);
            run.scrap += g.scrap;
            if (g.scrap) sfx("coin");
            flyCard(uid, crit);
            playCard(run, uid, Math.random).forEach(u => justDrawn.add(u));
            if (t) t.played = run.played;
        }
        return xp;
    }
    function flyCard(uid, crit) {
        sfx(crit ? "crit" : "card");
        const node = $("gHand").querySelector(`[data-uid="${uid}"]`);
        if (!node || reduce) return;
        const r = node.getBoundingClientRect(), to = center(portraitEl);
        const f = node.cloneNode(true);
        f.classList.add("g-flying");
        Object.assign(f.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        document.body.appendChild(f);
        requestAnimationFrame(() => {
            f.style.transform = `translate(${to.x - r.left - r.width / 2}px, ${to.y - r.top - r.height / 2}px) scale(.5) rotate(-8deg)`;
            f.style.opacity = "0";
        });
        setTimeout(() => { f.remove(); burst(to.x, to.y, { n: 22, colors: crit ? ["#ff4d6d", "#ffd166"] : ["#e9c46a", "#fff3c4"], shape: "star", speed: 4 }); }, 420);
        if (crit) setTimeout(() => floatAt(portraitEl, "CRIT!", "g-f-crit"), 430);
    }
    function strikeFx(color) {
        const c = center(portraitEl);
        if (!reduce) {
            restartClass(portraitEl, "g-hurt", 420);
            restartClass(hud, "g-shake", 320);
        }
        burst(c.x, c.y, { n: 26, colors: [color, "#ffffff", "#ffe8a3"], speed: 6, gravity: 0.15 });
        floatAt(portraitEl, "−1", "g-f-dmg");
    }
    function startFoe(group) {
        const gid = String(group.groupId);
        if (run.foe && run.foe !== gid && run.lastAction === "later" && !run.defeated[run.foe] && groupById(run.foe)) say(`${foeName(run.foe)} slinks back into the shadows. It will wait for you.`);
        run.foe = gid;
        run.momentum = run.relics.includes("lamp") ? 2 : 0;
        run.played = 0;
        run.first = true;
        discardHand(run);
        refillHand(run, Math.random).forEach(u => justDrawn.add(u));
        if (!run.met[gid]) {
            run.met[gid] = 1;
            const type = nodeType(gid);
            const o = { foe: foeName(gid), pack: ctx.pack.title || "tonight's pack" };
            if (type === "boss") say(line("boss", o));
            else if (type === "elite") say(line("elite", o));
            else if (Math.random() < 0.3) say(line("foe", o));
            setTimeout(() => sfx("foe"), 120);
        } else sfx("draw");
        saveRun();
    }
    function sync() {
        if (!meta.on || !ctx || !run) { renderHud(); return; }
        const wait = holdUntil - performance.now();
        if (wait > 0) { setTimeout(sync, wait + 30); return; }
        const top = topCard();
        if (!run.introduced) {
            run.introduced = true;
            saveRun();
            if (top) enqueue(introOverlay);
        }
        if (!top) {
            if (!run.done) {
                run.done = true;
                saveRun();
                if (Object.keys(run.scored).length) { meta.runs++; saveMeta(); enqueue(summaryOverlay); }
            }
        } else {
            if (String(top.group.groupId) !== run.foe) startFoe(top.group);
            if (!item || item.key !== top.key) item = { key: top.key, seen: new Set(), fired: new Set() };
        }
        renderHud();
        mood();
    }
    function defeat(group) {
        const gid = String(group.groupId);
        if (run.defeated[gid]) return;
        run.defeated[gid] = 1;
        const type = nodeType(gid);
        const n = ctx.cards.filter(c => String(c.group.groupId) === gid).length;
        const mult = run.momentum;
        let xp = Math.round((20 + 5 * n) * (type === "boss" ? 2 : type === "elite" ? 1.5 : 1));
        xp += withMomentum(trigger("defeat", { played: run.played }), mult);
        run.scrap += 2 + (run.relics.includes("gear") ? 3 : 0);
        meta.foes++;
        holdUntil = performance.now() + (reduce ? 300 : 1000);
        setTimeout(() => grant(xp, portraitEl), 350);
        sfx("defeat");
        setTimeout(() => sfx("victory"), 250);
        const c = center(portraitEl);
        portraitEl.classList.add("g-dead");
        burst(c.x, c.y, { n: 60, colors: ["#b9a8ff", "#f8f1d8", "#6b5bd6", "#e9c46a"], speed: 6, gravity: -0.03, shape: "dot", life: 60 });
        burst(c.x, c.y, { n: 14, colors: ["#e9c46a"], speed: 5, gravity: 0.25, shape: "star", lift: 3 });
        if (type === "boss" || type === "elite" || Math.random() < 0.4) say(line("defeat", { foe: foeName(gid) }));
        const route = nodes();
        const next = route[route.findIndex(x => x.groupId === gid) + 1];
        setTimeout(() => {
            enqueue(() => rewardOverlay(gid));
            if (type === "elite" || type === "boss") enqueue(() => relicOverlay("Trophy", `${foeName(gid)} drops a relic`));
            if (next && !next.groupId && !run.events[next.id]) { run.events[next.id] = 1; saveRun(); enqueue(() => eventOverlay(next.type)); }
        }, reduce ? 300 : 950);
    }

    // ---------- app events ----------
    document.addEventListener("vinder:pack", e => {
        ctx = e.detail;
        const saved = store.get(runKey(ctx.pack.packId), null);
        run = saved && Array.isArray(saved.deck) ? saved : newRun(ctx.pack.packId, hash(ctx.pack.packId));
        if (!saved) saveRun();
        item = null;
        portraitEl.dataset.gid = "";
    });
    document.addEventListener("vinder:screen", e => {
        screen = e.detail;
        if (screen !== "deck") $("gTip").hidden = true;
        renderMe();
        mood();
    });
    document.addEventListener("vinder:deck", sync);
    document.addEventListener("vinder:decide", e => {
        if (!meta.on || !run || !ctx) return;
        const { card, actionId } = e.detail;
        if (actionId === ctx.actions.down.id) {
            run.later[card.key] = 1;
            run.lastAction = "later";
            saveRun();
            sfx("later");
            floatAt(portraitEl, "Set aside", "g-f-muted");
            return;
        }
        run.lastAction = "verdict";
        const action = Object.values(ctx.actions).find(a => a.id === actionId);
        strikeFx((action && action.color) || "#ffffff");
        sfx("hit");
        meta.verdicts++;
        if (!run.scored[card.key]) {
            // Undo then redo earns nothing twice.
            run.scored[card.key] = 1;
            const t = { seen: item && item.key === card.key ? item.seen.size : 0, total: card.photos.length, firstOfFoe: run.first,
                wasLater: Boolean(run.later[card.key]), momentum: run.momentum, played: run.played };
            run.first = false;
            const mult = run.momentum;
            const xp = withMomentum(BASE_XP + trigger("verdict", t), mult);
            run.momentum = Math.min(10, run.momentum + 1);
            grant(xp, portraitEl);
        }
        if (V.groupDone(ctx.cards, ctx.decisions, ctx.actions, card.group.groupId)) defeat(card.group);
        saveRun(); saveMeta();
    });
    document.addEventListener("vinder:undo", () => {
        if (!meta.on || !run) return;
        sfx("undo");
        if (!reduce) restartClass(portraitEl, "g-heal", 600);
    });
    function fireAction(kind) {
        if (!meta.on || !run || !item) return;
        const mult = run.momentum;
        const xp = trigger(kind, {});
        if (xp) grant(withMomentum(xp, mult), portraitEl);
        renderHand(); renderMe(); saveRun();
    }
    document.addEventListener("vinder:inspect", e => {
        if (!meta.on || !run || !item) return;
        const d = e.detail || {};
        if (d.key && d.key !== item.key) return;
        const before = item.seen.size;
        item.seen.add(d.src);
        if (d.viewer) fireAction("viewer");
        else if (item.seen.size > before && before > 0) sfx("flip");
    });
    document.addEventListener("vinder:details", () => fireAction("details"));
    document.addEventListener("vinder:check", () => fireAction("check"));
    document.addEventListener("vinder:ai", () => fireAction("ai"));
    document.addEventListener("vinder:send", () => { if (meta.on) { say(line("send")); sfx("victory"); } });

    $("gStrip").addEventListener("click", () => { if (ctx) { sfx("ui"); enqueue(mapOverlay); } });
    $("gMe").addEventListener("click", () => { sfx("ui"); enqueue(profileOverlay); });
    // Browsers only start sound after a tap; any tap brings the music back.
    document.addEventListener("pointerdown", () => { if (meta.on && (meta.music || meta.sfx)) { audio(); mood(); } }, true);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            setMood(null);
            try { root.speechSynthesis && root.speechSynthesis.cancel(); } catch (_) { /* fine */ }
            if (A.ctx) A.ctx.suspend().catch(() => {});
        } else mood();
    });

    apply();
})(typeof globalThis !== "undefined" ? globalThis : this);
