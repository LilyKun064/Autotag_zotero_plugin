// src/modules/autotagMenu.ts
//
// Zotero 8 compatibility goals:
// - Tools menu popup can be created lazily → retry until it exists
// - Menu structure / IDs can vary → use robust selectors
// - Avoid duplicate inserts across retries / multiple windows
// - Fail loudly (alert + debug) instead of silently doing nothing

// Global Zotero object (provided by Zotero)
declare const Zotero: _ZoteroTypes.Zotero;

import { runAutotagForItems } from "./autotagCore";
import {
  Services, // from autotagPrefs (Z8-safe)
  getSelectedProvider,
  getApiKeyForProvider,
  openAutotagSettings,
  getPromptContentOptions,
} from "./autotagPrefs";

export type ItemMetadata = {
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

/**
 * Best-effort cleanup for extracted attachment text.
 */
function normalizeExtractedText(text: string): string {
  return String(text || "")
    .split("\x00").join(" ")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Truncate extracted text according to current settings.
 */
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

/**
 * Try to get extracted text from the first suitable PDF attachment.
 *
 * Priority:
 * 1. Imported PDF attachment
 * 2. Any PDF attachment
 * 3. HTML attachment as fallback
 *
 * Returns empty string if none is available or if extraction text is missing.
 */
async function getExtractedAttachmentTextForItem(item: any): Promise<string> {
  try {
    // If the selected item is itself an attachment, handle directly.
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

/**
 * Convert a Zotero item into an ItemMetadata structure.
 *
 * We still collect the normal bibliographic fields here. The prompt builder
 * will decide which ones to actually send based on prefs.
 */
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
 * Find the Tools menu popup (menupopup) in a robust way across Zotero 7/8.
 */
function findToolsMenuPopup(doc: Document): Element | null {
  const byId = doc.getElementById("menu_ToolsPopup");
  if (byId) return byId;

  const q1 = doc.querySelector("menupopup#menu_ToolsPopup");
  if (q1) return q1;

  const q2 = doc.querySelector('menupopup[id$="ToolsPopup"]');
  if (q2) return q2;

  // Fallback: English label (may fail on localized UI)
  const q3 = doc.querySelector('menu[label="Tools"] menupopup');
  if (q3) return q3;

  return null;
}

/**
 * Register Autotag menu items inside the Tools menu.
 */
export function registerAutotagToolsMenu(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document as Document;

  // Prevent duplicates across retries
  if (doc.getElementById("autotag-settings-menuitem")) return;
  if (doc.getElementById("autotag-run-menuitem")) return;

  // Retry logic per-window
  const anyWin = win as any;
  const retryKey = "__autotagToolsMenuRetries";
  const maxRetries = 20; // 20 * 250ms = 5s total
  anyWin[retryKey] = anyWin[retryKey] ?? 0;

  const toolsPopup = findToolsMenuPopup(doc);

  if (!toolsPopup) {
    if (anyWin[retryKey] < maxRetries) {
      anyWin[retryKey] += 1;
      debug(
        `Autotag: Tools menu popup not ready (retry ${anyWin[retryKey]}/${maxRetries})`,
      );
      win.setTimeout(() => {
        try {
          registerAutotagToolsMenu(win);
        } catch (e) {
          debug("Autotag: menu retry failed: " + String(e));
        }
      }, 250);
    } else {
      debug("Autotag: Tools menu popup not found after retries; giving up.");
    }
    return;
  }

  anyWin[retryKey] = 0;

  const xulDoc = doc as any;

  /* =========================
     Settings menu item
     ========================= */
  const settingsItem = xulDoc.createXULElement("menuitem");
  settingsItem.id = "autotag-settings-menuitem";
  settingsItem.setAttribute("label", "Autotag: settings…");
  settingsItem.setAttribute("class", "menuitem-iconic autotag-menuitem");
  settingsItem.removeAttribute("image");

  settingsItem.addEventListener("command", () => {
    try {
      openAutotagSettings(win);
    } catch (e) {
      showError(win, "Autotag settings failed", e);
    }
  });

  /* =========================
     Run Autotag menu item
     ========================= */
  const runItem = xulDoc.createXULElement("menuitem");
  runItem.id = "autotag-run-menuitem";
  runItem.setAttribute("label", "Autotag: tag selected items");
  runItem.setAttribute("class", "menuitem-iconic autotag-menuitem");
  runItem.removeAttribute("image");

  runItem.addEventListener("command", async () => {
    try {
      const pane =
        (Zotero as any).getActiveZoteroPane?.() ||
        (Zotero as any).Pane?.getActive?.();

      if (!pane) {
        (win as any).alert("Autotag: No active Zotero pane found.");
        return;
      }

      const selectedItems = pane.getSelectedItems?.() || [];
      if (!selectedItems.length) {
        (win as any).alert("Autotag: No items selected.");
        return;
      }

      const provider = getSelectedProvider();

      // Only check API key for non-local providers
      if (provider !== "local") {
        const apiKey = getApiKeyForProvider(provider);
        if (!apiKey) {
          const ask =
            Services?.prompt?.confirm?.(
              win,
              "Autotag",
              "No API key is configured for this provider.\n\n" +
                "Would you like to open Autotag settings now?",
            ) ??
            (win as any).confirm(
              "Autotag\n\nNo API key is configured for this provider.\n\n" +
                "Would you like to open Autotag settings now?",
            );

          if (ask) {
            try {
              openAutotagSettings(win);
            } catch (e) {
              showError(win, "Autotag settings failed", e);
            }
          }
          return;
        }
      }

      // Build payload asynchronously because PDF extraction can be async
      const payload: ItemMetadata[] = [];
      for (const item of selectedItems) {
        payload.push(await getItemMetadata(item));
      }

      await runAutotagForItems(payload, win);
    } catch (e) {
      showError(win, "Autotag run failed", e);
    }
  });

  /* =========================
     Attach menu items
     ========================= */
  try {
    toolsPopup.appendChild(settingsItem);
    toolsPopup.appendChild(runItem);
    debug("Autotag: menu items inserted into Tools menu");
  } catch (e) {
    debug("Autotag: failed to append menu items: " + String(e));
  }
}