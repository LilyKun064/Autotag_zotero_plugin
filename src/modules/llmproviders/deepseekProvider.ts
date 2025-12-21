// src/modules/llmProviders/deepseekProvider.ts

import type { LLMProvider } from "./LLMProvider";
import {
  getApiKeyForProvider,
  getModelForProvider,
} from "../autotagPrefs";

declare const Zotero: _ZoteroTypes.Zotero;

export const DeepSeekProvider: LLMProvider = {
  name: "deepseek",

  async generateTags(prompt: string): Promise<string> {
    const apiKey = getApiKeyForProvider("deepseek").trim();
    if (!apiKey) {
      throw new Error("DeepSeek API key not configured");
    }

    const model = getModelForProvider("deepseek").trim();
    if (!model) {
      throw new Error(
        "No DeepSeek model selected. Open Autotag settings and choose a model.",
      );
    }

    const body = {
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You must return ONLY valid JSON and no other text.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    };

    const response = await Zotero.HTTP.request(
      "POST",
      "https://api.deepseek.com/v1/chat/completions",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify(body),
      },
    );

    const raw = (response as any).responseText;
    if (!raw) {
      throw new Error("Empty DeepSeek response");
    }

    const parsed = JSON.parse(raw);
    const content = parsed?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("DeepSeek response missing message content");
    }

    return content;
  },
};
