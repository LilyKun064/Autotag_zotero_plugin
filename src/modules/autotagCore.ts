// src/modules/autotagCore.ts

// Global Zotero object
declare const Zotero: _ZoteroTypes.Zotero;
// In Zotero/Firefox chrome contexts this exists, but TS may not know it
declare const ChromeUtils: any;

import type { ItemMetadata } from "./autotagMenu";
import {
  Services as PrefsServices,
  getSeedKeywords,
  getModelForProvider,
  getCustomModelForProvider,
  getFinalPrompt,
  getPromptContentOptions,
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

function resolveServices(): any | undefined {
  const zServices = (Zotero as any)?.Services;
  if (zServices) return zServices;

  if (PrefsServices) return PrefsServices as any;

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

function nonEmptyString(value: unknown): string {
  return String(value ?? "").trim();
}

function maybeAddBlock(lines: string[], label: string, value: unknown): void {
  const text = nonEmptyString(value);
  if (text) {
    lines.push(`${label}: ${text}`);
  }
}

function maybeAddMultilineBlock(
  lines: string[],
  label: string,
  value: unknown,
  fallback?: string,
): void {
  const text = nonEmptyString(value);
  if (text) {
    lines.push(`${label}:`);
    lines.push(text);
  } else if (fallback) {
    lines.push(`${label}:`);
    lines.push(fallback);
  }
}

/**
 * Make model output more tolerant before JSON.parse():
 * - strips ```json ... ``` or ``` ... ``` fences
 * - strips a leading standalone "json" line
 * - trims surrounding whitespace
 */
function sanitizeLLMJsonResponse(content: string): string {
  let text = String(content || "").trim();

  const fencedMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch && fencedMatch[1]) {
    text = fencedMatch[1].trim();
  }

  text = text.replace(/^json\s*\n/i, "").trim();

  return text;
}

/* =========================
   Prompt construction
   ========================= */

function buildPromptFromItems(items: ItemMetadata[]): string {
  const basePrompt = getFinalPrompt();
  const seedKeywords = (getSeedKeywords() || "").trim();
  const contentOptions = getPromptContentOptions();

  const rawJsonInstruction = `
Return only raw JSON.
Do not wrap the JSON in Markdown, code fences, or explanatory text.
`.trim();

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
      const lines: string[] = [];
      const creators = Array.isArray(item.creators) ? item.creators : [];
      const creatorsStr = creators.join("; ");
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const tagsStr = tags.length ? tags.join(", ") : "(none)";

      lines.push(`Paper ${idx + 1}:`);
      lines.push(`key: ${String(item.key ?? "")}`);
      maybeAddBlock(lines, "itemType", item.itemType);

      if (contentOptions.includeTitle) {
        maybeAddBlock(lines, "title", item.title);
      }

      if (contentOptions.includeCreators) {
        maybeAddBlock(lines, "creators", creatorsStr);
      }

      if (contentOptions.includePublicationTitle) {
        maybeAddBlock(lines, "journal", item.publicationTitle);
      }

      if (contentOptions.includeDate) {
        maybeAddBlock(lines, "date", item.date);
      }

      if (contentOptions.includeExistingTags) {
        lines.push(`existing_tags: ${tagsStr}`);
      }

      if (contentOptions.includeAbstract) {
        maybeAddMultilineBlock(
          lines,
          "abstract",
          item.abstract,
          "[no abstract available]",
        );
      }

      if (contentOptions.includePdfText) {
        maybeAddMultilineBlock(
          lines,
          "pdf_text",
          item.pdfText,
          "[no extracted PDF text available]",
        );
      }

      return lines.join("\n");
    })
    .join("\n\n---\n\n");

  return `
${basePrompt}

${rawJsonInstruction}
${seedsBlock}

=== PAPERS ===

${itemsBlock}
`.trim();
}

/* =========================
   LLM call
   ========================= */

