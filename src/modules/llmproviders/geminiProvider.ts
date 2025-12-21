// src/modules/llmProviders/geminiProvider.ts

import type { LLMProvider } from "./LLMProvider";
import {
  getApiKeyForProvider,
  getModelForProvider,
} from "../autotagPrefs";

declare const Zotero: _ZoteroTypes.Zotero;

export const GeminiProvider: LLMProvider = {
  name: "gemini",

  async generateTags(prompt: string): Promise<string> {
    const apiKey = getApiKeyForProvider("gemini").trim();
    if (!apiKey) {
      throw new Error("Gemini API key not configured");
    }

    const model = getModelForProvider("gemini").trim();
    if (!model) {
      throw new Error(
        "No Gemini model selected. Open Autotag settings and choose a model.",
      );
    }

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    };

    const response = await Zotero.HTTP.request(
      "POST",
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const raw = (response as any).responseText;
    if (!raw) {
      throw new Error("Empty Gemini response");
    }

    const parsed = JSON.parse(raw);
    const content =
      parsed?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      throw new Error("Gemini response missing text content");
    }

    return content;
  },
};
