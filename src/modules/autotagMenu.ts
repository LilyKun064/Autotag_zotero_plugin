// src/modules/autotagMenu.ts

// Global Zotero objects
declare const Zotero: _ZoteroTypes.Zotero;
declare const Services: any;

import { runAutotagForItems } from "./autotagCore";
import {
  getSelectedProvider,
  getApiKeyForProvider,
  openAutotagSettings,
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
};

/**
 * Convert a Zotero item into an ItemMetadata structure.
 */
function getItemMetadata(item: any): ItemMetadata {
  const creators = (item.getCreators?.() || []).map((c: any) => {
    if (c.lastName && c.firstName) {
      return `${c.lastName}, ${c.firstName}`;
    }
    return c.name || c.lastName || "[unknown creator]";
  });

  const tags = (item.getTags?.() || []).map((t: any) => t.tag);

  return {
    key: item.key,
    itemType: item.itemType,
    title: item.getField("title") || "",
    abstract: item.getField("abstractNote") || "",
    publicationTitle: item.getField("publicationTitle") || "",
    date: item.getField("date") || "",
    creators,
    tags,
  };
}

/**
 * Register Autotag menu items inside the Tools menu.
 */
export function registerAutotagToolsMenu(
  win: _ZoteroTypes.MainWindow,
): void {
  const doc = win.document;
  const toolsMenu = doc.getElementById("menu_ToolsPopup") as any;
  if (!toolsMenu) return;

  // Prevent duplicate menu items
  if (doc.getElementById("autotag-settings-menuitem")) return;
  if (doc.getElementById("autotag-run-menuitem")) return;

  const xulDoc = doc as any;

  /* =========================
     Settings menu item
     ========================= */

  const settingsItem = xulDoc.createXULElement("menuitem");
  settingsItem.id = "autotag-settings-menuitem";
  settingsItem.setAttribute("label", "Autotag: settings…");
  settingsItem.setAttribute(
    "class",
    "menuitem-iconic autotag-menuitem",
  );
  settingsItem.removeAttribute("image");

  settingsItem.addEventListener("command", () => {
    openAutotagSettings(win);
  });

  /* =========================
     Run Autotag menu item
     ========================= */

  const runItem = xulDoc.createXULElement("menuitem");
  runItem.id = "autotag-run-menuitem";
  runItem.setAttribute("label", "Autotag: tag selected items");
  runItem.setAttribute(
    "class",
    "menuitem-iconic autotag-menuitem",
  );
  runItem.removeAttribute("image");

  runItem.addEventListener("command", async () => {
    const pane = Zotero.getActiveZoteroPane();
    if (!pane) {
      (win as any).alert("No active Zotero pane found.");
      return;
    }

    const selectedItems = pane.getSelectedItems();
    if (!selectedItems || !selectedItems.length) {
      (win as any).alert("No items selected.");
      return;
    }

    const provider = getSelectedProvider();

    // Only check API key for non-local providers
    if (provider !== "local") {
      const apiKey = getApiKeyForProvider(provider);

      if (!apiKey) {
        const ask = Services.prompt.confirm(
          win,
          "Autotag",
          "No API key is configured for this provider.\n\n" +
          "Would you like to open Autotag settings now?",
        );
        if (ask) openAutotagSettings(win);
        return;
      }
    }


    const payload: ItemMetadata[] = selectedItems.map((item: any) =>
      getItemMetadata(item),
    );

    try {
      await runAutotagForItems(payload, win);
    } catch (e) {
      (Zotero as any).debug("Autotag error: " + String(e));
      (win as any).alert("Autotag failed: " + String(e));
    }
  });

  /* =========================
     Attach menu items
     ========================= */

  toolsMenu.appendChild(settingsItem);
  toolsMenu.appendChild(runItem);
}
