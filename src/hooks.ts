// src/hooks.ts
// Minimal hooks: just register our Autotag tools menu, no template examples

// Zotero global from the app
declare const Zotero: _ZoteroTypes.Zotero;

import { runAutotagForItems } from "./modules/autotagCore";
import {
  Services,
  getSelectedProvider,
  getApiKeyForProvider,
  openAutotagSettings,
  getPromptContentOptions,
} from "./modules/autotagPrefs";
import { registerAutotagToolsMenu } from "./modules/autotagMenu";
import { config } from "../package.json";

type ItemMetadata = {
  key: string;
  itemType: string;
  title: string;
  abstract: string;
  publicationTitle: string;
  date: string;
  creators: string[];
  tags: string[];
  pdfText?: string;
};

function debug(msg: string) {
  (Zotero as any).debug?.(msg);
}

function showError(win: _ZoteroTypes.MainWindow, title: string, e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e));
  const message = err.message || String(e);
  const stack = err.stack || "";

  debug(`Autotag: ${title}: ${message}\n${stack}`);

  try {
    (Zotero as any).logError?.(err);
  } catch {
    // ignore
  }

  const detail = stack && !stack.includes(message)
    ? `${message}\n\n${stack}`
    : message;

  (win as any).alert(`${title}\n\n${detail}`);
}

function normalizeExtractedText(text: string): string {
  return String(text || "")
    .split("\x00").join(" ")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function truncatePdfText(text: string): string {
  const options = getPromptContentOptions();
  const cleaned = normalizeExtractedText(text);

  if (!cleaned) return "";

  if (options.pdfTextMode === "full_text") {
    return cleaned;
  }

  const limit =
    Number.isFinite(options.pdfTextCharLimit) && options.pdfTextCharLimit > 0
      ? Math.floor(options.pdfTextCharLimit)
      : 4000;

  if (cleaned.length <= limit) return cleaned;
  return cleaned.slice(0, limit).trim();
}

async function getExtractedAttachmentTextForItem(item: any): Promise<string> {
  try {
    if (item?.isAttachment?.()) {
      const contentType = String(item.attachmentContentType || "").toLowerCase();
      if (contentType === "application/pdf" || contentType === "text/html") {
        const text = await item.attachmentText;
        return truncatePdfText(String(text || ""));
      }
      return "";
    }

    if (!item?.isRegularItem?.()) {
      return "";
    }

    const attachmentIDs = item.getAttachments?.() || [];
    if (!attachmentIDs.length) return "";

    const attachments = attachmentIDs
      .map((id: number) => {
        try {
          return Zotero.Items.get(id);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (!attachments.length) return "";

    const importedPdf = attachments.find((att: any) => {
      const ct = String(att?.attachmentContentType || "").toLowerCase();
      return ct === "application/pdf" && !!att?.isImportedAttachment?.();
    });

    const anyPdf = attachments.find((att: any) => {
      const ct = String(att?.attachmentContentType || "").toLowerCase();
      return ct === "application/pdf";
    });

    const htmlAttachment = attachments.find((att: any) => {
      const ct = String(att?.attachmentContentType || "").toLowerCase();
      return ct === "text/html";
    });

    const chosen = importedPdf || anyPdf || htmlAttachment;
    if (!chosen) return "";

    try {
      const text = await chosen.attachmentText;
      return truncatePdfText(String(text || ""));
    } catch (e) {
      debug(`Autotag: failed to read attachment text for item ${item.key}: ${String(e)}`);
      return "";
    }
  } catch (e) {
    debug(`Autotag: getExtractedAttachmentTextForItem failed for ${item?.key || "[unknown]"}: ${String(e)}`);
    return "";
  }
}

async function getItemMetadata(item: any): Promise<ItemMetadata> {
  const creators = (item.getCreators?.() || []).map((c: any) => {
    if (c.lastName && c.firstName) return `${c.lastName}, ${c.firstName}`;
    return c.name || c.lastName || "[unknown creator]";
  });

  const tags = (item.getTags?.() || []).map((t: any) => t.tag);
  const options = getPromptContentOptions();

  let pdfText = "";
  if (options.includePdfText) {
    pdfText = await getExtractedAttachmentTextForItem(item);
  }

  return {
    key: item.key,
    itemType: item.itemType,
    title: item.getField?.("title") || "",
    abstract: item.getField?.("abstractNote") || "",
    publicationTitle: item.getField?.("publicationTitle") || "",
    date: item.getField?.("date") || "",
    creators,
    tags,
    pdfText: pdfText || "",
  };
}

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

  // Menu registration moved to onMainWindowLoad using manual insertion
  // (Zotero.MenuManager.registerMenu was unreliable in Zotero 9)
  debug("Autotag: startup complete, menu registration will happen per window");

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
  injectAutotagStyles(win);  // Inject CSS into window
  registerAutotagToolsMenu(win);  // Insert menu items into Tools menu
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