async function callLLMForTags(
  prompt: string,
  sourceItems: ItemMetadata[],
): Promise<LLMTagResult> {
  const provider = getLLMProvider();
  const customModel = getCustomModelForProvider(provider.name).trim();
  const selectedModel = getModelForProvider(provider.name).trim();
  const model = customModel || selectedModel || "(default)";

  let content = "";

  try {
    content = await provider.generateTags(prompt);
    (Zotero as any).debug?.(
      `Autotag raw response from ${provider.name} (${model}):\n${content}`,
    );
  } catch (e: any) {
    const msg = e instanceof Error ? e.message || String(e) : String(e);

    (Zotero as any).debug?.(
      `Autotag provider error from ${provider.name} (${model}): ${msg}`,
    );

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
        "Please select another model in Autotag settings.\n\n" +
        "Note: If you're using local model, the model you're calling might not be installed. ",
      );
    }

    throw new Error(`LLM error using ${provider.name} (${model}): ${msg}`);
  }

  let parsed: any;
  try {
    const sanitized = sanitizeLLMJsonResponse(content);
    (Zotero as any).debug?.(
      `Autotag sanitized response from ${provider.name} (${model}):\n${sanitized}`,
    );
    parsed = JSON.parse(sanitized);
  } catch {
    throw new Error(
      `Invalid JSON returned by ${provider.name} (${model}).\n\n` +
      `First 1000 chars of raw response:\n${content.substring(0, 1000)}`,
    );
  }

  if (!parsed?.items || !Array.isArray(parsed.items)) {
    throw new Error(
      `LLM JSON missing items array (${provider.name}, ${model}).\n\n` +
      `Returned JSON:\n${JSON.stringify(parsed, null, 2).substring(0, 1000)}`,
    );
  }

  const validKeys = new Set(
    (sourceItems || []).map((x) => String(x.key || "").trim()),
  );

  const normalized: LLMItemTags[] = (parsed.items || [])
    .map((x: any, i: number) => {
      let key = String(x?.key || "").trim();

      if (!key || !validKeys.has(key)) {
        key = String(sourceItems?.[i]?.key || "").trim();
      }

      const tagsRaw = x?.tags;
      const tags = Array.isArray(tagsRaw)
        ? tagsRaw.map((t: any) => String(t).trim()).filter(Boolean)
        : [];

      return { key, tags };
    })
    .filter((x: LLMItemTags) => !!x.key);

  return { items: normalized };
}

/* =========================
   Preview dialog
   ========================= */

function promptEditTags(
  winIn: _ZoteroTypes.MainWindow | undefined,
  title: string,
  message: string,
  initial: string,
): string | null {
  const win = resolveMainWindow(winIn);
  const S = resolveServices();

  if (S?.prompt?.prompt) {
    const input: any = { value: initial };
    const ok = S.prompt.prompt(win, title, message, input, null, {});
    return ok ? String(input.value ?? "") : null;
  }

  const w: any = win as any;
  if (typeof w.prompt === "function") {
    const raw = w.prompt(`${title}\n\n${message}`, initial);
    return raw == null ? null : String(raw);
  }

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
    if (!tags?.length) {
      (Zotero as any).debug?.(`Autotag: no tags for selected item ${item.key}`);
      continue;
    }

    const existingTags = (item.getTags?.() || []).map((t: any) => String(t.tag));
    const existing = new Set(existingTags.map((t: string) => t.toLowerCase()));

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

    (Zotero as any).debug?.(
      `Autotag item ${item.key}: proposed=${JSON.stringify(tags)} existing=${JSON.stringify(existingTags)} changed=${changed}`,
    );

    if (changed) {
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
  const customModel = getCustomModelForProvider(provider.name).trim();
  const selectedModel = getModelForProvider(provider.name).trim();
  const model = customModel || selectedModel || "(default)";
  const prompt = buildPromptFromItems(items);

  (Zotero as any).debug?.(
    `Autotag prompt sent to ${provider.name} (${model}):\n${prompt}`,
  );

  const llmResult = await callLLMForTags(prompt, items);

  (Zotero as any).debug?.(
    `Autotag parsed result:\n${JSON.stringify(llmResult, null, 2)}`,
  );

  const inputKeys = items.map((x) => x.key);
  const outputKeys = (llmResult.items || []).map((x) => x.key);

  (Zotero as any).debug?.(
    `Autotag input keys: ${JSON.stringify(inputKeys)}\n` +
    `Autotag output keys: ${JSON.stringify(outputKeys)}`,
  );

  const edited = previewAndEditTags(llmResult, items, mainWin);

  (Zotero as any).debug?.(
    `Autotag edited result:\n${JSON.stringify(edited, null, 2)}`,
  );

  const count = await applyTagsToZotero(edited);

  (mainWin as any).alert?.(
    `Autotag applied tags using ${provider.name} (${model}) to ${count} item(s).`,
  );
}