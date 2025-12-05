// src/hooks.ts
// Minimal hooks: just register our Autotag tools menu, no template examples

// Zotero global from the app
declare const Zotero: _ZoteroTypes.Zotero;

import { registerAutotagToolsMenu } from "./modules/autotagMenu";

/**
 * Inject our CSS into the Zotero main window.
 */
function injectAutotagStyles(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document;

  // Avoid injecting multiple times
  if (doc.getElementById("autotag-stylesheet")) return;

  const link = doc.createElement("link");
  link.id = "autotag-stylesheet";
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("type", "text/css");
  // ✅ addonRef = "autotag"
  link.setAttribute("href", "chrome://autotag/content/autotag.css");

  if (doc.documentElement) {
    doc.documentElement.appendChild(link);
  }
}

/**
 * Called once when the plugin starts up.
 */
async function onStartup(): Promise<void> {
  // Wait until Zotero is fully initialized
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  // Register for all existing main windows
  const wins = Zotero.getMainWindows() as _ZoteroTypes.MainWindow[];
  for (const win of wins) {
    await onMainWindowLoad(win);
  }
}

/**
 * Called whenever a main Zotero window is loaded.
 */
async function onMainWindowLoad(
  win: _ZoteroTypes.MainWindow,
): Promise<void> {
  injectAutotagStyles(win);       // 🔑 make sure CSS is loaded
  registerAutotagToolsMenu(win);  // 🔑 then create the Tools menu items
}

/**
 * Called when a main window is being unloaded.
 */
async function onMainWindowUnload(win: Window): Promise<void> {
  // Nothing to clean up at the moment
}

/**
 * Called when the plugin shuts down (disabled, removed, or Zotero closes).
 */
function onShutdown(): void {
  // Nothing special
}

/**
 * Notify handler – we don't use notifications yet.
 */
async function onNotify(
  event: string,
  type: string,
  ids: Array<number | string>,
  extraData: { [key: string]: any },
): Promise<void> {
  return;
}

/**
 * Preferences event handler – unused (we have our own settings prompts).
 */
async function onPrefsEvent(
  type: string,
  data: { [key: string]: any },
): Promise<void> {
  return;
}

/**
 * Shortcut handler – unused.
 */
function onShortcuts(type: string): void {
  return;
}

/**
 * Dialog events – unused.
 */
function onDialogEvents(type: string): void {
  return;
}

// Export hooks object for bootstrap.js
export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
