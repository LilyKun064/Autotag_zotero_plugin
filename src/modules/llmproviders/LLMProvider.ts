export interface LLMProvider {
  name: string;
  generateTags(prompt: string): Promise<string>;
}