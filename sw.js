const VERSION = "vinder-game-9";
const SHELL = ["./", "index.html", "styles.css", "app.js", "vinder-core.js", "game.js", "game.css", "manifest.webmanifest",
    "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];

self.addEventListener("install", event => {
    event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "vinder-share").map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
    const url = new URL(event.request.url);
    if (event.request.method === "POST" && url.pathname.endsWith("/share-target")) {
        event.respondWith((async () => {
            const form = await event.request.formData();
            const file = form.get("pack");
            if (file) {
                const cache = await caches.open("vinder-share");
                await cache.put("/shared-pack", new Response(file));
            }
            return Response.redirect("./?shared=1", 303);
        })());
        return;
    }
    if (event.request.method !== "GET" || url.origin !== location.origin) return;
    event.respondWith(caches.open(VERSION).then(async cache => {
        const hit = await cache.match(event.request, { ignoreSearch: true });
        const fresh = fetch(event.request).then(res => {
            if (res && res.ok) cache.put(event.request, res.clone());
            return res;
        }).catch(() => hit);
        return hit || fresh;
    }));
});
