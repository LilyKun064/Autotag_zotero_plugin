// src/modules/llmProviders/index.ts

import { OpenAIProvider } from "./openaiProvider";
import { GeminiProvider } from "./geminiProvider";
import { DeepSeekProvider } from "./deepseekProvider";
import { LocalProvider } from "./localProvider";

import { getSelectedProvider } from "../autotagPrefs";

export function getLLMProvider() {
  const provider = getSelectedProvider();

  switch (provider) {
    case "gemini":
      return GeminiProvider;
    case "deepseek":
      return DeepSeekProvider;
    case "local":
      return LocalProvider;
    case "openai":
    default:
      return OpenAIProvider;
  }
}
