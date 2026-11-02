// node make-manifest.js — lists every file under assets/ into assets/manifest.json for the splash preloader.
// Run again whenever assets are added or removed.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "assets");
const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name !== "manifest.json") files.push(path.relative(root, p).split(path.sep).join("/"));
    }
})(root);
files.sort();
fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ files }) + "\n");
console.log(`${files.length} files`);
