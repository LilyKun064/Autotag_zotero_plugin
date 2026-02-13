// src/index.ts
//
// Zotero 8–native entry point (no zotero-plugin-toolkit).
// bootstrap.js loads the bundled script into a sandbox `ctx` where `_globalThis` exists.

import Addon from "./addon";
import { config } from "../package.json";

// Zotero global from the app
declare const Zotero: any;

// Create addon instance once
if (!Zotero[config.addonInstance]) {
  (_globalThis as any).addon = new Addon();
  Zotero[config.addonInstance] = (_globalThis as any).addon;
}
