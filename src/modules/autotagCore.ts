// src/modules/autotagCore.ts

// Global Zotero object
declare const Zotero: _ZoteroTypes.Zotero;
// In Zotero/Firefox chrome contexts this exists, but TS may not know it
declare const ChromeUtils: any;

import type { ItemMetadata } from "./autotagMenu";
import {
  Services as PrefsServices, // may be undefined in some contexts
  getSeedKeywords,
  getModelForProvider,
  getFinalPrompt,
} from "./autotagPrefs";
import { getLLMProvider } from "./llmproviders";

type LLMItemTags = {
  key: string;
  tags: string[];
};

type LLMTagResult = {
  items: LLMItemTags[];
};

/* =========================
   Utilities
   ========================= */

/**
 * Resolve a usable Zotero main window even if caller passed a bad/undefined win.
 * This prevents preview crashing when win is not the real chrome window.
 */
function resolveMainWindow(
  win?: _ZoteroTypes.MainWindow,
): _ZoteroTypes.MainWindow {
  const pane = (Zotero as any).getActiveZoteroPane?.();
  const w =
    win ||
    pane?.document?.defaultView ||
    (Zotero as any).getMainWindow?.() ||
    (Zotero as any).mainWindow;

  if (!w) {
    throw new Error("Autotag: Unable to resolve Zotero main window.");
  }
  return w as _ZoteroTypes.MainWindow;
}

/**
 * Prefer Services from Zotero if present, else fall back to prefs export, else try import.
 * This fixes the common “preview tags” crash where prompt falls back to win.prompt,
 * which may not exist in Zotero windows.
 */
