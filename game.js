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

    // on: when the card fires. verdict/defeat fire on those moments; viewer/details/check/ai fire once per item.
    // on "play": an active card you tap and pay Light for.
    const CARDS = {
        gaze: { name: "Steady Gaze", on: "verdict", test: t => t.seen >= 2, xp: 12, text: "Verdict after seeing 2+ photos", unlock: 1 },
        dawn: { name: "First Light", on: "verdict", test: t => t.firstOfFoe, xp: 10, light: 1, text: "Your first verdict on a foe", unlock: 1 },
        ledger: { name: "Ledger Spark", on: "check", xp: 15, text: "Confirm or correct a value", unlock: 1 },
        closer: { name: "Last Word", on: "defeat", xp: 20, scrap: 3, text: "Vanquish a foe", unlock: 1 },
        panorama: { name: "Panorama", on: "verdict", test: t => t.total > 1 && t.seen >= t.total, xp: 25, text: "Verdict after seeing every photo", unlock: 1 },
        loupe: { name: "Loupe", on: "viewer", xp: 10, light: 1, text: "Open a photo full screen", unlock: 1 },
        notes: { name: "Field Notes", on: "details", xp: 10, text: "Read the details", unlock: 1 },
        flare: { name: "Lantern Flare", on: "play", cost: 2, text: "This foe drops double XP and shards", unlock: 1 },
        wind: { name: "Second Wind", on: "play", cost: 1, text: "Draw 2 cards", unlock: 1 },
        bounty: { name: "Bounty", on: "defeat", scrap: 8, text: "Vanquish a foe", unlock: 2 },
        revisit: { name: "Return Visit", on: "verdict", test: t => t.wasLater, xp: 25, text: "Decide one you set aside", unlock: 2 },
        quiet: { name: "Quiet Step", on: "verdict", test: t => t.details, xp: 15, text: "Verdict on an item whose details you read", unlock: 2 },
        whet: { name: "Whetstone", on: "play", cost: 2, text: "Upgrade a random card in your deck", unlock: 2 },
        tithe: { name: "Moon Tithe", on: "play", cost: 1, scrap: 8, text: "Gain 8 moonshards", unlock: 2 },
        oracle: { name: "Second Sight", on: "ai", xp: 15, text: "Ask the AI about it", unlock: 3 },
        inktrail: { name: "Ink Trail", on: "check", xp: 5, light: 2, text: "Confirm or correct a value", unlock: 3 },
        insight: { name: "Insight", on: "play", cost: 1, text: "The next card that fires crits for double", unlock: 3 },
        rally: { name: "War Drum", on: "verdict", test: t => t.played >= 3, xp: 5, light: 2, text: "Verdict after 3+ cards played on a foe", unlock: 4 },
        surge: { name: "Moonsurge", on: "play", cost: 4, xp: 40, text: "Gain 40 XP now", unlock: 4 },
        deep: { name: "Deep Scan", on: "verdict", test: t => t.seen >= 4, xp: 30, text: "Verdict after seeing 4+ photos", unlock: 5 },
        echo: { name: "Echo", on: "play", cost: 2, text: "Fire the last card again", unlock: 5 },
        fullmoon: { name: "Full Moon", on: "defeat", xp: 10, light: 3, text: "Vanquish a foe", unlock: 6 },
        bind: { name: "Binding Rite", on: "play", cost: 3, text: "Strip this foe of its trait", unlock: 6 },
        kindling: { name: "Kindling", on: "active", xp: 8, text: "Whenever you play an active card", unlock: 2 },
        purge: { name: "Purge", on: "play", cost: 1, text: "Burn another card in your hand for 10 shards", unlock: 2 },
        afterglow: { name: "Afterglow", on: "verdict", test: t => t.light >= 5, xp: 15, text: "Verdict while holding 5+ Light", unlock: 3 },
        chain: { name: "Chain of Sight", on: "verdict", test: t => t.photoFired >= 2, xp: 20, text: "Verdict after 2+ photo cards fired on this foe", unlock: 3 },
        forge: { name: "Forge", on: "play", cost: 2, text: "Turn another card in your hand into a rare one", unlock: 4 },
        overflow: { name: "Overflow", on: "overflow", xp: 12, text: "Earn Light while your lantern is already full", unlock: 5 },
        glint: { name: "Glint", on: "viewer", xp: 8, text: "Open a photo full screen", unlock: 1, hero: "seer" },
        squint: { name: "Squint", on: "verdict", test: t => t.zoom, xp: 14, text: "Verdict after zooming in", unlock: 1, hero: "seer" },
        patient: { name: "Patient Eye", on: "verdict", test: t => t.seen >= 3, xp: 18, text: "Verdict after seeing 3+ photos", unlock: 2, hero: "seer" },
        wideangle: { name: "Wide Angle", on: "verdict", test: t => t.total >= 3 && t.seen >= t.total, xp: 30, text: "Verdict after seeing every one of 3+ photos", unlock: 2, hero: "seer" },
        moonlens: { name: "Moon Lens", on: "viewer", light: 2, text: "Open a photo full screen", unlock: 2, hero: "seer" },
        afterimage: { name: "Afterimage", on: "verdict", test: t => t.photoFired >= 1, xp: 10, light: 1, text: "Verdict after a photo card fired on this foe", unlock: 2, hero: "seer" },
        crosslight: { name: "Crosslight", on: "verdict", test: t => t.seen >= 2 && t.zoom, xp: 22, text: "Verdict after 2+ photos and a zoom", unlock: 3, hero: "seer" },
        owlsight: { name: "Owl Sight", on: "verdict", test: t => t.firstOfFoe && t.total >= 2 && t.seen >= t.total, xp: 26, text: "First verdict on a foe, every photo seen", unlock: 3, hero: "seer" },
        stillwater: { name: "Still Water", on: "verdict", test: t => t.seen >= 2 && t.light >= 3, xp: 18, text: "Verdict after 2+ photos while holding 3+ Light", unlock: 3, hero: "seer" },
        tracer: { name: "Tracer", on: "verdict", test: t => t.photoFired >= 3, xp: 32, text: "Verdict after 3+ photo cards fired on this foe", unlock: 5, hero: "seer" },
        pinhole: { name: "Pinhole", on: "verdict", test: t => t.seen >= 2, light: 1, text: "Verdict after seeing 2+ photos", unlock: 1, hero: "seer" },
        vigil: { name: "Vigil", on: "verdict", test: t => t.seen >= 2 && t.details, xp: 26, text: "Verdict after 2+ photos and the details", unlock: 4, hero: "seer" },
        silverplate: { name: "Silver Plate", on: "viewer", test: t => t.elite, xp: 20, text: "Zoom in on an elite or boss", unlock: 4, hero: "seer" },
        halation: { name: "Halation", on: "verdict", test: t => t.zoom && t.light >= 5, xp: 24, light: 1, text: "Verdict after zooming with 5+ Light", unlock: 4, hero: "seer" },
        parallax: { name: "Parallax", on: "verdict", test: t => t.seen >= 5, xp: 40, text: "Verdict after seeing 5+ photos", unlock: 5, hero: "seer" },
        eyeofmoon: { name: "Eye of the Moon", on: "verdict", test: t => t.total >= 2 && t.seen >= t.total && t.zoom, xp: 36, text: "Every photo seen and a zoom", unlock: 6, hero: "seer" },
        negative: { name: "Negative", on: "viewer", test: t => t.seen >= 2, xp: 12, text: "Zoom in after flipping through 2+ photos", unlock: 3, hero: "seer" },
        starmap: { name: "Star Map", on: "defeat", test: t => t.photoFired >= 4, xp: 30, light: 2, text: "Vanquish a foe after 4+ photo cards fired", unlock: 6, hero: "seer" },
        dewdrop: { name: "Dewdrop", on: "viewer", scrap: 2, text: "Open a photo full screen", unlock: 1, hero: "seer" },
        blink: { name: "Blink", on: "verdict", test: t => t.seen >= t.total, xp: 8, text: "Verdict after seeing every photo", unlock: 2, hero: "seer" },
        longexposure: { name: "Long Exposure", on: "verdict", test: t => t.seen >= 4 && t.zoom, xp: 44, text: "Verdict after 4+ photos and a zoom", unlock: 7, hero: "seer" },
        moth: { name: "Moth to Flame", on: "overflow", xp: 16, text: "Earn Light while your lantern is full", unlock: 3, hero: "seer" },
        aperture: { name: "Aperture", on: "verdict", test: t => t.total >= 4 && t.seen >= t.total, xp: 50, text: "Every one of 4+ photos seen", unlock: 8, hero: "seer" },
        seconddawn: { name: "Second Dawn", on: "verdict", test: t => t.firstOfFoe && t.zoom, xp: 20, light: 2, text: "First verdict on a foe, after a zoom", unlock: 5, hero: "seer" },
        glasseye: { name: "Glass Eye", on: "verdict", test: t => t.seen >= 3 && t.photoFired >= 2, xp: 48, text: "3+ photos and 2+ photo cards fired", unlock: 9, hero: "seer" },
        develop: { name: "Develop", on: "play", cost: 2, fx: { per: ['seen', 6] }, text: "Gain 6 XP per photo seen on this item", unlock: 2, hero: "seer" },
        contact: { name: "Contact Sheet", on: "play", cost: 2, fx: { draw: 3 }, text: "Draw 3 cards", unlock: 3, hero: "seer" },
        exposure: { name: "Exposure", on: "play", cost: 1, fx: { crit: true, draw: 1 }, text: "Next card crits; draw 1", unlock: 1, hero: "seer" },
        darkroom: { name: "Darkroom", on: "play", cost: 3, fx: { per: ['photoFired', 15] }, text: "Gain 15 XP per photo card fired on this foe", unlock: 5, hero: "seer" },
        flashbulb: { name: "Flashbulb", on: "play", cost: 1, fx: { light: 2, draw: 1 }, text: "Gain 2 Light (net +1) and draw 1", unlock: 2, hero: "seer" },
        reframe: { name: "Reframe", on: "play", cost: 2, fx: { echo: 2 }, text: "Fire the last card twice more", unlock: 4, hero: "seer" },
        lanternlens: { name: "Lantern Lens", on: "play", cost: 4, fx: { xp: 30, crit: true }, text: "Gain 30 XP; next card crits", unlock: 6, hero: "seer" },
        focuspull: { name: "Focus Pull", on: "play", cost: 2, fx: { per: ['seen', 4], light: 1 }, text: "4 XP per photo seen here, +1 Light", unlock: 3, hero: "seer" },
        moonbath: { name: "Moonbath", on: "play", cost: 5, fx: { double: true, draw: 2 }, text: "This foe drops double; draw 2", unlock: 7, hero: "seer" },
        sharpshot: { name: "Sharp Shot", on: "verdict", test: t => t.zoom && t.firstOfFoe, xp: 24, text: "First verdict on a foe after a zoom", unlock: 4, hero: "seer" },
        wideeyed: { name: "Wide-Eyed", on: "viewer", test: t => t.seen >= 3, xp: 18, light: 1, text: "Zoom in after 3+ photos", unlock: 6, hero: "seer" },
        nightvision: { name: "Night Vision", on: "verdict", test: t => t.zoom && t.details, xp: 40, text: "Verdict after zoom and details", unlock: 8, hero: "seer" },
        seersmark: { name: "Seer's Mark", on: "verdict", test: t => t.total >= 2 && t.seen >= t.total && t.zoom && t.details, xp: 70, text: "Every photo, a zoom and the details", unlock: 10, hero: "seer" },
        glimpse: { name: "Glimpse", on: "verdict", test: t => t.seen >= 1, xp: 5, text: "Verdict after seeing a photo", unlock: 1, hero: "seer" },
        moonpool: { name: "Moon Pool", on: "defeat", test: t => t.elite, xp: 25, light: 2, text: "Vanquish an elite or boss", unlock: 5, hero: "seer" },
        spectacle: { name: "Spectacles", on: "viewer", test: t => t.details, xp: 22, text: "Zoom in after reading the details", unlock: 7, hero: "seer" },
        oculus: { name: "Oculus", on: "overflow", xp: 30, text: "Earn Light while your lantern is full", unlock: 9, hero: "seer" },
        marginalia: { name: "Marginalia", on: "details", xp: 8, light: 1, text: "Read the details", unlock: 1, hero: "scribe" },
        tally: { name: "Tally Mark", on: "check", xp: 10, text: "Confirm or correct a value", unlock: 1, hero: "scribe" },
        errata: { name: "Errata", on: "check", test: t => t.checks >= 2, xp: 18, text: "Check a second value on one item", unlock: 2, hero: "scribe" },
        footnote: { name: "Footnote", on: "verdict", test: t => t.details && t.checks >= 1, xp: 22, text: "Verdict after details and a checked value", unlock: 2, hero: "scribe" },
        ledgerline: { name: "Ledger Line", on: "verdict", test: t => t.checks >= 1, xp: 14, text: "Verdict after checking a value", unlock: 2, hero: "scribe" },
        annotate: { name: "Annotate", on: "details", test: t => t.seen >= 2, xp: 16, text: "Read the details after 2+ photos", unlock: 3, hero: "scribe" },
        cipher: { name: "Cipher", on: "ai", xp: 12, light: 1, text: "Ask the AI about it", unlock: 3, hero: "scribe" },
        crossref: { name: "Cross-Reference", on: "verdict", test: t => t.ai && t.details, xp: 26, text: "Verdict after the AI and the details", unlock: 3, hero: "scribe" },
        signet: { name: "Signet", on: "verdict", test: t => t.checks >= 2, xp: 30, text: "Verdict after checking 2 values", unlock: 4, hero: "scribe" },
        palimpsest: { name: "Palimpsest", on: "verdict", test: t => t.wasLater && t.details, xp: 30, text: "Decide a set-aside item after the details", unlock: 4, hero: "scribe" },
        archive: { name: "Archive", on: "defeat", xp: 18, text: "Vanquish a foe", unlock: 5, hero: "scribe" },
        inkwell: { name: "Inkwell", on: "details", scrap: 3, text: "Read the details", unlock: 1, hero: "scribe" },
        quillstroke: { name: "Quill Stroke", on: "check", light: 1, text: "Confirm or correct a value", unlock: 2, hero: "scribe" },
        rubric: { name: "Rubric", on: "verdict", test: t => t.details && t.zoom, xp: 28, text: "Verdict after details and a zoom", unlock: 5, hero: "scribe" },
        colophon: { name: "Colophon", on: "verdict", test: t => t.last && t.details, xp: 40, text: "Final verdict on a foe, after the details", unlock: 6, hero: "scribe" },
        scriptorium: { name: "Scriptorium", on: "check", test: t => t.elite, xp: 26, text: "Check a value on an elite or boss", unlock: 7, hero: "scribe" },
        concordance: { name: "Concordance", on: "verdict", test: t => t.checks >= 2 && t.details && t.ai, xp: 60, text: "2 checks, the details and the AI", unlock: 8, hero: "scribe" },
        vellum: { name: "Vellum", on: "details", test: t => t.elite, xp: 18, light: 1, text: "Read the details of an elite or boss", unlock: 3, hero: "scribe" },
        gloss: { name: "Gloss", on: "verdict", test: t => t.details, xp: 12, text: "Verdict after the details", unlock: 2, hero: "scribe" },
        redink: { name: "Red Ink", on: "check", test: t => t.checks >= 2, light: 2, text: "Check a second value on one item", unlock: 4, hero: "scribe" },
        bookmark: { name: "Bookmark", on: "verdict", test: t => t.wasLater, xp: 18, light: 1, text: "Decide one you set aside", unlock: 3, hero: "scribe" },
        index: { name: "Index", on: "verdict", test: t => t.details && t.seen >= 2, xp: 32, text: "Details and 2+ photos", unlock: 6, hero: "scribe" },
        almanac: { name: "Almanac", on: "defeat", test: t => t.elite, xp: 45, text: "Vanquish an elite or boss", unlock: 9, hero: "scribe" },
        epigraph: { name: "Epigraph", on: "verdict", test: t => t.firstOfFoe && t.details, xp: 24, light: 1, text: "First verdict on a foe, after the details", unlock: 5, hero: "scribe" },
        transcript: { name: "Transcript", on: "ai", test: t => t.details, xp: 26, text: "Ask the AI after reading the details", unlock: 7, hero: "scribe" },
        proofread: { name: "Proofread", on: "play", cost: 1, fx: { draw: 2 }, text: "Draw 2 cards", unlock: 1, hero: "scribe" },
        sealedletter: { name: "Sealed Letter", on: "play", cost: 2, fx: { scrap: 12 }, text: "Gain 12 moonshards", unlock: 2, hero: "scribe" },
        copyist: { name: "Copyist", on: "play", cost: 2, fx: { echo: 1, draw: 1 }, text: "Fire the last card again; draw 1", unlock: 3, hero: "scribe" },
        library: { name: "Library", on: "play", cost: 3, fx: { draw: 4 }, text: "Draw 4 cards", unlock: 5, hero: "scribe" },
        treatise: { name: "Treatise", on: "play", cost: 4, fx: { xp: 45 }, text: "Gain 45 XP", unlock: 6, hero: "scribe" },
        inkstorm: { name: "Ink Storm", on: "play", cost: 3, fx: { per: ['checks', 15], draw: 1 }, text: "15 XP per value checked here; draw 1", unlock: 7, hero: "scribe" },
        edict: { name: "Edict", on: "play", cost: 2, fx: { bind: true, xp: 10 }, text: "Strip this foe's trait; gain 10 XP", unlock: 4, hero: "scribe" },
        blotter: { name: "Blotter", on: "play", cost: 1, fx: { light: 1, crit: true }, text: "Next card crits; +1 Light back", unlock: 2, hero: "scribe" },
        chronicle: { name: "Chronicle", on: "play", cost: 5, fx: { per: ['defeats', 10] }, text: "10 XP per foe vanquished tonight", unlock: 8, hero: "scribe" },
        scrivener: { name: "Scrivener", on: "details", test: t => t.checks >= 1, xp: 20, text: "Read the details after checking a value", unlock: 4, hero: "scribe" },
        margins: { name: "Wide Margins", on: "verdict", test: t => t.details && t.light >= 4, xp: 26, text: "Details read, holding 4+ Light", unlock: 5, hero: "scribe" },
        calligraphy: { name: "Calligraphy", on: "check", test: t => t.details, xp: 28, light: 1, text: "Check a value after the details", unlock: 8, hero: "scribe" },
        lexicon: { name: "Lexicon", on: "verdict", test: t => t.details && t.checks >= 2 && t.seen >= t.total, xp: 72, text: "Details, 2 checks and every photo", unlock: 10, hero: "scribe" },
        postscript: { name: "Postscript", on: "verdict", test: t => t.last, xp: 10, text: "Final verdict on a foe", unlock: 1, hero: "scribe" },
        sealwax: { name: "Sealing Wax", on: "defeat", test: t => t.played >= 3, scrap: 10, xp: 10, text: "Vanquish a foe after 3+ cards", unlock: 6, hero: "scribe" },
        candlenotes: { name: "Candle Notes", on: "details", test: t => t.zoom, xp: 34, text: "Read the details after a zoom", unlock: 9, hero: "scribe" },
        stamp: { name: "Rubber Stamp", on: "check", test: t => t.firstOfFoe, xp: 16, text: "Check a value before your first verdict on a foe", unlock: 3, hero: "scribe" },
        watchfire: { name: "Watchfire", on: "verdict", test: t => t.firstOfFoe, light: 2, text: "Your first verdict on a foe", unlock: 1, hero: "warden" },
        bulwark: { name: "Bulwark", on: "defeat", xp: 15, light: 1, text: "Vanquish a foe", unlock: 1, hero: "warden" },
        sentinel: { name: "Sentinel", on: "verdict", test: t => t.played >= 2, xp: 14, text: "Verdict after 2+ cards played on a foe", unlock: 2, hero: "warden" },
        rampart: { name: "Rampart", on: "verdict", test: t => t.light >= 6, xp: 18, text: "Verdict while holding 6+ Light", unlock: 2, hero: "warden" },
        lastlight: { name: "Last Light", on: "verdict", test: t => t.last, xp: 20, text: "The verdict that vanquishes a foe", unlock: 2, hero: "warden" },
        bellringer: { name: "Bell Ringer", on: "defeat", test: t => t.played >= 4, xp: 26, text: "Vanquish a foe after 4+ cards", unlock: 3, hero: "warden" },
        vanguard: { name: "Vanguard", on: "verdict", test: t => t.firstOfFoe && t.seen >= 2, xp: 20, light: 1, text: "First verdict on a foe, 2+ photos", unlock: 3, hero: "warden" },
        oathkeeper: { name: "Oathkeeper", on: "defeat", test: t => t.elite, xp: 36, text: "Vanquish an elite or boss", unlock: 4, hero: "warden" },
        hearth: { name: "Hearth", on: "active", light: 1, text: "Whenever you play an active card", unlock: 3, hero: "warden" },
        standard: { name: "Standard", on: "verdict", test: t => t.played >= 5, xp: 30, text: "Verdict after 5+ cards on a foe", unlock: 4, hero: "warden" },
        lanternpost: { name: "Lantern Post", on: "verdict", test: t => t.light >= 3, xp: 8, text: "Verdict while holding 3+ Light", unlock: 1, hero: "warden" },
        shieldwall: { name: "Shield Wall", on: "verdict", test: t => t.light >= 8, xp: 32, text: "Verdict while holding 8+ Light", unlock: 5, hero: "warden" },
        warcry: { name: "War Cry", on: "active", xp: 12, text: "Whenever you play an active card", unlock: 5, hero: "warden" },
        finalstand: { name: "Final Stand", on: "verdict", test: t => t.last && t.boss, xp: 80, text: "The verdict that vanquishes a boss", unlock: 6, hero: "warden" },
        tower: { name: "Watchtower", on: "defeat", light: 3, text: "Vanquish a foe", unlock: 6, hero: "warden" },
        ember: { name: "Ember", on: "overflow", xp: 10, text: "Earn Light while your lantern is full", unlock: 2, hero: "warden" },
        bastion: { name: "Bastion", on: "verdict", test: t => t.light >= 10, xp: 44, text: "Verdict while holding 10+ Light", unlock: 7, hero: "warden" },
        vow: { name: "Vow", on: "verdict", test: t => t.last && t.seen >= t.total, xp: 28, text: "Final verdict on a foe, every photo seen", unlock: 3, hero: "warden" },
        gatekeeper: { name: "Gatekeeper", on: "defeat", test: t => t.boss, xp: 60, light: 3, text: "Vanquish a boss", unlock: 8, hero: "warden" },
        torchbearer: { name: "Torchbearer", on: "viewer", light: 1, xp: 6, text: "Open a photo full screen", unlock: 4, hero: "warden" },
        rearguard: { name: "Rearguard", on: "verdict", test: t => t.wasLater, light: 2, xp: 12, text: "Decide one you set aside", unlock: 5, hero: "warden" },
        steadfast: { name: "Steadfast", on: "verdict", test: t => t.played >= 3 && t.seen >= 2, xp: 34, text: "3+ cards played and 2+ photos seen", unlock: 7, hero: "warden" },
        dawnguard: { name: "Dawn Guard", on: "verdict", test: t => t.firstOfFoe && t.elite, xp: 40, light: 2, text: "First verdict on an elite or boss", unlock: 9, hero: "warden" },
        patrol: { name: "Night Patrol", on: "defeat", scrap: 4, xp: 6, text: "Vanquish a foe", unlock: 2, hero: "warden" },
        beacon: { name: "Beacon", on: "play", cost: 1, fx: { light: 3 }, text: "Gain 3 Light (net +2)", unlock: 1, hero: "warden" },
        rallycry: { name: "Rally Cry", on: "play", cost: 2, fx: { draw: 2, light: 1 }, text: "Draw 2; gain 1 Light", unlock: 2, hero: "warden" },
        bastionrite: { name: "Rite of Bastion", on: "play", cost: 3, fx: { per: ['light', 5] }, text: "Gain 5 XP per Light left after paying", unlock: 4, hero: "warden" },
        charge: { name: "Charge", on: "play", cost: 2, fx: { xp: 20, crit: true }, text: "Gain 20 XP; next card crits", unlock: 3, hero: "warden" },
        vigilance: { name: "Vigilance", on: "play", cost: 3, fx: { double: true }, text: "This foe drops double XP and shards", unlock: 5, hero: "warden" },
        lanternwall: { name: "Lantern Wall", on: "play", cost: 4, fx: { per: ['played', 8] }, text: "Gain 8 XP per card played on this foe", unlock: 6, hero: "warden" },
        signalfire: { name: "Signal Fire", on: "play", cost: 5, fx: { xp: 40, light: 3 }, text: "Gain 40 XP and 3 Light", unlock: 7, hero: "warden" },
        muster: { name: "Muster", on: "play", cost: 1, fx: { draw: 1, crit: true }, text: "Draw 1; next card crits", unlock: 2, hero: "warden" },
        ironvow: { name: "Iron Vow", on: "play", cost: 4, fx: { echo: 2, light: 2 }, text: "Fire the last card twice; +2 Light", unlock: 8, hero: "warden" },
        brazier: { name: "Brazier", on: "verdict", test: t => t.light >= 4 && t.firstOfFoe, xp: 18, text: "First verdict on a foe with 4+ Light", unlock: 3, hero: "warden" },
        keep: { name: "The Keep", on: "active", test: t => t.elite, xp: 20, text: "Play an active card against an elite or boss", unlock: 6, hero: "warden" },
        guardpost: { name: "Guard Post", on: "verdict", test: t => t.played >= 1 && t.seen >= 2, xp: 16, text: "A card played and 2+ photos seen", unlock: 4, hero: "warden" },
        ward: { name: "Moon Ward", on: "overflow", xp: 18, scrap: 2, text: "Earn Light while your lantern is full", unlock: 5, hero: "warden" },
        unbroken: { name: "Unbroken", on: "verdict", test: t => t.last && t.elite && t.seen >= t.total, xp: 90, text: "Final verdict on an elite or boss, every photo", unlock: 10, hero: "warden" },
        sentry: { name: "Sentry", on: "verdict", test: t => t.played >= 1, xp: 6, text: "Verdict after a card played on a foe", unlock: 1, hero: "warden" },
        bonfire: { name: "Bonfire", on: "defeat", test: t => t.played >= 5, xp: 40, light: 2, text: "Vanquish a foe after 5+ cards", unlock: 8, hero: "warden" },
        lampwick: { name: "Lamp Wick", on: "active", light: 1, xp: 6, text: "Whenever you play an active card", unlock: 7, hero: "warden" },
        gauntlet: { name: "Gauntlet", on: "verdict", test: t => t.light >= 6 && t.elite, xp: 46, text: "Verdict on an elite with 6+ Light", unlock: 9, hero: "warden" },
        stride: { name: "Long Stride", on: "path", xp: 12, light: 1, text: "Choose a path", unlock: 1, hero: "wayfarer" },
        waymark: { name: "Waymark", on: "verdict", test: t => t.firstOfFoe, xp: 10, scrap: 2, text: "Your first verdict on a foe", unlock: 1, hero: "wayfarer" },
        coinpurse: { name: "Coin Purse", on: "defeat", scrap: 6, text: "Vanquish a foe", unlock: 1, hero: "wayfarer" },
        milestone: { name: "Milestone", on: "defeat", test: t => t.defeats >= 3, xp: 20, text: "Vanquish your 3rd+ foe tonight", unlock: 2, hero: "wayfarer" },
        crossroads: { name: "Crossroads", on: "path", scrap: 6, text: "Choose a path", unlock: 2, hero: "wayfarer" },
        campfire: { name: "Campfire Tale", on: "event", xp: 20, text: "Stop at a camp, trader, cache or mystery", unlock: 2, hero: "wayfarer" },
        wanderlust: { name: "Wanderlust", on: "path", test: t => t.paths >= 3, xp: 25, text: "Choose your 3rd+ path tonight", unlock: 3, hero: "wayfarer" },
        heavypack: { name: "Heavy Pack", on: "verdict", test: t => t.scrap >= 30, xp: 18, text: "Verdict while carrying 30+ shards", unlock: 3, hero: "wayfarer" },
        roadsong: { name: "Road Song", on: "verdict", test: t => t.seen >= 2, xp: 10, scrap: 1, text: "Verdict after 2+ photos", unlock: 2, hero: "wayfarer" },
        lodestar: { name: "Lodestar", on: "path", light: 3, text: "Choose a path", unlock: 4, hero: "wayfarer" },
        pilgrim: { name: "Pilgrim", on: "event", scrap: 10, light: 1, text: "Stop at a camp, trader, cache or mystery", unlock: 4, hero: "wayfarer" },
        signpost: { name: "Signpost", on: "viewer", scrap: 2, xp: 4, text: "Open a photo full screen", unlock: 1, hero: "wayfarer" },
        caravan: { name: "Caravan", on: "defeat", test: t => t.scrap >= 40, xp: 35, text: "Vanquish a foe carrying 40+ shards", unlock: 5, hero: "wayfarer" },
        toll: { name: "Toll Gate", on: "defeat", test: t => t.elite, scrap: 15, text: "Vanquish an elite or boss", unlock: 3, hero: "wayfarer" },
        dustymap: { name: "Dusty Map", on: "details", scrap: 3, xp: 6, text: "Read the details", unlock: 2, hero: "wayfarer" },
        farhorizon: { name: "Far Horizon", on: "verdict", test: t => t.act >= 2 && t.seen >= 2, xp: 30, text: "2+ photos, past the first act", unlock: 6, hero: "wayfarer" },
        trailmix: { name: "Trail Rations", on: "event", light: 3, text: "Stop at a camp, trader, cache or mystery", unlock: 3, hero: "wayfarer" },
        nomad: { name: "Nomad", on: "path", test: t => t.light >= 3, xp: 22, scrap: 4, text: "Choose a path holding 3+ Light", unlock: 5, hero: "wayfarer" },
        hoard: { name: "Hoard", on: "verdict", test: t => t.scrap >= 60, xp: 34, text: "Verdict while carrying 60+ shards", unlock: 6, hero: "wayfarer" },
        bridge: { name: "Old Bridge", on: "verdict", test: t => t.wasLater, xp: 20, scrap: 3, text: "Decide one you set aside", unlock: 4, hero: "wayfarer" },
        compassrose: { name: "Compass Rose", on: "path", test: t => t.paths >= 5, xp: 45, text: "Choose your 5th+ path tonight", unlock: 7, hero: "wayfarer" },
        innkeeper: { name: "Innkeeper", on: "event", test: t => t.events >= 2, xp: 35, scrap: 8, text: "Your 2nd+ stop tonight", unlock: 7, hero: "wayfarer" },
        footsore: { name: "Footsore", on: "verdict", test: t => t.last, scrap: 5, text: "Final verdict on a foe", unlock: 3, hero: "wayfarer" },
        moonroad: { name: "Moon Road", on: "defeat", test: t => t.act >= 3, xp: 45, scrap: 6, text: "Vanquish a foe from act 3 on", unlock: 8, hero: "wayfarer" },
        tinker: { name: "Tinker's Cart", on: "event", light: 2, scrap: 3, text: "Stop at a camp, trader, cache or mystery", unlock: 5, hero: "wayfarer" },
        guide: { name: "Lantern Guide", on: "verdict", test: t => t.seen >= t.total && t.scrap >= 30, xp: 44, text: "Every photo seen, 30+ shards carried", unlock: 9, hero: "wayfarer" },
        ferryman: { name: "Ferryman", on: "path", test: t => t.elite, scrap: 15, xp: 15, text: "Choose a path while facing an elite", unlock: 8, hero: "wayfarer" },
        homeward: { name: "Homeward", on: "defeat", test: t => t.boss && t.scrap >= 50, xp: 90, text: "Vanquish a boss carrying 50+ shards", unlock: 10, hero: "wayfarer" },
        shortcut: { name: "Shortcut", on: "play", cost: 1, fx: { draw: 2 }, text: "Draw 2 cards", unlock: 1, hero: "wayfarer" },
        barter: { name: "Barter", on: "play", cost: 1, fx: { scrap: 10 }, text: "Gain 10 moonshards", unlock: 2, hero: "wayfarer" },
        spendthrift: { name: "Spendthrift", on: "play", cost: 2, fx: { per: ['scrap', 3] }, text: "3 XP per 10 shards you carry", unlock: 3, hero: "wayfarer" },
        pathfinder: { name: "Pathfinder", on: "play", cost: 2, fx: { light: 1, draw: 2 }, text: "Draw 2; +1 Light back", unlock: 3, hero: "wayfarer" },
        goldenmile: { name: "Golden Mile", on: "play", cost: 3, fx: { per: ['defeats', 6], scrap: 6 }, text: "6 XP per foe tonight; +6 shards", unlock: 5, hero: "wayfarer" },
        roadmap: { name: "Road Map", on: "play", cost: 2, fx: { per: ['paths', 10] }, text: "10 XP per path chosen tonight", unlock: 4, hero: "wayfarer" },
        lucky: { name: "Lucky Coin", on: "play", cost: 1, fx: { crit: true, scrap: 3 }, text: "Next card crits; +3 shards", unlock: 2, hero: "wayfarer" },
        journey: { name: "The Journey", on: "play", cost: 5, fx: { per: ['events', 20], draw: 1 }, text: "20 XP per stop tonight; draw 1", unlock: 7, hero: "wayfarer" },
        payday: { name: "Payday", on: "play", cost: 3, fx: { double: true, scrap: 5 }, text: "This foe drops double; +5 shards", unlock: 6, hero: "wayfarer" },
        detour: { name: "Detour", on: "play", cost: 4, fx: { echo: 2, scrap: 5 }, text: "Fire the last card twice; +5 shards", unlock: 8, hero: "wayfarer" },
        weatherwise: { name: "Weatherwise", on: "overflow", scrap: 4, xp: 8, text: "Earn Light while your lantern is full", unlock: 6, hero: "wayfarer" },
        pathworn: { name: "Path-Worn Boots", on: "verdict", test: t => t.paths >= 2 && t.seen >= 2, xp: 18, text: "2+ paths chosen, 2+ photos seen", unlock: 4, hero: "wayfarer" },
        emberroad: { name: "Ember Road", on: "event", xp: 50, text: "Stop at a camp, trader, cache or mystery", unlock: 9, hero: "wayfarer" },
        wayshrine: { name: "Wayshrine", on: "defeat", light: 2, text: "Vanquish a foe", unlock: 2, hero: "wayfarer" },
        stargazer: { name: "Stargazer", on: "verdict", test: t => t.zoom && t.scrap >= 20, xp: 30, text: "Zoomed in, 20+ shards carried", unlock: 7, hero: "wayfarer" },
        temper: { name: "Temper", on: "verdict", test: t => t.ups >= 1, xp: 12, text: "Verdict while you own an upgraded card", unlock: 1, hero: "moonsmith" },
        quench: { name: "Quench", on: "upgrade", xp: 15, light: 1, text: "Whenever a card is upgraded", unlock: 1, hero: "moonsmith" },
        slag: { name: "Slag", on: "burn", scrap: 8, text: "Whenever a card is burned", unlock: 1, hero: "moonsmith" },
        anvilsong: { name: "Anvil Song", on: "verdict", test: t => t.ups >= 3, xp: 20, text: "Verdict while you own 3+ upgraded cards", unlock: 2, hero: "moonsmith" },
        bellows: { name: "Bellows", on: "active", light: 1, text: "Whenever you play an active card", unlock: 2, hero: "moonsmith" },
        filings: { name: "Iron Filings", on: "burn", xp: 18, text: "Whenever a card is burned", unlock: 2, hero: "moonsmith" },
        annealing: { name: "Annealing", on: "upgrade", light: 2, text: "Whenever a card is upgraded", unlock: 3, hero: "moonsmith" },
        hallmark: { name: "Hallmark", on: "verdict", test: t => t.ups >= 5, xp: 28, text: "Verdict while you own 5+ upgraded cards", unlock: 3, hero: "moonsmith" },
        crucible: { name: "Crucible", on: "burn", xp: 20, light: 2, text: "Whenever a card is burned", unlock: 4, hero: "moonsmith" },
        masterwork: { name: "Masterwork", on: "verdict", test: t => t.ups >= 8, xp: 40, text: "Verdict while you own 8+ upgraded cards", unlock: 6, hero: "moonsmith" },
        rivet: { name: "Rivet", on: "check", xp: 8, light: 1, text: "Confirm or correct a value", unlock: 1, hero: "moonsmith" },
        whitehot: { name: "White Hot", on: "verdict", test: t => t.light >= 6 && t.ups >= 2, xp: 26, text: "6+ Light and 2+ upgraded cards", unlock: 4, hero: "moonsmith" },
        lean: { name: "Lean Deck", on: "verdict", test: t => t.deck <= 8, xp: 26, text: "Verdict while your deck has 8 or fewer cards", unlock: 5, hero: "moonsmith" },
        honed: { name: "Honed Edge", on: "verdict", test: t => t.seen >= 2 && t.ups >= 2, xp: 20, text: "2+ photos and 2+ upgraded cards", unlock: 3, hero: "moonsmith" },
        forgefire: { name: "Forgefire", on: "upgrade", xp: 28, text: "Whenever a card is upgraded", unlock: 5, hero: "moonsmith" },
        ashes: { name: "From Ashes", on: "burn", test: t => t.burned >= 3, xp: 40, text: "Burn your 3rd+ card tonight", unlock: 6, hero: "moonsmith" },
        assay: { name: "Assay", on: "viewer", xp: 8, scrap: 1, text: "Open a photo full screen", unlock: 2, hero: "moonsmith" },
        moonsteel: { name: "Moonsteel", on: "verdict", test: t => t.ups >= 10, xp: 50, text: "Verdict while you own 10+ upgraded cards", unlock: 7, hero: "moonsmith" },
        smeltery: { name: "Smeltery", on: "defeat", test: t => t.burned >= 2, xp: 35, scrap: 6, text: "Vanquish a foe after 2+ burns tonight", unlock: 7, hero: "moonsmith" },
        tongs: { name: "Tongs", on: "verdict", test: t => t.zoom, xp: 10, light: 1, text: "Verdict after zooming in", unlock: 2, hero: "moonsmith" },
        ingot: { name: "Ingot", on: "defeat", scrap: 6, xp: 8, text: "Vanquish a foe", unlock: 3, hero: "moonsmith" },
        whetted: { name: "Whetted", on: "verdict", test: t => t.firstOfFoe && t.ups >= 2, xp: 22, light: 1, text: "First verdict on a foe, 2+ upgraded cards", unlock: 4, hero: "moonsmith" },
        tempered: { name: "Tempered Will", on: "verdict", test: t => t.ups >= 6 && t.seen >= t.total, xp: 52, text: "6+ upgraded cards and every photo", unlock: 8, hero: "moonsmith" },
        starmetal: { name: "Star Metal", on: "upgrade", test: t => t.ups >= 6, xp: 50, light: 2, text: "Upgrade a card while owning 6+ upgraded", unlock: 9, hero: "moonsmith" },
        sparks: { name: "Sparks", on: "verdict", test: t => t.played >= 1, light: 1, text: "Verdict after a card played on a foe", unlock: 1, hero: "moonsmith" },
        refine: { name: "Refine", on: "details", test: t => t.ups >= 2, xp: 20, text: "Read the details with 2+ upgraded cards", unlock: 5, hero: "moonsmith" },
        goldleaf: { name: "Gold Leaf", on: "check", test: t => t.ups >= 3, xp: 24, text: "Check a value with 3+ upgraded cards", unlock: 6, hero: "moonsmith" },
        greatwork: { name: "Great Work", on: "verdict", test: t => t.ups >= 12 && t.seen >= 2, xp: 80, text: "12+ upgraded cards and 2+ photos", unlock: 10, hero: "moonsmith" },
        hammer: { name: "Moon Hammer", on: "play", cost: 2, fx: { upgrade: 1 }, text: "Upgrade a random card", unlock: 1, hero: "moonsmith" },
        smelt: { name: "Smelt", on: "play", cost: 1, fx: { burn: { scrap: 12, xp: 10 } }, text: "Burn another card in hand: +12 shards, +10 XP", unlock: 1, hero: "moonsmith" },
        doubleforge: { name: "Double Forge", on: "play", cost: 3, fx: { upgrade: 2 }, text: "Upgrade 2 random cards", unlock: 3, hero: "moonsmith" },
        recast: { name: "Recast", on: "play", cost: 2, fx: { forge: true }, text: "Turn another card in hand into a rare one", unlock: 2, hero: "moonsmith" },
        heatwave: { name: "Heat Wave", on: "play", cost: 2, fx: { per: ['ups', 6] }, text: "6 XP per upgraded card you own", unlock: 4, hero: "moonsmith" },
        melt: { name: "Melt Down", on: "play", cost: 1, fx: { burn: { light: 3 } }, text: "Burn another card in hand: +3 Light", unlock: 3, hero: "moonsmith" },
        goldsmith: { name: "Goldsmith", on: "play", cost: 3, fx: { upgrade: 1, scrap: 10 }, text: "Upgrade a random card; +10 shards", unlock: 5, hero: "moonsmith" },
        phoenix: { name: "Phoenix Ash", on: "play", cost: 4, fx: { per: ['burned', 20], draw: 1 }, text: "20 XP per card burned tonight; draw 1", unlock: 7, hero: "moonsmith" },
        starforge: { name: "Star Forge", on: "play", cost: 5, fx: { upgrade: 3, light: 1 }, text: "Upgrade 3 random cards; +1 Light", unlock: 8, hero: "moonsmith" },
        anvilstrike: { name: "Anvil Strike", on: "play", cost: 3, fx: { xp: 25, upgrade: 1 }, text: "Gain 25 XP; upgrade a random card", unlock: 6, hero: "moonsmith" },
        cinder: { name: "Cinder", on: "overflow", xp: 14, text: "Earn Light while your lantern is full", unlock: 3, hero: "moonsmith" },
        forgemaster: { name: "Forgemaster", on: "active", test: t => t.ups >= 5, xp: 20, light: 1, text: "Play an active card with 5+ upgraded", unlock: 9, hero: "moonsmith" },
        brand: { name: "Brand", on: "defeat", test: t => t.ups >= 3, xp: 26, text: "Vanquish a foe with 3+ upgraded cards", unlock: 4, hero: "moonsmith" },
        mould: { name: "Casting Mould", on: "upgrade", scrap: 10, xp: 10, text: "Whenever a card is upgraded", unlock: 7, hero: "moonsmith" },
        silversmith: { name: "Silversmith", on: "burn", xp: 30, scrap: 6, text: "Whenever a card is burned", unlock: 8, hero: "moonsmith" },
        tracker: { name: "Tracker", on: "verdict", test: t => t.seen >= 2, xp: 10, scrap: 1, text: "Verdict after 2+ photos", unlock: 1, hero: "huntress" },
        snare: { name: "Snare", on: "wager", xp: 12, light: 1, text: "Stake a wager", unlock: 1, hero: "huntress" },
        trophy: { name: "Trophy", on: "defeat", test: t => t.elite, xp: 25, scrap: 4, text: "Vanquish an elite or boss", unlock: 1, hero: "huntress" },
        stalk: { name: "Stalk", on: "verdict", test: t => t.wager, xp: 16, text: "Verdict while your wager holds", unlock: 2, hero: "huntress" },
        quarry: { name: "Quarry", on: "verdict", test: t => t.elite && t.seen >= 2, xp: 22, text: "2+ photos of an elite or boss", unlock: 2, hero: "huntress" },
        pelt: { name: "Pelt", on: "defeat", test: t => t.wager, scrap: 10, text: "Vanquish a foe with your wager unbroken", unlock: 2, hero: "huntress" },
        pounce: { name: "Pounce", on: "verdict", test: t => t.firstOfFoe && t.elite, xp: 26, text: "First verdict on an elite or boss", unlock: 3, hero: "huntress" },
        bloodmoon: { name: "Blood Moon", on: "wager", light: 3, text: "Stake a wager", unlock: 3, hero: "huntress" },
        hound: { name: "Moonhound", on: "viewer", test: t => t.elite, xp: 14, light: 1, text: "Zoom in on an elite or boss", unlock: 3, hero: "huntress" },
        lure: { name: "Lure", on: "verdict", test: t => t.wager && t.seen >= t.total, xp: 30, text: "Every photo seen while your wager holds", unlock: 4, hero: "huntress" },
        apex: { name: "Apex", on: "defeat", test: t => t.boss, xp: 70, text: "Vanquish a boss", unlock: 6, hero: "huntress" },
        arrow: { name: "Silver Arrow", on: "viewer", xp: 6, light: 1, text: "Open a photo full screen", unlock: 1, hero: "huntress" },
        spoor: { name: "Spoor", on: "details", xp: 10, text: "Read the details", unlock: 2, hero: "huntress" },
        ambush: { name: "Ambush", on: "verdict", test: t => t.firstOfFoe && t.wager, xp: 26, light: 1, text: "First verdict on a foe you wagered on", unlock: 4, hero: "huntress" },
        highstakes: { name: "High Stakes", on: "verdict", test: t => t.wager && t.elite, xp: 34, text: "Verdict on an elite while your wager holds", unlock: 5, hero: "huntress" },
        taxidermy: { name: "Taxidermy", on: "defeat", test: t => t.elite && t.wager, xp: 40, scrap: 8, text: "Vanquish an elite with your wager unbroken", unlock: 5, hero: "huntress" },
        moonbow: { name: "Moonbow", on: "verdict", test: t => t.zoom && t.elite, xp: 30, text: "Zoomed in on an elite or boss", unlock: 6, hero: "huntress" },
        pack: { name: "Hunting Pack", on: "verdict", test: t => t.played >= 3 && t.elite, xp: 38, text: "3+ cards played on an elite", unlock: 7, hero: "huntress" },
        scentmark: { name: "Scent Mark", on: "verdict", test: t => t.zoom, xp: 12, text: "Verdict after zooming in", unlock: 3, hero: "huntress" },
        deadeye: { name: "Deadeye", on: "verdict", test: t => t.wager && t.zoom && t.seen >= t.total, xp: 55, text: "Wager holds, zoomed, every photo", unlock: 8, hero: "huntress" },
        wolfmoon: { name: "Wolf Moon", on: "wager", test: t => t.elite, xp: 40, text: "Stake a wager on an elite or boss", unlock: 8, hero: "huntress" },
        crown: { name: "Hunter's Crown", on: "defeat", test: t => t.boss && t.wager, xp: 120, text: "Vanquish a boss with your wager unbroken", unlock: 10, hero: "huntress" },
        fang: { name: "Fang", on: "defeat", xp: 14, light: 1, text: "Vanquish a foe", unlock: 4, hero: "huntress" },
        bravado: { name: "Bravado", on: "wager", scrap: 8, xp: 8, text: "Stake a wager", unlock: 5, hero: "huntress" },
        thicket: { name: "Thicket", on: "verdict", test: t => t.details, xp: 12, text: "Verdict after the details", unlock: 2, hero: "huntress" },
        tusks: { name: "Tusk Charm", on: "viewer", test: t => t.wager, xp: 20, text: "Zoom in while your wager holds", unlock: 7, hero: "huntress" },
        nightstalker: { name: "Nightstalker", on: "verdict", test: t => t.elite && t.seen >= t.total && t.details, xp: 60, text: "Elite: every photo and the details", unlock: 9, hero: "huntress" },
        huntersmoon: { name: "Hunter's Moon", on: "overflow", xp: 16, text: "Earn Light while your lantern is full", unlock: 6, hero: "huntress" },
        mark: { name: "Hunter's Mark", on: "play", cost: 2, fx: { prey: true }, text: "This foe gives +50% XP and 5 shards", unlock: 1, hero: "huntress" },
        gambit: { name: "Gambit", on: "play", cost: 1, fx: { wager: 8 }, text: "Stake 8 shards on this foe for free", unlock: 1, hero: "huntress" },
        volley: { name: "Volley", on: "play", cost: 2, fx: { echo: 1, draw: 1 }, text: "Fire the last card again; draw 1", unlock: 2, hero: "huntress" },
        trap: { name: "Bear Trap", on: "play", cost: 2, fx: { bind: true, draw: 1 }, text: "Strip this foe's trait; draw 1", unlock: 3, hero: "huntress" },
        bait: { name: "Bait", on: "play", cost: 1, fx: { scrap: 6, light: 1 }, text: "+6 shards; +1 Light back", unlock: 2, hero: "huntress" },
        killshot: { name: "Killshot", on: "play", cost: 3, fx: { crit: true, prey: true }, text: "Next card crits; mark this foe", unlock: 5, hero: "huntress" },
        allin: { name: "All In", on: "play", cost: 3, fx: { wager: 20 }, text: "Stake 20 shards on this foe for free", unlock: 6, hero: "huntress" },
        hunt: { name: "The Hunt", on: "play", cost: 4, fx: { per: ['played', 10], prey: true }, text: "10 XP per card played here; mark it", unlock: 7, hero: "huntress" },
        fletch: { name: "Fletching", on: "play", cost: 2, fx: { draw: 3 }, text: "Draw 3 cards", unlock: 4, hero: "huntress" },
        trophywall: { name: "Trophy Wall", on: "play", cost: 5, fx: { per: ['defeats', 12] }, text: "12 XP per foe vanquished tonight", unlock: 8, hero: "huntress" },
        feint: { name: "Feint", on: "active", test: t => t.elite, xp: 12, text: "Play an active card against an elite", unlock: 3, hero: "huntress" },
        snarewire: { name: "Snare Wire", on: "check", test: t => t.elite, xp: 18, text: "Check a value on an elite or boss", unlock: 4, hero: "huntress" },
        houndsnose: { name: "Hound's Nose", on: "details", test: t => t.elite, xp: 22, light: 1, text: "Read the details of an elite or boss", unlock: 5, hero: "huntress" },
        lastarrow: { name: "Last Arrow", on: "verdict", test: t => t.last && t.elite, xp: 44, text: "The verdict that vanquishes an elite", unlock: 7, hero: "huntress" },
        chase: { name: "The Chase", on: "path", xp: 30, light: 2, text: "Choose a path", unlock: 9, hero: "huntress" },
        moonshard: { name: "Moonshard", on: "defeat", scrap: 4, text: "Vanquish a foe", unlock: 1 },
        nightowl: { name: "Night Owl", on: "verdict", test: t => t.seen >= 2 && t.details, xp: 18, text: "2+ photos and the details", unlock: 2 },
        candle: { name: "Candle", on: "verdict", light: 1, text: "Any verdict", unlock: 1 },
        lullaby: { name: "Lullaby", on: "verdict", test: t => t.wasLater, xp: 15, scrap: 3, text: "Decide one you set aside", unlock: 3 },
        pathlight: { name: "Path Light", on: "path", light: 2, text: "Choose a path", unlock: 2 },
        restful: { name: "Restful Night", on: "event", xp: 15, light: 1, text: "Stop at a camp, trader, cache or mystery", unlock: 3 },
        whisper: { name: "Whisper", on: "ai", scrap: 4, light: 1, text: "Ask the AI about it", unlock: 2 },
        ripple: { name: "Ripple", on: "verdict", test: t => t.played >= 2 && t.zoom, xp: 22, text: "2+ cards played and a zoom", unlock: 4 },
        moonflower: { name: "Moonflower", on: "defeat", test: t => t.seen >= 2, xp: 20, light: 1, text: "Vanquish a foe after 2+ photos on the last item", unlock: 5 },
        fireflies: { name: "Fireflies", on: "overflow", scrap: 5, text: "Earn Light while your lantern is full", unlock: 3 },
        mothwing: { name: "Moth Wing", on: "viewer", test: t => t.details, xp: 14, light: 1, text: "Zoom in after reading the details", unlock: 4 },
        tidewater: { name: "Tidewater", on: "verdict", test: t => t.act >= 2 && t.details, xp: 30, text: "Details read, past the first act", unlock: 6 },
        glasschime: { name: "Glass Chime", on: "verdict", test: t => t.act >= 4 && t.seen >= 2, xp: 40, text: "2+ photos, in act 4 or later", unlock: 7 },
        rustbloom: { name: "Rust Bloom", on: "verdict", test: t => t.act >= 3 && t.zoom, xp: 34, text: "Zoomed in, in act 3 or later", unlock: 6 },
        eclipse: { name: "Eclipse", on: "defeat", test: t => t.act >= 5, xp: 70, text: "Vanquish a foe in the Moonless Depot", unlock: 9 },
        lanternoil: { name: "Lantern Oil", on: "play", cost: 1, fx: { light: 2 }, text: "Gain 2 Light (net +1)", unlock: 1 },
        stardust: { name: "Stardust", on: "play", cost: 2, fx: { scrap: 6, draw: 1 }, text: "+6 shards; draw 1", unlock: 2 },
        moonwell: { name: "Moon Well", on: "play", cost: 3, fx: { light: 2, draw: 2 }, text: "Draw 2; gain 2 Light", unlock: 4 },
        wish: { name: "Wishing Star", on: "play", cost: 4, fx: { xp: 25, scrap: 10 }, text: "Gain 25 XP and 10 shards", unlock: 6 },
        cometail: { name: "Comet Tail", on: "play", cost: 5, fx: { echo: 3 }, text: "Fire the last card three more times", unlock: 8 },
        hush: { name: "Hush", on: "play", cost: 2, fx: { crit: true, light: 1 }, text: "Next card crits; +1 Light back", unlock: 3 },
        tide: { name: "Turning Tide", on: "play", cost: 3, fx: { draw: 2, crit: true }, text: "Draw 2; next card crits", unlock: 5 },
        lantern2: { name: "Old Lantern", on: "viewer", light: 1, text: "Open a photo full screen", unlock: 1 },
        feather: { name: "Owl Feather", on: "details", light: 1, xp: 4, text: "Read the details", unlock: 2 },
        silverthread: { name: "Silver Thread", on: "check", xp: 12, light: 1, text: "Confirm or correct a value", unlock: 4 },
        moonlit: { name: "Moonlit", on: "verdict", test: t => t.light >= 5 && t.seen >= t.total, xp: 26, text: "Every photo seen with 5+ Light", unlock: 5 },
        deepnight: { name: "Deep Night", on: "verdict", test: t => t.seen >= 3 && t.details && t.zoom, xp: 46, text: "3+ photos, details and a zoom", unlock: 7 },
        dawnchorus: { name: "Dawn Chorus", on: "defeat", test: t => t.played >= 4 && t.elite, xp: 50, text: "Vanquish an elite after 4+ cards", unlock: 8 },
        allseeing: { name: "All-Seeing", on: "verdict", test: t => t.total >= 2 && t.seen >= t.total && t.details && t.checks >= 1 && t.zoom, xp: 100, text: "Every photo, zoom, details and a check", unlock: 10 },
        graveyard: { name: "Night Shift", on: "defeat", test: t => t.defeats >= 5, xp: 25, light: 2, text: "Vanquish your 5th+ foe tonight", unlock: 3 }
    };
    // The first cards: hero families, and active effects as data (fx) so every active card shares one engine.
    for (const [hero, ids] of Object.entries({ seer: ["gaze", "panorama", "loupe", "deep", "chain"], scribe: ["ledger", "notes", "quiet", "inktrail", "oracle", "revisit"],
        warden: ["dawn", "closer", "rally", "fullmoon", "flare", "bind"] })) ids.forEach(id => { CARDS[id].hero = hero; });
    Object.entries({ flare: { double: true }, wind: { draw: 2 }, whet: { upgrade: 1 }, tithe: { scrap: 8 }, insight: { crit: true }, surge: { xp: 40 },
        echo: { echo: 1 }, bind: { bind: true }, forge: { forge: true }, purge: { burn: { scrap: 10 } } }).forEach(([id, fx]) => { CARDS[id].fx = fx; });
    const PHOTO_CARDS = new Set(["gaze", "panorama", "deep", "loupe"]);
    const INK_CARDS = new Set(["ledger", "notes", "inktrail"]);
    // Each class starts with a deck that rewards a different real habit.
    const CLASSES = {
        seer: { name: "Seer", text: "Rewards looking at every photo.", deck: ["gaze", "gaze", "panorama", "loupe", "flare"] },
        scribe: { name: "Scribe", text: "Rewards checking values and reading the details.", deck: ["ledger", "ledger", "notes", "quiet", "wind"] },
        warden: { name: "Warden", text: "Builds Light and finishes foes.", deck: ["dawn", "dawn", "closer", "rally", "flare"] },
        wayfarer: { name: "Wayfarer", text: "Rewards the road: paths, stops and shards.", deck: ["stride", "stride", "waymark", "coinpurse", "shortcut"] },
        moonsmith: { name: "Moonsmith", text: "Upgrades and burns cards into power.", deck: ["temper", "quench", "slag", "hammer", "smelt"] },
        huntress: { name: "Huntress", text: "Hunts elites and stakes wagers.", deck: ["tracker", "tracker", "snare", "trophy", "gambit"] }
    };
    const STARTER = CLASSES.seer.deck;
    // Twenty-four kinds of Defect per region; a group's kind is picked so none repeats within a week.
    const SPECIES = [["scratcher", "Scratcher"], ["needlewisp", "Needlewisp"], ["thumper", "Thumper"], ["anvilmole", "Anvil Mole"], ["rustmoth", "Rustmoth"], ["barnacle", "Barnacle Crone"], ["dripling", "Dripling"], ["smearhound", "Smearhound"], ["glasswing", "Glasswing"], ["cracklejack", "Cracklejack"], ["boltgnaw", "Boltgnaw"], ["springjack", "Springjack"], ["lugnut", "Lugnut Lurker"], ["dentling", "Dentling"], ["swirlmark", "Swirl Mark"], ["tarspot", "Tar Spot"], ["chipwing", "Chip Wing"], ["seamcreeper", "Seam Creeper"], ["gapsprite", "Gap Sprite"], ["sapdrip", "Sap Drip"], ["pecker", "Pecker"], ["hailhob", "Hail Hob"], ["scuffmite", "Scuff Mite"], ["peelwraith", "Peel Wraith"]];
    const RELICS = {
        lens: { name: "Brass Lens", text: "Photo cards give +50% XP" },
        ink: { name: "Ink of Night", text: "Ledger & Notes cards give +50% XP" },
        lamp: { name: "Lantern", text: "Start each foe with 2 Light" },
        pouch: { name: "Deep Pouch", text: "+1 card in hand" },
        gear: { name: "Moon Gear", text: "+3 Moonshards per foe" },
        bolt: { name: "Lucky Bolt", text: "Cards have a 20% chance to crit for double" },
        owl: { name: "Owl Feather", text: "+1 Light whenever a new foe appears" },
        thimble: { name: "Silver Thimble", text: "Active cards cost 1 less (never below 1)" },
        seal: { name: "Wax Seal", text: "Your first active card on each foe is free" },
        moth: { name: "Moth Lamp", text: "Hold up to 15 Light instead of 10" },
        compass: { name: "Cracked Compass", text: "See one more path when you choose your road" },
        kiln: { name: "Ember Kiln", text: "Playing a 3+ cost card gives 10 XP" },
        mirror: { name: "Silver Mirror", text: "The first card that fires on each foe counts twice" },
        bell: { name: "Night Bell", text: "Claiming a bounty gives 2 Light" },
        scale: { name: "Merchant's Scale", text: "The trader charges 25% less" },
        map: { name: "Inked Map", text: "Elites offer 4 cards instead of 3" },
        quill: { name: "Raven Quill", text: "Ink cards also give 1 Light" }
    };
    // Every foe carries one trait. Traits change rewards and how cards play out, never what a verdict does.
    const TRAITS = {
        greedy: { name: "Greedy", text: "Drops 6 extra moonshards" },
        glimmer: { name: "Glimmering", text: "+5 shards for each item where you saw every photo" },
        restless: { name: "Restless", text: "Zooming in gives 1 extra Light" },
        armored: { name: "Armored", text: "Cards give 25% less XP here, but it drops 50% more" },
        brittle: { name: "Brittle", text: "Cards have a 25% crit chance here" },
        shy: { name: "Shy", text: "The first photo you flip on each item gives 1 extra Light" }
    };
    const traitOf = gid => Object.keys(TRAITS)[hash(`${gid}|trait`) % Object.keys(TRAITS).length];
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
        return { xp, light: def.light ? def.light + (up ? 1 : 0) : 0, scrap: def.scrap ? Math.round(def.scrap * (up ? 1.5 : 1)) : 0 };
    }
    // Light cost of an active card: upgrades and the Silver Thimble make it cheaper, the Wax Seal makes the first one free.
    function costOf(id, up, relics, sealReady) {
        if (sealReady && relics.includes("seal")) return 0;
        const base = CARDS[id].cost || 0;
        return Math.max(base ? 1 : 0, base - (up ? 1 : 0) - (relics.includes("thimble") ? 1 : 0));
    }
    const lightCap = relics => (relics.includes("moth") ? 15 : 10);
    // How closely the run was played: share of verdicts made after looking properly. Never about speed.
    function gradeOf(close, items) {
        if (!items) return "-";
        const r = close / items;
        return r >= 0.9 ? "S" : r >= 0.7 ? "A" : r >= 0.5 ? "B" : "C";
    }

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
    // Rest stops and events now come every second foe (see eventAfter), since the player picks the order.
    function buildMap(cards) {
        const gs = groupsOf(cards);
        const avg = gs.reduce((n, g) => n + g.count, 0) / (gs.length || 1);
        const nodes = [];
        const acts = gs.length >= 8 ? Math.min(5, Math.floor(gs.length / 4)) : 1;
        const size = Math.ceil(gs.length / acts);
        gs.forEach((g, i) => {
            const gr = g.group;
            const act = Math.min(acts, Math.floor(i / size) + 1);
            const last = i === gs.length - 1 || (i + 1) % size === 0;
            const blocked = (Array.isArray(gr.gates) && gr.gates.some(x => x && x.level === "block")) || Boolean(gr.flag && gr.flag.tone === "block");
            const type = last ? "boss" : (blocked || (g.count >= 4 && g.count >= avg * 1.6)) ? "elite" : "foe";
            nodes.push({ type, groupId: String(gr.groupId), count: g.count, act });
        });
        return nodes;
    }

    let uidSeq = 0;
    const inst = (id, up) => ({ uid: `c${Date.now().toString(36)}${(uidSeq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, id, up: Boolean(up) });
    // Five regions. Long packs walk through them in order; each act ends with its own boss.
    const REGIONS = [
        { name: "The Moon Road", species: SPECIES, boss: ["sovereign", "The Pale Sovereign"], lore: "" },
        { name: "The Drowned Yard", boss: ["lamplighter", "The Hollow Lamplighter"], lore: "Past the Sovereign's gate the road sinks into the sea. Cars stand half-drowned under a lighthouse that has not turned in years.",
            species: [["rainwight", "Rainwight"], ["saltgnawer", "Salt Gnawer"], ["puddlejack", "Puddlejack"], ["fogmoth", "Fogmoth"], ["hingehound", "Hinge Hound"], ["wiperwraith", "Wiper Wraith"], ["paintleech", "Paint Leech"], ["lampmite", "Lamp Mite"], ["rivetrook", "Rivet Rook"], ["chromeeel", "Chrome Eel"], ["bumpertoad", "Bumper Toad"], ["mirrorimp", "Mirror Imp"], ["kelpcoil", "Kelp Coil"], ["barnaclebat", "Barnacle Bat"], ["brinewisp", "Brine Wisp"], ["tidecrab", "Tide Crab"], ["drainrat", "Drain Rat"], ["foamjelly", "Foam Jelly"], ["anchorgrub", "Anchor Grub"], ["mudskipper", "Mudskipper"], ["netwraith", "Net Wraith"], ["silthound", "Silt Hound"], ["gullghost", "Gull Ghost"], ["rustclam", "Rust Clam"]] },
        { name: "The Rust Orchard", boss: ["thornregent", "The Thorn Regent"], lore: "Inland, trees grow out of old chassis. Their leaves are flakes of rust, and they rattle when nothing moves.",
            species: [["burrthorn", "Burr Thorn"], ["oxidrake", "Oxidrake"], ["rustwren", "Rust Wren"], ["flakefox", "Flake Fox"], ["corrodile", "Corrodile"], ["boltworm", "Bolt Worm"], ["scabbeetle", "Scab Beetle"], ["tarnishhare", "Tarnish Hare"], ["ironmoth", "Iron Moth"], ["pitlark", "Pit Lark"], ["sapwraith", "Sap Wraith"], ["husklurk", "Husk Lurker"], ["thornsprite", "Thorn Sprite"], ["acornbolt", "Acorn Bolt"], ["vinehound", "Vine Hound"], ["leafrot", "Leaf Rot"], ["rootgnarl", "Root Gnarl"], ["mouldmoth", "Mould Moth"], ["peelbark", "Peel Bark"], ["cinderowl", "Cinder Owl"], ["canworm", "Can Worm"], ["spokespider", "Spoke Spider"], ["grafthog", "Graft Hog"], ["blightbat", "Blight Bat"]] },
        { name: "The Glass Market", boss: ["mirrorqueen", "The Mirror Queen"], lore: "A night market of windscreens and mirrors. Every stall shows you a little more than you asked to see.",
            species: [["shardling", "Shardling"], ["prismcat", "Prism Cat"], ["glarehawk", "Glare Hawk"], ["crazeling", "Crazeling"], ["lenslug", "Lens Slug"], ["splintermouse", "Splinter Mouse"], ["glintfish", "Glint Fish"], ["frostpane", "Frost Pane"], ["chipjay", "Chip Jay"], ["webcrack", "Web Crack"], ["bevelbat", "Bevel Bat"], ["hazeowl", "Haze Owl"], ["shimmerkoi", "Shimmer Koi"], ["bubblewisp", "Bubble Wisp"], ["tintmole", "Tint Mole"], ["streakhare", "Streak Hare"], ["reflectsprite", "Reflect Sprite"], ["lampfish", "Lamp Fish"], ["etchling", "Etchling"], ["gritsprite", "Grit Sprite"], ["fogfinch", "Fog Finch"], ["panespider", "Pane Spider"], ["glasstoad", "Glass Toad"], ["crystalcrab", "Crystal Crab"]] },
        { name: "The Moonless Depot", boss: ["moonless", "The Moonless King"], lore: "At the end of the road the moon goes out. Only your lantern is left, and the depot where every Defect was born.",
            species: [["dimwisp", "Dim Wisp"], ["gloomhound", "Gloom Hound"], ["nullmoth", "Null Moth"], ["hushcrow", "Hush Crow"], ["voidtoad", "Void Toad"], ["shadeling", "Shadeling"], ["blankface", "Blank Face"], ["duskeel", "Dusk Eel"], ["murkmole", "Murk Mole"], ["sootimp", "Soot Imp"], ["lullspider", "Lull Spider"], ["nightjar", "Nightjar"], ["oilshade", "Oil Shade"], ["silencer", "Silencer"], ["eclipsecat", "Eclipse Cat"], ["hollowpup", "Hollow Pup"], ["dreadmite", "Dread Mite"], ["wanewisp", "Wane Wisp"], ["veilbat", "Veil Bat"], ["inkling", "Inkling"], ["latchwraith", "Latch Wraith"], ["coldfox", "Cold Fox"], ["deeprook", "Deep Rook"], ["shroudmoth", "Shroud Moth"]] }
    ];
    function speciesOf(gid, type, act, avoid) {
        const R = REGIONS[(act || 1) - 1] || REGIONS[0];
        if (type === "boss") return { id: R.boss[0], name: R.boss[1] };
        const start = hash(`${gid}|species`);
        let pick = R.species[start % R.species.length];
        if (avoid) {
            outer: for (const reg of [R, ...REGIONS.filter(x => x !== R)]) {
                for (let i = 0; i < reg.species.length; i++) {
                    const c = reg.species[(start + i) % reg.species.length];
                    if (!avoid.has(c[0])) { pick = c; break outer; }
                }
            }
        }
        return { id: pick[0], name: type === "elite" ? `Elder ${pick[1]}` : pick[1] };
    }
    // Monday-start week, so "this week" matches a working week.
    const weekKey = d => { const m = new Date(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return dayKey(m); };
    function newRun(packId, seed, hero) {
        const cls = CLASSES[hero] ? hero : "seer";
        const deck = CLASSES[cls].deck.map(id => inst(id));
        return { packId, hero: cls, deck, draw: shuffle(rng(seed), deck.map(c => c.uid)), discard: [], hand: [], relics: [], scrap: 0, xp: 0,
            light: 0, played: 0, first: true, foe: null, scored: {}, later: {}, defeated: {}, met: {}, events: {}, done: false, introduced: false,
            pref: null, defeats: 0, close: 0, items: 0, double: null, bound: null, sealUsed: null, nextCrit: false, lastFired: null, startedAt: Date.now() };
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
    const rewardChoices = (r, level, n, hero) => shuffle(r, Object.keys(CARDS).filter(id => CARDS[id].unlock <= level && (!hero || !CARDS[id].hero || CARDS[id].hero === hero))).slice(0, n);
    // After every second foe: a stop on the road, in this order.
    const eventAfter = defeats => (defeats > 0 && defeats % 2 === 0 ? ["camp", "mystery", "shop", "mystery", "cache"][((defeats / 2) - 1) % 5] : null);
    // Paths you may take next: groups still to finish, in route order; the boss only when it is all that is left.
    function pathChoices(route, isOpen, n) {
        const open = route.filter(x => isOpen(x.groupId));
        if (!open.length) return [];
        // Finish an act before the next one; its boss comes last.
        const act = Math.min(...open.map(x => x.act || 1));
        const inAct = open.filter(x => (x.act || 1) === act);
        const nonBoss = inAct.filter(x => x.type !== "boss");
        return (nonBoss.length ? nonBoss : inAct).slice(0, n);
    }

    // One omen per calendar day, the same for everyone that day; applies to tales started that day.
    const OMENS = {
        silver: { name: "Silver Night", text: "Foes drop 50% more moonshards" },
        wick: { name: "Long Wick", text: "Hold 3 more Light" },
        clear: { name: "Clear Sky", text: "Start each foe with 1 Light" },
        owl: { name: "Owl's Eye", text: "Photo cards give 25% more XP" },
        cross: { name: "Crossroads", text: "See one more path at each fork" },
        kind: { name: "Kind Moon", text: "Your first active card on each foe costs 1 less" }
    };
    const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const omenOf = key => Object.keys(OMENS)[hash(`omen|${key}`) % Object.keys(OMENS).length];
    // Consecutive days ending today (or yesterday, so a streak survives until tonight's first verdict).
    function streakOf(days, today) {
        const set = new Set(days);
        const d = new Date(today);
        if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
        let n = 0;
        while (set.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
        return n;
    }
    const ACHIEVEMENTS = {
        first: { name: "The First Night", text: "Vanquish your first foe" },
        tale: { name: "Told in Full", text: "Finish a tale" },
        sgrade: { name: "Not a Thing Missed", text: "Earn an S grade" },
        boss: { name: "Sovereign's End", text: "Vanquish the Pale Sovereign" },
        elites: { name: "Elder's Bane", text: "Vanquish 5 elites" },
        hundred: { name: "A Hundred Verdicts", text: "Make 100 verdicts" },
        lamp: { name: "Lamplighter", text: "Hold 10 Light at once" },
        sharp: { name: "Card Sharp", text: "Play 20 active cards" },
        paths: { name: "Three Paths", text: "Finish a tale as Seer, Scribe and Warden" },
        naturalist: { name: "Naturalist", text: "Meet every kind of Defect" },
        collector: { name: "Collector", text: "Hold 4 relics in one tale" },
        three: { name: "Three Nights", text: "Walk the road 3 nights in a row" },
        week: { name: "A Week of Moons", text: "Walk the road 7 nights in a row" },
        warden10: { name: "Moonwarden", text: "Reach level 10" }
    };
    // Lantern colours recolour the accent; unlocked by level or achievements.
    const LANTERNS = {
        amber: { name: "Amber", c: "#e0a243", d: "#a8741f", need: () => true, how: "" },
        moon: { name: "Moonlight", c: "#8fb4d8", d: "#5b7fa3", need: m => levelOf(m.xp).level >= 5, how: "Reach level 5" },
        verdant: { name: "Verdant", c: "#a7c37f", d: "#6d8a4c", need: m => Object.keys(m.achv || {}).length >= 6, how: "Earn 6 achievements" },
        rose: { name: "Rose", c: "#e0928f", d: "#a35a5a", need: m => levelOf(m.xp).level >= 10, how: "Reach level 10" }
    };
    // Each item telegraphs one bounty before the verdict, like an enemy intent: do the careful thing, get paid.
    const BOUNTIES = {
        zoom: { text: "Zoom in", reward: "+2 Light" },
        details: { text: "Read the details", reward: "+8 shards" },
        every: { text: "See every photo", reward: "+15 XP" }
    };
    const bountyOf = (key, photos) => {
        const pool = photos > 1 ? ["zoom", "details", "every"] : ["zoom", "details"];
        return pool[hash(`${key}|bounty`) % pool.length];
    };
    const FLAVOR = {
        gaze: "Look twice. The moon only lies once.", dawn: "The first light finds what the night hid.", ledger: "Every number is a small promise.",
        closer: "The last word is always the lantern's.", panorama: "From the hill, every car tells the truth.", loupe: "Small glass, large secrets.",
        notes: "Write it down before the fog takes it.", flare: "Turn the wick up and watch them scatter.", wind: "A gust, and two more cards in your hand.",
        bounty: "Defects carry shards like mice carry crumbs.", revisit: "What you set aside still waits for you.", quiet: "Read first. Strike after.",
        whet: "A dull eye is sharpened on stone and patience.", tithe: "The moon pays those who keep its road.", oracle: "Ask, and a second sight opens.",
        inktrail: "The ink glows where the truth was written.", insight: "Stillness, then the perfect moment.", rally: "One drum, and the whole road answers.",
        surge: "The moon pulls hard, just once.", deep: "Four photos deep, nothing hides.", echo: "What worked once, works again.",
        fullmoon: "A whole moon of light, all for you.", bind: "Rope, a knot, and a quiet word.",
        kindling: "Every spark feeds the next.", purge: "Less to carry, more to see.", afterglow: "The light lingers on the careful.",
        chain: "One look leads to the next.", forge: "Hammer the plain into the rare.", overflow: "A full lantern still spills light."
    };
    const rules = { weekKey, REGIONS, BOUNTIES, bountyOf, FLAVOR, OMENS, dayKey, omenOf, streakOf, ACHIEVEMENTS, LANTERNS, hash, rng, shuffle, CARDS, RELICS, TRAITS, traitOf, STARTER, CLASSES, SPECIES, speciesOf, BASE_XP, levelOf, need, rankOf, cardGain, costOf, lightCap, gradeOf, eventAfter, pathChoices, buildMap, newRun, drawOne, refillHand, discardHand, playCard, addCard, removeCard, rewardChoices, handSize };
    root.PaleMoonRules = rules;
    if (typeof module !== "undefined" && module.exports) module.exports = rules;
    if (typeof document === "undefined") return;

    // ---------- state ----------
    const V = root.VINderCore;
    const systemReduce = Boolean(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    let reduce = systemReduce;
    const store = {
        get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode: progress lives for this visit only */ } }
    };
    const meta = Object.assign({ on: false, music: true, sfx: true, voice: true, mute: false, subs: "ja", haptics: true, reduceMotion: false, textSize: "m", cb: false, tutorialDone: false, vol: 0.7, musicVol: 0.6, sfxVol: 0.9, voiceVol: 1, xp: 0, runs: 0, foes: 0, verdicts: 0 },
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
        const q = V.remainingCards(ctx.cards, ctx.decisions, ctx.actions).filter(c => !V.isDecided(ctx.actions, ctx.decisions[c.key]));
        const pref = run && run.pref;
        return (pref && q.find(c => String(c.group.groupId) === pref)) || q[0] || null;
    }
    const groupOpen = gid => ctx.cards.some(c => String(c.group.groupId) === String(gid) && !V.isDecided(ctx.actions, ctx.decisions[c.key]));
    const traitHere = gid => (run && run.bound === String(gid) ? null : run && run.phased && run.phased[String(gid)] ? "armored" : traitOf(gid));
    function prefer(gid) {
        run.pref = gid ? String(gid) : null;
        saveRun();
        document.dispatchEvent(new CustomEvent("vinder:prefer", { detail: run.pref }));
    }
    let mapCache = { cards: null, nodes: [] };
    function nodes() {
        if (ctx && mapCache.cards !== ctx.cards) mapCache = { cards: ctx.cards, nodes: buildMap(ctx.cards) };
        return mapCache.nodes;
    }
    const nodeType = gid => (nodes().find(n => n.groupId === String(gid)) || { type: "foe" }).type;
    const groupById = gid => { const c = ctx && ctx.cards.find(x => String(x.group.groupId) === String(gid)); return c ? c.group : null; };

    const actOf = gid => (nodes().find(n => n.groupId === String(gid)) || {}).act || 1;
    const thisWeek = () => {
        if (!meta.week || meta.week.k !== weekKey(new Date())) meta.week = { k: weekKey(new Date()), ids: [] };
        return meta.week;
    };
    const nameOfSpecies = id => { for (const R of REGIONS) { const f = R.species.find(x => x[0] === id); if (f) return f[1]; } return id; };
    function speciesAt(gid, type) {
        const t = type || nodeType(gid);
        if (t === "boss" || !run) return speciesOf(gid, t, actOf(gid));
        run.species = run.species || {};
        let id = run.species[gid];
        if (!id) {
            id = speciesOf(gid, t, actOf(gid), new Set([...thisWeek().ids, ...Object.values(run.species)])).id;
            run.species[gid] = id;
        }
        const name = nameOfSpecies(id);
        return { id, name: t === "elite" ? `Elder ${name}` : name };
    }
    const foeName = gid => speciesAt(gid, nodeType(gid)).name;
    const capOf = () => lightCap(run.relics) + (run.omen === "wick" ? 3 : 0);
    function costNow(c) {
        const base = costOf(c.id, c.up, run.relics, run.sealUsed !== run.foe);
        return Math.max(0, base - (run.omen === "kind" && run.kindUsed !== run.foe ? 1 : 0));
    }
    // Achievements: unlock once, with a badge toast.
    function award(id) {
        meta.achv = meta.achv || {};
        if (meta.achv[id] || !ACHIEVEMENTS[id]) return;
        meta.achv[id] = Date.now();
        saveMeta();
        const t = h("div", "g-achv");
        t.setAttribute("role", "status");
        t.append(h("span", "g-achv-kicker", "Achievement"), h("b", "", ACHIEVEMENTS[id].name), h("small", "", ACHIEVEMENTS[id].text));
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3600);
        sfx("relic");
        haptic(HAPTIC.level);
    }
    const stat = (k, n) => { meta.stats = meta.stats || {}; meta.stats[k] = (meta.stats[k] || 0) + (n || 1); return meta.stats[k]; };
    // Distinct vibration per moment; off with the Vibration setting.
    const haptic = p => { if (meta.haptics === false || !navigator.vibrate) return; try { navigator.vibrate(p); } catch (_) { /* no haptics */ } };
    const HAPTIC = { crit: [18, 30, 26], card: 8, level: [30, 50, 30, 50, 90], defeat: [20, 40, 34], light: 4, pick: 12, nope: [12, 40, 12] };
    const ART = "assets/";
    // An <img> that hides itself if the art file is missing, so the layout never shows a broken image.
    function art(path, cls, alt) {
        const i = h("img", cls);
        i.alt = alt || "";
        i.decoding = "async";
        i.loading = "lazy";
        i.onerror = () => { i.remove(); };
        i.src = `${ART}${path}.webp`;
        return i;
    }
    const FAMILY_ART = { seer: "gaze", scribe: "notes", warden: "dawn", wayfarer: "wind", moonsmith: "whet", huntress: "bounty" };
    function cardArt(id) {
        const fb = FAMILY_ART[(CARDS[id] || {}).hero] || "insight";
        if (!listed(`cards/${id}`)) return art(`cards/${fb}`, "", "");
        const i = art(`cards/${id}`, "", "");
        i.onerror = () => { if (i.dataset.fb || fb === id) { i.remove(); return; } i.dataset.fb = "1"; i.src = `${ART}cards/${fb}.webp`; };
        return i;
    }
    // The animated idle loop (dir/anim/id) if there is one, otherwise the still painting.
    // Once the manifest is in, files it does not list are never requested.
    const listed = path => !assetList.length || assetList.includes(`${path}.webp`);
    function liveArt(dir, id, cls, alt) {
        if (!listed(`${dir}/anim/${id}`)) return art(`${dir}/${id}`, cls, alt);
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
        if (opts && opts.rate) src.playbackRate.value = opts.rate;
        g.gain.value = opts && opts.gain !== undefined ? opts.gain : 1;
        src.connect(g); g.connect(A[bus]);
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
        const t = await play(`${ART}${pickTrack(m)}`, "music", { gain: 0 });
        if (!t) return;
        if (A.mood !== m) { t.src.stop(); return; }
        t.g.gain.setTargetAtTime(1, A.ctx.currentTime, 0.5);
        A.track = t;
        // When a track ends, the next one comes from the same pool; nothing repeats until the pool is used up.
        t.src.onended = () => { if (A.track === t) { A.track = null; A.mood = null; setMood(m); } };
    }
    // Music pools per mood and region (assets/audio/music2), with a no-repeat shuffle remembered across days.
    let assetList = [];
    fetch(`${ART}manifest.json`).then(r => r.json()).then(j => { assetList = j.files || []; }).catch(() => {});
    const REGION_KEYS = ["road", "drowned", "orchard", "glass", "moonless"];
    function pickTrack(m) {
        if (m === "title") return "audio/music/theme.webm";
        if (m === "camp") return "audio/music/camp.webm";
        const act = run && run.foe && ctx ? actOf(run.foe) : 1;
        const region = REGION_KEYS[act - 1] || "road";
        const pool = assetList.filter(f => f.startsWith(`audio/music2/${m}-${region}-`));
        const all = [...(act === 1 || !pool.length ? [`audio/music/${m}.webm`] : []), ...pool];
        meta.heard = meta.heard || {};
        const key = `${m}-${region}`;
        let heard = (meta.heard[key] || []).filter(f => all.includes(f));
        let fresh = all.filter(f => !heard.includes(f));
        if (!fresh.length) { heard = []; fresh = all; }
        const f = fresh[Math.floor(Math.random() * fresh.length)];
        meta.heard[key] = [...heard, f];
        saveMeta();
        return f;
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
    // Each sound picks one of its recorded variants, with a slight pitch and level change, so repeats never sound identical.
    function sfx(name, gain) {
        if (!meta.on || !meta.sfx || meta.mute || !SFX[name] || !audio()) return;
        const base = SFX[name];
        const variants = assetList.filter(f => f.startsWith(`audio/sfx/${base}_v`) || f.startsWith(`audio/sfx/${name}_v`));
        const pickFrom = [`audio/sfx/${base}.webm`, ...variants];
        const f = pickFrom[Math.floor(Math.random() * pickFrom.length)];
        play(`${ART}${f}`, "sfx", { gain: (gain === undefined ? 1 : gain) * (0.88 + Math.random() * 0.12), rate: 0.94 + Math.random() * 0.12 });
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
        class_wayfarer: ["歩くことが、あなたの力。どんな道も、あなたの道。", "Walking is your power. Every road is your road."],
        class_moonsmith: ["鍛えることが、あなたの力。弱いものを、強くする人。", "Forging is your power. The one who makes the weak strong."],
        class_huntress: ["狩ることが、あなたの力。強い相手ほど、燃える人。", "Hunting is your power. The stronger the foe, the brighter you burn."],
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
        send_1: ["報告、夜空に飛んでった。お疲れさま！", "The report's flown off into the night sky. Good work!"],
        tut_1: ["これが今夜の相手。下の写真をよく見て、判定してね。", "This is tonight’s foe. Look closely at the photo below, then give your verdict."],
        tut_2: ["写真をめくったり、拡大すると、ランタンの光がたまるよ。", "Flip through the photos or zoom in, and your lantern’s Light builds up."],
        tut_3: ["光がたまったら、カードを上に引いて使ってね。", "Once you have Light, drag a card upward to play it."],
        tut_4: ["どの判定も同じ一撃。正しいと思うものを選んでね。", "Every verdict strikes the same blow. Choose what you think is right."],
        tut_5: ["相手を倒したら、次の道を選べるよ。いってらっしゃい。", "Defeat a foe and you can choose your next road. Off you go."]
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
        play(`${ART}audio/voice/${l.id}.webm`, "voice").then(v => {
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
                <div class="g-life" role="meter" aria-label="Left to decide on this foe" id="gHp" data-explain="One segment per item still to decide on this foe. Every verdict removes one, whichever verdict it is."></div>
            </div>
            <div class="g-bounty" id="gBounty" hidden></div>
            <button type="button" class="g-wager" id="gWager" hidden></button>
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
                <span id="gMom" data-explain="Light: earned by looking closely (new photos, zooming, details, values, asking the AI). Drag an active card up to spend it."></span>
                <span id="gScrap" data-explain="Moonshards: spend them at the wandering trader, shrines and wells."></span>
                <button type="button" class="g-piles" id="gPiles" aria-label="Your deck"></button>
            </div>
        </div>`;
    const deckbar = document.querySelector("#deck .deckbar");
    if (deckbar) deckbar.after(hud);
    const actionsBar = document.querySelector("#deck .actions");
    if (actionsBar) actionsBar.before(dock);
    const $ = id => document.getElementById(id);
    const portraitEl = $("gPortrait");
    const ICON = {
        mom: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6v2H9zM8 5h8l1 3H7zM7 9h10v10a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3zM12 12c-1.5 2-1.5 4 0 5 1.5-1 1.5-3 0-5z"/></svg>`,
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
    homeBtn.innerHTML = '<span class="g-legend-face" id="gLegendFace"></span><span class="g-legend-text"><b id="gLegendRank"></b><small class="g-legend-streak" id="gLegendStreak"></small><span class="g-legend-xp"><span id="gLegendXp"></span></span></span><span class="g-legend-lv" id="gLegendLv"></span>';
    const omenChip = h("p", "g-omen");
    const talesHead = h("h2", "g-tales-head", "Tales");
    const homeEl = document.getElementById("home");
    const packsEl = document.getElementById("packs");
    if (homeEl && packsEl) { packsEl.before(titleBlock, homeBtn, omenChip); packsEl.before(talesHead); }
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
    // Numbers tick up instead of jumping, with a small bump.
    const shown = {};
    function countUp(id, value) {
        const host = $(id), b = host.querySelector("b");
        const from = shown[id] === undefined ? value : shown[id];
        shown[id] = value;
        if (from === value || reduce) { b.textContent = String(value); return; }
        const t0 = performance.now();
        const step = now => {
            const k = Math.min(1, (now - t0) / 450);
            b.textContent = String(Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3))));
            if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        if (value > from) restartClass(host, "g-bump", 320);
    }
    function renderMe() {
        const L = levelOf(meta.xp);
        $("gLvl").textContent = String(L.level);
        $("gXpFill").style.setProperty("--xp", `${Math.round((L.into / L.need) * 360)}deg`);
        if (!$("gMom").querySelector("b")) $("gMom").innerHTML = `${ICON.mom}<b>0</b>`;
        countUp("gMom", run ? run.light : 0);
        $("gMom").title = `Light ${run ? run.light : 0} of ${run ? capOf() : 10}`;
        if (!$("gScrap").querySelector("b")) $("gScrap").innerHTML = `${ICON.shard}<b>0</b>`;
        countUp("gScrap", run ? run.scrap : 0);
        const hero = run && CLASSES[run.hero] ? run.hero : "seer";
        const face = $("gHeroFace");
        if (face.dataset.hero !== hero) {
            face.dataset.hero = hero;
            face.replaceChildren(h("span", "g-initial", CLASSES[hero].name[0]), liveArt("heroes", hero, "g-hero-img", CLASSES[hero].name));
        }
        if (run) $("gPiles").textContent = `Deck ${run.deck.length}`;
        $("gMe").setAttribute("aria-label", `${CLASSES[hero].name}, level ${L.level}. Your legend and settings`);
        $("gLegendRank").textContent = rankOf(L.level);
        const streak = streakOf(meta.nights || [], new Date());
        $("gLegendStreak").textContent = streak > 1 ? `${streak}-night streak` : streak === 1 ? "On the road tonight" : "";
        const om = OMENS[omenOf(dayKey(new Date()))];
        omenChip.replaceChildren(h("b", "", `Tonight's omen · ${om.name}`), h("span", "", om.text));
        $("gLegendLv").textContent = `Lv ${L.level}`;
        $("gLegendXp").style.width = `${(L.into / L.need) * 100}%`;
        homeBtn.setAttribute("aria-label", `Your legend: level ${L.level}, ${rankOf(L.level)}. Settings`);
        const lf = $("gLegendFace"), lh = CLASSES[meta.lastHero] ? meta.lastHero : "seer";
        if (lf.dataset.hero !== lh) { lf.dataset.hero = lh; lf.replaceChildren(h("span", "g-initial", CLASSES[lh].name[0]), liveArt("heroes", lh, "", "")); }
    }
    const rarity = def => def.unlock >= 4 ? "epic" : def.unlock >= 2 ? "rare" : "common";
    const gainText = (id, g) => (CARDS[id].on === "play" ? `Costs ${costOf(id, false, run ? run.relics : [], false)} Light` : [g.xp && `+${g.xp} XP`, g.light && `+${g.light} Light`, g.scrap && `+${g.scrap} shards`].filter(Boolean).join(" · "));
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
            pic.append(h("span", "g-initial", def.name[0]), cardArt(c.id));
            b.append(pic, h("span", "g-card-name", def.name));
            if (c.up) b.appendChild(h("span", "g-plus", "+"));
            const cost = def.on === "play" ? costNow(c) : null;
            if (cost !== null) {
                b.classList.add("g-active");
                if (run.light >= cost && run.foe) b.classList.add("g-ready");
                b.appendChild(h("span", "g-cost", String(cost)));
                dragToPlay(b, uid, () => run.light >= cost && Boolean(run.foe));
            }
            b.addEventListener("click", () => {
                if (b.dataset.dragged) return;
                const tip = $("gTip");
                const same = !tip.hidden && tip.dataset.uid === uid;
                tip.hidden = same;
                tip.dataset.uid = uid;
                const parts = [h("b", "", `${def.name}${c.up ? "+" : ""}`), h("span", "", def.text)];
                if (cost !== null) {
                    const play = h("button", "btn btn-primary g-play", run.light >= cost ? `Play · ${cost} Light` : `Need ${cost} Light (you have ${run.light})`);
                    play.type = "button";
                    play.disabled = run.light < cost || !run.foe;
                    play.addEventListener("click", ev => { ev.stopPropagation(); tip.hidden = true; playActive(uid); });
                    parts.push(play);
                } else parts.push(h("em", "", gainText(c.id, cardGain(c.id, c.up, run.relics))));
                tip.replaceChildren(...parts);
                sfx("ui");
            });
            hand.appendChild(b);
        }
        justDrawn.clear();
    }
    // Drag an active card up past the line to play it; it snaps back if you let go early or lack Light.
    function dragToPlay(b, uid, ready) {
        let s = null;
        b.addEventListener("pointerdown", e => { s = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }; b.setPointerCapture(e.pointerId); });
        b.addEventListener("pointermove", e => {
            if (!s || e.pointerId !== s.id) return;
            const dx = e.clientX - s.x, dy = Math.min(0, e.clientY - s.y);
            if (Math.abs(dx) > 6 || dy < -6) s.moved = true;
            if (!s.moved) return;
            b.classList.add("g-dragging");
            b.style.transform = `translate(${dx * 0.4}px, ${dy}px) rotate(${dx * 0.04}deg) scale(${1 + Math.min(0.18, -dy / 380)})`;
            b.classList.toggle("g-armed", dy < -70);
        });
        const end = e => {
            if (!s || e.pointerId !== s.id) return;
            const dy = e.clientY - s.y, moved = s.moved;
            s = null;
            b.classList.remove("g-dragging", "g-armed");
            b.style.transform = "";
            if (!moved) return;
            b.dataset.dragged = "1";
            setTimeout(() => { delete b.dataset.dragged; }, 60);
            if (dy > -70) return;
            if (ready()) { haptic(HAPTIC.card); playActive(uid); }
            else { haptic(HAPTIC.nope); restartClass(b, "g-nope", 320); floatAt(b, "Need more Light", "g-f-muted"); }
        };
        b.addEventListener("pointerup", end);
        b.addEventListener("pointercancel", end);
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
            const sp = speciesAt(gid, type);
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
        const tr = traitHere(gid);
        $("gFoeSub").textContent = [top.group.title, tr && TRAITS[tr].name].filter(Boolean).join(" · ");
        $("gFoeSub").title = tr ? `${TRAITS[tr].name}: ${TRAITS[tr].text}` : "";
        if (tr) $("gFoeSub").dataset.explain = `${TRAITS[tr].name}: ${TRAITS[tr].text}`; else delete $("gFoeSub").dataset.explain;
        renderLife(gid, ctx.cards.filter(c => String(c.group.groupId) === gid));
        renderHand();
        renderBounty();
        renderWager();
        const act = actOf(gid);
        for (let a = 2; a <= 5; a++) hud.classList.toggle(`g-act${a}`, act === a);
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
        meta.seenCards = meta.seenCards || {};
        if (!meta.seenCards[id]) { meta.seenCards[id] = 1; saveMeta(); }
        b.type = "button";
        const pic = h("span", "g-big-art");
        pic.append(h("span", "g-initial", def.name[0]), cardArt(id));
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
        const om = run.omen && OMENS[run.omen];
        body.append(h("p", "g-lore", text), ...(om ? [h("p", "g-omen", `Tonight's omen · ${om.name}: ${om.text}`)] : []), heroes, routeEl(),
            h("p", "g-fine", "Every verdict strikes the same blow, whatever you choose. Cards reward looking closely: flipping photos, zooming, reading details, checking values. Choose what's true."));
        panel({ kicker: "A new tale begins", title: ctx.pack.title || "The Expedition", body, actions: [{ label: "Begin", primary: true, onClick: () => {
            audio(); mood();
            // The hand was dealt before the class was chosen; deal it again from the chosen deck.
            if (!run.played && !Object.keys(run.scored).length) {
                run.draw = shuffle(Math.random, run.deck.map(c => c.uid));
                run.discard = []; run.hand = []; run.foe = null;
                sync();
            }
            queuePath();
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
        const choices = rewardChoices(Math.random, level(), nodeType(gid) === "elite" && run.relics.includes("map") ? 4 : 3, run.hero);
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
            b.addEventListener("click", () => { c.up = true; upgraded(); saveRun(); nextOverlay(); });
            row.appendChild(b);
        }
        body.append(h("p", "g-lore", plain.length ? "Sharpen one card (+50%), or sit by the fire for a while." : "All your cards are sharp. Sit by the fire for a while."), row);
        panel({ kicker: "Campfire", title: "Rest under the trees", body, actions: [{ label: "Rest (+30 XP)", onClick: () => grant(30, homeBtn) }] });
        moodOverride = "camp"; mood();
        say(line("camp_1"));
    }
    function shopOverlay() {
        const off = run.relics.includes("scale") ? 0.75 : 1;
        const prices = { card: Math.round(12 * off), relic: Math.round(35 * off), remove: Math.round(15 * off) };
        const stock = { cards: rewardChoices(Math.random, level(), 3, run.hero), relic: shuffle(Math.random, Object.keys(RELICS).filter(id => !run.relics.includes(id)))[0] || null, removed: false };
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
                    b.addEventListener("click", () => { run.scrap -= prices.remove; removeCard(run, c.uid); burned(); stock.removed = true; saveRun(); sfx("burn"); say(line("burn_1")); draw(); });
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
    // Mystery stops: small stories with a trade-off.
    const MYSTERIES = [
        { id: "lantern", title: "A lost lantern", lore: "A lantern sits on a car roof, still burning. Someone will come back for it. Probably.",
            options: [{ label: "Take it (+3 Light)", go: () => earnLight(3) }, { label: "Leave it for its owner (+20 XP)", go: () => grant(20, homeBtn) }] },
        { id: "well", title: "The moon well", lore: "Water in an old wheel rim holds the whole moon. It tastes of iron and silver.",
            options: [{ label: "Drink (upgrade 2 random cards, lose 10 shards)", need: 10, go: () => { run.scrap -= 10; shuffle(Math.random, run.deck.filter(c => !c.up)).slice(0, 2).forEach(c => { c.up = true; upgraded(); }); } },
                { label: "Fill a flask (+2 Light)", go: () => earnLight(2) }] },
        { id: "tinker", title: "A tinker's offer", lore: "A tinker in a long coat taps your deck. That one is dull, they say. I have better.",
            options: [{ label: "Trade a common card for a rarer one", go: () => {
                const common = run.deck.filter(c => CARDS[c.id].unlock <= 1);
                const better = Object.keys(CARDS).filter(id => CARDS[id].unlock >= 2 && CARDS[id].unlock <= Math.max(2, level()));
                if (common.length > 3 && better.length) { removeCard(run, pick(Math.random, common).uid); addCard(run, pick(Math.random, better), false); }
                else run.scrap += 10;
            } }, { label: "Decline politely (+10 shards)", go: () => { run.scrap += 10; } }] },
        { id: "shrine", title: "A whispering shrine", lore: "Bolts and keys hang from a dead tree like bells. They whisper when the wind is right.",
            options: [{ label: "Leave an offering (15 shards for a relic)", need: 15, go: () => { run.scrap -= 15; const left = Object.keys(RELICS).filter(r => !run.relics.includes(r)); if (left.length) run.relics.push(pick(Math.random, left)); } },
                { label: "Walk on (+15 XP)", go: () => grant(15, homeBtn) }] },
        { id: "star", title: "A fallen star", lore: "Something small and bright smoulders in a puddle between two cars.",
            options: [{ label: "Pocket it (+12 shards)", go: () => { run.scrap += 12; } },
                { label: "Make a wish (a new card, already sharpened)", go: () => addCard(run, pick(Math.random, rewardChoices(Math.random, level(), 6, run.hero)), true) }] }
    ];
    function mysteryOverlay() {
        run.seenMyst = run.seenMyst || [];
        const pool = MYSTERIES.filter(m => !run.seenMyst.includes(m.id));
        const m = pick(Math.random, pool.length ? pool : MYSTERIES);
        run.seenMyst.push(m.id);
        saveRun();
        const body = h("div", "g-body");
        body.appendChild(h("p", "g-lore", m.lore));
        const row = h("div", "g-choices");
        for (const o of m.options) {
            const b = h("button", "g-choice", o.label);
            b.type = "button";
            b.disabled = Boolean(o.need && run.scrap < o.need);
            b.addEventListener("click", () => { sfx("confirm"); o.go(); saveRun(); renderHud(); nextOverlay(); });
            row.appendChild(b);
        }
        body.appendChild(row);
        panel({ kicker: "On the road", title: m.title, body, actions: [] });
        sfx("page");
    }
    function eventOverlay(type) { run.eventsSeen = (run.eventsSeen || 0) + 1; moment("event"); (type === "camp" ? campOverlay : type === "shop" ? shopOverlay : type === "mystery" ? mysteryOverlay : cacheOverlay)(); }
    function summaryOverlay() {
        const L = levelOf(meta.xp);
        const foes = Object.keys(run.defeated).length;
        const body = h("div", "g-body");
        const dl = h("dl", "g-stats");
        for (const [k, v] of [["Foes vanquished", foes], ["XP earned", run.xp], ["Looked closely", `${run.close} of ${run.items} verdicts`], ["Deck", `${run.deck.length} cards`], ["Relics", run.relics.map(id => RELICS[id].name).join(", ") || "none"], ["Rank", `Lv ${L.level} ${rankOf(L.level)}`]]) dl.append(h("dt", "", k), h("dd", "", String(v)));
        const grade = gradeOf(run.close, run.items);
        meta.best = meta.best && "SABC".indexOf(meta.best) <= "SABC".indexOf(grade) ? meta.best : grade;
        saveMeta();
        const gradeEl = h("div", `g-grade g-grade-${grade}`);
        gradeEl.append(h("b", "", grade), h("span", "", grade === "S" ? "Not a thing slipped past you." : grade === "A" ? "A careful night's work." : grade === "B" ? "Good. Look a little closer next time." : "The moon saw more than you did."));
        const spoken = line(grade === "S" ? "grade_s" : "end");
        award("tale");
        if (grade === "S") award("sgrade");
        if (run.relics.length >= 4) award("collector");
        meta.classesDone = meta.classesDone || {};
        meta.classesDone[run.hero || "seer"] = 1;
        if (Object.keys(meta.classesDone).length >= 3) award("paths");
        saveMeta();
        const text = spoken.en;
        body.append(gradeEl, h("p", "g-lore", text), dl);
        setTimeout(() => sfx("rank"), 400);
        moodOverride = "title"; mood();
        panel({ kicker: "The tale is told", title: ctx.pack.title || "Expedition complete", body,
            actions: [{ label: "Share", onClick: () => { shareCard(grade, foes); return false; } }, { label: "Onward", primary: true }] });
        say(spoken, true);
        sfx("victory");
        if (!reduce) for (let i = 0; i < 4; i++) setTimeout(() => burst(root.innerWidth * (0.2 + Math.random() * 0.6), root.innerHeight * 0.3, { n: 40, colors: ["#e6dcc6", "#9aa3a8", "#2f4f57", "#e0a243"], speed: 6 }), i * 250);
    }
    // A picture of tonight's tale to share: art, grade, foes, hero, date.
    async function shareCard(grade, foes) {
        const W = 1080, H = 1350, cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        const g = cv.getContext("2d");
        const img = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
        try { await document.fonts.ready; } catch (_) { /* system fonts */ }
        g.fillStyle = "#1b2238"; g.fillRect(0, 0, W, H);
        const bg = await img(`${ART}bg/title.webp`);
        if (bg) g.drawImage(bg, 0, -260, W, W * bg.height / bg.width);
        const fade = g.createLinearGradient(0, 520, 0, 980);
        fade.addColorStop(0, "rgba(27,34,56,0)"); fade.addColorStop(1, "#1b2238");
        g.fillStyle = fade; g.fillRect(0, 0, W, H);
        g.textAlign = "center"; g.fillStyle = "#9aa3a8";
        g.font = "700 30px Figtree, sans-serif"; g.fillText("A  V I N D E R  T A L E", W / 2, 110);
        g.fillStyle = "#e6dcc6"; g.font = "900 120px Fraunces, Georgia, serif"; g.fillText("Pale Moon", W / 2, 230);
        const hero = await img(`${ART}heroes/${run.hero || "seer"}.webp`);
        if (hero) { g.save(); g.beginPath(); g.arc(W / 2, 760, 120, 0, Math.PI * 2); g.fillStyle = "#2f4f57"; g.fill(); g.clip(); g.drawImage(hero, W / 2 - 120, 640, 240, 240); g.restore(); }
        g.fillStyle = grade === "S" ? (getComputedStyle(document.body).getPropertyValue("--amber").trim() || "#e0a243") : "#e6dcc6";
        g.font = "900 260px Fraunces, Georgia, serif"; g.fillText(grade, W / 2, 1100);
        g.fillStyle = "#e6dcc6"; g.font = "800 52px Fraunces, Georgia, serif"; g.fillText(ctx.pack.title || "A night on the road", W / 2, 1180);
        g.fillStyle = "#9aa3a8"; g.font = "600 34px Figtree, sans-serif";
        g.fillText(`${foes} foes · ${run.xp} XP · ${CLASSES[run.hero || "seer"].name} · Lv ${level()}`, W / 2, 1236);
        g.fillText(new Date().toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" }), W / 2, 1290);
        const blob = await new Promise(res => cv.toBlob(res, "image/png"));
        if (!blob) return;
        const file = new File([blob], "pale-moon-tale.png", { type: "image/png" });
        try {
            if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Pale Moon" }); return; }
        } catch (e) { if (e && e.name === "AbortError") return; }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = file.name;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }
    function pilesOverlay() {
        const body = h("div", "g-body");
        const pile = (title, uids, note) => {
            body.appendChild(h("h3", "g-h3", `${title} · ${uids.length}`));
            if (note) body.appendChild(h("p", "g-fine", note));
            const row = h("div", "g-pile");
            const cards = uids.map(cardOf).filter(Boolean);
            if (title === "Draw pile") cards.sort((a, b) => CARDS[a.id].name.localeCompare(CARDS[b.id].name));
            for (const c of cards) {
                const t = h("div", `g-mini g-${rarity(CARDS[c.id])}`);
                const pic = h("span", "g-card-art");
                pic.append(h("span", "g-initial", CARDS[c.id].name[0]), cardArt(c.id));
                t.append(pic, h("b", "", `${CARDS[c.id].name}${c.up ? "+" : ""}`), h("small", "", CARDS[c.id].text));
                row.appendChild(t);
            }
            if (!cards.length) row.appendChild(h("p", "g-fine", "Empty"));
            body.appendChild(row);
        };
        pile("In hand", run.hand);
        pile("Draw pile", run.draw, "Shown in name order, so the order you draw stays a surprise.");
        pile("Discard pile", run.discard, "Shuffled back into the draw pile when it runs out.");
        panel({ kicker: "Your deck", title: `${run.deck.length} cards`, body, wide: true, actions: [{ label: "Close", primary: true }] });
    }
    function compendiumOverlay() {
        meta.seenCards = meta.seenCards || {};
        const body = h("div", "g-body");
        const ids = Object.keys(CARDS), seen = ids.filter(id => meta.seenCards[id] || CARDS[id].unlock <= level());
        body.appendChild(h("p", "g-lore", `${seen.length} of ${ids.length} cards known · ${Object.keys(RELICS).length} relics`));
        // One family at a time: your hero first, then any other, or the cards every hero shares.
        const fams = [...Object.keys(CLASSES), "shared"];
        let cur = CLASSES[meta.lastHero] ? meta.lastHero : "seer";
        const tabs = h("div", "g-chip-row g-fam-tabs");
        tabs.setAttribute("role", "tablist");
        const grid = h("div", "g-pile");
        const fill = () => {
            tabs.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.fam === cur)));
            grid.replaceChildren(...ids.filter(id => (CARDS[id].hero || "shared") === cur).sort((a, b) => CARDS[a].unlock - CARDS[b].unlock).map(tile));
        };
        for (const f of fams) {
            const n = ids.filter(id => (CARDS[id].hero || "shared") === f);
            const b = h("button", "g-chip-btn", `${f === "shared" ? "Shared" : CLASSES[f].name} ${n.filter(id => seen.includes(id)).length}/${n.length}`);
            b.type = "button"; b.dataset.fam = f; b.setAttribute("role", "tab");
            b.addEventListener("click", () => { sfx("ui"); cur = f; fill(); });
            tabs.appendChild(b);
        }
        body.appendChild(tabs);
        function tile(id) {
            const known = seen.includes(id), def = CARDS[id];
            const t = h("div", `g-mini g-${rarity(def)}${known ? "" : " locked"}`);
            const pic = h("span", "g-card-art");
            if (known) pic.append(h("span", "g-initial", def.name[0]), cardArt(id));
            t.append(pic, h("b", "", known ? def.name : "???"), h("small", "", known ? def.text : `Unlocks at Lv ${def.unlock}`));
            if (known) t.appendChild(h("em", "", FLAVOR[id] || ""));
            return t;
        }
        fill();
        body.appendChild(grid);
        body.appendChild(h("h3", "g-h3", "Relics"));
        const rel = h("div", "g-pile");
        for (const [id, r] of Object.entries(RELICS)) {
            const t = h("div", "g-mini");
            const pic = h("span", "g-card-art");
            pic.append(h("span", "g-initial", r.name[0]), art(`ui/relic-${id}`, "", ""));
            t.append(pic, h("b", "", r.name), h("small", "", r.text));
            rel.appendChild(t);
        }
        body.appendChild(rel);
        panel({ kicker: "Compendium", title: "Cards and relics", body, wide: true, actions: [{ label: "Close", primary: true }] });
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
        body.appendChild(h("h3", "g-h3", "Card collection"));
        const all = Object.values(CARDS), open = all.filter(d => d.unlock <= L.level).length, next = all.filter(d => d.unlock === L.level + 1).length;
        body.appendChild(h("p", "g-lore", `${open} of ${all.length} cards unlocked${next ? ` · ${next} more at Lv ${L.level + 1}` : ""}. Open the Compendium to browse them.`));
        // Bestiary: every kind of Defect you have vanquished.
        body.appendChild(h("h3", "g-h3", "Bestiary"));
        const best = h("div", "g-bestiary");
        for (const [id, name] of REGIONS.flatMap(R => [...R.species, R.boss])) {
            const n = (meta.bestiary || {})[id] || 0;
            const tile = h("div", `g-beast${n ? "" : " unseen"}`);
            const pic = h("span", "g-beast-art");
            pic.appendChild(art(`foes/${id}`, "", ""));
            tile.append(pic, h("b", "", n ? name : "???"), h("small", "", n ? `× ${n}` : "Not yet met"));
            best.appendChild(tile);
        }
        body.appendChild(best);
        body.appendChild(h("h3", "g-h3", `Achievements ${Object.keys(meta.achv || {}).length} / ${Object.keys(ACHIEVEMENTS).length}`));
        const ach = h("div", "g-achievements");
        for (const [id, a] of Object.entries(ACHIEVEMENTS)) {
            const got = Boolean((meta.achv || {})[id]);
            const row = h("div", `g-ach${got ? "" : " locked"}`);
            row.append(h("b", "", a.name), h("small", "", a.text));
            ach.appendChild(row);
        }
        body.appendChild(ach);
        panel({ kicker: "Your legend", title: `Lv ${L.level} ${rankOf(L.level)}`, body, wide: true,
            actions: [{ label: "Compendium", onClick: () => { queue.unshift(compendiumOverlay); } }, { label: "Settings", onClick: () => { queue.unshift(settingsOverlay); } }, { label: "Close", primary: true }] });
    }
    function settingsOverlay() {
        const body = h("div", "g-body");
        const section = title => { const s = h("div", "g-opts"); body.append(h("h3", "g-h3", title), s); return s; };
        const toggle = (box, key, label, after) => {
            const l = h("label", "g-opt");
            const i = h("input");
            i.type = "checkbox"; i.checked = Boolean(meta[key]);
            i.addEventListener("change", () => { meta[key] = i.checked; saveMeta(); apply(); if (after) after(); });
            l.append(i, h("span", "", label));
            box.appendChild(l);
        };
        const choose = (box, key, label, options, after) => {
            const l = h("label", "g-opt g-vol");
            const sel = h("select", "g-select");
            for (const [v, t] of options) { const o = h("option", "", t); o.value = v; o.selected = meta[key] === v; sel.appendChild(o); }
            sel.addEventListener("change", () => { meta[key] = sel.value; saveMeta(); apply(); if (after) after(); });
            l.append(h("span", "", label), sel);
            box.appendChild(l);
        };
        const slider = (box, key, label, onSet) => {
            const vl = h("label", "g-opt g-vol");
            const vi = h("input");
            vi.type = "range"; vi.min = "0"; vi.max = "1"; vi.step = "0.05"; vi.value = String(meta[key]);
            vi.addEventListener("input", () => { meta[key] = Number(vi.value); levels(); saveMeta(); });
            if (onSet) vi.addEventListener("change", onSet);
            vl.append(h("span", "", label), vi);
            box.appendChild(vl);
        };
        const sound = section("Sound");
        toggle(sound, "mute", "Mute everything");
        toggle(sound, "music", "Music");
        toggle(sound, "sfx", "Sound effects");
        toggle(sound, "voice", "Narrator voice (Yui)");
        choose(sound, "subs", "Subtitles", [["ja", "Japanese, tap for English"], ["en", "English, tap for Japanese"], ["off", "Off"]], () => say(line("welcome_back"), true));
        slider(sound, "vol", "Master");
        slider(sound, "musicVol", "Music");
        slider(sound, "sfxVol", "Effects", () => sfx("hit"));
        slider(sound, "voiceVol", "Narrator");
        const comfort = section("Comfort");
        choose(comfort, "textSize", "Text size", [["s", "Small"], ["m", "Medium"], ["l", "Large"], ["xl", "Extra large"]]);
        toggle(comfort, "haptics", "Vibration", () => haptic(HAPTIC.pick));
        toggle(comfort, "reduceMotion", "Reduce motion");
        toggle(comfort, "cb", "Colour-blind verdict colours");
        const looks = section("Lantern colour");
        const swatches = h("div", "g-swatches");
        for (const [id, lc] of Object.entries(LANTERNS)) {
            const open = lc.need(meta);
            const b = h("button", `g-swatch${(meta.lantern || "amber") === id ? " on" : ""}`);
            b.type = "button";
            b.disabled = !open;
            b.style.setProperty("--sw", lc.c);
            b.append(h("i"), h("span", "", open ? lc.name : lc.how));
            b.addEventListener("click", () => { meta.lantern = id; saveMeta(); apply(); swatches.querySelectorAll(".g-swatch").forEach(x => x.classList.toggle("on", x === b)); haptic(HAPTIC.pick); });
            swatches.appendChild(b);
        }
        looks.appendChild(swatches);
        const game = section("Game");
        toggle(game, "on", "Pale Moon game mode");
        const replay = h("button", "g-chip-btn", "Replay the tutorial with Yui");
        replay.type = "button";
        replay.addEventListener("click", () => { meta.tutorialDone = false; saveMeta(); nextOverlay(); if (screen === "deck") maybeTutorial(); });
        game.appendChild(replay);
        panel({ kicker: "Settings", title: "Make it yours", body, wide: true, actions: [{ label: "Done", primary: true }] });
    }
    overlay.addEventListener("keydown", e => {
        if (e.key !== "Escape") return;
        const btns = overlay.querySelectorAll(".g-actions .btn");
        if (btns.length) btns[btns.length - 1].click();
    });

    // ---------- game flow ----------
    function apply() {
        document.body.classList.toggle("game-on", meta.on);
        reduce = systemReduce || Boolean(meta.reduceMotion);
        document.body.classList.toggle("g-reduce", reduce);
        document.body.classList.toggle("g-cb", Boolean(meta.cb));
        const lc = LANTERNS[meta.lantern] && LANTERNS[meta.lantern].need(meta) ? LANTERNS[meta.lantern] : LANTERNS.amber;
        document.body.style.setProperty("--amber", lc.c);
        document.body.style.setProperty("--amber-deep", lc.d);
        for (const s of ["s", "m", "l", "xl"]) document.body.classList.toggle(`g-ts-${s}`, meta.textSize === s);
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
        if (lvl >= 10) award("warden10");
        sfx("level");
        haptic(HAPTIC.level);
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
    function payBounty(kind) {
        if (!item || item.paid || run.scored[item.key] || item.bounty !== kind) return;
        item.paid = true;
        if (kind === "zoom") earnLight(2);
        if (run.relics.includes("bell")) earnLight(2);
        if (kind === "details") { run.scrap += 8; floatAt($("gScrap"), "+8 shards", "g-f-xp"); }
        if (kind === "every") grant(15, portraitEl);
        floatAt($("gBounty"), "Bounty!", "g-f-xp");
        sfx("coin");
        haptic(HAPTIC.pick);
        renderBounty();
        saveRun();
    }
    function renderWager() {
        const el = $("gWager");
        if (!el || !run) return;
        const w = run.wager && run.wager.gid === run.foe ? run.wager : null;
        const canStake = !w && run.first && run.scrap >= 5 && run.foe && topCard();
        el.hidden = !(w || canStake);
        el.className = `g-wager${w ? (w.broken ? " lost" : " on") : ""}`;
        el.disabled = Boolean(w);
        el.textContent = w ? (w.broken ? "Wager lost" : `Wager ${w.stake} · look closely at every item`) : `Wager ${Math.min(10, run.scrap)} shards`;
        el.dataset.explain = "Stake shards that you will look closely at every item on this foe (see every photo, zoom in, or read the details). Do it and win double plus 20 XP; miss once and the stake is lost. Which verdict you choose never matters.";
    }
    function renderBounty() {
        const el = $("gBounty");
        if (!el) return;
        if (!item || !item.bounty || !meta.on) { el.hidden = true; return; }
        const b = BOUNTIES[item.bounty];
        el.hidden = false;
        el.classList.toggle("done", Boolean(item.paid));
        el.replaceChildren(h("b", "", item.paid ? "Bounty claimed" : `Bounty: ${b.text}`), h("span", "", b.reward));
        el.dataset.explain = "Each item shows one bounty before you decide. Do it before your verdict to claim the reward. Verdicts are never part of a bounty.";
    }
    function earnLight(n) {
        if (!n || !run) return;
        const before = run.light;
        if (before + n > capOf() && item && !run.scored[item.key]) { const ox = trigger("overflow", {}); if (ox) grant(ox, portraitEl); }
        run.light = Math.min(capOf(), run.light + n);
        if (run.light >= 10) award("lamp");
        if (run.light > before) {
            floatAt($("gMom"), `+${run.light - before} Light`, "g-f-light");
            haptic(HAPTIC.light);
            if (run.light >= 5 && before < 5 && Math.random() < 0.5) say(line("momentum_1"));
        }
        renderMe();
        renderHand();
    }
    function ctxT(extra) {
        const g = run.foe, type = g ? nodeType(g) : "foe";
        return Object.assign({
            seen: item ? item.seen.size : 0, total: item ? item.total : 0, zoom: Boolean(item && item.lit.has("viewer")),
            details: Boolean(item && item.lit.has("details")), ai: Boolean(item && item.lit.has("ai")), checks: item ? item.checks : 0,
            elite: type === "elite" || type === "boss", boss: type === "boss", wager: Boolean(run.wager && run.wager.gid === g && !run.wager.broken),
            scrap: run.scrap, light: run.light, played: run.played, photoFired: run.photoFired || 0, firstOfFoe: run.first, last: false, wasLater: false,
            ups: run.deck.filter(c => c.up).length, deck: run.deck.length, act: g ? actOf(g) : 1, defeats: run.defeats || 0,
            burned: run.burned || 0, events: run.eventsSeen || 0, paths: run.paths || 0
        }, extra || {});
    }
    // Moments outside the item: these fire from hand like a verdict does.
    function moment(kind) { const x = trigger(kind, ctxT()); if (x) grant(x, portraitEl); }
    const ITEM_KINDS = new Set(["viewer", "details", "check", "ai"]);
    // Fires matching cards in hand. Item-based kinds fire once per item, and never on an item already scored.
    function trigger(kind, t) {
        t = t || ctxT();
        let xp = 0;
        const tr = run.foe ? traitHere(run.foe) : null;
        for (const uid of run.hand.slice()) {
            const c = cardOf(uid);
            if (!c) continue;
            const def = CARDS[c.id];
            if (def.on !== kind || (def.test && !def.test(t))) continue;
            if (ITEM_KINDS.has(kind)) {
                if (!item || run.scored[item.key] || item.fired.has(kind)) continue;
                item.fired.add(kind);
            }
            const g = cardGain(c.id, c.up, run.relics);
            let gx = tr === "armored" ? Math.round(g.xp * 0.75) : g.xp;
            if (run.omen === "owl" && PHOTO_CARDS.has(c.id)) gx = Math.round(gx * 1.25);
            if (run.relics.includes("mirror") && run.mirrorUsed !== run.foe && gx) { gx *= 2; run.mirrorUsed = run.foe; }
            if (PHOTO_CARDS.has(c.id)) run.photoFired = (run.photoFired || 0) + 1;
            if (run.relics.includes("quill") && INK_CARDS.has(c.id)) earnLight(1);
            const chance = (run.relics.includes("bolt") ? 0.2 : 0) + (tr === "brittle" ? 0.25 : 0);
            const crit = Boolean(gx) && (run.nextCrit || Math.random() < chance);
            if (crit) { gx *= 2; run.nextCrit = false; }
            xp += gx;
            run.scrap += g.scrap;
            if (g.scrap) sfx("coin");
            run.lastFired = { id: c.id, up: c.up };
            flyCard(uid, crit);
            playCard(run, uid, Math.random).forEach(u => justDrawn.add(u));
            if (g.light) earnLight(g.light);
            if (t) t.played = run.played;
        }
        return xp;
    }
    // Active cards: tap, pay Light, get the effect. Nothing here touches a verdict.
    function playActive(uid) {
        const c = cardOf(uid);
        if (!c || !run.foe) return;
        const sealReady = run.sealUsed !== run.foe;
        const cost = costNow(c);
        if (run.light < cost) return;
        run.light -= cost;
        if (run.relics.includes("seal") && sealReady) run.sealUsed = run.foe;
        if (run.omen === "kind") run.kindUsed = run.foe;
        if (stat("actives") >= 20) award("sharp");
        const more = c.up ? 1.5 : 1;
        runFx(CARDS[c.id].fx || {}, more, uid);
        if (run.relics.includes("kiln") && (CARDS[c.id].cost || 0) >= 3) grant(10, portraitEl);
        flyCard(uid, false);
        run.hand = run.hand.filter(u => u !== uid);
        run.discard.push(uid);
        run.played++;
        const kx = trigger("active", ctxT());
        if (kx) grant(kx, portraitEl);
        refillHand(run, Math.random).forEach(u => justDrawn.add(u));
        saveRun();
        renderHud();
    }
    const upgradeRandom = (n, not) => {
        const plain = shuffle(Math.random, run.deck.filter(x => !x.up && x.uid !== not)).slice(0, n);
        plain.forEach(x => { x.up = true; floatAt(portraitEl, `${CARDS[x.id].name}+`, "g-f-xp"); upgraded(); });
    };
    function upgraded() { sfx("upgrade"); moment("upgrade"); }
    function burned() { run.burned = (run.burned || 0) + 1; moment("burn"); }
    function runFx(fx, more, uid) {
        const n = v => Math.round(v * more);
        if (fx.xp) grant(n(fx.xp), portraitEl);
        if (fx.scrap) { run.scrap += n(fx.scrap); sfx("coin"); floatAt($("gScrap"), `+${n(fx.scrap)} shards`, "g-f-xp"); }
        if (fx.light) earnLight(n(fx.light));
        for (let i = 0; i < (fx.draw || 0); i++) { const u = drawOne(run, Math.random); if (u) justDrawn.add(u); }
        if (fx.crit) { run.nextCrit = true; floatAt(portraitEl, "Next card crits", "g-f-xp"); }
        if (fx.double) { run.double = run.foe; floatAt(portraitEl, "Loot ×2", "g-f-xp"); }
        if (fx.prey) { run.prey = run.foe; floatAt(portraitEl, "Marked", "g-f-xp"); }
        if (fx.bind) { run.bound = run.foe; floatAt(portraitEl, "Trait broken", "g-f-xp"); }
        if (fx.upgrade) upgradeRandom(n(fx.upgrade), uid);
        if (fx.per) {
            const [key, k] = fx.per;
            const base = { seen: item ? item.seen.size : 0, checks: item ? item.checks : 0, ups: run.deck.filter(x => x.up).length, scrap: Math.floor(run.scrap / 10),
                defeats: run.defeats || 0, burned: run.burned || 0, events: run.eventsSeen || 0, paths: run.paths || 0, played: run.played,
                photoFired: run.photoFired || 0, light: run.light }[key] || 0;
            if (base) grant(n(base * k), portraitEl);
        }
        if (fx.echo && run.lastFired) {
            const g = cardGain(run.lastFired.id, run.lastFired.up, run.relics);
            for (let i = 0; i < fx.echo; i++) { if (g.xp) grant(g.xp, portraitEl); if (g.scrap) run.scrap += g.scrap; if (g.light) earnLight(g.light); }
        }
        if (fx.forge) {
            const other = shuffle(Math.random, run.hand.filter(u => u !== uid).map(cardOf).filter(x => x && CARDS[x.id].unlock <= 1));
            const rare = Object.keys(CARDS).filter(id => CARDS[id].unlock >= 2 && CARDS[id].unlock <= Math.max(2, level()) && CARDS[id].on !== "play" && (!CARDS[id].hero || CARDS[id].hero === run.hero));
            if (other[0] && rare.length) { other[0].id = pick(Math.random, rare); floatAt(portraitEl, `→ ${CARDS[other[0].id].name}`, "g-f-xp"); }
        }
        if (fx.burn) {
            const other = run.hand.filter(u => u !== uid);
            if (other.length) {
                const victim = cardOf(other[other.length - 1]);
                removeCard(run, victim.uid);
                if (fx.burn.scrap) run.scrap += n(fx.burn.scrap);
                if (fx.burn.light) earnLight(n(fx.burn.light));
                if (fx.burn.xp) grant(n(fx.burn.xp), portraitEl);
                floatAt($("gScrap"), `Burned ${CARDS[victim.id].name}`, "g-f-xp"); sfx("burn");
                burned();
            }
        }
        if (fx.wager && !(run.wager && run.wager.gid === run.foe)) {
            run.wager = { gid: run.foe, stake: n(fx.wager), broken: false };
            floatAt($("gWager"), `Staked ${n(fx.wager)}`, "g-f-xp"); moment("wager");
        }
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
        if (crit) { setTimeout(() => floatAt(portraitEl, "CRIT!", "g-f-crit"), 430); say(line("crit_1")); haptic(HAPTIC.crit); }
        else { haptic(HAPTIC.card); if (Math.random() < 0.12) say(line("card")); }
    }
    // Play the foe’s flinch clip once, then go back to its idle loop.
    function hurtAnim() {
        const img = portraitEl.querySelector(".g-foe-img");
        const gid = portraitEl.dataset.gid;
        if (!img || !gid || portraitEl.querySelector(".g-hurt-img") || !listed(`foes/hurt/${speciesAt(gid, nodeType(gid)).id}`)) return;
        // A fresh element always starts the clip from its first frame.
        const hurt = h("img", "g-foe-img g-hurt-img");
        hurt.alt = img.alt;
        let done = false;
        const back = () => { if (done) return; done = true; if (hurt.isConnected) hurt.replaceWith(img); };
        hurt.onerror = back;
        hurt.onload = () => { if (!done && img.isConnected) img.replaceWith(hurt); };
        hurt.src = `${ART}foes/hurt/${speciesAt(gid, nodeType(gid)).id}.webp`;
        setTimeout(back, 1700);
    }
    function strikeFx(color) {
        const c = center(portraitEl);
        floatAt(portraitEl, "−1", "g-f-dmg");
        if (reduce) return;
        portraitEl.classList.add("g-blanch");
        setTimeout(() => {
            portraitEl.classList.remove("g-blanch");
            restartClass(portraitEl, "g-hurt", 300);
            hurtAnim();
            restartClass(hud, "g-shake", 200);
            burst(c.x, c.y, { n: 22, colors: [color, "#e6dcc6", "#9aa3a8"], speed: 6 });
        }, 60);
    }
    function startFoe(group) {
        const gid = String(group.groupId);
        if (run.foe && run.foe !== gid && run.lastAction === "later" && !run.defeated[run.foe] && groupById(run.foe)) say(line("retreat_1"));
        run.foe = gid;
        run.played = 0;
        run.photoFired = 0;
        earnLight((run.relics.includes("lamp") ? 2 : 0) + (run.relics.includes("owl") ? 1 : 0) + (run.omen === "clear" ? 1 : 0));
        run.first = true;
        discardHand(run);
        refillHand(run, Math.random).forEach(u => justDrawn.add(u));
        const act = actOf(gid);
        run.actsSeen = run.actsSeen || {};
        if (act >= 2 && !run.actsSeen[act]) {
            run.actsSeen[act] = 1;
            const R = REGIONS[act - 1];
            enqueue(() => {
                const body = h("div", "g-body");
                body.append(h("p", "g-lore", R.lore));
                panel({ kicker: `Act ${["I", "II", "III", "IV", "V"][act - 1]}`, title: R.name, body, actions: [{ label: "Walk on", primary: true }] });
                sfx("boss");
            });
        }
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
    // First-run tutorial: Yui points at each part of the battle screen. Replay from Settings.
    const TUTORIAL = [["#gHud", "tut_1"], ["#stack", "tut_2"], ["#gHand", "tut_3"], ["#deck .actions", "tut_4"], ["#gStrip", "tut_5"]];
    let coaching = false;
    function maybeTutorial() {
        if (meta.tutorialDone || coaching || screen !== "deck" || !meta.on || !topCard()) return;
        coaching = true;
        enqueue(coach);
    }
    function coach() {
        const layer = h("div", "g-coach");
        const spot = h("div", "g-coach-spot");
        const bubble = h("div", "g-coach-bubble");
        bubble.setAttribute("role", "dialog");
        bubble.setAttribute("aria-live", "polite");
        layer.append(spot, bubble);
        document.body.appendChild(layer);
        document.body.classList.add("g-modal");
        let i = 0;
        const finish = () => { layer.remove(); meta.tutorialDone = true; saveMeta(); coaching = false; nextOverlay(); };
        const show = () => {
            const [sel, id] = TUTORIAL[i];
            const target = document.querySelector(sel);
            const l = line(id);
            if (!target || !l) { if (++i < TUTORIAL.length) show(); else finish(); return; }
            const r = target.getBoundingClientRect(), pad = 6;
            Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
            const below = r.bottom + 190 < root.innerHeight;
            bubble.style.top = below ? `${r.bottom + 14}px` : "";
            bubble.style.bottom = below ? "" : `${root.innerHeight - r.top + 14}px`;
            const next = h("button", "btn btn-primary", i === TUTORIAL.length - 1 ? "Let's go" : "Next");
            next.type = "button";
            next.addEventListener("click", () => { sfx("ui"); if (++i < TUTORIAL.length) show(); else finish(); });
            const skip = h("button", "g-coach-skip", "Skip");
            skip.type = "button";
            skip.addEventListener("click", finish);
            const ja = h("p", "g-coach-ja g-ja", l.ja);
            ja.lang = "ja";
            const row = h("div", "g-coach-row");
            row.append(h("span", "g-coach-step", `${i + 1} / ${TUTORIAL.length}`), skip, next);
            bubble.replaceChildren(h("b", "g-coach-who", "Yui"), ja, h("p", "g-coach-en", l.en), row);
            restartClass(bubble, "g-coach-in", 400);
            say(l, true);
            sub.hidden = true; // the bubble already shows the line
            next.focus({ preventScroll: true });
        };
        show();
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
            if (!item || item.key !== top.key) item = { key: top.key, seen: new Set(), fired: new Set(), lit: new Set(), checks: 0, bounty: bountyOf(top.key, top.photos.length), paid: false, total: top.photos.length };
        }
        renderHud();
        mood();
        if (greet) { greet = false; say(line("welcome_back")); }
        // After the intro and the first path choice, Yui teaches the screen once.
        setTimeout(() => { if (!showing) maybeTutorial(); }, 900);
    }
    function defeat(group) {
        const gid = String(group.groupId);
        if (run.defeated[gid]) return;
        run.defeated[gid] = 1;
        run.defeats = (run.defeats || 0) + 1;
        const type = nodeType(gid);
        const tr = traitHere(gid);
        const n = ctx.cards.filter(c => String(c.group.groupId) === gid).length;
        let xp = Math.round((20 + 5 * n) * (type === "boss" ? 2 : type === "elite" ? 1.5 : 1) * (tr === "armored" ? 1.5 : 1));
        xp += trigger("defeat", ctxT());
        let shards = 2 + (run.relics.includes("gear") ? 3 : 0) + (tr === "greedy" ? 6 : 0);
        if (run.omen === "silver") shards = Math.round(shards * 1.5);
        if (run.wager && run.wager.gid === gid) {
            if (!run.wager.broken) { const won = run.wager.stake * 2; shards += won; xp += 20; setTimeout(() => { floatAt($("gScrap"), `Wager won · +${won}`, "g-f-xp"); sfx("coin"); }, 500); }
            run.wager = null;
        }
        if (run.prey === gid) { xp = Math.round(xp * 1.5); shards += 5; }
        if (run.double === gid) { xp *= 2; shards *= 2; }
        run.scrap += shards;
        meta.foes++;
        const sp = speciesAt(gid, type).id;
        meta.bestiary = meta.bestiary || {};
        meta.bestiary[sp] = (meta.bestiary[sp] || 0) + 1;
        if (type !== "boss" && !thisWeek().ids.includes(sp)) meta.week.ids.push(sp);
        award("first");
        if (type === "elite" && stat("elites") >= 5) award("elites");
        if (type === "boss") award("boss");
        if (Object.keys(meta.bestiary).length >= REGIONS.reduce((n, R) => n + R.species.length + 1, 0)) award("naturalist");
        holdUntil = performance.now() + (reduce ? 300 : 1000);
        setTimeout(() => grant(xp, portraitEl), 350);
        sfx("defeat");
        haptic(HAPTIC.defeat);
        setTimeout(() => sfx("victory"), 250);
        const c = center(portraitEl);
        portraitEl.classList.add("g-dead");
        burst(c.x, c.y, { n: 60, colors: ["#e6dcc6", "#9aa3a8", "#2f4f57", "#e0a243"], speed: 6, gravity: -0.03, shape: "dot", life: 60 });
        burst(c.x, c.y, { n: 14, colors: ["#e6dcc6", "#9aa3a8", "#2f4f57", "#e0a243"], speed: 5, gravity: 0.25, lift: 3 });
        if (type === "boss" || type === "elite" || Math.random() < 0.4) say(line("defeat"));
        if (run.pref === gid) run.pref = null;
        const stop = eventAfter(run.defeats);
        setTimeout(() => {
            enqueue(() => rewardOverlay(gid));
            if (type === "elite" || type === "boss") enqueue(() => relicOverlay("Trophy", `${foeName(gid)} drops a relic`));
            if (stop && nodes().some(x => groupOpen(x.groupId))) enqueue(() => eventOverlay(stop));
            queuePath();
        }, reduce ? 300 : 950);
    }
    // Choose your path: the next foes you may face. Every vehicle still gets done; this only picks the order.
    function queuePath() {
        const options = pathChoices(nodes(), groupOpen, (run.relics.includes("compass") ? 4 : 3) + (run.omen === "cross" ? 1 : 0));
        if (options.length < 2) { prefer(options[0] ? options[0].groupId : null); return; }
        enqueue(() => pathOverlay(options));
    }
    function pathOverlay(options) {
        const body = h("div", "g-body");
        const list = h("div", "g-paths");
        for (const o of options) {
            const sp = speciesAt(o.groupId, o.type), tr = traitHere(o.groupId), g = groupById(o.groupId);
            const left = ctx.cards.filter(c => String(c.group.groupId) === o.groupId && !V.isDecided(ctx.actions, ctx.decisions[c.key])).length;
            const b = h("button", `g-path g-path-${o.type}`);
            b.type = "button";
            const pic = h("span", "g-path-art");
            pic.appendChild(liveArt("foes", sp.id, "", ""));
            const txt = h("span", "g-path-text");
            txt.append(h("b", "", sp.name), h("small", "", [g && g.title, `${left} to decide`].filter(Boolean).join(" · ")));
            if (tr) txt.appendChild(h("em", "", `${TRAITS[tr].name}: ${TRAITS[tr].text}`));
            b.append(pic, txt);
            if (o.type === "elite") b.appendChild(h("span", "g-tag g-tag-elite", "Elite"));
            b.addEventListener("click", () => { sfx("confirm"); haptic(HAPTIC.pick); run.paths = (run.paths || 0) + 1; moment("path"); prefer(o.groupId); nextOverlay(); });
            list.appendChild(b);
        }
        body.append(h("p", "g-lore", "The road forks under the moon. Which way?"), list,
            h("p", "g-fine", "Every vehicle still gets inspected; this only chooses the order. Elites drop relics."));
        panel({ kicker: "Choose your path", title: "The road forks", body, actions: [] });
    }

    // ---------- app events ----------
    document.addEventListener("vinder:pack", e => {
        ctx = e.detail;
        const saved = store.get(runKey(ctx.pack.packId), null);
        run = saved && Array.isArray(saved.deck) ? saved : newRun(ctx.pack.packId, hash(ctx.pack.packId));
        greet = Boolean(saved && saved.introduced && !saved.done);
        if (run.light === undefined) { run.light = 0; delete run.momentum; }
        if (!saved) run.omen = omenOf(dayKey(new Date()));
        if (!saved) saveRun();
        document.dispatchEvent(new CustomEvent("vinder:prefer", { detail: run.pref || null }));
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
        if (meta.verdicts >= 100) award("hundred");
        const today = dayKey(new Date());
        meta.nights = meta.nights || [];
        if (!meta.nights.includes(today)) {
            meta.nights = [...meta.nights.slice(-60), today];
            const s = streakOf(meta.nights, new Date());
            if (s >= 3) award("three");
            if (s >= 7) award("week");
        }
        if (!run.scored[card.key]) {
            // Undo then redo earns nothing twice.
            run.scored[card.key] = 1;
            const mine = item && item.key === card.key ? item : null;
            const left = ctx.cards.filter(c => String(c.group.groupId) === String(card.group.groupId) && !V.isDecided(ctx.actions, ctx.decisions[c.key])).length;
            const t = ctxT({ seen: mine ? mine.seen.size : 0, total: card.photos.length, firstOfFoe: run.first, wasLater: Boolean(run.later[card.key]),
                details: Boolean(mine && mine.lit.has("details")), zoom: Boolean(mine && mine.lit.has("viewer")), ai: Boolean(mine && mine.lit.has("ai")),
                checks: mine ? mine.checks : 0, last: left === 0 });
            if (t.wasLater) say(line("revisit_1"));
            run.first = false;
            // Looked closely = saw every photo (or there was only one), or zoomed, or read the details.
            run.items = (run.items || 0) + 1;
            const lookedClose = t.total <= 1 || t.seen >= t.total || Boolean(mine && (mine.lit.has("viewer") || mine.lit.has("details")));
            if (lookedClose) run.close = (run.close || 0) + 1;
            if (run.wager && run.wager.gid === String(card.group.groupId) && !run.wager.broken && !lookedClose) {
                run.wager.broken = true; floatAt($("gWager"), "Wager lost", "g-f-muted"); sfx("later"); haptic(HAPTIC.nope);
            }
            if (traitHere(card.group.groupId) === "glimmer" && t.total > 1 && t.seen >= t.total) { run.scrap += 5; floatAt($("gScrap"), "+5 shards", "g-f-xp"); }
            grant(BASE_XP + trigger("verdict", t), portraitEl);
        }
        const bgid = String(card.group.groupId);
        if (nodeType(bgid) === "boss" && !(run.phased && run.phased[bgid])) {
            const mineAll = ctx.cards.filter(c => String(c.group.groupId) === bgid);
            const left = mineAll.filter(c => !V.isDecided(ctx.actions, ctx.decisions[c.key])).length;
            if (mineAll.length >= 2 && left > 0 && left <= mineAll.length / 2) {
                run.phased = run.phased || {};
                run.phased[bgid] = 1;
                setTimeout(() => { floatAt(portraitEl, "The mask cracks!", "g-f-crit"); sfx("boss"); haptic(HAPTIC.defeat); restartClass(portraitEl, "g-phase", 900); say(line("boss_2"), true); renderHud(); }, 400);
            }
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
        if (kind === "viewer") payBounty("zoom");
        if (kind === "details") payBounty("details");
        if (!run.scored[item.key]) {
            const tr = run.foe ? traitHere(run.foe) : null;
            if (kind === "check") { if (item.checks < 2) { item.checks++; earnLight(1); } }
            else if (!item.lit.has(kind)) { item.lit.add(kind); earnLight(1 + (kind === "viewer" && tr === "restless" ? 1 : 0)); }
        }
        const xp = trigger(kind, ctxT());
        if (xp) grant(xp, portraitEl);
        renderHand(); renderMe(); saveRun();
    }
    document.addEventListener("vinder:inspect", e => {
        if (!meta.on || !run || !item) return;
        const d = e.detail || {};
        if (d.key && d.key !== item.key) return;
        const before = item.seen.size;
        item.seen.add(d.src);
        if (item.total > 1 && item.seen.size >= item.total) payBounty("every");
        if (d.viewer) fireAction("viewer");
        else if (item.seen.size > before && before > 0) {
            sfx("flip");
            // A new photo flipped to (not the one shown first) earns Light; Shy foes give more for the first.
            if (!run.scored[item.key]) earnLight(1 + (!item.lit.has("flip") && traitHere(run.foe) === "shy" ? 1 : 0));
            item.lit.add("flip");
        }
    });
    document.addEventListener("vinder:details", () => fireAction("details"));
    document.addEventListener("vinder:check", () => fireAction("check"));
    document.addEventListener("vinder:ai", () => fireAction("ai"));
    document.addEventListener("vinder:send", () => { if (meta.on) { say(line("send_1"), true); sfx("send"); } });

    $("gStrip").dataset.explain = "Your route tonight: foes, elites and the boss. Tap to open the map.";
    $("gStrip").addEventListener("click", () => { if (ctx) { sfx("map"); enqueue(mapOverlay); } });
    $("gMe").addEventListener("click", () => { sfx("ui"); enqueue(profileOverlay); });
    $("gWager").addEventListener("click", () => {
        if (!run || !run.foe || (run.wager && run.wager.gid === run.foe) || run.scrap < 5) return;
        const stake = Math.min(10, run.scrap);
        run.scrap -= stake;
        run.wager = { gid: run.foe, stake, broken: false };
        moment("wager");
        sfx("purchase"); haptic(HAPTIC.pick);
        floatAt($("gWager"), `Staked ${stake}`, "g-f-xp");
        saveRun(); renderMe(); renderWager();
    });
    $("gPiles").addEventListener("click", () => { if (run) { sfx("draw"); enqueue(pilesOverlay); } });
    // Hold to explain: long-press anything with data-explain.
    let explainTimer = 0, explainEl = null;
    const hideExplain = () => { clearTimeout(explainTimer); if (explainEl) { explainEl.remove(); explainEl = null; } };
    document.addEventListener("pointerdown", e => {
        const t = e.target.closest && e.target.closest("[data-explain]");
        hideExplain();
        if (!t || !meta.on) return;
        explainTimer = setTimeout(() => {
            const r = t.getBoundingClientRect();
            explainEl = h("div", "g-explain", t.dataset.explain);
            explainEl.setAttribute("role", "tooltip");
            document.body.appendChild(explainEl);
            const w = explainEl.offsetWidth;
            explainEl.style.left = `${Math.max(8, Math.min(root.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
            explainEl.style.top = r.top > 140 ? `${r.top - explainEl.offsetHeight - 10}px` : `${r.bottom + 10}px`;
            haptic(HAPTIC.light);
        }, 450);
    }, true);
    for (const ev of ["pointerup", "pointercancel", "scroll"]) document.addEventListener(ev, () => { clearTimeout(explainTimer); setTimeout(hideExplain, ev === "pointerup" ? 1400 : 0); }, true);
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

    // ---------- splash: moonrise while everything loads, once per app launch ----------
    async function preload(progress) {
        let list = [];
        try { list = (await (await fetch(`${ART}manifest.json`)).json()).files || []; } catch (_) { return; }
        // Big or optional files (the music2 pool, idle and hurt clips) load when first used, never up front.
        const lazy = f => f.startsWith("audio/music2/") || f.startsWith("foes/anim/") || f.startsWith("foes/hurt/") || f.startsWith("heroes/anim/");
        const first = list.filter(f => !lazy(f) && (!f.startsWith("audio/music/") || f.endsWith("/theme.webm")));
        const later = list.filter(f => f.startsWith("audio/music/") && !first.includes(f));
        let done = 0;
        const q = first.slice();
        await Promise.all(Array.from({ length: 6 }, async () => {
            while (q.length) { const f = q.shift(); try { await fetch(ART + f); } catch (_) { /* offline: skip */ } progress(++done, first.length); }
        }));
        // The other music tracks follow quietly, so the first battle never waits.
        setTimeout(() => later.forEach((f, i) => setTimeout(() => fetch(ART + f).catch(() => {}), i * 500)), 2500);
    }
    function splash() {
        try { if (sessionStorage.getItem("pmSplash")) return; sessionStorage.setItem("pmSplash", "1"); } catch (_) { /* private mode: show it */ }
        const s = h("div", "g-splash");
        s.setAttribute("role", "status");
        s.innerHTML = '<div class="g-splash-moon"></div><p class="g-title-kicker">a VINder tale</p><p class="g-title-logo">Pale Moon</p><div class="g-splash-bar"><span></span></div><p class="g-splash-note">Lighting the lanterns…</p><p class="g-splash-tap">Tap to skip</p>';
        document.body.appendChild(s);
        const bar = s.querySelector(".g-splash-bar span"), t0 = performance.now();
        let closed = false;
        const close = () => { if (closed) return; closed = true; s.classList.add("g-out"); setTimeout(() => s.remove(), 650); audio(); mood(); };
        s.addEventListener("click", close);
        setTimeout(close, 7000);
        preload((d, n) => { bar.style.width = `${Math.round((d / n) * 100)}%`; }).then(() => setTimeout(close, Math.max(0, 1600 - (performance.now() - t0))));
    }
    if (meta.on) splash();

    apply();
})(typeof globalThis !== "undefined" ? globalThis : this);
