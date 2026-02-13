/* eslint-env node */

const fs = require("fs");
const path = require("path");

const pkg = require("../package.json");

const buildDir = path.join(__dirname, "..", ".scaffold", "build");

// --- Patch built JS for Zotero 8 (ChromeUtils.import removed but still defined) ---
function patchImportESModule() {
  const builtJs = path.join(
    buildDir,
    "addon",
    "content",
    "scripts",
    "autotag.js"
  );

  if (!fs.existsSync(builtJs)) {
    console.warn(`[patch] ${builtJs} not found, skipping patch`);
    return;
  }

  let s = fs.readFileSync(builtJs, "utf8");

  // Replace the buggy helper:
  // function _importESModule(path) {
  //   if (typeof ChromeUtils.import === "undefined") return ChromeUtils.importESModule(...)
  //   ...
  //   return ChromeUtils.import(path);
  // }
  //
  // Zotero 8: ChromeUtils.import exists but throws. So we always prefer importESModule,
  // and only fall back to import() in a try/catch for older environments.

  const re = /function _importESModule\(\s*path\s*\)\s*\{[\s\S]*?\n\s*\}/m;
  if (!re.test(s)) {
    console.warn("[patch] _importESModule() not found, skipping patch");
    return;
  }

  const replacement = `function _importESModule(path) {
    // Zotero 8+: ChromeUtils.import exists but throws ("has been removed"),
    // so we must use importESModule() and only fall back in a try/catch.
    try {
      return ChromeUtils.importESModule(path, { global: "contextual" });
    } catch (e) {
      // Older Gecko: allow .sys.mjs → .jsm fallback, then use ChromeUtils.import
      if (path.endsWith(".sys.mjs")) path = path.replace(/\\.sys\\.mjs$/, ".jsm");
      return ChromeUtils.import(path);
    }
  }`;

  s = s.replace(re, replacement);

  fs.writeFileSync(builtJs, s, "utf8");
  console.log("[patch] Patched _importESModule() in built autotag.js for Zotero 8");
}

// Run patch before renaming xpi
patchImportESModule();

// --- Rename XPI ---
const from = path.join(buildDir, "autotag.xpi");
const to = path.join(buildDir, `autotag-${pkg.version}.xpi`);

if (fs.existsSync(from)) {
  fs.renameSync(from, to);
  console.log(`XPI renamed to autotag-${pkg.version}.xpi`);
} else {
  console.warn("autotag.xpi not found. Nothing renamed.");
}