function resolveServices(): any | undefined {
  const zServices = (Zotero as any)?.Services;
  if (zServices) return zServices;

  if (PrefsServices) return PrefsServices as any;

  // last resort: try importing Services.sys.mjs if ChromeUtils exists
  try {
    if (typeof ChromeUtils !== "undefined" && ChromeUtils?.importESModule) {
      const mod = ChromeUtils.importESModule(
        "resource://gre/modules/Services.sys.mjs",
      );
      return mod?.Services || mod?.default || mod;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/* =========================
   Prompt construction
   ========================= */

function buildPromptFromItems(items: ItemMetadata[]): string {
  const basePrompt = getFinalPrompt();
  const seedKeywords = (getSeedKeywords() || "").trim();

  const seedsBlock = seedKeywords
    ? `

The user has provided the following preferred tag vocabulary:
seed_keywords = [${seedKeywords}]

- Prefer using these tags when they clearly apply
- Do not force them if irrelevant
`
    : "";

  const itemsBlock = items
    .map((item, idx) => {
      const creators = Array.isArray(item.creators) ? item.creators : [];
      const creatorsStr = creators.join("; ");
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const tagsStr = tags.length ? tags.join(", ") : "(none)";

      return [
        `Paper ${idx + 1}:`,
        `key: ${String(item.key ?? "")}`,
        `itemType: ${String(item.itemType ?? "")}`,
        `title: ${String(item.title ?? "")}`,
        `creators: ${creatorsStr}`,
        `journal: ${String((item as any).publicationTitle ?? "")}`,
        `date: ${String((item as any).date ?? "")}`,
        `existing_tags: ${tagsStr}`,
        `abstract:`,
        (item as any).abstract || "[no abstract available]",
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return `
${basePrompt}
${seedsBlock}

=== PAPERS ===

${itemsBlock}
`.trim();
}

/* =========================
   LLM call
   ========================= */

async function callLLMForTags(prompt: string): Promise<LLMTagResult> {
  const provider = getLLMProvider();
  const model = getModelForProvider(provider.name) || "(default)";

  let content: string;
  try {
    content = await provider.generateTags(prompt);
  } catch (e: any) {
    const msg = String(e);

    if (msg.includes("API version") && msg.includes("not supported")) {
      const match = msg.match(/API version ([a-zA-Z0-9.-]+)/);
      const apiVersion = match ? match[1] : "your current API version";
      throw new Error(
        `This model is not supported by the current API version (${apiVersion}).\n\n` +
          "Please select a different model in Autotag settings.",
      );
    }

    if (msg.includes("404") && msg.toLowerCase().includes("not found")) {
      throw new Error(
        "This model is not available anymore according to the provider.\n\n" +
          "Please select another model in Autotag settings.",
      );
    }

    throw new Error(`LLM error using ${provider.name} (${model}): ${msg}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      `Invalid JSON returned by ${provider.name} (${model}):\n` +
        content.substring(0, 1000),
    );
  }

  if (!parsed?.items || !Array.isArray(parsed.items)) {
    throw new Error(`LLM JSON missing items array (${provider.name}, ${model})`);
  }

  // Normalize/validate to prevent preview crashes
  const normalized: LLMItemTags[] = parsed.items
    .map((x: any) => {
      const key = String(x?.key || "").trim();
      const tagsRaw = x?.tags;
      const tags = Array.isArray(tagsRaw)
        ? tagsRaw.map((t: any) => String(t).trim()).filter(Boolean)
        : [];
      return { key, tags };
    })
    .filter((x: LLMItemTags) => !!x.key); // drop empty keys

  return { items: normalized };
}

/* =========================
   Preview dialog (robust)
   ========================= */

function promptEditTags(
  winIn: _ZoteroTypes.MainWindow | undefined,
  title: string,
  message: string,
  initial: string,
): string | null {
  const win = resolveMainWindow(winIn);
  const S = resolveServices();

  // Preferred: Services.prompt.prompt
  if (S?.prompt?.prompt) {
    const input: any = { value: initial };
    const ok = S.prompt.prompt(win, title, message, input, null, {});
    return ok ? String(input.value ?? "") : null;
  }

  // Fallback: window.prompt (may not exist in Zotero windows)
  const w: any = win as any;
  if (typeof w.prompt === "function") {
    const raw = w.prompt(`${title}\n\n${message}`, initial);
    return raw == null ? null : String(raw);
  }

  // Last-resort: do not crash preview; treat as "Cancel"
  (Zotero as any).debug?.(
    "Autotag: No available prompt implementation (Services.prompt.prompt missing and win.prompt not a function).",
  );
  return null;
}

function previewAndEditTags(
  result: LLMTagResult,
  items: ItemMetadata[],
  win: _ZoteroTypes.MainWindow | undefined,
): LLMTagResult {
  const itemMap = new Map<string, ItemMetadata>();
  for (const item of items || []) {
    if (item?.key) itemMap.set(item.key, item);
  }

  const edited: LLMItemTags[] = [];

  for (const entry of result?.items || []) {
    if (!entry?.key) continue;

    const title = itemMap.get(entry.key)?.title || "[unknown title]";
    const current = Array.isArray(entry.tags) ? entry.tags : [];
    const initial = current.join(", ");

    const raw = promptEditTags(
      win,
      "Autotag preview",
      `Title:\n${title}\n\nEdit tags as a comma-separated list:`,
      initial,
    );

    // Cancel (or no prompt available) → keep original tags
    if (raw == null) {
      edited.push({ key: entry.key, tags: current });
      continue;
    }

    const newTags = String(raw)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    edited.push({ key: entry.key, tags: newTags });
  }

  return { items: edited };
}

/* =========================
   Apply tags
   ========================= */

/**
 * NOTE: This function currently tags the *currently selected items*.
 * That’s ok if Autotag is always launched from a selection, but selection can change
 * while preview is open. If you want strict correctness, tag by keys instead of selection.
 */
async function applyTagsToZotero(result: LLMTagResult): Promise<number> {
  const pane = (Zotero as any).getActiveZoteroPane?.();
  if (!pane) throw new Error("No active Zotero pane.");

  const selectedItems = pane.getSelectedItems?.() || [];
  if (!selectedItems.length) throw new Error("No items selected.");

  const tagMap = new Map<string, string[]>();
  for (const entry of result.items || []) {
    if (!entry?.key) continue;
    tagMap.set(entry.key, Array.isArray(entry.tags) ? entry.tags : []);
  }

  let taggedCount = 0;

  for (const item of selectedItems as any[]) {
    const tags = tagMap.get(item.key);
    if (!tags?.length) continue;

    const existing = new Set(
      (item.getTags?.() || []).map((t: any) => String(t.tag).toLowerCase()),
    );

    let changed = false;

    for (const tag of tags) {
      if (!tag) continue;
      const tLower = tag.toLowerCase();
      if (!existing.has(tLower)) {
        item.addTag(tag);
        existing.add(tLower);
        changed = true;
      }
    }

    if (changed) {
      // saveTx is async in Zotero; await to ensure tags persist reliably
      if (typeof item.saveTx === "function") {
        await item.saveTx();
      } else if (typeof item.save === "function") {
        await item.save();
      }
      taggedCount++;
    }
  }

  return taggedCount;
}

/* =========================
   Public entry point
   ========================= */

export async function runAutotagForItems(
  items: ItemMetadata[],
  win: _ZoteroTypes.MainWindow,
): Promise<void> {
  const mainWin = resolveMainWindow(win);

  if (!items?.length) {
    (mainWin as any).alert?.("No items provided to Autotag.");
    return;
  }

  const provider = getLLMProvider();
  const model = getModelForProvider(provider.name) || "(default)";
  const prompt = buildPromptFromItems(items);

  (Zotero as any).debug?.(
    `Autotag prompt sent to ${provider.name} (${model}):\n${prompt}`,
  );

  const llmResult = await callLLMForTags(prompt);

  const edited = previewAndEditTags(llmResult, items, mainWin);
  const count = await applyTagsToZotero(edited);

  (mainWin as any).alert?.(
    `Autotag applied tags using ${provider.name} (${model}) to ${count} item(s).`,
  );
}
