"use strict";

(function (root) {
    const DIRECTIONS = ["right", "left", "up", "down"];
    const DEFAULT_ACTIONS = {
        right: { id: "yes", label: "Yes", color: "#15803d" },
        left: { id: "no", label: "No", color: "#6d28d9" },
        up: { id: "flag", label: "Flag", color: "#c2410c" },
        down: { id: "later", label: "Later", color: "#475569" }
    };

    const itemKey = (groupId, itemIndex) => `${groupId}#${itemIndex}`;

    function actionsOf(pack) {
        const out = {};
        for (const dir of DIRECTIONS) {
            const a = pack && pack.actions && pack.actions[dir];
            out[dir] = a && a.id ? { id: String(a.id), label: String(a.label || a.id), color: /^#[0-9a-f]{3,8}$/i.test(a.color || "") ? a.color : DEFAULT_ACTIONS[dir].color }
                : { ...DEFAULT_ACTIONS[dir] };
        }
        return out;
    }

    const directionOf = (actions, id) => DIRECTIONS.find(d => actions[d].id === id) || null;

    function readPack(pack) {
        const errors = [];
        if (!pack || pack.app !== "VINder" || pack.kind !== "pack") errors.push("This file isn't a VINder pack.");
        else if (pack.version !== 1) errors.push(`Pack version ${pack.version} is newer than this VINder - update the app.`);
        if (errors.length) return { ok: false, errors, cards: [], actions: actionsOf(null) };
        if (!pack.packId) errors.push("The pack has no id.");
        const actions = actionsOf(pack);
        const ids = DIRECTIONS.map(d => actions[d].id);
        if (new Set(ids).size !== ids.length) errors.push("Two swipe directions share one action.");
        const cards = [];
        for (const group of Array.isArray(pack.groups) ? pack.groups : []) {
            if (!group || group.groupId === undefined || group.groupId === null) continue;
            for (const item of Array.isArray(group.items) ? group.items : []) {
                if (!item || !Number.isInteger(item.itemIndex)) continue;
                cards.push({
                    key: itemKey(group.groupId, item.itemIndex),
                    group,
                    item,
                    photos: (Array.isArray(item.photos) ? item.photos : []).filter(p => p && typeof p.src === "string")
                });
            }
        }
        if (!cards.length && !errors.length) errors.push("The pack has nothing to decide.");
        return { ok: errors.length === 0, errors, cards, actions };
    }

    function swipeDirection(dx, dy, width, height, velocity) {
        const vx = Math.abs(dx), vy = Math.abs(dy);
        const fast = (velocity || 0) > 0.6;
        const needX = width * (fast ? 0.18 : 0.33);
        const needY = height * (fast ? 0.12 : 0.22);
        if (vx >= vy && vx >= needX) return dx > 0 ? "right" : "left";
        if (vy > vx && vy >= needY) return dy < 0 ? "up" : "down";
        return null;
    }

    function lean(dx, dy, width, height) {
        const x = Math.max(-1, Math.min(1, dx / (width * 0.33)));
        const y = Math.max(-1, Math.min(1, dy / (height * 0.22)));
        const horizontal = Math.abs(x) >= Math.abs(y);
        return {
            right: Math.max(0, x) * (horizontal ? 1 : 0.4),
            left: Math.max(0, -x) * (horizontal ? 1 : 0.4),
            up: Math.max(0, -y) * (horizontal ? 0.4 : 1),
            down: Math.max(0, y) * (horizontal ? 0.4 : 1)
        };
    }

    const isLater = (actions, decision) => Boolean(decision) && decision.action === actions.down.id;
    const isDecided = (actions, decision) => Boolean(decision) && decision.action !== actions.down.id;

    function remainingCards(cards, decisions, actions) {
        const open = cards.filter(c => !decisions[c.key]);
        const later = cards.filter(c => isLater(actions, decisions[c.key]));
        return [...open, ...later];
    }

    function decide(decisions, history, card, actionId, actions, at) {
        if (!DIRECTIONS.some(d => actions[d].id === actionId)) throw new Error(`Unknown action ${actionId}`);
        const next = { ...decisions, [card.key]: { action: actionId, decidedAt: at || new Date().toISOString() } };
        return { decisions: next, history: [...history, { key: card.key, previous: decisions[card.key] || null }] };
    }

    function undo(decisions, history) {
        if (!history.length) return { decisions, history, key: null };
        const last = history[history.length - 1];
        const next = { ...decisions };
        if (last.previous) next[last.key] = last.previous;
        else delete next[last.key];
        return { decisions: next, history: history.slice(0, -1), key: last.key };
    }

    function groupDone(cards, decisions, actions, groupId) {
        const mine = cards.filter(c => c.group.groupId === groupId);
        return mine.length > 0 && mine.every(c => isDecided(actions, decisions[c.key]));
    }

    function progress(cards, decisions, actions) {
        const decided = cards.filter(c => isDecided(actions, decisions[c.key])).length;
        const later = cards.filter(c => isLater(actions, decisions[c.key])).length;
        return { total: cards.length, decided, later, left: cards.length - decided };
    }

    function groupSummary(cards, decisions, groupId) {
        const counts = {};
        for (const c of cards) {
            if (c.group.groupId !== groupId || !decisions[c.key]) continue;
            const a = decisions[c.key].action;
            counts[a] = (counts[a] || 0) + 1;
        }
        return counts;
    }

    const moveKey = (groupId, photoId) => `${groupId}|${photoId}`;
    function setMove(moves, { groupId, photoId, from = null, to, at }) {
        const next = { ...moves };
        const key = moveKey(groupId, photoId);
        if (to === undefined || to === null || to === from) delete next[key];
        else next[key] = { groupId: String(groupId), photoId: String(photoId), from: from === null ? null : Number(from), to: typeof to === "number" ? to : String(to), at: at || new Date().toISOString() };
        return next;
    }
    const moveOf = (moves, groupId, photoId) => (moves && moves[moveKey(groupId, photoId)]) || null;
    const movesList = moves => Object.values(moves || {}).sort((a, b) => String(a.at).localeCompare(String(b.at)));

    const fieldKey = (groupId, fieldId) => `${groupId}|${fieldId}`;
    function setFieldCheck(checks, { groupId, fieldId, value, at }) {
        const next = { ...checks };
        const key = fieldKey(groupId, fieldId);
        if (value === undefined || value === null) delete next[key];
        else next[key] = { groupId: String(groupId), fieldId: String(fieldId), value: String(value).trim(), at: at || new Date().toISOString() };
        return next;
    }
    const fieldCheckOf = (checks, groupId, fieldId) => (checks && checks[fieldKey(groupId, fieldId)]) || null;
    const fieldChecksList = checks => Object.values(checks || {}).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const fieldsToCheck = (group, checks) => (Array.isArray(group && group.fields) ? group.fields : [])
        .filter(f => f && f.status === "check" && !fieldCheckOf(checks, group.groupId, f.id));

    function decisionsFile(pack, cards, decisions, at, moves, checks) {
        return {
            app: "VINder",
            kind: "decisions",
            version: 2,
            packId: pack.packId,
            exportedAt: at || new Date().toISOString(),
            decisions: cards.filter(c => decisions[c.key]).map(c => ({
                groupId: c.group.groupId,
                itemIndex: c.item.itemIndex,
                action: decisions[c.key].action,
                decidedAt: decisions[c.key].decidedAt
            })),
            moves: movesList(moves).map(m => ({ groupId: m.groupId, photoId: m.photoId, from: m.from, to: m.to, movedAt: m.at })),
            fields: fieldChecksList(checks).map(f => ({ groupId: f.groupId, fieldId: f.fieldId, value: f.value, checkedAt: f.at }))
        };
    }

    const api = { DIRECTIONS, DEFAULT_ACTIONS, itemKey, actionsOf, directionOf, readPack, swipeDirection, lean, isLater, isDecided, remainingCards, decide, undo, groupDone, progress, groupSummary, decisionsFile, moveKey, setMove, moveOf, movesList, fieldKey, setFieldCheck, fieldCheckOf, fieldChecksList, fieldsToCheck };
    root.VINderCore = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
