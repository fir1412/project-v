"use strict";

(function () {
    const V = window.VINderCore;
    const $ = id => document.getElementById(id);
    const EDGE = 24;      // px from the screen edge are left to the phone's back gesture
    const TAP_MOVE = 10;

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

    const S = { pack: null, cards: [], actions: V.actionsOf(null), decisions: {}, history: [], photoIndex: 0, sentAt: null };
    const actionById = id => Object.values(S.actions).find(a => a.id === id) || null;
    const labelOf = id => (actionById(id) || { label: id }).label;
    const colorOf = id => (actionById(id) || { color: "" }).color;

    async function saveState() {
        if (!S.pack) return;
        await put("state", { packId: S.pack.packId, decisions: S.decisions, history: S.history.slice(-200), sentAt: S.sentAt });
    }

    function show(screen) {
        for (const id of ["home", "deck", "review"]) $(id).hidden = id !== screen;
        if (screen === "home") renderHome();
        if (screen === "deck") renderDeck();
        if (screen === "review") renderReview();
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

    async function renderHome() {
        const list = $("packs");
        const packs = (await getAll("packs")).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
        const states = new Map((await getAll("state")).map(s => [s.packId, s]));
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
            top.append(el("div", "pack-name", item.pack.title || `Pack ${fmtDate(item.pack.createdAt)}`), el("div", "pack-meta", `${groups} groups · ${p.total} cards`));
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

    async function loadPackFile(file) {
        try {
            const pack = JSON.parse(await file.text());
            const r = V.readPack(pack);
            if (!r.ok) { toast(r.errors[0], 4000); return; }
            await put("packs", { packId: pack.packId, pack, openedAt: Date.now() });
            if (!(await get("state", pack.packId))) await put("state", { packId: pack.packId, decisions: {}, history: [], sentAt: null });
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
        S.photoIndex = 0;
        applyActions();
        show(screen || "deck");
        maybeCoach();
    }

    const queue = () => V.remainingCards(S.cards, S.decisions, S.actions).filter(c => !V.isDecided(S.actions, S.decisions[c.key]));

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
            return;
        }
        if (q[1]) stack.appendChild(buildCard(q[1], true));
        const top = buildCard(q[0], false);
        stack.appendChild(top);
        attachDrag(top, q[0]);
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
        title.appendChild(el("h2", "", data.item.title || "(no title)"));
        const more = el("button", "info-btn");
        more.type = "button";
        more.setAttribute("aria-label", "Details");
        more.appendChild(svgIcon("M12 8h.01M11 12h1v5h1"));
        more.addEventListener("pointerdown", e => e.stopPropagation());
        more.addEventListener("click", e => { e.stopPropagation(); openSheet(data); });
        title.appendChild(more);
        const chips = el("div", "chips");
        if (data.item.suggestion) {
            const chip = el("span", "chip ai");
            const label = (S.pack.suggestionLabels && S.pack.suggestionLabels[data.item.suggestion]) || labelOf(data.item.suggestion);
            chip.append(document.createTextNode(`${S.pack.suggestionTitle || "Suggested"}: `), el("b", "", label));
            chips.appendChild(chip);
        }
        for (const c of Array.isArray(data.item.chips) ? data.item.chips : []) if (c) chips.appendChild(el("span", "chip", String(c)));
        if (data.photos.length) chips.appendChild(el("span", "chip", `${data.photos.length} photo${data.photos.length === 1 ? "" : "s"}`));
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
                if (data.photos.length > 1 && s.y - rect.top < rect.height * 0.62) {
                    if (x < rect.width * 0.35) flipPhoto(card, data, -1);
                    else if (x > rect.width * 0.65) flipPhoto(card, data, 1);
                }
                return;
            }
            const dir = V.swipeDirection(dx, dy, rect.width, rect.height, Math.hypot(dx, dy) / dt);
            if (dir) flyOut(card, data, dir, dx, dy);
            else {
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
        if (actionId !== S.actions.down.id && V.groupDone(S.cards, S.decisions, S.actions, data.group.groupId)) celebrate(data.group);
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
        flyOut(card, q[0], dir, 0, 0);
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
        renderDeck();
        toast("Undone");
    });
    document.addEventListener("keydown", e => {
        if ($("deck").hidden || !$("sheet").hidden) return;
        const map = { ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down" };
        if (map[e.key]) { e.preventDefault(); decideTop(map[e.key]); }
        if (e.key === "Backspace" || (e.key === "z" && (e.ctrlKey || e.metaKey))) $("actUndo").click();
    });
    let resizeTimer = null;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (!$("deck").hidden) renderDeck(); }, 150);
    });

    function openSheet(data) {
        $("sheetTitle").textContent = data.item.title || "";
        const body = $("sheetBody");
        body.replaceChildren();
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
        $("sheet").hidden = false;
        $("sheetClose").focus();
    }
    $("sheetClose").addEventListener("click", () => { $("sheet").hidden = true; });
    $("sheet").addEventListener("click", e => { if (e.target === $("sheet")) $("sheet").hidden = true; });

    function renderReview() {
        const counts = {};
        for (const c of S.cards) {
            const id = S.decisions[c.key] ? S.decisions[c.key].action : "";
            counts[id] = (counts[id] || 0) + 1;
        }
        const summary = $("reviewSummary");
        summary.replaceChildren(...Object.entries(counts).map(([id, n]) => {
            const pill = el("span", "pill", `${id ? labelOf(id) : "Open"} ${n}`);
            if (id) pill.style.setProperty("--c", colorOf(id));
            return pill;
        }));
        const list = $("reviewList");
        list.replaceChildren();
        const byGroup = new Map();
        for (const c of S.cards) {
            if (!byGroup.has(c.group.groupId)) byGroup.set(c.group.groupId, []);
            byGroup.get(c.group.groupId).push(c);
        }
        for (const [, cards] of byGroup) {
            const group = el("section", "grp");
            const head = el("div", "grp-head");
            head.append(el("span", "", cards[0].group.title || ""), el("small", "", cards[0].group.subtitle || ""));
            group.appendChild(head);
            for (const c of cards) {
                const row = el("div", "row");
                const thumb = el("img", "row-thumb");
                thumb.alt = "";
                if (c.photos[0]) thumb.src = c.photos[0].src;
                const text = el("div", "row-text", c.item.title || "");
                const sub = [c.item.suggestion ? `${S.pack.suggestionTitle || "Suggested"}: ${(S.pack.suggestionLabels && S.pack.suggestionLabels[c.item.suggestion]) || labelOf(c.item.suggestion)}` : "", ...(c.item.chips || [])].filter(Boolean).join(" · ");
                if (sub) text.appendChild(el("small", "", sub));
                const select = document.createElement("select");
                select.setAttribute("aria-label", `Decision for ${c.item.title || "this card"}`);
                const cur = S.decisions[c.key] ? S.decisions[c.key].action : "";
                const open = el("option", "", "Open");
                open.value = "";
                select.appendChild(open);
                for (const dir of V.DIRECTIONS) {
                    const o = el("option", "", S.actions[dir].label);
                    o.value = S.actions[dir].id;
                    if (o.value === cur) o.selected = true;
                    select.appendChild(o);
                }
                select.addEventListener("change", async () => {
                    if (!select.value) {
                        const next = { ...S.decisions };
                        delete next[c.key];
                        S.decisions = next;
                    } else {
                        S.decisions = V.decide(S.decisions, S.history, c, select.value, S.actions).decisions;
                    }
                    await saveState();
                    renderReview();
                });
                row.append(thumb, text, select);
                group.appendChild(row);
            }
            list.appendChild(group);
        }
        const p = V.progress(S.cards, S.decisions, S.actions);
        $("sendDecisions").disabled = !p.decided;
        $("sendHint").textContent = `${S.sentAt ? `Last sent ${fmtDate(S.sentAt)} - send again after changes. ` : ""}${S.pack.sendHint || "Save the file where the pack came from."}`;
    }

    $("sendDecisions").addEventListener("click", async () => {
        const data = V.decisionsFile(S.pack, S.cards, S.decisions);
        const name = `vinder-decisions-${S.pack.packId}.json`;
        const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
        const file = new File([blob], name, { type: "application/json" });
        try {
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: name });
            } else {
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
        navigator.serviceWorker.register("sw.js").catch(() => { /* offline install not available */ });
    }
    show("home");
    takeSharedFile();
})();
