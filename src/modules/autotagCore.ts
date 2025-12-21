// src/modules/autotagCore.ts

// Global Zotero objects
declare const Zotero: _ZoteroTypes.Zotero;
declare const Services: any;

import type { ItemMetadata } from "./autotagMenu";
import {
  getSeedKeywords,
  getModelForProvider,
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

function buildPromptFromItems(
  items: ItemMetadata[],
  seedKeywords: string,
): string {
  const seedsLine = seedKeywords
    ? `
The user has provided the following preferred tag vocabulary:

seed_keywords = [${seedKeywords}]

For each paper:
- First, select any tags from seed_keywords that clearly apply to that paper.
- Then, ADD 3–8 NEW tags (not necessarily in seed_keywords) so that the final tag set covers:
  - TOPIC: main scientific question or conceptual focus
  - TECHNIQUE / METHOD: key methods or approaches
  - MATERIAL / SYSTEM
- Reuse the same tag strings across papers whenever they refer to the same concept.
- If a seed keyword never fits a paper, do NOT force it.
`.trim()
    : `
For each paper:
- Generate 3–8 tags so that the final tag set covers:
  - TOPIC: main scientific question or conceptual focus
  - TECHNIQUE / METHOD
  - MATERIAL / SYSTEM
- Reuse the same tag strings across papers whenever they refer to the same concept.
`.trim();

  const header = `
You are an assistant that reads scientific papers and assigns concise, reusable tags.

General rules:
- Tags must be 1–3 words long, snake_case or simple ASCII.
- Avoid overly generic terms like "study", "research", "methods", "experiment".
- Avoid full sentences or long phrases.
${seedsLine}

Return ONLY valid JSON in the following format:

{
  "items": [
    {
      "key": "<Zotero item key>",
      "tags": ["tag1", "tag2"]
    }
  ]
}
`.trim();

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

  return `${header}\n\n=== PAPERS ===\n\n${itemsBlock}`;
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

    // Case 1: model exists but not supported by current API version
    if (
      msg.includes("not supported") &&
      msg.includes("API version")
    ) {
      const match = msg.match(/API version ([a-zA-Z0-9.-]+)/);
      const apiVersion = match ? match[1] : "your current API version";

      throw new Error(
        `This model is not supported by the current API version (${apiVersion}).\n\n` +
          "Please select a different model in Autotag settings.",
      );
    }

    // Case 2: model not found or no longer available
    if (
      msg.includes("404") &&
      (msg.includes("not found") ||
        msg.includes("is not found"))
    ) {
      throw new Error(
        "This model is not available anymore according to the provider.\n\n" +
          "Please try another model in Autotag settings.",
      );
    }

    // Other errors
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
  for (const item of items) {
    itemMap.set(item.key, item);
  }

  const edited: LLMItemTags[] = [];

  for (const entry of result.items) {
    const meta = itemMap.get(entry.key);
    const title = meta?.title || "[unknown title]";
    const currentTagsStr = entry.tags.join(", ");

    const input: any = { value: currentTagsStr };

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
      .filter((t) => t.length > 0);

    edited.push({
      key: entry.key,
      tags: newTags,
    });
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

    for (const t of tags) {
      const tagName = String(t).trim();
      if (!existing.has(tagName.toLowerCase())) {
        item.addTag(tagName);
        existing.add(tagName.toLowerCase());
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

  const seeds = getSeedKeywords().trim();
  const prompt = buildPromptFromItems(items, seeds);

  const provider = getLLMProvider();
  const model = getModelForProvider(provider.name) || "(default)";

  (Zotero as any).debug(
    `Autotag prompt sent to ${provider.name} (${model}):\n${prompt}`,
  );

  const llmResult = await callLLMForTags(prompt);

  (Zotero as any).debug(
    `Autotag result from ${provider.name} (${model}) before preview:\n` +
      JSON.stringify(llmResult, null, 2),
  );

  const editedResult = previewAndEditTags(llmResult, items, win);

  const taggedCount = applyTagsToZotero(editedResult);

  (win as any).alert(
    `Autotag applied tags using ${provider.name} (${model}) to ${taggedCount} item(s).`,
  );
}
