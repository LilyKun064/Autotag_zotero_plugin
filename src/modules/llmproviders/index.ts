// src/modules/llmProviders/index.ts

import { OpenAIProvider } from "./openaiProvider";
import { GeminiProvider } from "./geminiProvider";
import { DeepSeekProvider } from "./deepseekProvider";
import { OpenRouterProvider } from "./openrouterProvider";
import { LocalProvider } from "./localProvider";

import { getSelectedProvider } from "../autotagPrefs";

export function getLLMProvider() {
  const provider = getSelectedProvider();

  switch (provider) {
    case "gemini":
      return GeminiProvider;
    case "deepseek":
      return DeepSeekProvider;
    case "openrouter":
      return OpenRouterProvider;
    case "local":
      return LocalProvider;
    case "openai":
    default:
      return OpenAIProvider;
  }
}
