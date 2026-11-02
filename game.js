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
        gaze: { name: "Steady Gaze", on: "verdict", test: t => t.seen >= 2, xp: 12, text: "Verdict after seeing 2+ photos", unlock: 1 },
        dawn: { name: "First Light", on: "verdict", test: t => t.firstOfFoe, xp: 10, mom: 1, text: "Your first verdict on a foe", unlock: 1 },
        ledger: { name: "Ledger Spark", on: "check", xp: 15, text: "Confirm or correct a value", unlock: 1 },
        closer: { name: "Last Word", on: "defeat", xp: 20, scrap: 3, text: "Vanquish a foe", unlock: 1 },
        panorama: { name: "Panorama", on: "verdict", test: t => t.total > 1 && t.seen >= t.total, xp: 25, text: "Verdict after seeing every photo", unlock: 1 },
        loupe: { name: "Loupe", on: "viewer", xp: 10, mom: 1, text: "Open a photo full screen", unlock: 1 },
        notes: { name: "Field Notes", on: "details", xp: 10, text: "Read the details", unlock: 1 },
        bounty: { name: "Bounty", on: "defeat", scrap: 8, text: "Vanquish a foe", unlock: 2 },
        revisit: { name: "Return Visit", on: "verdict", test: t => t.wasLater, xp: 25, text: "Decide one you set aside", unlock: 2 },
        oracle: { name: "Second Sight", on: "ai", xp: 15, text: "Ask the AI about it", unlock: 3 },
        surge: { name: "Moonsurge", on: "verdict", test: t => t.momentum >= 4, xp: 30, momReset: true, text: "Verdict with 4+ Momentum (spends it)", unlock: 4 },
        deep: { name: "Deep Scan", on: "verdict", test: t => t.seen >= 4, xp: 30, text: "Verdict after seeing 4+ photos", unlock: 5 },
        rally: { name: "War Drum", on: "verdict", test: t => t.played >= 3, xp: 5, mom: 3, text: "Verdict after 3+ cards played on a foe", unlock: 6 }
    };
    const PHOTO_CARDS = new Set(["gaze", "panorama", "deep", "loupe"]);
    const INK_CARDS = new Set(["ledger", "notes"]);
    // Each class starts with a deck that rewards a different real habit.
    const CLASSES = {
        seer: { name: "Seer", text: "Rewards looking at every photo.", deck: ["gaze", "gaze", "panorama", "loupe", "closer"] },
        scribe: { name: "Scribe", text: "Rewards checking values and reading the details.", deck: ["ledger", "ledger", "notes", "dawn", "closer"] },
        warden: { name: "Warden", text: "Builds momentum and finishes foes.", deck: ["dawn", "dawn", "gaze", "closer", "rally"] }
    };
    const STARTER = CLASSES.seer.deck;
    // Twelve kinds of Defect; each group gets one by its id, the last group is always the Sovereign.
    const SPECIES = [["scratcher", "Scratcher"], ["needlewisp", "Needlewisp"], ["thumper", "Thumper"], ["anvilmole", "Anvil Mole"],
        ["rustmoth", "Rustmoth"], ["barnacle", "Barnacle Crone"], ["dripling", "Dripling"], ["smearhound", "Smearhound"],
        ["glasswing", "Glasswing"], ["cracklejack", "Cracklejack"], ["boltgnaw", "Boltgnaw"], ["springjack", "Springjack"]];
    const RELICS = {
        lens: { name: "Brass Lens", text: "Photo cards give +50% XP" },
        ink: { name: "Ink of Night", text: "Ledger & Notes cards give +50% XP" },
        lamp: { name: "Lantern", text: "Start each foe with 2 Momentum" },
        pouch: { name: "Deep Pouch", text: "+1 card in hand" },
        gear: { name: "Moon Gear", text: "+3 Moonshards per foe" },
        bolt: { name: "Lucky Bolt", text: "Cards have a 20% chance to crit for double" }
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
    function speciesOf(gid, type) {
        if (type === "boss") return { id: "sovereign", name: "The Pale Sovereign" };
        const [id, name] = SPECIES[hash(`${gid}|species`) % SPECIES.length];
        return { id, name: type === "elite" ? `Elder ${name}` : name };
    }
    function newRun(packId, seed, hero) {
        const cls = CLASSES[hero] ? hero : "seer";
        const deck = CLASSES[cls].deck.map(id => inst(id));
        return { packId, hero: cls, deck, draw: shuffle(rng(seed), deck.map(c => c.uid)), discard: [], hand: [], relics: [], scrap: 0, xp: 0,
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

    const rules = { hash, rng, shuffle, CARDS, RELICS, STARTER, CLASSES, SPECIES, speciesOf, BASE_XP, levelOf, need, rankOf, cardGain, withMomentum, buildMap, newRun, drawOne, refillHand, discardHand, playCard, addCard, removeCard, rewardChoices, handSize };
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
    const meta = Object.assign({ on: false, music: true, sfx: true, voice: true, mute: false, subs: "ja", vol: 0.7, musicVol: 0.6, sfxVol: 0.9, voiceVol: 1, xp: 0, runs: 0, foes: 0, verdicts: 0 },
        store.get("vinderGameMeta", {}));
    const saveMeta = () => store.set("vinderGameMeta", meta);
    const runKey = id => `vinderGameRun:${id}`;
    let ctx = null, run = null, item = null, screen = "home", holdUntil = 0, greet = false;
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

    const foeName = gid => speciesOf(gid, nodeType(gid)).name;
    const ART = "assets/";
    // An <img> that hides itself if the art file is missing, so the layout never shows a broken image.
    function art(path, cls, alt) {
        const i = h("img", cls);
        i.alt = alt || "";
        i.decoding = "async";
        i.onerror = () => { i.remove(); };
        i.src = `${ART}${path}.webp`;
        return i;
    }
    // The animated idle loop (dir/anim/id) if there is one, otherwise the still painting.
    function liveArt(dir, id, cls, alt) {
        const i = art(`${dir}/anim/${id}`, cls, alt);
        i.onerror = () => { i.onerror = () => i.remove(); i.src = `${ART}${dir}/${id}.webp`; };
        return i;
    }

    // ---------- audio: recorded music, effects and Yui's voice (cached offline by the service worker) ----------
    const A = { ctx: null, master: null, music: null, sfx: null, voice: null, bufs: new Map(), track: null, mood: null, speaking: null };
    function audio() {
        if (!A.ctx) {
            const C = root.AudioContext || root.webkitAudioContext;
            if (!C) return null;
            A.ctx = new C();
            const comp = A.ctx.createDynamicsCompressor();
            comp.connect(A.ctx.destination);
            A.master = A.ctx.createGain(); A.master.connect(comp);
            for (const bus of ["music", "sfx", "voice"]) { A[bus] = A.ctx.createGain(); A[bus].connect(A.master); }
            levels();
            ["hit", "card", "draw", "ui", "defeat"].forEach(n => loadBuf(`${ART}audio/sfx/${SFX[n]}.webm`));
        }
        if (A.ctx.state === "suspended" && !document.hidden) A.ctx.resume().catch(() => {});
        return A.ctx;
    }
    // Mute silences everything at the master; each channel keeps its own level.
    function levels() {
        if (!A.ctx) return;
        A.master.gain.value = meta.mute ? 0 : meta.vol;
        A.music.gain.value = A.speaking ? meta.musicVol * 0.35 : meta.musicVol;
        A.sfx.gain.value = meta.sfxVol;
        A.voice.gain.value = meta.voiceVol;
    }
    const loadBuf = url => {
        if (!A.bufs.has(url)) {
            A.bufs.set(url, fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
                .then(b => A.ctx.decodeAudioData(b)).catch(() => { A.bufs.delete(url); return null; }));
        }
        return A.bufs.get(url);
    };
    async function play(url, bus, opts) {
        if (!audio()) return null;
        const buf = await loadBuf(url);
        if (!buf) return null;
        const src = A.ctx.createBufferSource(), g = A.ctx.createGain();
        src.buffer = buf;
        src.loop = Boolean(opts && opts.loop);
        g.gain.value = opts && opts.gain !== undefined ? opts.gain : 1;
        src.connect(g); g.connect(bus);
        src.start();
        return { src, g };
    }
    // Music crossfades between Lyria tracks by situation.
    async function setMood(m) {
        if (!meta.on || !meta.music || meta.mute || document.hidden) m = null;
        if (m === A.mood) return;
        A.mood = m;
        const old = A.track;
        A.track = null;
        if (old) { old.g.gain.setTargetAtTime(0, A.ctx.currentTime, 0.35); setTimeout(() => { try { old.src.stop(); } catch (_) { /* already stopped */ } }, 2500); }
        if (!m) return;
        const t = await play(`${ART}audio/music/${m === "title" ? "theme" : m}.webm`, A.music, { loop: true, gain: 0 });
        if (!t) return;
        if (A.mood !== m) { t.src.stop(); return; }
        t.g.gain.setTargetAtTime(1, A.ctx.currentTime, 0.5);
        A.track = t;
    }
    let moodOverride = null;
    function mood() {
        if (moodOverride) return setMood(moodOverride);
        if (screen === "home") return setMood("title");
        if (screen !== "deck") return setMood("explore");
        const top = topCard();
        if (!top) return setMood("explore");
        const type = nodeType(top.group.groupId);
        setMood(type === "boss" ? "boss" : type === "elite" ? "elite" : "battle");
    }
    const SFX = { hit: "hit_x", crit: "crit_x", later: "later", flip: "flip", card: "card_x", draw: "draw_x", coin: "shards", defeat: "defeat_x",
        victory: "victory", level: "levelup", undo: "undo", ui: "ui_tap", confirm: "confirm", foe: "foe_enter", elite: "elite_enter", boss: "boss_enter",
        relic: "relic_x", upgrade: "upgrade", purchase: "purchase", burn: "burn", send: "send", map: "map_open", page: "page", rank: "rank" };
    function sfx(name, gain) {
        if (!meta.on || !meta.sfx || meta.mute || !SFX[name] || !audio()) return;
        play(`${ART}audio/sfx/${SFX[name]}.webm`, A.sfx, { gain });
    }

    // ---------- narration: Yui (ElevenLabs v4), Japanese subtitles with a tap for the other language ----------
    const YUI = {
        first_time: ["はじめまして。わたしはユイ。今夜の道案内をするね。", "Nice to meet you. I'm Yui. I'll be your guide tonight."],
        welcome_back: ["おかえり。月が待ってたよ。", "Welcome back. The moon was waiting."],
        intro_1: ["月が昇ったよ。今夜の道に、何かが潜んでる。…よく見てね、全部。", "The moon is up. Something's lurking on tonight's road… Look closely. At everything."],
        intro_2: ["さあ、物語の始まり。どんな小さな傷も、見逃さないで。", "Here begins the tale. Don't let a single scratch slip past you."],
        class_seer: ["見ることが、あなたの力。何も見逃さない人。", "Seeing is your power. The one who misses nothing."],
        class_scribe: ["書くことが、あなたの力。一字も間違えない人。", "Writing is your power. The one who never gets a single letter wrong."],
        class_warden: ["守ることが、あなたの力。最後まで倒れない人。", "Guarding is your power. The one who stands till the very end."],
        foe_1: ["あれ、何か出てきた。", "Huh, something's crawled out."],
        foe_2: ["ほら、また一匹いるよ。", "Look, there's another one."],
        foe_3: ["月明かりに、影がひとつ。", "One shadow in the moonlight."],
        elite_1: ["こいつは手強いよ。欠点を上手に隠してる。", "This one's tough. It hides its flaws well."],
        elite_2: ["焦らないで。全部見てから、決めよう。", "Don't rush. See it all, then decide."],
        boss_1: ["来たね…今夜の、最後の相手。", "Here it comes… tonight's final foe."],
        boss_2: ["これを倒せば、物語はあなたのもの。", "Defeat this, and the tale is yours."],
        defeat_1: ["やった、きれいに決まったね。", "Yes, that was clean."],
        defeat_2: ["お見事。ちゃんと見てたね。", "Well done. You really looked."],
        defeat_3: ["道が静かになった。…今のところはね。", "The road's gone quiet. For now, anyway."],
        defeat_4: ["残念でした、ふふ。", "Too bad for you, heh."],
        retreat_1: ["逃げちゃった。でも、また会えるよ。", "It slipped away. But we'll meet it again."],
        later_1: ["うん、あとでゆっくり見よう。", "Okay, we'll take a proper look later."],
        revisit_1: ["戻ってきたね。えらいえらい。", "You came back to it. Good, good."],
        undo_1: ["やり直し？いいよ、もう一度見よう。", "A do-over? Sure, let's look again."],
        card_1: ["いい目してる。", "You've got a good eye."],
        card_2: ["そう、それそれ！そういうところ！", "Yes, that's it! That's the stuff!"],
        crit_1: ["会心の一撃！", "Critical hit!"],
        momentum_1: ["勢いに乗ってるね！", "You're on a roll!"],
        level_1: ["レベルアップ！目がどんどん鋭くなってる。", "Level up! Your eye keeps getting sharper."],
        level_2: ["月が、あなたの名前を覚えたみたい。", "Looks like the moon remembers your name now."],
        level_3: ["すごい…どんどん強くなるね。", "Wow… you just keep getting stronger."],
        unlock_1: ["新しいカードが来たよ。試してみて。", "A new card's arrived. Give it a try."],
        camp_1: ["焚き火だ。少し休んで、技を磨こう。", "A campfire. Let's rest a little and sharpen a technique."],
        shop_1: ["旅の商人さん。月のかけらで、いいもの買えるよ。", "A wandering trader. Moonshards buy nice things."],
        cache_1: ["苔むした宝箱…何が入ってるかな。", "A mossy treasure chest… wonder what's inside."],
        relic_1: ["それ、大事にしてね。", "Take good care of that."],
        burn_1: ["さよなら。もう、いらないよね。", "Goodbye. You don't need it anymore."],
        grade_s: ["完璧。文句なしのSランク！", "Perfect. An undisputed S rank!"],
        end_1: ["今夜の物語は、ここでおしまい。報告を送ってね。", "Tonight's tale ends here. Send your report."],
        end_2: ["夜を越えたね。お疲れさま。", "You made it through the night. Good work."],
        send_1: ["報告、夜空に飛んでった。お疲れさま！", "The report's flown off into the night sky. Good work!"]
    };
    const GROUPS = { intro: ["intro_1", "intro_2"], elite: ["elite_1", "elite_2"], boss: ["boss_1", "boss_2"], foe: ["foe_1", "foe_2", "foe_3"],
        defeat: ["defeat_1", "defeat_2", "defeat_3", "defeat_4"], level: ["level_1", "level_2", "level_3"], end: ["end_1", "end_2"], card: ["card_1", "card_2"] };
    const line = key => { const id = GROUPS[key] ? pick(Math.random, GROUPS[key]) : key; return YUI[id] ? { id, ja: YUI[id][0], en: YUI[id][1] } : null; };
    const sub = h("div", "g-sub");
    sub.setAttribute("aria-live", "polite");
    sub.setAttribute("role", "button");
    sub.hidden = true;
    let subTimer = 0, subLine = null;
    function showSub(l, keep) {
        subLine = l;
        const main = meta.subs === "en" ? l.en : l.ja, alt = meta.subs === "en" ? l.ja : l.en;
        const m = h("span", `g-sub-main${meta.subs === "en" ? "" : " g-ja"}`, main);
        m.lang = meta.subs === "en" ? "en" : "ja";
        const a = h("span", `g-sub-alt${meta.subs === "en" ? " g-ja" : ""}`, alt);
        a.lang = meta.subs === "en" ? "ja" : "en";
        a.hidden = !keep;
        sub.replaceChildren(m, a);
        sub.setAttribute("aria-label", `${main}. Tap to show ${meta.subs === "en" ? "Japanese" : "English"}`);
        sub.hidden = false;
        if (!keep) { sub.classList.remove("g-sub-in"); void sub.offsetWidth; sub.classList.add("g-sub-in"); }
        clearTimeout(subTimer);
        subTimer = setTimeout(() => { sub.hidden = true; }, 2600 + l.ja.length * 110 + (keep ? 2500 : 0));
    }
    sub.addEventListener("click", () => { if (subLine) showSub(subLine, true); });
    // Yui does not talk over herself; "important" lines (boss, level-up, the end) cut in.
    function say(l, important) {
        if (!meta.on || !l) return;
        if (A.speaking && !important) return;
        if (meta.subs !== "off") showSub(l);
        if (meta.mute || !meta.voice) return;
        const marker = {};
        A.speaking = marker;
        levels();
        play(`${ART}audio/voice/${l.id}.webm`, A.voice).then(v => {
            if (!v || A.speaking !== marker) { if (v) v.src.stop(); if (A.speaking === marker) { A.speaking = null; levels(); } return; }
            if (A.voiceNow) { try { A.voiceNow.src.stop(); } catch (_) { /* done */ } }
            A.voiceNow = v;
            v.src.onended = () => { if (A.speaking === marker) { A.speaking = null; A.voiceNow = null; levels(); } };
        });
    }

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
                color: o.colors[Math.floor(Math.random() * o.colors.length)], g: o.gravity ?? 0.22, shape: o.shape || "chip", rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4 });
        }
        if (!raf) raf = requestAnimationFrame(tick);
    }
    function tick() {
        fx2.clearRect(0, 0, root.innerWidth, root.innerHeight);
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.97; p.life--;
            if (p.life <= 0) { parts.splice(i, 1); continue; }
            fx2.globalAlpha = Math.min(1, p.life / p.max * 2);
            fx2.fillStyle = p.color;
            p.rot += p.vr;
            fx2.save();
            fx2.translate(p.x, p.y);
            fx2.rotate(p.rot);
            if (p.shape === "tri") {
                fx2.beginPath(); fx2.moveTo(0, -p.size * 1.6); fx2.lineTo(p.size * 1.4, p.size); fx2.lineTo(-p.size * 1.4, p.size); fx2.fill();
            } else if (p.shape === "dot") {
                fx2.beginPath(); fx2.arc(0, 0, p.size, 0, Math.PI * 2); fx2.fill();
            } else {
                // a paper chip: flat rectangle whose width flips as it tumbles
                fx2.fillRect(-p.size * 1.6 * Math.cos(p.rot * 2), -p.size * 0.8, p.size * 3.2 * Math.cos(p.rot * 2), p.size * 1.6);
            }
            fx2.restore();
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
    // Scene band under the top bar: the foe on the road, its name plate and life bar.
    const hud = h("div", "g-hud");
    hud.id = "gHud";
    hud.innerHTML = `
        <div class="g-scene">
            <div class="g-top">
                <button type="button" class="g-route-strip" id="gStrip" aria-label="Open the route map"></button>
                <button type="button" class="g-mute" id="gMute" aria-label="Mute all sound" aria-pressed="false">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path class="g-wave" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/><path class="g-x" d="M16 9l6 6M22 9l-6 6"/></svg>
                </button>
            </div>
            <div class="g-portrait" id="gPortrait"></div>
            <div class="g-plate">
                <div class="g-foe-name"><b id="gFoeName"></b><span class="g-tag" id="gFoeTag"></span></div>
                <div class="g-foe-sub" id="gFoeSub"></div>
                <div class="g-life" role="meter" aria-label="Left to decide on this foe" id="gHp"></div>
            </div>
        </div>`;
    // Dock above the verdict buttons: hero, hand, resources.
    const dock = h("div", "g-dock");
    dock.id = "gDock";
    dock.innerHTML = `
        <div class="g-tip" id="gTip" hidden></div>
        <div class="g-dock-row">
            <button type="button" class="g-hero" id="gMe" aria-label="Your legend">
                <span class="g-hero-ring" id="gXpFill"></span>
                <span class="g-hero-face" id="gHeroFace"></span>
                <span class="g-lvl" id="gLvl"></span>
            </button>
            <div class="g-hand" id="gHand" aria-label="Your hand"></div>
            <div class="g-res">
                <span id="gMom" title="Momentum"></span>
                <span id="gScrap" title="Moonshards"></span>
            </div>
        </div>`;
    const deckbar = document.querySelector("#deck .deckbar");
    if (deckbar) deckbar.after(hud);
    const actionsBar = document.querySelector("#deck .actions");
    if (actionsBar) actionsBar.before(dock);
    const $ = id => document.getElementById(id);
    const portraitEl = $("gPortrait");
    const ICON = {
        mom: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 5 14h6l-1 8 8-12h-6z"/></svg>`,
        shard: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 19 9 12 22 5 9z"/></svg>`
    };

    const overlay = h("div", "g-overlay");
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "gOvTitle");
    document.body.append(fxCanvas, sub, overlay);
    sizeFx();
    root.addEventListener("resize", sizeFx);

    const titleBlock = h("div", "g-title-block");
    titleBlock.innerHTML = '<p class="g-title-kicker">a VINder tale</p><p class="g-title-logo">Pale Moon</p>';
    const homeBtn = h("button", "g-legend");
    homeBtn.type = "button";
    homeBtn.innerHTML = '<span class="g-legend-face" id="gLegendFace"></span><span class="g-legend-text"><b id="gLegendRank"></b><span class="g-legend-xp"><span id="gLegendXp"></span></span></span><span class="g-legend-lv" id="gLegendLv"></span>';
    const talesHead = h("h2", "g-tales-head", "Tales");
    const homeEl = document.getElementById("home");
    const packsEl = document.getElementById("packs");
    if (homeEl && packsEl) { packsEl.before(titleBlock, homeBtn); packsEl.before(talesHead); }
    const checkUpdate = document.getElementById("checkUpdate");
    homeBtn.addEventListener("click", () => { sfx("ui"); enqueue(profileOverlay); });
    const toggleBtn = h("button", "g-toggle");
    toggleBtn.type = "button";
    toggleBtn.setAttribute("role", "switch");
    toggleBtn.innerHTML = '<span class="g-toggle-track"><span class="g-toggle-knob"></span></span><span class="g-toggle-label">Game</span>';
    toggleBtn.addEventListener("click", () => {
        meta.on = !meta.on;
        saveMeta();
        apply();
        if (meta.on) { audio(); sfx("confirm"); sync(); }
    });
    const tagline = h("p", "g-tagline", "~ Tales of the Pale Moon ~");
    const brand = document.querySelector(".brandbar");
    if (brand) { brand.after(tagline); brand.appendChild(toggleBtn); }

    function portraitSvg(gid, type) {
        const r = rng(hash(`${gid}|face`));
        const body = type === "boss" ? "#9aa3a8" : pick(r, ["#2f4f57", "#9aa3a8", "#6f7d5a", "#b4562f"]);
            const eye = "#e6dcc6";
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
            ? `<path d="M33 36 L${24 - r() * 8} ${12 - r() * 6} L42 31Z M67 36 L${76 + r() * 8} ${12 - r() * 6} L58 31Z" fill="#203840"/>` : "";
        const eyes = 1 + Math.floor(r() * 3);
        const ex = eyes === 1 ? [50] : eyes === 2 ? [40, 60] : [36, 50, 64];
        const eyeSvg = ex.map((x, i) => {
            const y = eyes === 3 && i === 1 ? 44 : 50, s = eyes === 1 ? 8 : 5.5;
            return `<ellipse cx="${x}" cy="${y}" rx="${s}" ry="${s * 0.8}" fill="#121829"/><circle class="g-eye" cx="${x}" cy="${y}" r="${s * 0.45}" fill="${eye}"/>`;
        }).join("");
        let teeth = "M36 66";
        const tn = 4 + Math.floor(r() * 4);
        for (let i = 1; i <= tn; i++) teeth += ` L${36 + (28 / tn) * (i - 0.5)} ${i % 2 ? 73 : 70} L${36 + (28 / tn) * i} 66`;
        const crown = type === "boss" ? `<path d="M34 24 L38 10 L44 20 L50 6 L56 20 L62 10 L66 24Z" fill="#e6dcc6"/>` : "";
        return `<svg viewBox="0 0 100 100" aria-hidden="true" class="g-face">
            ${horns}<path d="${d}" fill="${body}"/>${crown}${eyeSvg}
            <path d="${teeth}" fill="none" stroke="#e6dcc6" stroke-width="2" stroke-linejoin="round"/></svg>`;
    }

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
        $("gLvl").textContent = String(L.level);
        $("gXpFill").style.setProperty("--xp", `${Math.round((L.into / L.need) * 360)}deg`);
        $("gMom").innerHTML = `${ICON.mom}<b>${run ? run.momentum : 0}</b>`;
        $("gScrap").innerHTML = `${ICON.shard}<b>${run ? run.scrap : 0}</b>`;
        const hero = run && CLASSES[run.hero] ? run.hero : "seer";
        const face = $("gHeroFace");
        if (face.dataset.hero !== hero) {
            face.dataset.hero = hero;
            face.replaceChildren(h("span", "g-initial", CLASSES[hero].name[0]), liveArt("heroes", hero, "g-hero-img", CLASSES[hero].name));
        }
        $("gMe").setAttribute("aria-label", `${CLASSES[hero].name}, level ${L.level}. Your legend and settings`);
        $("gLegendRank").textContent = rankOf(L.level);
        $("gLegendLv").textContent = `Lv ${L.level}`;
        $("gLegendXp").style.width = `${(L.into / L.need) * 100}%`;
        homeBtn.setAttribute("aria-label", `Your legend: level ${L.level}, ${rankOf(L.level)}. Settings`);
        const lf = $("gLegendFace"), lh = CLASSES[meta.lastHero] ? meta.lastHero : "seer";
        if (lf.dataset.hero !== lh) { lf.dataset.hero = lh; lf.replaceChildren(h("span", "g-initial", CLASSES[lh].name[0]), liveArt("heroes", lh, "", "")); }
    }
    const rarity = def => def.unlock >= 4 ? "epic" : def.unlock >= 2 ? "rare" : "common";
    const gainText = (id, g) => [g.xp && `+${g.xp} XP`, g.mom && `+${g.mom} momentum`, g.scrap && `+${g.scrap} shards`, CARDS[id].momReset && "spends momentum"].filter(Boolean).join(" · ");
    function renderHand() {
        const hand = $("gHand");
        hand.replaceChildren();
        if (!run) return;
        for (const uid of run.hand) {
            const c = cardOf(uid);
            if (!c) continue;
            const def = CARDS[c.id];
            const b = h("button", `g-card g-${rarity(def)}${c.up ? " g-up" : ""}${justDrawn.has(uid) ? " g-draw" : ""}`);
            b.type = "button";
            b.dataset.uid = uid;
            b.setAttribute("aria-label", `${def.name}${c.up ? " plus" : ""}: ${def.text}, ${gainText(c.id, cardGain(c.id, c.up, run.relics))}`);
            const pic = h("span", "g-card-art");
            pic.append(h("span", "g-initial", def.name[0]), art(`cards/${c.id}`, "", ""));
            b.append(pic, h("span", "g-card-name", def.name));
            if (c.up) b.appendChild(h("span", "g-plus", "+"));
            b.addEventListener("click", () => {
                const tip = $("gTip");
                const same = !tip.hidden && tip.dataset.uid === uid;
                tip.hidden = same;
                tip.dataset.uid = uid;
                tip.replaceChildren(h("b", "", `${def.name}${c.up ? "+" : ""}`), h("span", "", def.text), h("em", "", gainText(c.id, cardGain(c.id, c.up, run.relics))));
                sfx("ui");
            });
            hand.appendChild(b);
        }
        justDrawn.clear();
    }
    let lifeShown = { gid: null, gone: new Set() };
    function renderLife(gid, mine) {
        const life = $("gHp");
        const before = lifeShown.gid === gid ? lifeShown.gone : new Set();
        const gone = new Set(mine.filter(c => V.isDecided(ctx.actions, ctx.decisions[c.key])).map(c => c.key));
        life.replaceChildren(...mine.map(c => h("i", gone.has(c.key) ? (before.has(c.key) ? "gone" : "gone g-drop") : "")));
        life.setAttribute("aria-valuemin", "0");
        life.setAttribute("aria-valuemax", String(mine.length));
        life.setAttribute("aria-valuenow", String(mine.length - gone.size));
        life.setAttribute("aria-valuetext", `${mine.length - gone.size} of ${mine.length} left`);
        lifeShown = { gid, gone };
    }
    function renderHud() {
        document.body.classList.toggle("game-on", meta.on);
        hud.hidden = dock.hidden = !meta.on || !ctx;
        renderMe();
        if (hud.hidden) return;
        renderStrip();
        const top = topCard();
        if (!top) {
            portraitEl.dataset.gid = "";
            portraitEl.className = "g-portrait g-clear";
            portraitEl.replaceChildren();
            $("gFoeName").textContent = "The road is clear";
            $("gFoeTag").textContent = "";
            $("gFoeSub").textContent = ctx.pack.title || "";
            $("gHp").replaceChildren();
            renderHand();
            return;
        }
        const gid = String(top.group.groupId), type = nodeType(gid);
        if (portraitEl.dataset.gid !== gid) {
            const sp = speciesOf(gid, type);
            portraitEl.dataset.gid = gid;
            portraitEl.className = `g-portrait g-${type}`;
            portraitEl.innerHTML = portraitSvg(gid, type);
            // The animated idle loop if one exists, otherwise the still painting.
            const img = liveArt("foes", sp.id, "g-foe-img", sp.name);
            img.onload = () => portraitEl.classList.add("has-art");
            portraitEl.appendChild(img);
            if (!reduce) restartClass(portraitEl, "g-enter", 700);
        }
        $("gFoeName").textContent = foeName(gid);
        $("gFoeTag").textContent = type === "boss" ? "Boss" : type === "elite" ? "Elite" : "";
        $("gFoeTag").className = `g-tag g-tag-${type}`;
        $("gFoeSub").textContent = [top.group.title, top.group.subtitle].filter(Boolean).join(" · ");
        renderLife(gid, ctx.cards.filter(c => String(c.group.groupId) === gid));
        renderHand();
    }

    // ---------- overlays, shown one at a time ----------
    const queue = [];
    let showing = false;
    function enqueue(fn) { queue.push(fn); if (!showing) nextOverlay(); }
    function nextOverlay() {
        const fn = queue.shift();
        if (moodOverride) { moodOverride = null; mood(); }
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
        const pic = h("span", "g-big-art");
        pic.append(h("span", "g-initial", def.name[0]), art(`cards/${id}`, "", ""));
        b.classList.add(`g-${rarity(def)}`);
        b.append(pic, h("span", "g-big-name", `${def.name}${up ? "+" : ""}`), h("span", "g-big-text", def.text),
            h("span", "g-big-gain", gainText(id, cardGain(id, up, run ? run.relics : []))));
        if (note) b.appendChild(h("span", "g-big-note", note));
        return b;
    }
    function relicEl(id, note) {
        const r = RELICS[id];
        const b = h("button", "g-relic");
        b.type = "button";
        const ic = h("span", "g-relic-icon");
        ic.append(h("span", "g-initial", r.name[0]), art(`ui/relic-${id}`, "", ""));
        b.append(ic, h("span", "g-relic-name", r.name), h("span", "g-relic-text", r.text));
        if (note) b.appendChild(h("span", "g-big-note", note));
        return b;
    }
    function routeEl() {
        const list = h("ol", "g-route");
        for (const n of nodes()) {
            const li = h("li", `g-node g-node-${n.type}${nodeDone(n) ? " done" : ""}${run && n.groupId === run.foe ? " here" : ""}`);
            const g = n.groupId ? groupById(n.groupId) : null;
            const ic = h("span", "g-node-icon");
            ic.appendChild(art(`ui/node-${n.type}`, "", ""));
            li.append(ic);
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
        const spoken = line(meta.runs || meta.verdicts ? "intro" : "first_time");
        const text = line("intro").en;
        // Choose a class: each deals its own starter deck. Only offered before the first card is played.
        const heroes = h("div", "g-heroes");
        heroes.setAttribute("role", "radiogroup");
        heroes.setAttribute("aria-label", "Choose who walks the road tonight");
        const pickHero = id => {
            if (run.hero !== id) {
                const fresh = newRun(run.packId, hash(run.packId), id);
                Object.assign(run, { hero: fresh.hero, deck: fresh.deck, draw: fresh.draw, discard: [], hand: [] });
                saveRun();
            }
            heroes.querySelectorAll(".g-hero-pick").forEach(b => b.setAttribute("aria-checked", String(b.dataset.hero === id)));
            meta.lastHero = id; saveMeta();
            renderMe();
        };
        for (const [id, c] of Object.entries(CLASSES)) {
            const b = h("button", "g-hero-pick");
            b.type = "button";
            b.dataset.hero = id;
            b.setAttribute("role", "radio");
            const face = h("span", "g-hero-pick-face");
            face.append(h("span", "g-initial", c.name[0]), liveArt("heroes", id, "", ""));
            b.append(face, h("b", "", c.name), h("small", "", c.text));
            b.addEventListener("click", () => { sfx("ui"); pickHero(id); say(line(`class_${id}`), true); });
            heroes.appendChild(b);
        }
        body.append(h("p", "g-lore", text), heroes, routeEl(),
            h("p", "g-fine", "Every verdict strikes the same blow, whatever you choose. Cards reward looking closely: flipping photos, zooming, reading details, checking values. Choose what's true."));
        panel({ kicker: "A new tale begins", title: ctx.pack.title || "The Expedition", body, actions: [{ label: "Begin", primary: true, onClick: () => {
            audio(); mood();
            // The hand was dealt before the class was chosen; deal it again from the chosen deck.
            if (!run.played && !Object.keys(run.scored).length) {
                run.draw = shuffle(Math.random, run.deck.map(c => c.uid));
                run.discard = []; run.hand = []; run.foe = null;
                sync();
            }
        } }] });
        pickHero(run.hero || "seer");
        say(spoken, true);
    }
    function mapOverlay() {
        const body = h("div", "g-body");
        body.appendChild(routeEl());
        if (run && run.relics.length) {
            const rel = h("div", "g-relic-row");
            for (const id of run.relics) rel.appendChild(h("span", "g-relic-chip", RELICS[id].name));
            body.appendChild(rel);
        }
        if (run) body.appendChild(h("p", "g-fine", `Deck: ${run.deck.length} cards · ${run.scrap} moonshards`));
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
                const c = center(b); burst(c.x, c.y, { n: 30, colors: ["#e6dcc6", "#9aa3a8", "#2f4f57", "#e0a243"], speed: 5 });
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
            b.addEventListener("click", () => { run.relics.push(id); saveRun(); sfx("relic"); say(line("relic_1")); renderHud(); nextOverlay(); });
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
            b.addEventListener("click", () => { c.up = true; saveRun(); sfx("upgrade"); nextOverlay(); });
            row.appendChild(b);
        }
        body.append(h("p", "g-lore", plain.length ? "Sharpen one card (+50%), or sit by the fire for a while." : "All your cards are sharp. Sit by the fire for a while."), row);
        panel({ kicker: "Campfire", title: "Rest under the trees", body, actions: [{ label: "Rest (+30 XP)", onClick: () => grant(30, homeBtn) }] });
        moodOverride = "camp"; mood();
        say(line("camp_1"));
    }
    function shopOverlay() {
        const prices = { card: 12, relic: 35, remove: 15 };
        const stock = { cards: rewardChoices(Math.random, level(), 3), relic: shuffle(Math.random, Object.keys(RELICS).filter(id => !run.relics.includes(id)))[0] || null, removed: false };
        const draw = () => {
            const body = h("div", "g-body");
            body.appendChild(h("p", "g-lore", `You carry ${run.scrap} moonshards.`));
            const row = h("div", "g-big-row");
            stock.cards.forEach((id, i) => {
                if (!id) return;
                const b = bigCard(id, false, `${prices.card} shards`);
                b.disabled = run.scrap < prices.card;
                b.addEventListener("click", () => { run.scrap -= prices.card; addCard(run, id, false); stock.cards[i] = null; saveRun(); sfx("purchase"); draw(); });
                row.appendChild(b);
            });
            body.appendChild(row);
            if (stock.relic) {
                const r = relicEl(stock.relic, `${prices.relic} shards`);
                r.disabled = run.scrap < prices.relic;
                r.addEventListener("click", () => { run.scrap -= prices.relic; run.relics.push(stock.relic); stock.relic = null; saveRun(); sfx("relic"); say(line("relic_1")); draw(); });
                body.appendChild(r);
            }
            if (!stock.removed && run.deck.length > 3) {
                body.appendChild(h("h3", "g-h3", `Burn a card from your deck (${prices.remove} shards)`));
                const rm = h("div", "g-chip-row");
                for (const c of run.deck) {
                    const b = h("button", "g-chip-btn", `${CARDS[c.id].name}${c.up ? "+" : ""}`);
                    b.type = "button";
                    b.disabled = run.scrap < prices.remove;
                    b.addEventListener("click", () => { run.scrap -= prices.remove; removeCard(run, c.uid); stock.removed = true; saveRun(); sfx("burn"); say(line("burn_1")); draw(); });
                    rm.appendChild(b);
                }
                body.appendChild(rm);
            }
            renderMe();
            panel({ kicker: "Wandering trader", title: "Wares by lantern light", body, wide: true, actions: [{ label: "Leave", primary: true, onClick: () => renderHud() }] });
        };
        draw();
        say(line("shop_1"));
    }
    function cacheOverlay() { relicOverlay("Forgotten cache", "Something glints in the moss"); say(line("cache_1")); }
    function eventOverlay(type) { (type === "camp" ? campOverlay : type === "shop" ? shopOverlay : cacheOverlay)(); }
    function summaryOverlay() {
        const L = levelOf(meta.xp);
        const foes = Object.keys(run.defeated).length;
        const body = h("div", "g-body");
        const dl = h("dl", "g-stats");
        for (const [k, v] of [["Foes vanquished", foes], ["XP earned", run.xp], ["Deck", `${run.deck.length} cards`], ["Relics", run.relics.map(id => RELICS[id].name).join(", ") || "none"], ["Rank", `Lv ${L.level} ${rankOf(L.level)}`]]) dl.append(h("dt", "", k), h("dd", "", String(v)));
        const spoken = line("end");
        const text = spoken.en;
        body.append(h("p", "g-lore", text), dl);
        moodOverride = "title"; mood();
        panel({ kicker: "The tale is told", title: ctx.pack.title || "Expedition complete", body, actions: [{ label: "Onward", primary: true }] });
        say(spoken, true);
        sfx("victory");
        if (!reduce) for (let i = 0; i < 4; i++) setTimeout(() => burst(root.innerWidth * (0.2 + Math.random() * 0.6), root.innerHeight * 0.3, { n: 40, colors: ["#e6dcc6", "#9aa3a8", "#2f4f57", "#e0a243"], speed: 6 }), i * 250);
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
        toggle("voice", "Narrator voice (Yui)");
        const sl = h("label", "g-opt g-vol");
        const sel = h("select", "g-select");
        for (const [v, t] of [["ja", "Japanese, tap for English"], ["en", "English, tap for Japanese"], ["off", "Off"]]) {
            const o = h("option", "", t);
            o.value = v;
            o.selected = meta.subs === v;
            sel.appendChild(o);
        }
        sel.addEventListener("change", () => { meta.subs = sel.value; saveMeta(); say(line("welcome_back"), true); });
        sl.append(h("span", "", "Subtitles"), sel);
        opts.appendChild(sl);
        toggle("mute", "Mute everything");
        const slider = (key, label, onSet) => {
            const vl = h("label", "g-opt g-vol");
            const vi = h("input");
            vi.type = "range"; vi.min = "0"; vi.max = "1"; vi.step = "0.05"; vi.value = String(meta[key]);
            vi.addEventListener("input", () => { meta[key] = Number(vi.value); levels(); saveMeta(); });
            if (onSet) vi.addEventListener("change", onSet);
            vl.append(h("span", "", label), vi);
            opts.appendChild(vl);
        };
        slider("vol", "Master");
        slider("musicVol", "Music");
        slider("sfxVol", "Effects", () => sfx("hit"));
        slider("voiceVol", "Narrator");
        body.appendChild(opts);
        body.appendChild(h("h3", "g-h3", "Card collection"));
        const grid = h("div", "g-collection");
        for (const id of Object.keys(CARDS)) {
            const def = CARDS[id], open = def.unlock <= L.level;
            grid.appendChild(h("div", `g-coll${open ? "" : " locked"}`, open ? def.name : `Unlocks at Lv ${def.unlock}`));
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
        toggleBtn.setAttribute("aria-checked", String(meta.on));
        talesHead.textContent = meta.on ? "Tales" : "Packs";
        toggleBtn.setAttribute("aria-label", meta.on ? "Game mode on. Tap to turn it off" : "Game mode off. Tap to turn it on");
        levels();
        const mute = $("gMute");
        mute.setAttribute("aria-pressed", String(meta.mute));
        mute.setAttribute("aria-label", meta.mute ? "Turn sound on" : "Mute all sound");
        if (!meta.on || meta.mute) { if (A.voiceNow) { try { A.voiceNow.src.stop(); } catch (_) { /* done */ } } A.speaking = null; A.voiceNow = null; sub.hidden = true; levels(); }
        if (!meta.on) { setMood(null); sub.hidden = true; }
        else mood();
        renderHud();
    }

    function levelUp(lvl) {
        sfx("level");
        const unlocked = Object.keys(CARDS).filter(id => CARDS[id].unlock === lvl).map(id => CARDS[id].name);
        const banner = h("div", "g-banner");
        banner.setAttribute("aria-hidden", "true");
        const plate = h("div", "g-banner-plate");
        plate.append(h("b", "", `Level ${lvl}`), h("span", "", unlocked.length ? `New card: ${unlocked.join(", ")}` : rankOf(lvl)));
        banner.appendChild(plate);
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 2600);
        burst(root.innerWidth / 2, root.innerHeight * 0.4, { n: 70, colors: ["#e6dcc6", "#9aa3a8", "#2f4f57", "#e0a243"], speed: 7 });
        say(line(unlocked.length ? "unlock_1" : "level"), true);
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
        setTimeout(() => { f.remove(); burst(to.x, to.y, { n: 22, colors: crit ? ["#b4562f", "#e6dcc6"] : ["#e0a243", "#e6dcc6"], speed: 4 }); }, 420);
        if (crit) { setTimeout(() => floatAt(portraitEl, "CRIT!", "g-f-crit"), 430); say(line("crit_1")); }
        else if (Math.random() < 0.12) say(line("card"));
    }
    function strikeFx(color) {
        const c = center(portraitEl);
        floatAt(portraitEl, "−1", "g-f-dmg");
        if (reduce) return;
        portraitEl.classList.add("g-blanch");
        setTimeout(() => {
            portraitEl.classList.remove("g-blanch");
            restartClass(portraitEl, "g-hurt", 300);
            restartClass(hud, "g-shake", 200);
            burst(c.x, c.y, { n: 22, colors: [color, "#e6dcc6", "#9aa3a8"], speed: 6 });
        }, 60);
    }
    function startFoe(group) {
        const gid = String(group.groupId);
        if (run.foe && run.foe !== gid && run.lastAction === "later" && !run.defeated[run.foe] && groupById(run.foe)) say(line("retreat_1"));
        run.foe = gid;
        run.momentum = run.relics.includes("lamp") ? 2 : 0;
        run.played = 0;
        run.first = true;
        discardHand(run);
        refillHand(run, Math.random).forEach(u => justDrawn.add(u));
        if (!run.met[gid]) {
            run.met[gid] = 1;
            const type = nodeType(gid);
            if (type === "boss") say(line("boss"), true);
            else if (type === "elite") say(line("elite"));
            else if (Math.random() < 0.3) say(line("foe"));
            setTimeout(() => sfx(type === "boss" ? "boss" : type === "elite" ? "elite" : "foe"), 120);
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
        if (greet) { greet = false; say(line("welcome_back")); }
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
        burst(c.x, c.y, { n: 60, colors: ["#e6dcc6", "#9aa3a8", "#2f4f57", "#e0a243"], speed: 6, gravity: -0.03, shape: "dot", life: 60 });
        burst(c.x, c.y, { n: 14, colors: ["#e6dcc6", "#9aa3a8", "#2f4f57", "#e0a243"], speed: 5, gravity: 0.25, lift: 3 });
        if (type === "boss" || type === "elite" || Math.random() < 0.4) say(line("defeat"));
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
        greet = Boolean(saved && saved.introduced && !saved.done);
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
            if (Math.random() < 0.3) say(line("later_1"));
            floatAt(portraitEl, "Set aside", "g-f-muted");
            return;
        }
        run.lastAction = "verdict";
        const STRIKE = { right: "#6f7d5a", left: "#4f7a84", up: "#b4562f", down: "#9aa3a8" };
        strikeFx(STRIKE[V.directionOf(ctx.actions, actionId)] || "#e6dcc6");
        sfx("hit");
        meta.verdicts++;
        if (!run.scored[card.key]) {
            // Undo then redo earns nothing twice.
            run.scored[card.key] = 1;
            const t = { seen: item && item.key === card.key ? item.seen.size : 0, total: card.photos.length, firstOfFoe: run.first,
                wasLater: Boolean(run.later[card.key]), momentum: run.momentum, played: run.played };
            if (t.wasLater) say(line("revisit_1"));
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
        if (Math.random() < 0.25) say(line("undo_1"));
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
    document.addEventListener("vinder:send", () => { if (meta.on) { say(line("send_1"), true); sfx("send"); } });

    $("gStrip").addEventListener("click", () => { if (ctx) { sfx("map"); enqueue(mapOverlay); } });
    $("gMe").addEventListener("click", () => { sfx("ui"); enqueue(profileOverlay); });
    $("gMute").addEventListener("click", () => { meta.mute = !meta.mute; saveMeta(); apply(); sfx("ui"); });
    // Browsers only start sound after a tap; any tap brings the music back.
    document.addEventListener("pointerdown", () => { if (meta.on && (meta.music || meta.sfx)) { audio(); mood(); } }, true);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            setMood(null);
            if (A.voiceNow) { try { A.voiceNow.src.stop(); } catch (_) { /* done */ } } A.speaking = null; A.voiceNow = null; sub.hidden = true; levels();
            if (A.ctx) A.ctx.suspend().catch(() => {});
        } else mood();
    });

    apply();
})(typeof globalThis !== "undefined" ? globalThis : this);
