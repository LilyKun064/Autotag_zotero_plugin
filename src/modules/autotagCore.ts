// src/modules/autotagCore.ts

// Global Zotero objects
declare const Zotero: _ZoteroTypes.Zotero;
declare const Services: any;

import type { ItemMetadata } from "./autotagMenu";
import {
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
   Prompt construction
   ========================= */

function buildPromptFromItems(items: ItemMetadata[]): string {
  const basePrompt = getFinalPrompt();
  const seedKeywords = getSeedKeywords().trim();

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
      const creatorsStr = item.creators.join("; ");
      const tagsStr = item.tags.length ? item.tags.join(", ") : "(none)";

      return [
        `Paper ${idx + 1}:`,
        `key: ${item.key}`,
        `itemType: ${item.itemType}`,
        `title: ${item.title}`,
        `creators: ${creatorsStr}`,
        `journal: ${item.publicationTitle}`,
        `date: ${item.date}`,
        `existing_tags: ${tagsStr}`,
        `abstract:`,
        item.abstract || "[no abstract available]",
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

async function callLLMForTags(
  prompt: string,
): Promise<LLMTagResult> {
  const provider = getLLMProvider();
  const model = getModelForProvider(provider.name) || "(default)";

  let content: string;
  try {
    content = await provider.generateTags(prompt);
  } catch (e: any) {
    const msg = String(e);

    // Case 1: API version mismatch
    if (msg.includes("API version") && msg.includes("not supported")) {
      const match = msg.match(/API version ([a-zA-Z0-9.-]+)/);
      const apiVersion = match ? match[1] : "your current API version";

      throw new Error(
        `This model is not supported by the current API version (${apiVersion}).\n\n` +
          "Please select a different model in Autotag settings.",
      );
    }

    // Case 2: Model no longer exists
    if (msg.includes("404") && msg.includes("not found")) {
      throw new Error(
        "This model is not available anymore according to the provider.\n\n" +
          "Please select another model in Autotag settings.",
      );
    }

    throw new Error(
      `LLM error using ${provider.name} (${model}): ${msg}`,
    );
  }

  let parsed: LLMTagResult;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      `Invalid JSON returned by ${provider.name} (${model}):\n` +
        content.substring(0, 1000),
    );
  }

  if (!parsed.items || !Array.isArray(parsed.items)) {
    throw new Error(
      `LLM JSON missing items array (${provider.name}, ${model})`,
    );
  }

  return parsed;
}

/* =========================
   Preview dialog
   ========================= */

function previewAndEditTags(
  result: LLMTagResult,
  items: ItemMetadata[],
  win: _ZoteroTypes.MainWindow,
): LLMTagResult {
  const itemMap = new Map<string, ItemMetadata>();
  for (const item of items) itemMap.set(item.key, item);

  const edited: LLMItemTags[] = [];

  for (const entry of result.items) {
    const title = itemMap.get(entry.key)?.title || "[unknown title]";
    const input: any = { value: entry.tags.join(", ") };

    const ok = Services.prompt.prompt(
      win,
      "Autotag preview",
      `Title:\n${title}\n\nEdit tags as a comma-separated list:`,
      input,
      null,
      {},
    );

    if (!ok) {
      edited.push(entry);
      continue;
    }

    const newTags = String(input.value || "")
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

function applyTagsToZotero(result: LLMTagResult): number {
  const pane = Zotero.getActiveZoteroPane();
  if (!pane) throw new Error("No active Zotero pane.");

  const selectedItems = pane.getSelectedItems();
  if (!selectedItems.length) throw new Error("No items selected.");

  const tagMap = new Map<string, string[]>();
  for (const entry of result.items) {
    tagMap.set(entry.key, entry.tags);
  }

  let taggedCount = 0;

  for (const item of selectedItems as any[]) {
    const tags = tagMap.get(item.key);
    if (!tags?.length) continue;

    const existing = new Set(
      (item.getTags?.() || []).map((t: any) =>
        String(t.tag).toLowerCase(),
      ),
    );

    for (const tag of tags) {
      if (!existing.has(tag.toLowerCase())) {
        item.addTag(tag);
        existing.add(tag.toLowerCase());
      }
    }

    item.saveTx?.();
    taggedCount++;
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
  if (!items.length) {
    (win as any).alert("No items provided to Autotag.");
    return;
  }

  const provider = getLLMProvider();
  const model = getModelForProvider(provider.name) || "(default)";
  const prompt = buildPromptFromItems(items);

  (Zotero as any).debug(
    `Autotag prompt sent to ${provider.name} (${model}):\n${prompt}`,
  );

  const llmResult = await callLLMForTags(prompt);

  const edited = previewAndEditTags(llmResult, items, win);
  const count = applyTagsToZotero(edited);

  (win as any).alert(
    `Autotag applied tags using ${provider.name} (${model}) to ${count} item(s).`,
  );
}
