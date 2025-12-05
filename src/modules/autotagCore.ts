// src/modules/autotagCore.ts

// Global Zotero object from the Zotero app
// src/modules/autotagCore.ts

// Global Zotero object from the Zotero app
declare const Zotero: _ZoteroTypes.Zotero;
declare const Services: any;  // <-- add this line if not present

import type { ItemMetadata } from "./autotagMenu";
import { getApiKey, getSeedKeywords } from "./autotagPrefs";


type LLMItemTags = {
  key: string;
  tags: string[];
};

type LLMTagResult = {
  items: LLMItemTags[];
};

/**
 * Build an LLM-ready prompt from a list of ItemMetadata,
 * including user-provided seed keywords.
 */
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
  - TECHNIQUE / METHOD: key methods or approaches (e.g., RNA_seq, GWAS, in_vivo_recording, RL_finetuning)
  - MATERIAL / SYSTEM:
      - For biology papers: species, taxa, tissue, system type (e.g., house_mouse, drosophila, zebrafish, human_neuroimaging)
      - For CS/ML papers: model or system type and key objects (e.g., LLM, vision_transformer, multimodal_model, benchmark_dataset)
- Reuse the same tag strings across papers whenever they refer to the same concept.
- If a seed keyword never fits a paper, do NOT force it.
`.trim()
    : `
For each paper:
- Generate 3–8 tags so that the final tag set covers:
  - TOPIC: main scientific question or conceptual focus
  - TECHNIQUE / METHOD: key methods or approaches (e.g., RNA_seq, GWAS, in_vivo_recording, RL_finetuning)
  - MATERIAL / SYSTEM:
      - For biology papers: species, taxa, tissue, system type (e.g., house_mouse, drosophila, zebrafish, human_neuroimaging)
      - For CS/ML papers: model or system type and key objects (e.g., LLM, vision_transformer, multimodal_model, benchmark_dataset)
- Reuse the same tag strings across papers whenever they refer to the same concept.
`.trim();

  const header = `
You are an assistant that reads scientific papers and assigns concise, reusable tags.

General rules:
- Tags must be 1–3 words long, snake_case or simple ASCII (e.g., "adaptive_evolution", "epigenetic_plasticity", "urban_ecology").
- Avoid overly generic terms like "study", "research", "methods", "experiment".
- Avoid full sentences or long phrases.
${seedsLine}

Return ONLY valid JSON in the following format, with no extra text:

{
  "items": [
    {
      "key": "<Zotero item key>",
      "tags": ["tag1", "tag2", "..."]
    },
    ...
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

/**
 * Call OpenAI's chat.completions endpoint with the prompt and return parsed JSON.
 * - Uses the API key stored in Autotag settings.
 * - Uses seed keywords (if any) to steer the vocabulary and structure.
 */
async function callOpenAIForTags(
  prompt: string,
): Promise<LLMTagResult> {
  const apiKey = getApiKey().trim();
  if (!apiKey) {
    throw new Error(
      "No API key configured. Open Tools → Autotag: settings… and set your OpenAI key.",
    );
  }

  const body = {
    model: "gpt-4o-mini", // change if you prefer another model
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are a careful assistant that ALWAYS returns ONLY valid JSON and never natural language outside JSON.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  };

  const url = "https://api.openai.com/v1/chat/completions";

  // Let Zotero.HTTP give us plain text so we can JSON.parse manually
  const response = await Zotero.HTTP.request("POST", url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify(body),
    // IMPORTANT: no responseType here, default is text
  });

  const raw = (response as any).responseText;
  if (!raw) {
    throw new Error(
      "OpenAI response did not contain responseText. Status: " +
        (response as any).status,
    );
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error("Failed to parse OpenAI response JSON: " + e);
  }

  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;

  if (!content || typeof content !== "string") {
    throw new Error(
      "OpenAI response did not contain a string message.content.",
    );
  }

  let parsed: LLMTagResult;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(
      "OpenAI did not return valid JSON. Raw content was:\n" +
        content.substring(0, 1000),
    );
  }

  if (!parsed.items || !Array.isArray(parsed.items)) {
    throw new Error(
      "OpenAI JSON is missing 'items' array. Parsed value: " +
        JSON.stringify(parsed).substring(0, 500),
    );
  }

  return parsed;
}

/**
 * Preview and allow the user to edit tags per item using a simple dialog.
 * Returns a new result object with the edited tags.
 */
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
      `Title:\n${title}\n\n` +
        `Edit tags as a comma-separated list.\n` +
        `You can change casing (e.g., "Adaptive Evolution") or remove/add tags.\n\n` +
        `Suggested tags:`,
      input,
      null,
      {},
    );

    if (!ok) {
      // User pressed Cancel → keep original tags
      edited.push(entry);
      continue;
    }

    const text = String(input.value || "").trim();
    if (!text) {
      // Empty text → treat as "no tags" for this item
      edited.push({ key: entry.key, tags: [] });
      continue;
    }

    const newTags = text
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


/**
 * Apply tags from an LLMTagResult back to Zotero items.
 */
function applyTagsToZotero(result: LLMTagResult): number {
  const pane = Zotero.getActiveZoteroPane();
  if (!pane) {
    throw new Error("No active Zotero pane.");
  }

  const selectedItems = pane.getSelectedItems();
  if (!selectedItems || !selectedItems.length) {
    throw new Error("No items selected.");
  }

  const tagMap = new Map<string, string[]>();
  for (const entry of result.items) {
    tagMap.set(entry.key, entry.tags);
  }

  let taggedCount = 0;

  for (const item of selectedItems as any[]) {
    const tags = tagMap.get(item.key);
    if (!tags || !tags.length) continue;

    const existingTags = new Set(
      (item.getTags?.() || []).map((t: any) =>
        String(t.tag).toLowerCase(),
      ),
    );

    for (const t of tags) {
      const tagName = String(t).trim();
      if (!tagName) continue;

      if (!existingTags.has(tagName.toLowerCase())) {
        item.addTag(tagName);
        existingTags.add(tagName.toLowerCase());
      }
    }

    item.saveTx?.();
    taggedCount++;
  }

  return taggedCount;
}

/**
 * Core entry point called by the menu.
 * - Builds the prompt (including seed keywords)
 * - Calls OpenAI
 * - Applies tags to the selected items
 */
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

  // Log prompt for debugging
  (Zotero as any).debug(
    "Autotag prompt being sent to OpenAI:\n" + prompt,
  );

  let llmResult = await callOpenAIForTags(prompt);

  (Zotero as any).debug(
    "Autotag OpenAI result (before preview): " +
      JSON.stringify(llmResult, null, 2),
  );

  // Let the user review and edit tags per item
  llmResult = previewAndEditTags(llmResult, items, win);

  (Zotero as any).debug(
    "Autotag result (after preview edits): " +
      JSON.stringify(llmResult, null, 2),
  );

  const taggedCount = applyTagsToZotero(llmResult);


  (win as any).alert(
    `Autotag applied tags from OpenAI to ${taggedCount} item(s).`,
  );
}
