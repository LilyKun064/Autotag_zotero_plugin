// src/modules/llmProviders/openrouterProvider.ts

import type { LLMProvider } from "./LLMProvider";
import {
  getApiKeyForProvider,
  getBaseUrlForProvider,
  getCustomModelForProvider,
  getModelForProvider,
} from "../autotagPrefs";

declare const Zotero: _ZoteroTypes.Zotero;

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export const OpenRouterProvider: LLMProvider = {
  name: "openrouter",

  async generateTags(prompt: string): Promise<string> {
    const apiKey = getApiKeyForProvider("openrouter").trim();
    if (!apiKey) {
      throw new Error("OpenRouter API key not configured");
    }

    const customModel = getCustomModelForProvider("openrouter").trim();
    const selectedModel = getModelForProvider("openrouter").trim();
    const model = customModel || selectedModel;

    if (!model) {
      throw new Error(
        "No OpenRouter model selected. Open Autotag settings and choose a model.",
      );
    }

    const customBaseUrl = getBaseUrlForProvider("openrouter").trim();
    const baseUrl = normalizeBaseUrl(customBaseUrl || "https://openrouter.ai/api/v1");
    const endpoint = `${baseUrl}/chat/completions`;

    const body = {
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a careful assistant that ALWAYS returns ONLY valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    };

    // Optional attribution headers for OpenRouter rankings
    const headers: { [key: string]: string } = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    };

    // Add optional attribution headers (these help with OpenRouter rankings)
    const addonURL = "https://github.com/LilyKun064/Autotag_zotero_plugin";
    headers["HTTP-Referer"] = addonURL;
    headers["X-OpenRouter-Title"] = "Autotag Zotero Plugin";

    const response = await Zotero.HTTP.request("POST", endpoint, {
      headers,
      body: JSON.stringify(body),
    });

    const raw = (response as any).responseText;
    if (!raw) {
      throw new Error("Empty OpenRouter response");
    }

    const parsed = JSON.parse(raw);
    const content = parsed?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("OpenRouter response missing message content");
    }

    return content;
  },
};
