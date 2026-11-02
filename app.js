"use strict";

(function () {
    const V = window.VINderCore;
    const $ = id => document.getElementById(id);
    const EDGE = 24;      // px from the screen edge are left to the phone's back gesture
    const TAP_MOVE = 10;
    const APP_VERSION = "2026-11-03 · Pale Moon 14";

    let dbPromise = null;
    function db() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open("vinder", 1);
                req.onupgradeneeded = () => {
                    req.result.createObjectStore("packs", { keyPath: "packId" });
                    req.result.createObjectStore("state", { keyPath: "packId" });
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        return dbPromise;
    }
    async function run(name, mode, fn) {
        const d = await db();
        return new Promise((resolve, reject) => {
            const tx = d.transaction(name, mode);
            const req = fn(tx.objectStore(name));
            tx.oncomplete = () => resolve(req ? req.result : undefined);
            tx.onerror = () => reject(tx.error);
        });
    }
    const getAll = name => run(name, "readonly", s => s.getAll());
    const get = (name, key) => run(name, "readonly", s => s.get(key));
    const put = (name, value) => run(name, "readwrite", s => s.put(value));
    const del = (name, key) => run(name, "readwrite", s => s.delete(key));

    const S = { pack: null, cards: [], actions: V.actionsOf(null), decisions: {}, history: [], photoIndex: 0, sentAt: null, moves: {}, checks: {}, overrides: {}, translations: {} };
    const actionById = id => Object.values(S.actions).find(a => a.id === id) || null;
    const labelOf = id => (actionById(id) || { label: id }).label;
    const colorOf = id => (actionById(id) || { color: "" }).color;

    async function saveState() {
        if (!S.pack) return;
        await put("state", { packId: S.pack.packId, decisions: S.decisions, history: S.history.slice(-200), sentAt: S.sentAt, moves: S.moves, checks: S.checks, overrides: S.overrides, translations: S.translations });
    }

    function show(screen) {
        const swap = () => {
            for (const id of ["home", "deck", "review"]) $(id).hidden = id !== screen;
            if (screen === "home") renderHome();
            if (screen === "deck") renderDeck();
            if (screen === "review") renderReview();
            emit("screen", screen);
        };
        const animate = document.startViewTransition && document.body.classList.contains("game-on")
            && !document.body.classList.contains("g-reduce") && !matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!animate) { swap(); return; }
        document.documentElement.dataset.go = screen === "home" ? "back" : "in";
        document.startViewTransition(swap);
    }

    let toastTimer = null;
    function toast(text, ms) {
        const t = $("toast");
        t.textContent = text;
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2600);
    }
    const buzz = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) { /* no haptics */ } };
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    };
    const emit = (name, detail) => document.dispatchEvent(new CustomEvent(`vinder:${name}`, { detail }));
    const svgIcon = d => {
        const ns = "http://www.w3.org/2000/svg";
        const s = document.createElementNS(ns, "svg");
        s.setAttribute("viewBox", "0 0 24 24");
        s.setAttribute("aria-hidden", "true");
        const p = document.createElementNS(ns, "path");
        p.setAttribute("d", d);
        s.appendChild(p);
        return s;
    };
    const fmtDate = iso => {
        if (!iso) return "";
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString([], { day: "numeric", month: "short" });
    };
    const pairs = list => (Array.isArray(list) ? list : []).filter(p => Array.isArray(p) && p.length >= 2 && p[1] !== "" && p[1] !== null && p[1] !== undefined);

    function applyActions() {
        for (const dir of V.DIRECTIONS) {
            const a = S.actions[dir];
            const btn = document.querySelector(`.act[data-dir="${dir}"]`);
            if (btn) {
                btn.style.setProperty("--c", a.color);
                btn.setAttribute("aria-label", `${a.label} (swipe ${dir})`);
                const span = btn.querySelector("span");
                if (span) span.textContent = dir === "down" ? "" : a.label;
            }
        }
    }

    $("appVersion").textContent = `Version ${APP_VERSION}`;
    $("checkUpdate").addEventListener("click", async () => {
        const button = $("checkUpdate");
        if (!("serviceWorker" in navigator)) { toast("Updates come with each reload here."); return; }
        button.disabled = true;
        button.textContent = "Checking…";
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg) { location.reload(); return; }
            await reg.update();
            if (reg.installing || reg.waiting) { toast("Updating…"); return; }
            toast(`You're on the latest version (${APP_VERSION}).`);
        } catch (_) {
            toast("Couldn't check - are you online?");
        } finally {
            button.disabled = false;
            button.textContent = "Check for updates";
        }
    });

    const packMissing = pack => [
        Array.isArray(pack.itemFields) && pack.itemFields.length ? "" : "correcting place / name",
        pack.groups && pack.groups.some(g => Array.isArray(g.fields) || g.fieldsNote) ? "" : "checking the values"
    ].filter(Boolean);

    // Landing card: greeting, date and what is left across every pack on this phone.
    function renderSummary(packs, states) {
        const box = $("homeSummary");
        let left = 0, decided = 0, sent = 0;
        for (const item of packs) {
            const r = V.readPack(item.pack);
            const st = states.get(item.packId) || { decisions: {} };
            const p = V.progress(r.cards, st.decisions || {}, r.actions);
            left += p.left; decided += p.decided;
            if (st.sentAt) sent++;
        }
        const now = new Date(), hr = now.getHours();
        const hello = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
        box.replaceChildren();
        const art = el("div", "home-summary-art");
        art.setAttribute("aria-hidden", "true");
        art.append(el("i"), el("i"), el("i"));
        const text = el("div", "home-summary-text");
        text.append(el("p", "home-summary-hello", `${hello} · ${now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}`));
        if (!packs.length) {
            text.append(el("p", "home-summary-big", "Ready when you are"), el("p", "home-summary-sub", "Open a pack to start deciding."));
        } else {
            text.append(el("p", "home-summary-big", left ? `${left} card${left === 1 ? "" : "s"} to decide` : "All caught up"),
                el("p", "home-summary-sub", [`${packs.length} pack${packs.length === 1 ? "" : "s"} on this phone`, decided ? `${decided} decided` : "", sent ? `${sent} sent` : ""].filter(Boolean).join(" · ")));
        }
        box.append(text, art);
        box.hidden = false;
    }

    async function renderHome() {
        const list = $("packs");
        const packs = (await getAll("packs")).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
        const states = new Map((await getAll("state")).map(s => [s.packId, s]));
        renderSummary(packs, states);
        list.replaceChildren();
        if (!packs.length) {
            const empty = el("div", "empty");
            const art = el("div", "empty-art");
            art.append(el("i"), el("i"), el("i"));
            empty.append(art, el("p", "", "No pack on this phone yet."), el("p", "", "Open a pack file, or share one to VINder from your files app."));
            list.appendChild(empty);
            return;
        }
        for (const item of packs) {
            const r = V.readPack(item.pack);
            const st = states.get(item.packId) || { decisions: {} };
            const p = V.progress(r.cards, st.decisions || {}, r.actions);
            const groups = new Set(r.cards.map(c => c.group.groupId)).size;
            const box = el("article", "pack");
            const top = el("div", "pack-top");
            top.append(el("div", "pack-name", item.pack.title || `Pack ${fmtDate(item.pack.createdAt)}`), el("div", "pack-meta", `${groups} groups · ${p.total} cards · made ${fmtDate(item.pack.createdAt)}`));
            const missing = packMissing(item.pack);
            if (missing.length) top.appendChild(el("div", "pack-old", `Older pack - no ${missing.join(" or ")}. Make a new pack for those.`));
            const bar = el("div", "pack-bar");
            const fill = el("span");
            fill.style.width = `${p.total ? Math.round((p.decided / p.total) * 100) : 0}%`;
            bar.appendChild(fill);
            const meta = el("div", "pack-meta", `${p.decided} decided${p.later ? ` · ${p.later} for later` : ""}${st.sentAt ? ` · sent ${fmtDate(st.sentAt)}` : ""}`);
            const buttons = el("div", "pack-buttons");
            const open = el("button", "btn btn-primary", p.left ? (p.decided ? "Continue" : "Start") : "Review");
            open.type = "button";
            open.addEventListener("click", () => openPack(item.packId, p.left ? "deck" : "review"));
            const remove = el("button", "btn", "Remove");
            remove.type = "button";
            remove.addEventListener("click", async () => {
                if (!st.sentAt && p.decided && !confirm("These decisions haven't been sent yet. Remove the pack anyway?")) return;
                await del("packs", item.packId);
                await del("state", item.packId);
                renderHome();
            });
            buttons.append(open, remove);
            box.append(top, bar, meta, buttons);
            list.appendChild(box);
        }
    }

    async function carryOver(cards, pack) {
        const out = { decisions: {}, moves: {}, checks: {}, overrides: {}, translations: {}, count: 0 };
        let olds = [];
        try { olds = (await getAll("packs")).filter(p => p.packId !== pack.packId).sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0)); } catch (_) { return out; }
        const newByKey = new Map(cards.map(c => [c.key, c]));
        const groups = new Map((pack.groups || []).map(g => [String(g.groupId), g]));
        for (const old of olds) {
            const st = await get("state", old.packId);
            if (!st) continue;
            let oldCards = [];
            try { oldCards = V.readPack(old.pack).cards; } catch (_) { continue; }
            const same = new Map();
            for (const oc of oldCards) {
                const nc = newByKey.get(oc.key);
                if (nc && String(nc.item.title || "") === String(oc.item.title || "")) same.set(oc.key, nc);
            }
            for (const [key, d] of Object.entries(st.decisions || {})) if (same.has(key) && !d.preset) { out.decisions[key] = d; out.count++; }
            for (const [key, c] of Object.entries(st.checks || {})) {
                const g = groups.get(String(c.groupId));
                if (!g) continue;
                const ok = c.itemIndex === null || c.itemIndex === undefined
                    ? (Array.isArray(g.fields) && g.fields.some(f => f.id === c.fieldId))
                    : same.has(`${c.groupId}#${c.itemIndex}`);
                if (ok) { out.checks[key] = c; out.count++; }
            }
            for (const [key, m] of Object.entries(st.moves || {})) {
                const g = groups.get(String(m.groupId));
                const has = g && ((g.items || []).some(it => (it.photos || []).some(p => String(p.id) === m.photoId)) || (g.attachments || []).some(a => String(a.id) === m.photoId));
                const fromOk = m.from === null || same.has(`${m.groupId}#${m.from}`);
                if (has && fromOk) { out.moves[key] = m; out.count++; }
            }
            for (const [key, o] of Object.entries(st.overrides || {})) if (groups.has(String(o.groupId))) { out.overrides[key] = o; out.count++; }
            for (const [gid, t] of Object.entries(st.translations || {})) if (groups.has(String(gid))) out.translations[gid] = t;
        }
        return out;
    }

    async function loadPackFile(file) {
        try {
            const pack = JSON.parse(await file.text());
            const r = V.readPack(pack);
            if (!r.ok) { toast(r.errors[0], 4000); return; }
            await put("packs", { packId: pack.packId, pack, openedAt: Date.now() });
            if (!(await get("state", pack.packId))) {
                const carried = await carryOver(r.cards, pack);
                await put("state", { packId: pack.packId, decisions: { ...V.presetDecisions(r.cards, r.actions, pack.createdAt), ...carried.decisions },
                    history: [], sentAt: null, moves: carried.moves, checks: carried.checks, overrides: carried.overrides, translations: carried.translations });
                if (carried.count) setTimeout(() => toast(`Carried over ${carried.count} thing${carried.count === 1 ? "" : "s"} you did in an older pack.`, 4000), 600);
            }
            let coached = true;
            try { coached = Boolean(localStorage.getItem("vinderCoached")); } catch (_) { /* fine */ }
            if (coached) toast(`Pack loaded: ${r.cards.length} cards. It's on this phone now - works offline.`);
            openPack(pack.packId, "deck");
        } catch (error) {
            toast(`Couldn't read that file: ${error.message}`, 4000);
        }
    }

    $("packFile").addEventListener("change", event => {
        const file = event.target.files && event.target.files[0];
        event.target.value = "";
        if (file) loadPackFile(file);
    });

    async function openPack(packId, screen) {
        const item = await get("packs", packId);
        if (!item) return;
        const st = (await get("state", packId)) || { decisions: {}, history: [] };
        const r = V.readPack(item.pack);
        S.pack = item.pack;
        S.cards = r.cards;
        S.actions = r.actions;
        S.decisions = st.decisions || {};
        S.history = st.history || [];
        S.sentAt = st.sentAt || null;
        S.moves = st.moves || {};
        S.checks = st.checks || {};
        S.overrides = st.overrides || {};
        S.translations = st.translations || {};
        S.photoIndex = 0;
        S.pref = null;
        applyActions();
        emit("pack", S);
        show(screen || "deck");
        maybeCoach();
    }

    // The game layer may ask for a group to go first (the path the player chose); everything else keeps its order.
    const queue = () => {
        const q = V.remainingCards(S.cards, S.decisions, S.actions).filter(c => !V.isDecided(S.actions, S.decisions[c.key]));
        if (!S.pref) return q;
        return [...q.filter(c => String(c.group.groupId) === S.pref), ...q.filter(c => String(c.group.groupId) !== S.pref)];
    };
    document.addEventListener("vinder:prefer", e => {
        S.pref = e.detail || null;
        if (!$("deck").hidden) renderDeck();
    });

    function renderProgress() {
        const p = V.progress(S.cards, S.decisions, S.actions);
        $("deckCount").textContent = `${p.decided} / ${p.total}${p.later ? ` · ${p.later} later` : ""}`;
        $("deckMeter").style.width = `${p.total ? (p.decided / p.total) * 100 : 0}%`;
        $("actUndo").disabled = !S.history.length;
    }

    function renderDeck() {
        renderProgress();
        const stack = $("stack");
        stack.replaceChildren();
        const q = queue();
        document.querySelectorAll(".act[data-dir]").forEach(b => { b.disabled = !q.length; });
        if (!q.length) {
            const done = el("div", "finished");
            const p = V.progress(S.cards, S.decisions, S.actions);
            done.append(el("h2", "", p.later ? `Only the "${S.actions.down.label}" ones are left` : "All done"), el("p", "", `${p.decided} of ${p.total} decided.`));
            const send = el("button", "btn btn-primary", "Review & send");
            send.type = "button";
            send.addEventListener("click", () => show("review"));
            done.appendChild(send);
            stack.appendChild(done);
            emit("deck");
            return;
        }
        if (q[1]) stack.appendChild(buildCard(q[1], true));
        const top = buildCard(q[0], false);
        stack.appendChild(top);
        attachDrag(top, q[0]);
        emit("deck");
    }

    function fitFrame(frame, img, card) {
        const area = card.getBoundingClientRect();
        const maxW = area.width;
        const maxH = area.height * 0.78;
        const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 3 / 4;
        let w = maxW, h = w / ratio;
        if (h > maxH) { h = maxH; w = h * ratio; }
        frame.style.width = `${w}px`;
        frame.style.height = `${h}px`;
    }

    function drawPhoto(card, data, index) {
        const photos = data.photos;
        const frame = card.querySelector(".photo-frame");
        const bg = card.querySelector(".photo-bg");
        card.querySelectorAll(".segments i").forEach((s, i) => s.classList.toggle("on", i === index));
        frame.replaceChildren();
        if (!photos.length) { bg.style.backgroundImage = "none"; return; }
        const photo = photos[index];
        if (!card.classList.contains("behind")) emit("inspect", { key: data.key, src: photo.src });
        bg.style.backgroundImage = `url("${photo.src}")`;
        const img = new Image();
        img.alt = `Photo ${index + 1} of ${photos.length}: ${data.item.title || ""}`;
        img.decoding = "async";
        img.onload = () => fitFrame(frame, img, card);
        img.src = photo.src;
        frame.appendChild(img);
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 1000 1000");
        svg.setAttribute("preserveAspectRatio", "none");
        svg.setAttribute("aria-hidden", "true");
        for (const b of Array.isArray(photo.boxes) ? photo.boxes : []) {
            if (!Array.isArray(b) || b.length < 4) continue;
            const r = document.createElementNS(ns, "rect");
            r.setAttribute("class", "box");
            r.setAttribute("x", b[0]); r.setAttribute("y", b[1]); r.setAttribute("width", b[2]); r.setAttribute("height", b[3]);
            r.setAttribute("rx", 12);
            svg.appendChild(r);
        }
        frame.appendChild(svg);
    }

    function buildCard(data, behind) {
        const card = el("article", `card${behind ? " behind" : ""}`);
        card.setAttribute("aria-label", `${data.item.title || ""}, ${data.group.title || ""}`);
        card.append(el("div", "photo-bg"), el("div", "photo-frame"));
        if (data.photos.length > 1) {
            const segs = el("div", "segments");
            data.photos.forEach(() => segs.appendChild(el("i")));
            card.appendChild(segs);
        }
        if (!data.photos.length) card.appendChild(el("div", "no-photo", "No photo for this one"));
        card.append(el("div", "tap-zone prev"), el("div", "tap-zone next"));
        for (const dir of V.DIRECTIONS) {
            const stamp = el("div", `stamp ${dir}`, S.actions[dir].label);
            stamp.style.setProperty("--c", S.actions[dir].color);
            card.appendChild(stamp);
        }

        const info = el("div", "card-info");
        const title = el("div", "card-title");
        title.appendChild(el("h2", "", V.itemTitle(data, S.checks) || "(no title)"));
        const more = el("button", "info-btn");
        more.type = "button";
        more.setAttribute("aria-label", "Details");
        more.appendChild(svgIcon("M12 8h.01M11 12h1v5h1"));
        more.addEventListener("pointerdown", e => e.stopPropagation());
        more.addEventListener("click", e => { e.stopPropagation(); openSheet(data); });
        const ask = el("button", "info-btn");
        ask.type = "button";
        ask.setAttribute("aria-label", "Ask AI");
        ask.appendChild(svgIcon("M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"));
        ask.addEventListener("pointerdown", e => e.stopPropagation());
        ask.addEventListener("click", e => { e.stopPropagation(); openAiSheet(data); });
        const btns = el("div", "card-btns");
        btns.append(ask, more);
        title.appendChild(btns);
        const chips = el("div", "chips");
        if (data.item.suggestion) {
            const chip = el("span", "chip ai");
            const label = (S.pack.suggestionLabels && S.pack.suggestionLabels[data.item.suggestion]) || labelOf(data.item.suggestion);
            chip.append(document.createTextNode(`${S.pack.suggestionTitle || "Suggested"}: `), el("b", "", label));
            chips.appendChild(chip);
        }
        for (const c of Array.isArray(data.item.chips) ? data.item.chips : []) if (c) chips.appendChild(el("span", "chip", String(c)));
        if (data.photos.length) chips.appendChild(el("span", "chip", `${data.photos.length} photo${data.photos.length === 1 ? "" : "s"}`));
        const movedHere = V.movesList(S.moves).filter(m => m.groupId === data.group.groupId && (m.from === data.item.itemIndex || m.to === data.item.itemIndex)).length;
        if (movedHere) chips.appendChild(el("span", "chip moved", `${movedHere} photo move${movedHere === 1 ? "" : "s"}`));
        if (data.group.flag && data.group.flag.text) chips.appendChild(el("span", `chip ${data.group.flag.tone === "block" && !Object.values(S.overrides).some(o => o.groupId === data.group.groupId) ? "block" : "check"}`, String(data.group.flag.text)));
        const toCheck = V.fieldsToCheck(data.group, S.checks).length;
        if (toCheck) {
            const chip = el("button", "chip check", `${data.group.fieldsChip || "To check"}: ${toCheck}`);
            chip.type = "button";
            chip.addEventListener("pointerdown", e => e.stopPropagation());
            chip.addEventListener("click", e => { e.stopPropagation(); openSheet(data); });
            chips.appendChild(chip);
        }
        const same = S.cards.filter(c => c.group.groupId === data.group.groupId);
        const pos = same.indexOf(data) + 1;
        info.append(title, chips, el("div", "card-sub", [data.group.title, data.group.subtitle, same.length > 1 ? `${pos} of ${same.length}` : ""].filter(Boolean).join(" · ")));
        if (data.item.footnote) info.appendChild(el("div", "card-past", data.item.footnote));
        card.appendChild(info);

        const index = behind ? 0 : Math.min(S.photoIndex, Math.max(0, data.photos.length - 1));
        if (!behind) S.photoIndex = index;
        requestAnimationFrame(() => drawPhoto(card, data, index));
        return card;
    }

    function setStamps(card, l) {
        for (const dir of V.DIRECTIONS) card.querySelector(`.stamp.${dir}`).style.opacity = l[dir];
    }
    const NO_LEAN = { right: 0, left: 0, up: 0, down: 0 };

    function attachDrag(card, data) {
        let start = null;
        card.addEventListener("pointerdown", e => {
            if (e.target.closest(".info-btn")) return;
            if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return;
            start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
            card.setPointerCapture(e.pointerId);
            card.classList.remove("returning");
        });
        card.addEventListener("pointermove", e => {
            if (!start || e.pointerId !== start.id) return;
            const dx = e.clientX - start.x, dy = e.clientY - start.y;
            const rect = card.getBoundingClientRect();
            card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
            setStamps(card, V.lean(dx, dy, rect.width, rect.height));
        });
        const end = e => {
            if (!start || e.pointerId !== start.id) return;
            const dx = e.clientX - start.x, dy = e.clientY - start.y;
            const dt = Math.max(1, performance.now() - start.t);
            const rect = card.getBoundingClientRect();
            const s = start;
            start = null;
            if (Math.abs(dx) < TAP_MOVE && Math.abs(dy) < TAP_MOVE && dt < 350) {
                card.style.transform = "";
                setStamps(card, NO_LEAN);
                const x = s.x - rect.left;
                if (data.photos.length && s.y - rect.top < rect.height * 0.62) {
                    if (data.photos.length > 1 && x < rect.width * 0.3) flipPhoto(card, data, -1);
                    else if (data.photos.length > 1 && x > rect.width * 0.7) flipPhoto(card, data, 1);
                    else openViewer(data.photos.map(p => ({ ...p, title: data.photos.length > 1 ? "" : data.item.title, move: { group: data.group, photoId: String(p.id), from: data.item.itemIndex } })), S.photoIndex);
                }
                return;
            }
            const dir = V.swipeDirection(dx, dy, rect.width, rect.height, Math.hypot(dx, dy) / dt);
            if (dir) {
                const actionId = S.actions[dir].id;
                if (V.gateFor(data.group, actionId, S.overrides).level === "block") {
                    card.classList.add("returning");
                    card.style.transform = "";
                    setStamps(card, NO_LEAN);
                }
                throughGate(data, actionId, () => {
                    const live = $("stack").querySelector(".card:not(.behind)") || card;
                    flyOut(live, data, dir, live === card ? dx : 0, live === card ? dy : 0);
                });
            } else {
                card.classList.add("returning");
                card.style.transform = "";
                setStamps(card, NO_LEAN);
            }
        };
        card.addEventListener("pointerup", end);
        card.addEventListener("pointercancel", end);
    }

    function flipPhoto(card, data, step) {
        const next = S.photoIndex + step;
        if (next < 0 || next >= data.photos.length) { buzz(8); return; }
        S.photoIndex = next;
        drawPhoto(card, data, next);
    }

    function throughGate(data, actionId, go, cancel) {
        const gate = V.gateFor(data.group, actionId, S.overrides);
        if (gate.level === "block") {
            openPicker(`${labelOf(actionId)} is blocked`, [
                { label: `Override - allow ${labelOf(actionId)} anyway`, sub: gate.overrideText || "Saved with the group and sent back.", value: "yes" },
                { label: "Cancel", value: "" }
            ], null, async value => {
                if (!value) { if (cancel) cancel(); return; }
                S.overrides = V.setOverride(S.overrides, data.group.groupId, actionId, true);
                await saveState();
                go();
            }, gate.text);
            return;
        }
        if (gate.level === "warn" && gate.text) toast(gate.text, 4500);
        go();
    }

    function flyOut(card, data, dir, dx, dy) {
        const w = window.innerWidth, h = window.innerHeight;
        const tx = dir === "right" ? w * 1.4 : dir === "left" ? -w * 1.4 : dx;
        const ty = dir === "up" ? -h * 1.2 : dir === "down" ? h * 1.2 : dy + 60;
        card.querySelector(`.stamp.${dir}`).style.opacity = 1;
        card.classList.add("flying");
        card.style.transform = `translate(${tx}px, ${ty}px) rotate(${dir === "right" ? 24 : dir === "left" ? -24 : 0}deg)`;
        card.style.opacity = "0";
        buzz(dir === "down" ? 8 : 18);
        const btn = document.querySelector(`.act[data-dir="${dir}"]`);
        if (btn) { btn.classList.remove("pulse"); void btn.offsetWidth; btn.classList.add("pulse"); }
        setTimeout(() => record(data, S.actions[dir].id), 220);
    }

    async function record(data, actionId) {
        const r = V.decide(S.decisions, S.history, data, actionId, S.actions);
        S.decisions = r.decisions;
        S.history = r.history;
        S.photoIndex = 0;
        await saveState();
        emit("decide", { card: data, actionId });
        if (!document.body.classList.contains("game-on") && actionId !== S.actions.down.id && V.groupDone(S.cards, S.decisions, S.actions, data.group.groupId)) celebrate(data.group);
        renderDeck();
    }

    function celebrate(group) {
        const counts = V.groupSummary(S.cards, S.decisions, group.groupId);
        $("celebrateTitle").textContent = `${group.title || "Group"} done`;
        $("celebrateSub").textContent = Object.entries(counts).map(([id, n]) => `${labelOf(id)} ${n}`).join(" · ");
        const box = $("celebrate");
        box.hidden = false;
        buzz([12, 60, 18]);
        setTimeout(() => { box.hidden = true; }, 1300);
    }
    $("celebrate").addEventListener("click", () => { $("celebrate").hidden = true; });

    function decideTop(dir) {
        const q = queue();
        const card = $("stack").querySelector(".card:not(.behind)");
        if (!q.length || !card) return;
        throughGate(q[0], S.actions[dir].id, () => flyOut(card, q[0], dir, 0, 0));
    }
    document.querySelectorAll(".act[data-dir]").forEach(b => b.addEventListener("click", () => decideTop(b.dataset.dir)));
    $("actUndo").addEventListener("click", async () => {
        const r = V.undo(S.decisions, S.history);
        if (!r.key) return;
        S.decisions = r.decisions;
        S.history = r.history;
        S.photoIndex = 0;
        await saveState();
        buzz(10);
        emit("undo", { key: r.key });
        renderDeck();
        toast("Undone");
    });
    document.addEventListener("keydown", e => {
        if ($("deck").hidden || !$("sheet").hidden || document.body.classList.contains("g-modal")) return;
        const map = { ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down" };
        if (map[e.key]) { e.preventDefault(); decideTop(map[e.key]); }
        if (e.key === "Backspace" || (e.key === "z" && (e.ctrlKey || e.metaKey))) $("actUndo").click();
    });
    let resizeTimer = null;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (!$("deck").hidden) renderDeck(); }, 150);
    });

    const VW = { list: [], index: 0, s: 1, tx: 0, ty: 0, baseW: 0, baseH: 0, pointers: new Map(), gesture: null, lastTap: 0,
        measuring: false, ref: [], refMm: 0, len: [] };

    function openViewer(list, index, onClose) {
        if (!list || !list.length) return;
        VW.onClose = onClose || null;
        VW.list = list;
        VW.index = Math.max(0, Math.min(index || 0, list.length - 1));
        $("viewer").hidden = false;
        setMeasuring(false);
        showViewerPhoto();
        $("viewerClose").focus();
    }
    function closeViewer() {
        $("viewer").hidden = true;
        const after = VW.onClose;
        VW.onClose = null;
        if (after) after();
        if (!$("deck").hidden && $("sheet").hidden) renderDeck();
        $("viewerImg").removeAttribute("src");
        VW.pointers.clear();
    }

    function showViewerPhoto() {
        const photo = VW.list[VW.index];
        const img = $("viewerImg");
        emit("inspect", { src: photo.src, viewer: true });
        updateViewerMove();
        $("viewerPrev").hidden = VW.index === 0;
        $("viewerNext").hidden = VW.index >= VW.list.length - 1;
        VW.ref = []; VW.len = []; VW.refMm = 0;
        img.onload = () => { fitViewer(); drawViewerMarks(); updateMeasureText(); };
        img.alt = photo.title || `Photo ${VW.index + 1}`;
        img.src = photo.src;
    }

    function itemTitle(group, index) {
        const card = S.cards.find(c => c.group.groupId === group.groupId && c.item.itemIndex === index);
        return card ? (V.itemTitle(card, S.checks) || `#${index + 1}`) : `#${index + 1}`;
    }
    function moveText(m) {
        const labels = (S.pack && S.pack.moveLabels) || {};
        return m.to === "new" ? (labels.newItem || "New item") : m.to === "none" ? (labels.none || "Off this item") : itemTitle({ groupId: m.groupId }, m.to);
    }
    function updateViewerEdit() {
        const bar = $("viewerEdit");
        const photo = VW.list[VW.index] || {};
        bar.replaceChildren();
        bar.hidden = !photo.edit || VW.measuring;
        if (!photo.edit) return;
        const e = photo.edit;
        const save = async v => {
            await e.save(v);
            e.value = v;
            toast(`${e.label}: ${v || "(blank)"} ✓`, 1600);
            if (VW.index < VW.list.length - 1) viewerStep(1); else updateViewerEdit();
        };
        bar.append(el("label", "viewer-edit-label", e.label), valueControl({ ...e, save }));
        const ok = el("button", "viewer-pill", "✓ Right");
        ok.type = "button";
        ok.addEventListener("click", () => save(e.value || ""));
        bar.appendChild(ok);
    }

    function updateViewerMove() {
        updateViewerEdit();
        const photo = VW.list[VW.index] || {};
        const cap = $("viewerCaption");
        cap.textContent = photo.caption ? String(photo.caption) : "";
        cap.hidden = !photo.caption || VW.measuring;
        const m = photo.move ? V.moveOf(S.moves, photo.move.group.groupId, photo.move.photoId) : null;
        $("viewerCount").textContent = [photo.title, VW.list.length > 1 ? `${VW.index + 1} / ${VW.list.length}` : "", m ? `→ ${moveText(m)}` : ""].filter(Boolean).join(" · ");
        $("viewerMoveBtn").hidden = !photo.move;
        $("viewerMoveBtn").setAttribute("aria-pressed", String(Boolean(m)));
    }

    function openMoveSheet() {
        const photo = VW.list[VW.index];
        if (!photo || !photo.move) return;
        const { group, photoId, from } = photo.move;
        const labels = (S.pack && S.pack.moveLabels) || {};
        const current = V.moveOf(S.moves, group.groupId, photoId);
        const body = $("moveBody");
        body.replaceChildren();
        const choose = async to => {
            S.moves = V.setMove(S.moves, { groupId: group.groupId, photoId, from, to });
            await saveState();
            $("moveSheet").hidden = true;
            buzz(10);
            updateViewerMove();
            const now = V.moveOf(S.moves, group.groupId, photoId);
            toast(now ? `Photo → ${moveText(now)}` : "Move undone.");
        };
        const option = (label, to, sub) => {
            const b = el("button", `move-opt${current && current.to === to ? " on" : ""}`);
            b.type = "button";
            b.append(el("span", "", label));
            if (sub) b.appendChild(el("small", "", sub));
            b.addEventListener("click", () => choose(to));
            body.appendChild(b);
        };
        for (const c of S.cards.filter(x => x.group.groupId === group.groupId)) {
            if (c.item.itemIndex === from) continue;
            option(c.item.title || `#${c.item.itemIndex + 1}`, c.item.itemIndex, from === null ? (labels.addTo || "Add to this item") : (labels.moveTo || "Move here"));
        }
        option(labels.newItem || "New item", "new", labels.newItemHint || "Starts a new item with this photo");
        if (from !== null) option(labels.none || "Off this item", "none", labels.noneHint || "This photo doesn't belong to it");
        if (current) {
            const clear = el("button", "btn btn-block", "Undo this move");
            clear.type = "button";
            clear.addEventListener("click", () => choose(null));
            body.appendChild(clear);
        }
        $("moveTitle").textContent = labels.title || "Where does this photo belong?";
        $("moveSheet").hidden = false;
    }
    $("moveClose").addEventListener("click", () => { $("moveSheet").hidden = true; });
    $("moveSheet").addEventListener("click", e => { if (e.target === $("moveSheet")) $("moveSheet").hidden = true; });

    function fitViewer() {
        const img = $("viewerImg");
        const stage = $("viewerStage").getBoundingClientRect();
        const ratio = img.naturalWidth / img.naturalHeight || 3 / 4;
        let w = stage.width, h = w / ratio;
        if (h > stage.height) { h = stage.height; w = h * ratio; }
        VW.baseW = w; VW.baseH = h;
        const layer = $("viewerLayer");
        layer.style.width = `${w}px`;
        layer.style.height = `${h}px`;
        VW.s = 1;
        VW.tx = (stage.width - w) / 2;
        VW.ty = (stage.height - h) / 2;
        applyViewer();
    }

    function applyViewer() {
        const stage = $("viewerStage").getBoundingClientRect();
        const w = VW.baseW * VW.s, h = VW.baseH * VW.s;
        VW.tx = w <= stage.width ? (stage.width - w) / 2 : Math.min(0, Math.max(stage.width - w, VW.tx));
        VW.ty = h <= stage.height ? (stage.height - h) / 2 : Math.min(0, Math.max(stage.height - h, VW.ty));
        $("viewerLayer").style.transform = `translate(${VW.tx}px, ${VW.ty}px) scale(${VW.s})`;
    }

    function zoomAt(x, y, s) {
        const ns = Math.max(1, Math.min(8, s));
        const ix = (x - VW.tx) / VW.s, iy = (y - VW.ty) / VW.s;
        VW.s = ns;
        VW.tx = x - ix * ns;
        VW.ty = y - iy * ns;
        applyViewer();
    }

    function toImage(x, y) {
        const img = $("viewerImg");
        const fx = (x - VW.tx) / (VW.baseW * VW.s), fy = (y - VW.ty) / (VW.baseH * VW.s);
        if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
        return { x: fx * img.naturalWidth, y: fy * img.naturalHeight };
    }

    function drawViewerMarks() {
        const img = $("viewerImg");
        const W = img.naturalWidth || 1000, H = img.naturalHeight || 1000;
        const svg = $("viewerSvg");
        const ns = "http://www.w3.org/2000/svg";
        svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
        svg.setAttribute("preserveAspectRatio", "none");
        svg.replaceChildren();
        const add = (tag, attrs) => {
            const n = document.createElementNS(ns, tag);
            for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
            svg.appendChild(n);
        };
        const photo = VW.list[VW.index] || {};
        if (!VW.measuring) {
            for (const b of Array.isArray(photo.boxes) ? photo.boxes : []) {
                if (!Array.isArray(b) || b.length < 4) continue;
                add("rect", { class: "box", x: b[0] * W / 1000, y: b[1] * H / 1000, width: b[2] * W / 1000, height: b[3] * H / 1000, rx: 8 });
            }
        }
        const r = Math.max(W, H) / 160 / Math.sqrt(VW.s);
        for (const [pts, cls] of [[VW.ref, "m-ref"], [VW.len, "m-len"]]) {
            if (pts.length === 2) add("line", { class: cls, x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y });
            for (const p of pts) add("circle", { class: "m-dot", cx: p.x, cy: p.y, r });
        }
    }

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    function updateMeasureText() {
        const t = $("viewerMeasureText");
        $("viewerRefRow").hidden = !(VW.ref.length === 2 && !VW.refMm);
        if (VW.ref.length < 2) t.textContent = `Tap two marks on the ruler (${VW.ref.length} of 2). Pinch to zoom in first for a closer tap.`;
        else if (!VW.refMm) t.textContent = "How many mm apart are those two marks?";
        else if (VW.len.length < 2) t.textContent = `Now tap both ends of what you want to measure (${VW.len.length} of 2).`;
        else {
            const mm = dist(VW.len[0], VW.len[1]) / dist(VW.ref[0], VW.ref[1]) * VW.refMm;
            t.replaceChildren(document.createTextNode("About "), el("b", "", `${mm < 10 ? mm.toFixed(1) : Math.round(mm)} mm`),
                document.createTextNode(" - only as good as the taps and the ruler sitting flat beside it. Tap again to measure something else."));
        }
    }

    function setMeasuring(on) {
        VW.measuring = on;
        VW.ref = []; VW.len = []; VW.refMm = 0;
        $("viewerMeasureBtn").setAttribute("aria-pressed", String(on));
        $("viewerMeasure").hidden = !on;
        if (typeof updateViewerEdit === "function") updateViewerEdit();
        if (on) updateMeasureText();
        drawViewerMarks();
    }

    function viewerTap(x, y) {
        const now = performance.now();
        if (!VW.measuring) {
            if (now - VW.lastTap < 300) { zoomAt(x, y, VW.s > 1.2 ? 1 : 2.5); VW.lastTap = 0; }
            else VW.lastTap = now;
            return;
        }
        const p = toImage(x, y);
        if (!p) return;
        if (VW.ref.length < 2) VW.ref.push(p);
        else if (!VW.refMm) return;
        else if (VW.len.length < 2) VW.len.push(p);
        else VW.len = [p];
        buzz(6);
        drawViewerMarks();
        updateMeasureText();
        if (VW.ref.length === 2 && !VW.refMm) $("viewerRefMm").focus();
    }

    function viewerStep(step) {
        const next = VW.index + step;
        if (next < 0 || next >= VW.list.length) { buzz(8); return; }
        VW.index = next;
        const measuring = VW.measuring;
        showViewerPhoto();
        if (measuring) setMeasuring(true);
    }

    (function wireViewer() {
        const stage = $("viewerStage");
        const local = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
        stage.addEventListener("pointerdown", e => {
            stage.setPointerCapture(e.pointerId);
            VW.pointers.set(e.pointerId, local(e));
            const pts = [...VW.pointers.values()];
            if (pts.length === 1) VW.gesture = { kind: "pan", start: pts[0], tx: VW.tx, ty: VW.ty, t: performance.now(), moved: false };
            else if (pts.length === 2) {
                const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
                VW.gesture = { kind: "pinch", d: Math.max(1, dist(pts[0], pts[1])), s: VW.s, ix: (mid.x - VW.tx) / VW.s, iy: (mid.y - VW.ty) / VW.s };
            }
        });
        stage.addEventListener("pointermove", e => {
            if (!VW.pointers.has(e.pointerId) || !VW.gesture) return;
            VW.pointers.set(e.pointerId, local(e));
            const pts = [...VW.pointers.values()];
            const g = VW.gesture;
            if (g.kind === "pinch" && pts.length >= 2) {
                const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
                VW.s = Math.max(1, Math.min(8, g.s * dist(pts[0], pts[1]) / g.d));
                VW.tx = mid.x - g.ix * VW.s;
                VW.ty = mid.y - g.iy * VW.s;
                applyViewer();
                drawViewerMarks();
            } else if (g.kind === "pan") {
                const p = pts[0];
                if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > TAP_MOVE) g.moved = true;
                if (VW.s > 1.01) { VW.tx = g.tx + p.x - g.start.x; VW.ty = g.ty + p.y - g.start.y; applyViewer(); }
            }
        });
        const end = e => {
            if (!VW.pointers.has(e.pointerId)) return;
            const p = VW.pointers.get(e.pointerId);
            VW.pointers.delete(e.pointerId);
            const g = VW.gesture;
            if (VW.pointers.size) {
                const rest = [...VW.pointers.values()][0];
                VW.gesture = { kind: "pan", start: rest, tx: VW.tx, ty: VW.ty, t: performance.now(), moved: true };
                return;
            }
            VW.gesture = null;
            if (!g || g.kind !== "pan" || e.type === "pointercancel") return;
            const dx = p.x - g.start.x, dy = p.y - g.start.y;
            if (!g.moved && performance.now() - g.t < 350) viewerTap(p.x, p.y);
            else if (VW.s <= 1.01 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) viewerStep(dx < 0 ? 1 : -1);
            else if (VW.s <= 1.01 && dy > 120 && Math.abs(dy) > Math.abs(dx) * 1.5 && !VW.measuring) closeViewer();
        };
        stage.addEventListener("pointerup", end);
        stage.addEventListener("pointercancel", end);
        stage.addEventListener("wheel", e => { e.preventDefault(); const p = local(e); zoomAt(p.x, p.y, VW.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); drawViewerMarks(); }, { passive: false });
        $("viewerClose").addEventListener("click", closeViewer);
        $("viewerPrev").addEventListener("click", () => viewerStep(-1));
        $("viewerNext").addEventListener("click", () => viewerStep(1));
        $("viewerMeasureBtn").addEventListener("click", () => setMeasuring(!VW.measuring));
        $("viewerMoveBtn").addEventListener("click", openMoveSheet);
        $("viewerMeasureReset").addEventListener("click", () => setMeasuring(true));
        const takeRef = () => {
            const mm = Number(String($("viewerRefMm").value).replace(",", "."));
            if (!(mm > 0)) { $("viewerRefMm").focus(); return; }
            VW.refMm = mm;
            $("viewerRefMm").blur();
            updateMeasureText();
        };
        $("viewerRefOk").addEventListener("click", takeRef);
        $("viewerRefMm").addEventListener("keydown", e => { if (e.key === "Enter") takeRef(); });
        document.addEventListener("keydown", e => {
            if ($("viewer").hidden) return;
            if (e.key === "Escape") closeViewer();
            else if (e.key === "ArrowRight") viewerStep(1);
            else if (e.key === "ArrowLeft") viewerStep(-1);
        });
        window.addEventListener("resize", () => { if (!$("viewer").hidden) { fitViewer(); drawViewerMarks(); } });
    })();

    const SETTINGS_ID = "~settings";
    const AI_DEFAULT_MODEL = "claude-opus-5-5";
    const AI_MAX_IMAGES = 8;
    const AI = { key: "", threads: {}, busy: false };

    async function loadAiKey() {
        try { AI.key = ((await get("state", SETTINGS_ID)) || {}).aiKey || ""; } catch (_) { AI.key = ""; }
        $("openKeyLabel").textContent = AI.key ? "AI is set up" : "Set up AI";
    }
    async function saveAiKey(key) {
        AI.key = key;
        await put("state", { packId: SETTINGS_ID, aiKey: key });
        $("openKeyLabel").textContent = key ? "AI is set up" : "Set up AI";
    }

    function openKeySheet() {
        $("keyInput").value = "";
        $("keyStatus").textContent = AI.key ? `A key is saved (…${AI.key.slice(-4)}).` : "No key saved yet.";
        $("keyRemove").hidden = !AI.key;
        $("keySheet").hidden = false;
        $("keyInput").focus();
    }
    $("openKey").addEventListener("click", openKeySheet);
    $("keyClose").addEventListener("click", () => { $("keySheet").hidden = true; });
    $("keyForm").addEventListener("submit", async e => {
        e.preventDefault();
        const key = $("keyInput").value.trim();
        if (!key) return;
        await saveAiKey(key);
        $("keyInput").value = "";
        $("keySheet").hidden = true;
        toast("AI key saved on this phone.");
    });
    $("keyRemove").addEventListener("click", async () => {
        await saveAiKey("");
        $("keySheet").hidden = true;
        toast("AI key removed.");
    });

    const aiConfig = () => (S.pack && S.pack.ai && typeof S.pack.ai === "object") ? S.pack.ai : {};
    const dataUrlParts = src => {
        const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(String(src || ""));
        return m ? { media_type: m[1], data: m[2] } : null;
    };

    function aiFirstContent(data, question) {
        const content = [];
        const images = [...data.photos.map(p => ({ src: p.src, label: "photo" })),
            ...(Array.isArray(data.group.attachments) ? data.group.attachments : []).map(a => ({ src: a.src, label: a.title || "attachment" }))]
            .slice(0, AI_MAX_IMAGES);
        images.forEach((img, i) => {
            const part = dataUrlParts(img.src);
            if (!part) return;
            content.push({ type: "text", text: `Image ${i + 1}: ${img.label}` });
            content.push({ type: "image", source: { type: "base64", ...part } });
        });
        const lines = [`Card: ${data.item.title || ""}`, `Group: ${[data.group.title, data.group.subtitle].filter(Boolean).join(" · ")}`];
        if (data.item.suggestion) lines.push(`${S.pack.suggestionTitle || "Suggested"}: ${(S.pack.suggestionLabels && S.pack.suggestionLabels[data.item.suggestion]) || labelOf(data.item.suggestion)}`);
        for (const c of Array.isArray(data.item.chips) ? data.item.chips : []) lines.push(`Note: ${c}`);
        for (const [k, v] of [...pairs(data.item.details), ...pairs(data.group.details)]) lines.push(`${k}: ${v}`);
        if (data.item.notes) lines.push(`${data.item.noteTitle || "Notes"}:\n${data.item.notes}`);
        if (data.item.footnote) lines.push(data.item.footnote);
        if (data.group.notes) lines.push(`${data.group.noteTitle || "Group notes"}:\n${String(data.group.notes).slice(0, 8000)}`);
        lines.push(`Choices: ${V.DIRECTIONS.map(d => S.actions[d].label).join(" / ")}`);
        const boxes = data.photos.some(p => Array.isArray(p.boxes) && p.boxes.length);
        if (boxes) lines.push("Marked areas on the photos (x, y, w, h in a 0-1000 frame): " + data.photos.map((p, i) => `photo ${i + 1}: ${JSON.stringify(p.boxes || [])}`).join("; "));
        content.push({ type: "text", text: `${lines.join("\n")}\n\nQuestion: ${question}` });
        return content;
    }

    function renderAiThread(data) {
        const box = $("aiThread");
        box.replaceChildren();
        const thread = AI.threads[data.key] || [];
        for (const turn of thread) {
            if (turn.role === "user") box.appendChild(el("div", "ai-q", turn.question));
            else box.appendChild(el("div", `ai-a${turn.error ? " error" : ""}`, turn.text));
            if (turn.cost) box.appendChild(el("div", "ai-cost", turn.cost));
        }
        if (AI.busy) box.appendChild(el("div", "ai-a pending", "Thinking…"));
        box.scrollTop = box.scrollHeight;
    }

    function openAiSheet(data) {
        AI.card = data;
        $("aiTitle").textContent = `Ask AI · ${data.item.title || ""}`;
        const presets = Array.isArray(aiConfig().presets) && aiConfig().presets.length ? aiConfig().presets
            : [{ label: "Second opinion", prompt: "Which choice would you make for this card, and why? Point to what in the photos decides it." }];
        const row = $("aiPresets");
        row.replaceChildren();
        for (const p of presets.slice(0, 6)) {
            const b = el("button", "viewer-pill ai-preset", String(p.label || "Ask"));
            b.type = "button";
            b.addEventListener("click", () => askAi(String(p.prompt || p.label || "")));
            row.appendChild(b);
        }
        $("aiHint").textContent = AI.key ? `Sends this card's text and up to ${AI_MAX_IMAGES} images to ${aiConfig().model || AI_DEFAULT_MODEL}.` : "Set up AI on the home screen first (your own API key).";
        renderAiThread(data);
        $("aiSheet").hidden = false;
    }

    async function askAi(question) {
        const data = AI.card;
        question = String(question || "").trim();
        if (!data || !question || AI.busy) return;
        if (!AI.key) { toast("Set up AI on the home screen first."); return; }
        emit("ai");
        const thread = AI.threads[data.key] = AI.threads[data.key] || [];
        const messages = [];
        for (const turn of thread) {
            if (turn.error) continue;
            messages.push(turn.role === "user" ? { role: "user", content: turn.content } : { role: "assistant", content: turn.content });
        }
        while (messages.length && messages[messages.length - 1].role === "user") messages.pop();
        const content = messages.length ? [{ type: "text", text: question }] : aiFirstContent(data, question);
        thread.push({ role: "user", question, content });
        messages.push({ role: "user", content });
        AI.busy = true;
        $("aiQuestion").value = "";
        $("aiSend").disabled = true;
        renderAiThread(data);
        const cfg = aiConfig();
        const model = String(cfg.model || AI_DEFAULT_MODEL);
        try {
            const body = {
                model, max_tokens: 4000, messages, fallbacks: "default",
                system: String(cfg.system || "You help a reviewer decide on one card from a set of photos and notes. Answer briefly and concretely, in the reviewer's language. Say what in the photos supports your answer, and say plainly when the photos cannot decide it.")
            };
            if (cfg.effort) body.output_config = { effort: String(cfg.effort) };
            const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-api-key": AI.key,
                    "anthropic-version": "2026-10-21",
                    "anthropic-beta": "server-side-fallback-2026-07-01",
                    "anthropic-dangerous-direct-browser-access": "true"
                },
                body: JSON.stringify(body)
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg = (json.error && json.error.message) || `HTTP ${res.status}`;
                throw new Error(res.status === 401 ? "The AI key was not accepted - check it on the home screen." : res.status === 429 ? "Too many requests right now - try again in a minute." : msg);
            }
            if (json.stop_reason === "refusal") throw new Error("The AI declined to answer this one.");
            const blocks = Array.isArray(json.content) ? json.content : [];
            const text = blocks.filter(b => b.type === "text").map(b => b.text).join("\n").trim() || "(no answer)";
            const u = json.usage || {};
            const price = cfg.price && Number(cfg.price.in) >= 0 ? cfg.price : null;
            const usd = price ? ((u.input_tokens || 0) * Number(price.in) + (u.output_tokens || 0) * Number(price.out)) / 1e6 : null;
            thread.push({ role: "assistant", text, content: blocks, cost: `${u.input_tokens || 0} in · ${u.output_tokens || 0} out tokens${usd !== null ? ` · about $${usd.toFixed(3)}` : ""}` });
        } catch (error) {
            thread.push({ role: "assistant", error: true, text: navigator.onLine === false ? "No connection - AI needs the internet. Swiping still works offline." : `AI: ${error.message}` });
        } finally {
            AI.busy = false;
            $("aiSend").disabled = false;
            if (AI.card === data) renderAiThread(data);
        }
    }
    const translating = new Set();
    const textKey = t => { const x = String(t || ""); let h = 0; for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) | 0; return `${x.length}:${h}`; };
    const needsTranslation = t => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(String(t || ""));
    async function translateNotes(data, button) {
        const gid = data.group.groupId;
        if (!AI.key) { toast("Set up AI on the home screen first."); return; }
        if (translating.has(gid)) return;
        translating.add(gid);
        if (button) { button.disabled = true; button.textContent = "Translating…"; }
        const cfg = aiConfig();
        const lang = String(cfg.translateTo || "English");
        try {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-api-key": AI.key,
                    "anthropic-version": "2026-10-21",
                    "anthropic-beta": "server-side-fallback-2026-07-01",
                    "anthropic-dangerous-direct-browser-access": "true"
                },
                body: JSON.stringify({
                    model: String(cfg.model || AI_DEFAULT_MODEL),
                    max_tokens: 8000,
                    fallbacks: "default",
                    output_config: { effort: "low" },
                    system: `Translate the user's text into clear, natural ${lang}. Keep the order and any labels or speaker names. After each part name or specialist term, keep the original word in brackets. Keep numbers, sizes, dates, codes and file names exactly. Output only the translation, no comments.`,
                    messages: [{ role: "user", content: [{ type: "text", text: String(data.group.notes) }] }]
                })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(res.status === 401 ? "The AI key was not accepted." : (json.error && json.error.message) || `HTTP ${res.status}`);
            if (json.stop_reason === "refusal") throw new Error("The AI declined this one.");
            const text = (Array.isArray(json.content) ? json.content : []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
            if (!text) throw new Error("No translation came back.");
            S.translations = { ...S.translations, [gid]: { text, lang, source: textKey(data.group.notes), at: new Date().toISOString() } };
            await saveState();
            S.showOriginal = false;
            if (!$("sheet").hidden && $("sheetTitle").textContent === (V.itemTitle(data, S.checks) || "")) refreshSheet(data);
        } catch (error) {
            toast(navigator.onLine === false ? "No connection - translation needs the internet." : `Translation: ${error.message}`, 4000);
            if (button) { button.disabled = false; button.textContent = "Translate"; }
        } finally {
            translating.delete(gid);
        }
    }

    $("aiForm").addEventListener("submit", e => { e.preventDefault(); askAi($("aiQuestion").value); });
    $("aiClose").addEventListener("click", () => { $("aiSheet").hidden = true; });
    $("aiSheet").addEventListener("click", e => { if (e.target === $("aiSheet")) $("aiSheet").hidden = true; });
    $("keySheet").addEventListener("click", e => { if (e.target === $("keySheet")) $("keySheet").hidden = true; });
    loadAiKey();

    function refreshSheet(data) {
        const panel = $("sheet").querySelector(".sheet-panel");
        const top = panel ? panel.scrollTop : 0;
        openSheet(data, true);
        if (panel) panel.scrollTop = top;
    }

    function openSheet(data, refresh) {
        if (!refresh) emit("details");
        $("sheetTitle").textContent = V.itemTitle(data, S.checks) || "";
        const body = $("sheetBody");
        body.replaceChildren();
        renderItemValues(body, data);
        renderFields(body, data);
        const kv = el("dl", "kv");
        if (data.item.suggestion) {
            kv.append(el("dt", "", S.pack.suggestionTitle || "Suggested"), el("dd", "", (S.pack.suggestionLabels && S.pack.suggestionLabels[data.item.suggestion]) || labelOf(data.item.suggestion)));
        }
        for (const [k, v] of [...pairs(data.item.details), ...pairs(data.group.details)]) kv.append(el("dt", "", String(k)), el("dd", "", String(v)));
        body.appendChild(kv);
        if (data.item.notes) {
            body.appendChild(el("h3", "", data.item.noteTitle || "Notes"));
            body.appendChild(el("p", "note-text", data.item.notes));
        }
        if (data.item.footnote) body.appendChild(el("p", "note-text", data.item.footnote));
        const attachments = (Array.isArray(data.group.attachments) ? data.group.attachments : []).filter(a => a && typeof a.src === "string" && a.src.startsWith("data:image/"));
        if (attachments.length) {
            body.appendChild(el("h3", "", data.group.attachmentsTitle || "Attachments"));
            const list = el("div", "attach-list");
            attachments.forEach((a, i) => {
                const b = el("button", "attach");
                b.type = "button";
                const img = new Image();
                img.alt = "";
                img.loading = "lazy";
                img.src = a.src;
                b.append(img, el("span", "", a.title || `Attachment ${i + 1}`));
                b.addEventListener("click", () => openViewer(attachments.map(x => ({ src: x.src, title: x.title || "", caption: x.caption || "", move: x.movable && x.id ? { group: data.group, photoId: String(x.id), from: null } : null })), i));
                list.appendChild(b);
            });
            body.appendChild(list);
        }
        if (data.group.notes) {
            const own = S.translations[data.group.groupId];
            const sameText = own && own.source === textKey(data.group.notes);
            const alt = data.group.notesAlt && data.group.notesAlt.text ? data.group.notesAlt
                : sameText ? { label: `${own.lang || "English"} (AI)`, text: own.text } : null;
            const head = el("div", "fields-head");
            head.appendChild(el("h3", "", data.group.noteTitle || "Notes"));
            const text = el("p", "note-text long", "");
            const show = original => {
                S.showOriginal = original;
                text.textContent = String(alt && !original ? alt.text : data.group.notes);
                if (toggle) toggle.textContent = original ? (alt.label || "Translation") : "Original";
            };
            let toggle = null;
            if (alt) {
                toggle = el("button", "viewer-pill field-ok", "");
                toggle.type = "button";
                toggle.addEventListener("click", () => show(!S.showOriginal));
                head.appendChild(toggle);
            }
            if (!alt && needsTranslation(data.group.notes)) {
                const tr = el("button", "viewer-pill field-ok", AI.key ? "Translate" : "Translate (set up AI)");
                tr.type = "button";
                tr.addEventListener("click", () => translateNotes(data, tr));
                head.appendChild(tr);
                if (AI.key && !translating.has(data.group.groupId)) translateNotes(data, tr);
            }
            body.append(head, text);
            show(alt ? Boolean(S.showOriginal) : true);
        }
        const others = S.cards.filter(c => c.group.groupId === data.group.groupId && c !== data);
        if (others.length) {
            body.appendChild(el("h3", "", "Others in this group"));
            for (const o of others) {
                const d = S.decisions[o.key];
                const row = el("div", "row");
                const pill = el("span", "pill", d ? labelOf(d.action) : "Open");
                if (d) pill.style.setProperty("--c", colorOf(d.action));
                row.append(el("div", "row-text", o.item.title || ""), pill);
                body.appendChild(row);
            }
        }
        const wasOpen = !$("sheet").hidden;
        $("sheet").hidden = false;
        if (!refresh && !wasOpen) {
            const panel = $("sheet").querySelector(".sheet-panel");
            if (panel) panel.scrollTop = 0;
            $("sheetClose").focus({ preventScroll: true });
        }
    }
    const norm = v => String(v ?? "").normalize("NFKC").trim().toLowerCase();

    function openListPicker(title, options, current, onPick, extras) {
        const body = $("moveBody");
        body.replaceChildren();
        const search = document.createElement("input");
        search.type = "search";
        search.className = "field-input list-search";
        search.placeholder = "Search…";
        search.setAttribute("aria-label", `Search ${title}`);
        const list = el("div", "list-pick");
        const choose = async value => { $("moveSheet").hidden = true; await onPick(value); };
        const top = (extras || []).filter(x => x && x.value);
        const draw = () => {
            const q = norm(search.value);
            list.replaceChildren();
            const seen = new Set();
            const add = (label, value, sub) => {
                if (seen.has(value)) return;
                seen.add(value);
                const b = el("button", `move-opt${value === current ? " on" : ""}`);
                b.type = "button";
                b.append(el("span", "", label));
                if (sub) b.appendChild(el("small", "", sub));
                b.addEventListener("click", () => choose(value));
                list.appendChild(b);
            };
            if (!q) for (const x of top) add(x.value, x.value, x.sub);
            const matches = options.filter(o => !q || norm(o).includes(q));
            for (const o of matches.slice(0, 80)) add(o, o, o === current ? "Current" : "");
            if (q && !matches.length) list.appendChild(el("p", "hint", "Nothing on the list matches."));
        };
        search.addEventListener("input", draw);
        body.append(search, list);
        draw();
        $("moveTitle").textContent = title;
        $("moveSheet").hidden = false;
    }

    function valueControl({ type, value, dateValue, options, inputMode, label, save, listTitle, extras }) {
        if (type === "date") {
            const input = document.createElement("input");
            input.type = "date";
            input.className = "field-input";
            input.value = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : (dateValue || "");
            input.setAttribute("aria-label", label);
            input.addEventListener("change", () => { if (input.value) save(input.value); });
            return input;
        }
        const list = options && S.pack.options && Array.isArray(S.pack.options[options]) ? S.pack.options[options] : null;
        if (list && list.length) {
            const b = el("button", "field-input field-pick", value || "Choose…");
            b.type = "button";
            b.setAttribute("aria-label", `${label}: ${value || "not set"} - change`);
            b.addEventListener("click", () => openListPicker(listTitle || label, list, value, save, extras));
            return b;
        }
        const input = document.createElement("input");
        input.className = "field-input";
        input.value = value || "";
        input.placeholder = "(blank)";
        input.autocomplete = "off";
        input.enterKeyHint = "done";
        if (inputMode) input.inputMode = inputMode;
        input.setAttribute("aria-label", label);
        const commit = () => { if (input.value.trim() !== String(value || "").trim()) save(input.value.trim()); };
        input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
        input.addEventListener("change", commit);
        return input;
    }

    function renderItemValues(body, data) {
        const defs = (Array.isArray(S.pack.itemFields) ? S.pack.itemFields : []).filter(d => d && d.id);
        if (!defs.length || !data.item.values) return;
        body.appendChild(el("h3", "", S.pack.itemFieldsTitle || "Correct this card"));
        const box = el("div", "item-values");
        const hint = data.item.hint;
        const setValue = async (fieldId, value) => {
            const original = String((data.item.values || {})[fieldId] ?? "").trim();
            S.checks = V.setFieldCheck(S.checks, { groupId: data.group.groupId, fieldId, itemIndex: data.item.itemIndex, value: String(value).trim() === original ? null : value });
            await saveState();
            emit("check");
            buzz(8);
            refreshSheet(data);
        };
        if (hint && (hint.text || hint.image)) {
            const h = el("div", "hint-box");
            if (typeof hint.image === "string" && hint.image.startsWith("data:image/")) {
                const pic = el("button", "field-pic");
                pic.type = "button";
                pic.setAttribute("aria-label", "Zoom the mark on the form");
                const img = new Image();
                img.alt = "";
                img.src = hint.image;
                pic.appendChild(img);
                pic.addEventListener("click", () => openViewer([{ src: hint.image, title: hint.title || "" }], 0));
                h.appendChild(pic);
            }
            const t = el("div", "hint-text");
            t.append(el("small", "", [hint.title || "The other side says", hint.source].filter(Boolean).join(" · ")), el("span", "", hint.text || ""));
            h.appendChild(t);
            const hv = hint.values || {};
            const differs = defs.some(d => hv[d.id] && hv[d.id] !== V.itemValue(S.checks, data, d.id));
            if (differs) {
                const use = el("button", "viewer-pill hint-use", "Use");
                use.type = "button";
                use.setAttribute("aria-label", `Use: ${defs.map(d => hv[d.id]).filter(Boolean).join(" · ")}`);
                use.addEventListener("click", async () => {
                    for (const d of defs) {
                        if (!hv[d.id]) continue;
                        const original = String((data.item.values || {})[d.id] ?? "").trim();
                        S.checks = V.setFieldCheck(S.checks, { groupId: data.group.groupId, fieldId: d.id, itemIndex: data.item.itemIndex, value: hv[d.id] === original ? null : hv[d.id] });
                    }
                    await saveState();
                    buzz(8);
                    refreshSheet(data);
                });
                h.appendChild(use);
            }
            box.appendChild(h);
        }
        for (const d of defs) {
            const check = V.fieldCheckOf(S.checks, data.group.groupId, d.id, data.item.itemIndex);
            const value = V.itemValue(S.checks, data, d.id);
            const row = el("div", `item-value${check ? " checked" : ""}`);
            const head = el("div", "field-head");
            head.appendChild(el("span", "field-label", d.label || d.id));
            if (check) {
                const undo = el("button", "link-btn", `Undo (was ${String((data.item.values || {})[d.id] || "blank")})`);
                undo.type = "button";
                undo.addEventListener("click", () => setValue(d.id, String((data.item.values || {})[d.id] ?? "")));
                head.appendChild(undo);
            }
            const hv = hint && hint.values && hint.values[d.id];
            row.append(head, valueControl({ type: d.type, value, options: d.options, label: d.label || d.id, listTitle: d.label || d.id,
                extras: [hv ? { value: hv, sub: hint.title || "Suggested" } : null, value ? { value, sub: "Current" } : null],
                save: v => setValue(d.id, v) }));
            box.appendChild(row);
        }
        body.appendChild(box);
    }

    const FIELD_STATUS = { done: "Confirmed", ok: "Auto-verified", check: "Check" };
    function renderFields(body, data) {
        const g = data.group;
        const fields = (Array.isArray(g.fields) ? g.fields : []).filter(f => f && f.id);
        if (!fields.length && !g.fieldsNote) return;
        const head = el("div", "fields-head");
        head.appendChild(el("h3", "", g.fieldsTitle || "Values"));
        const open = fields.filter(f => f.status !== "done" && !V.fieldCheckOf(S.checks, g.groupId, f.id));
        if (open.length > 1) {
            const all = el("button", "viewer-pill field-ok", `All OK (${open.length})`);
            all.type = "button";
            all.addEventListener("click", async () => {
                for (const f of open) S.checks = V.setFieldCheck(S.checks, { groupId: g.groupId, fieldId: f.id, value: String(f.value || "") });
                await saveState();
                buzz(8);
                refreshSheet(data);
            });
            head.appendChild(all);
        }
        body.appendChild(head);
        if (g.fieldsNote) body.appendChild(el("p", "note-text", String(g.fieldsNote)));
        const saveField = async (f, value) => {
            S.checks = V.setFieldCheck(S.checks, { groupId: g.groupId, fieldId: f.id, value });
            await saveState();
            emit("check");
            buzz(8);
        };
        const currentOf = f => { const c = V.fieldCheckOf(S.checks, g.groupId, f.id); return c ? c.value : String(f.value || ""); };
        const withImg = fields.filter(f => typeof f.image === "string" && f.image.startsWith("data:image/"));
        const viewerList = () => withImg.map(f => ({ src: f.image, title: f.label || f.id,
            edit: { label: f.label || f.id, type: f.type, options: f.options, inputMode: f.inputMode, dateValue: f.dateValue,
                value: currentOf(f), save: async v => { await saveField(f, v); } } }));
        for (const f of fields) {
            const check = V.fieldCheckOf(S.checks, g.groupId, f.id);
            const row = el("div", `field-row${check ? " checked" : ""}`);
            if (typeof f.image === "string" && f.image.startsWith("data:image/")) {
                const pic = el("button", "field-pic");
                pic.type = "button";
                pic.setAttribute("aria-label", `Zoom and correct: ${f.label || f.id}`);
                const img = new Image();
                img.alt = "";
                img.src = f.image;
                pic.appendChild(img);
                pic.addEventListener("click", () => openViewer(viewerList(), withImg.indexOf(f), () => refreshSheet(data)));
                row.appendChild(pic);
            }
            const text = el("div", "field-text");
            const fh = el("div", "field-head");
            fh.append(el("span", "field-label", f.label || f.id),
                el("span", `field-status ${check ? "checked" : (f.status || "check")}`, check ? "Checked" : (f.statusText || FIELD_STATUS[f.status] || FIELD_STATUS.check)));
            const line = el("div", "field-line");
            line.appendChild(valueControl({ type: f.type, value: currentOf(f), dateValue: f.dateValue, options: f.options, inputMode: f.inputMode,
                label: f.label || f.id, save: async v => { await saveField(f, v); refreshSheet(data); } }));
            const ok = el("button", "viewer-pill field-ok", check ? "Undo" : "✓");
            ok.type = "button";
            ok.setAttribute("aria-label", check ? `Undo ${f.label || f.id}` : `${f.label || f.id} is right`);
            ok.addEventListener("click", async () => {
                S.checks = V.setFieldCheck(S.checks, { groupId: g.groupId, fieldId: f.id, value: check ? null : String(f.value || "") });
                await saveState();
                buzz(8);
                refreshSheet(data);
            });
            line.appendChild(ok);
            text.append(fh, line);
            if (f.note) text.appendChild(el("small", "field-note", String(f.note)));
            row.appendChild(text);
            body.appendChild(row);
        }
    }

    const closeSheet = () => {
        $("sheet").hidden = true;
        if (!$("deck").hidden) renderDeck();
    };
    $("sheetClose").addEventListener("click", closeSheet);
    $("sheet").addEventListener("click", e => { if (e.target === $("sheet")) closeSheet(); });

    function openPicker(title, options, current, onPick, note) {
        const body = $("moveBody");
        body.replaceChildren();
        if (note) body.appendChild(el("p", "note-text", note));
        for (const o of options) {
            const b = el("button", `move-opt${o.value === current ? " on" : ""}`);
            b.type = "button";
            const label = el("span", "", o.label);
            if (o.color) { label.classList.add("opt-dot"); label.style.setProperty("--c", o.color); }
            b.appendChild(label);
            if (o.sub) b.appendChild(el("small", "", o.sub));
            b.addEventListener("click", async () => { $("moveSheet").hidden = true; await onPick(o.value); });
            body.appendChild(b);
        }
        $("moveTitle").textContent = title;
        $("moveSheet").hidden = false;
    }

    function changeLine(text, onUndo) {
        const line = el("div", "change");
        line.appendChild(el("span", "change-text", text));
        const x = el("button", "icon-btn change-x");
        x.type = "button";
        x.setAttribute("aria-label", `Undo: ${text}`);
        x.appendChild(svgIcon("M6 6l12 12M18 6 6 18"));
        x.addEventListener("click", async () => { await onUndo(); await saveState(); renderReview(); });
        line.appendChild(x);
        return line;
    }

    function renderReview() {
        const counts = {};
        for (const c of S.cards) {
            const id = S.decisions[c.key] ? S.decisions[c.key].action : "";
            counts[id] = (counts[id] || 0) + 1;
        }
        $("reviewSummary").replaceChildren(...Object.entries(counts).map(([id, n]) => {
            const pill = el("span", "pill", `${id ? labelOf(id) : "Open"} ${n}`);
            if (id) pill.style.setProperty("--c", colorOf(id));
            return pill;
        }));
        const list = $("reviewList");
        list.replaceChildren();
        const moves = V.movesList(S.moves);
        const checks = V.fieldChecksList(S.checks);
        const byGroup = new Map();
        for (const c of S.cards) {
            if (!byGroup.has(c.group.groupId)) byGroup.set(c.group.groupId, []);
            byGroup.get(c.group.groupId).push(c);
        }
        const itemDefs = Array.isArray(S.pack.itemFields) ? S.pack.itemFields : [];
        for (const [gid, cards] of byGroup) {
            const g = cards[0].group;
            const sec = el("section", "grp");
            const head = el("div", "grp-head");
            const ht = el("div", "grp-title");
            ht.append(el("span", "", g.title || ""), el("small", "", g.subtitle || ""));
            head.appendChild(ht);
            if (g.flag && g.flag.text) head.appendChild(el("span", `grp-flag${g.flag.tone === "block" ? " block" : ""}`, String(g.flag.text)));
            sec.appendChild(head);
            for (const c of cards) {
                const row = el("div", "row");
                const thumb = el("img", "row-thumb");
                thumb.alt = "";
                if (c.photos[0]) thumb.src = c.photos[0].src;
                const title = V.itemTitle(c, S.checks) || "";
                const text = el("div", "row-text");
                text.appendChild(el("span", "row-title", title));
                const sub = [c.item.suggestion ? `${S.pack.suggestionTitle || "Suggested"}: ${(S.pack.suggestionLabels && S.pack.suggestionLabels[c.item.suggestion]) || labelOf(c.item.suggestion)}` : "", ...(c.item.chips || [])].filter(Boolean).join(" · ");
                if (sub) text.appendChild(el("small", "", sub));
                const cur = S.decisions[c.key] ? S.decisions[c.key].action : "";
                const btn = el("button", `verdict-btn${cur ? "" : " open"}`, cur ? labelOf(cur) : "Open");
                btn.type = "button";
                btn.setAttribute("aria-label", `Decision for ${title}: ${cur ? labelOf(cur) : "open"}`);
                if (cur) btn.style.setProperty("--c", colorOf(cur));
                btn.addEventListener("click", () => openPicker(title,
                    [...V.DIRECTIONS.map(d => ({ label: S.actions[d].label, value: S.actions[d].id, color: S.actions[d].color })), { label: "Open (not decided)", value: "" }],
                    cur, async value => {
                        const apply = async () => {
                            if (!value) { const next = { ...S.decisions }; delete next[c.key]; S.decisions = next; }
                            else S.decisions = V.decide(S.decisions, S.history, c, value, S.actions).decisions;
                            await saveState();
                            renderReview();
                        };
                        if (value) throughGate(c, value, apply); else await apply();
                    }));
                row.append(thumb, text, btn);
                sec.appendChild(row);
            }
            const gm = moves.filter(m => m.groupId === gid);
            const gc = checks.filter(x => x.groupId === gid);
            const go = Object.values(S.overrides || {}).filter(o => o.groupId === gid);
            if (gm.length || gc.length || go.length) {
                const det = el("details", "changes");
                const parts = [go.length ? "override" : "", gm.length ? `${gm.length} photo move${gm.length === 1 ? "" : "s"}` : "", gc.length ? `${gc.length} value${gc.length === 1 ? "" : "s"} checked` : ""].filter(Boolean);
                det.appendChild(el("summary", "", parts.join(" · ")));
                for (const o of go) {
                    det.appendChild(changeLine(`Override: ${labelOf(o.action)} allowed`,
                        async () => { S.overrides = V.setOverride(S.overrides, o.groupId, o.action, false); }));
                }
                for (const m of gm) {
                    const att = (Array.isArray(g.attachments) ? g.attachments : []).find(a => String(a.id) === m.photoId);
                    det.appendChild(changeLine(`${m.from === null ? ((att && att.title) || "Photo") : `Photo of ${itemTitle(g, m.from)}`} → ${moveText(m)}`,
                        async () => { S.moves = V.setMove(S.moves, { groupId: m.groupId, photoId: m.photoId, from: m.from, to: null }); }));
                }
                for (const x of gc) {
                    let label = x.fieldId;
                    let was = "";
                    if (x.itemIndex === null || x.itemIndex === undefined) {
                        const f = (Array.isArray(g.fields) ? g.fields : []).find(y => y.id === x.fieldId);
                        if (f) { label = f.label || f.id; was = String(f.value || "").trim(); }
                    } else {
                        const d = itemDefs.find(y => y.id === x.fieldId);
                        const card = cards.find(y => y.item.itemIndex === x.itemIndex);
                        label = `${card ? (card.item.titlePrefix || `#${x.itemIndex + 1}`) : `#${x.itemIndex + 1}`} ${d ? d.label : x.fieldId}`;
                        was = card && card.item.values ? String(card.item.values[x.fieldId] || "") : "";
                    }
                    det.appendChild(changeLine(`${label}: ${x.value || "(blank)"}${was && was !== x.value ? ` (was ${was})` : was === x.value ? " ✓" : ""}`,
                        async () => { S.checks = V.setFieldCheck(S.checks, { groupId: x.groupId, fieldId: x.fieldId, itemIndex: x.itemIndex, value: null }); }));
                }
                sec.appendChild(det);
            }
            list.appendChild(sec);
        }
        const p = V.progress(S.cards, S.decisions, S.actions);
        $("sendDecisions").disabled = !p.decided && !moves.length && !checks.length;
        $("sendHint").textContent = `${S.sentAt ? `Last sent ${fmtDate(S.sentAt)} - send again after changes. ` : ""}${S.pack.sendHint || "Save the file where the pack came from."}`;
    }

    $("sendDecisions").addEventListener("click", async () => {
        const data = V.decisionsFile(S.pack, S.cards, S.decisions, undefined, S.moves, S.checks, S.overrides);
        const name = `vinder-decisions-${S.pack.packId}.txt`;
        const blob = new Blob([JSON.stringify(data, null, 1)], { type: "text/plain" });
        const file = new File([blob], name, { type: "text/plain" });
        try {
            let shared = false;
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({ files: [file], title: name });
                    shared = true;
                } catch (error) {
                    if (error && error.name === "AbortError") throw error;
                }
            }
            if (!shared) {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = name;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
                toast("Saved to Downloads.", 3500);
            }
            S.sentAt = new Date().toISOString();
            await saveState();
            emit("send");
            renderReview();
        } catch (error) {
            if (error && error.name === "AbortError") return;
            toast(`Couldn't send: ${error.message}`, 4000);
        }
    });

    $("backHome").addEventListener("click", () => show("home"));
    $("openReview").addEventListener("click", () => show("review"));
    $("backDeck").addEventListener("click", () => show("deck"));

    function maybeCoach() {
        try {
            if (localStorage.getItem("vinderCoached")) return;
            localStorage.setItem("vinderCoached", "1");
        } catch (_) { return; }
        $("sheetTitle").textContent = "How VINder works";
        const body = $("sheetBody");
        body.replaceChildren();
        const kv = el("dl", "kv");
        for (const [k, dir] of [["Swipe right →", "right"], ["← Swipe left", "left"], ["Swipe up ↑", "up"], ["Swipe down ↓", "down"]]) {
            kv.append(el("dt", "", k), el("dd", "", S.actions[dir].label));
        }
        kv.append(el("dt", "", "Tap photo sides"), el("dd", "", "Previous / next photo"), el("dt", "", "ⓘ"), el("dd", "", "All the details"));
        body.appendChild(kv);
        if (S.pack.coachNote) body.appendChild(el("p", "note-text", S.pack.coachNote));
        $("sheet").hidden = false;
    }

    async function takeSharedFile() {
        if (!location.search.includes("shared=1") || !("caches" in window)) return false;
        try {
            const cache = await caches.open("vinder-share");
            const res = await cache.match("/shared-pack");
            history.replaceState(null, "", location.pathname);
            if (!res) return false;
            await cache.delete("/shared-pack");
            const blob = await res.blob();
            await loadPackFile(new File([blob], "shared.json", { type: "application/json" }));
            return true;
        } catch (_) {
            return false;
        }
    }

    if ("serviceWorker" in navigator && location.protocol === "https:") {
        const hadController = Boolean(navigator.serviceWorker.controller);
        let reloaded = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (!hadController || reloaded) return;
            reloaded = true;
            location.reload();
        });
        navigator.serviceWorker.register("sw.js").then(reg => reg.update()).catch(() => { /* offline install not available */ });
    }
    show("home");
    takeSharedFile();
})();
