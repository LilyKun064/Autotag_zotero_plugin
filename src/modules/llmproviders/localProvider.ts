// src/modules/llmProviders/localProvider.ts

import type { LLMProvider } from "./LLMProvider";
import { getModelForProvider } from "../autotagPrefs";

declare const Zotero: _ZoteroTypes.Zotero;

export const LocalProvider: LLMProvider = {
  name: "local",

  async generateTags(prompt: string): Promise<string> {
    const model = getModelForProvider("local").trim();
    if (!model) {
      throw new Error(
        "No local model selected. Open Autotag settings and enter a model name.",
      );
    }

    const body = {
      model,
      prompt,
      stream: false,
    };

    let response;
    try {
      response = await Zotero.HTTP.request(
        "POST",
        "http://127.0.0.1:11434/api/generate",
        {
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      throw new Error(
        "Cannot connect to local model server. Make sure Ollama is running.",
      );
    }

    const raw = (response as any).responseText;
    if (!raw) {
      throw new Error("Empty response from local model server");
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
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
          "Local model not found. Please download the model from Ollama.com",
        );
      }

      throw new Error(parsed.error);
    }

    const content = parsed.response;
    if (!content) {
      throw new Error("Local model response missing text");
    }

    return content;
  },
};
