// src/modules/llmProviders/localProvider.ts

import type { LLMProvider } from "./LLMProvider";
import { getModelForProvider } from "../autotagPrefs";

declare const Zotero: _ZoteroTypes.Zotero;

async function detectOllamaBase(): Promise<string | null> {
  const candidateBases = [
    "http://127.0.0.1:11434",
    "http://localhost:11434",
  ];

  for (const base of candidateBases) {
    try {
      await Zotero.HTTP.request("GET", `${base}/api/tags`, {
        headers: {
          Accept: "application/json",
        },
      });
      return base;
    } catch {
      // try next candidate
    }
  }

  return null;
}

function parseServerResponse(rawResponseText: string): string {
  let parsed: any;
  try {
    parsed = JSON.parse(rawResponseText);
  } catch {
    throw new Error("Invalid JSON returned by local model server");
  }

  if (parsed.error) {
    const msg = String(parsed.error).toLowerCase();

    if (
      msg.includes("model") &&
      (msg.includes("not found") ||
        msg.includes("no such") ||
        msg.includes("unknown"))
    ) {
      throw new Error(
        "Local model not found. Make sure the selected Ollama model is installed."
      );
    }

    throw new Error(String(parsed.error));
  }

  const content =
    typeof parsed.response === "string" ? parsed.response.trim() : "";
  if (!content) {
    throw new Error("Local model returned empty text");
  }

  return content;
}

function normalizeToAutotagJson(text: string): string | null {
  let parsed: any;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  // Case 1: already in the correct shape
  if (parsed && Array.isArray(parsed.items)) {
    const normalizedItems = parsed.items
      .map((x: any) => {
        const key = String(x?.key || "").trim();
        const tags = Array.isArray(x?.tags)
          ? x.tags.map((t: any) => String(t).trim()).filter(Boolean)
          : [];
        return { key, tags };
      })
      .filter((x: any) => x.key || x.tags.length > 0);

    if (normalizedItems.length > 0) {
      return JSON.stringify({ items: normalizedItems });
    }
  }

  // Case 2: model returned { tags: [...] }
  if (parsed && Array.isArray(parsed.tags)) {
    const tags = parsed.tags
      .map((t: any) => String(t).trim())
      .filter(Boolean);

    if (tags.length > 0) {
      return JSON.stringify({
        items: [
          {
            tags,
          },
        ],
      });
    }
  }

  // Case 3: model returned a bare array ["tag1", "tag2"]
  if (Array.isArray(parsed)) {
    const tags = parsed
      .map((t: any) => String(t).trim())
      .filter(Boolean);

    if (tags.length > 0) {
      return JSON.stringify({
        items: [
          {
            tags,
          },
        ],
      });
    }
  }

  return null;
}

async function callOllamaGenerate(
  base: string,
  model: string,
  prompt: string,
  strictRetry = false,
): Promise<string> {
  const schema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            tags: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["tags"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  };

  const wrappedPrompt = strictRetry
    ? [
        prompt,
        "",
        "IMPORTANT:",
        'Return ONLY valid JSON in exactly this shape:',
        '{"items":[{"key":"<Zotero item key>","tags":["tag1","tag2"]}]}',
        'Each item must contain a "tags" array.',
        'Use the paper key when available.',
        "Do not return a bare array.",
        'Do not return {"tags":[...]} by itself.',
        "Do not return markdown fences.",
        "Do not return explanation or summary.",
      ].join("\n")
    : [
        prompt,
        "",
        "IMPORTANT:",
        'Return ONLY valid JSON in exactly this shape:',
        '{"items":[{"key":"<Zotero item key>","tags":["tag1","tag2"]}]}',
        'Each item must contain a "tags" array.',
        "Do not return markdown fences or explanation.",
      ].join("\n");

  const body = {
    model,
    prompt: wrappedPrompt,
    stream: false,
    format: schema,
    options: {
      temperature: 0,
    },
  };

  let response;
  try {
    response = await Zotero.HTTP.request("POST", `${base}/api/generate`, {
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      timeout: 300000
    });
  } catch (err: any) {
    throw new Error(
      `Connected to Ollama at ${base}, but failed to generate a response. ${err?.message || String(err)}`
    );
  }

  const raw = (response as any).responseText;
  if (!raw) {
    throw new Error("Empty response from local model server");
  }

  return parseServerResponse(raw);
}

export const LocalProvider: LLMProvider = {
  name: "local",

  async generateTags(prompt: string): Promise<string> {
    const model = getModelForProvider("local").trim();
    if (!model) {
      throw new Error(
        "No local model selected. Open Autotag settings and enter a model name."
      );
    }

    const base = await detectOllamaBase();
    if (!base) {
      throw new Error(
        "Cannot connect to local model server. Make sure Ollama is running."
      );
    }

    const firstOutput = await callOllamaGenerate(base, model, prompt, false);
    const firstNormalized = normalizeToAutotagJson(firstOutput);
    if (firstNormalized) {
      return firstNormalized;
    }

    const secondOutput = await callOllamaGenerate(base, model, prompt, true);
    const secondNormalized = normalizeToAutotagJson(secondOutput);
    if (secondNormalized) {
      return secondNormalized;
    }

    throw new Error(
      `Invalid JSON returned by local (${model}).\n\n` +
        `Expected format: {"items":[{"key":"<Zotero item key>","tags":["tag1","tag2"]}]}\n\n` +
        `First 1000 chars of raw response:\n${secondOutput.slice(0, 1000)}`
    );
  },
};