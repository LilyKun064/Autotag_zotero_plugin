// src/modules/autotagPrefs.ts

// Zotero global from the app
declare const Zotero: _ZoteroTypes.Zotero;
// ChromeUtils is provided by the Zotero Firefox platform
declare const ChromeUtils: any;

/**
 * Services access in Zotero 8:
 * - In some Zotero 8 contexts, importing resource://gre/modules/Services.sys.mjs
 *   can FAIL (not just export-shape issues).
 * - Prefer Zotero.Services when available, and only try importing as a fallback.
 */
let ServicesAny: any = (Zotero as any)?.Services;

if (!ServicesAny) {
  try {
    const ServicesMod = ChromeUtils.importESModule(
      "resource://gre/modules/Services.sys.mjs",
    );
    ServicesAny =
      (ServicesMod as any).Services ||
      (ServicesMod as any).default ||
      ServicesMod;
  } catch {
    // leave undefined; callers will fall back to window.prompt/confirm
  }
}

export const Services: any = ServicesAny;

// =========================
// Preference namespace
// =========================
const PREF_BRANCH = "extensions.zotero.autotag.";

// =========================
// Preference keys
// =========================

// Provider
const PREF_PROVIDER = `${PREF_BRANCH}llmProvider`;

// API keys
const PREF_API_KEY_OPENAI = `${PREF_BRANCH}apiKey.openai`;
const PREF_API_KEY_GEMINI = `${PREF_BRANCH}apiKey.gemini`;
const PREF_API_KEY_DEEPSEEK = `${PREF_BRANCH}apiKey.deepseek`;

// Models
const PREF_MODEL_OPENAI = `${PREF_BRANCH}model.openai`;
const PREF_MODEL_GEMINI = `${PREF_BRANCH}model.gemini`;
const PREF_MODEL_DEEPSEEK = `${PREF_BRANCH}model.deepseek`;
const PREF_MODEL_LOCAL = `${PREF_BRANCH}model.local`;

// Seed keywords
const PREF_SEED_KEYWORDS = `${PREF_BRANCH}seedKeywords`;

// Final prompt
const PREF_FINAL_PROMPT = `${PREF_BRANCH}finalPrompt`;

// Prompt content selection
const PREF_INCLUDE_TITLE = `${PREF_BRANCH}content.includeTitle`;
const PREF_INCLUDE_CREATORS = `${PREF_BRANCH}content.includeCreators`;
const PREF_INCLUDE_PUBLICATION_TITLE = `${PREF_BRANCH}content.includePublicationTitle`;
const PREF_INCLUDE_DATE = `${PREF_BRANCH}content.includeDate`;
const PREF_INCLUDE_EXISTING_TAGS = `${PREF_BRANCH}content.includeExistingTags`;
const PREF_INCLUDE_ABSTRACT = `${PREF_BRANCH}content.includeAbstract`;
const PREF_INCLUDE_PDF_TEXT = `${PREF_BRANCH}content.includePdfText`;
const PREF_PDF_TEXT_MODE = `${PREF_BRANCH}content.pdfTextMode`;
const PREF_PDF_TEXT_CHAR_LIMIT = `${PREF_BRANCH}content.pdfTextCharLimit`;

// =========================
// Types
// =========================

export type PdfTextMode = "first_n_chars" | "full_text";

export type PromptContentOptions = {
  includeTitle: boolean;
  includeCreators: boolean;
  includePublicationTitle: boolean;
  includeDate: boolean;
  includeExistingTags: boolean;
  includeAbstract: boolean;
  includePdfText: boolean;
  pdfTextMode: PdfTextMode;
  pdfTextCharLimit: number;
};

// =========================
// Generic pref helpers
// =========================

function getStringPref(prefKey: string, useGlobal = false): string {
  try {
    const raw = Zotero.Prefs.get(prefKey, useGlobal);
    return raw == null ? "" : String(raw);
  } catch {
    return "";
  }
}

function setStringPref(prefKey: string, value: string, useGlobal = false): void {
  Zotero.Prefs.set(prefKey, value, useGlobal);
}

function getBoolPref(prefKey: string, fallback: boolean): boolean {
  try {
    const raw = Zotero.Prefs.get(prefKey);
    if (raw === true || raw === false) return raw;
    if (raw == null || raw === "") return fallback;

    const normalized = String(raw).trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;

    return fallback;
  } catch {
    return fallback;
  }
}

function setBoolPref(prefKey: string, value: boolean): void {
  Zotero.Prefs.set(prefKey, !!value);
}

function getIntPref(prefKey: string, fallback: number): number {
  try {
    const raw = Zotero.Prefs.get(prefKey);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  } catch {
    return fallback;
  }
}

function setIntPref(prefKey: string, value: number): void {
  const n = Number(value);
  Zotero.Prefs.set(prefKey, Number.isFinite(n) && n > 0 ? Math.floor(n) : value);
}

// =========================
// Provider helpers
// =========================

export function getSelectedProvider(): string {
  try {
    const raw = Zotero.Prefs.get(PREF_PROVIDER);
    return raw ? String(raw) : "openai";
  } catch {
    return "openai";
  }
}

export function setSelectedProvider(provider: string): void {
  Zotero.Prefs.set(PREF_PROVIDER, provider);
}

function getApiKeyPref(provider: string): string {
  switch (provider) {
    case "gemini":
      return PREF_API_KEY_GEMINI;
    case "deepseek":
      return PREF_API_KEY_DEEPSEEK;
    case "openai":
    default:
      return PREF_API_KEY_OPENAI;
  }
}

function getModelPref(provider: string): string {
  switch (provider) {
    case "gemini":
      return PREF_MODEL_GEMINI;
    case "deepseek":
      return PREF_MODEL_DEEPSEEK;
    case "local":
      return PREF_MODEL_LOCAL;
    case "openai":
    default:
      return PREF_MODEL_OPENAI;
  }
}

// =========================
// API key access
// =========================

export function getApiKeyForProvider(provider: string): string {
  if (provider === "local") return "";

  const prefKey = getApiKeyPref(provider);
  try {
    const raw = Zotero.Prefs.get(prefKey, true);
    return raw == null ? "" : String(raw);
  } catch {
    return "";
  }
}

export function setApiKeyForProvider(provider: string, value: string): void {
  if (provider === "local") return;

  const prefKey = getApiKeyPref(provider);
  Zotero.Prefs.set(prefKey, value, true);
}

// =========================
// Model access
// =========================

export function getModelForProvider(provider: string): string {
  const prefKey = getModelPref(provider);
  try {
    const raw = Zotero.Prefs.get(prefKey);
    return raw ? String(raw) : "";
  } catch {
    return "";
  }
}

export function setModelForProvider(provider: string, model: string): void {
  const prefKey = getModelPref(provider);
  Zotero.Prefs.set(prefKey, model);
}

// =========================
// Seed keywords
// =========================

export function getSeedKeywords(): string {
  try {
    const raw = Zotero.Prefs.get(PREF_SEED_KEYWORDS, true);
    return raw == null ? "" : String(raw);
  } catch {
    return "";
  }
}

export function setSeedKeywords(value: string): void {
  Zotero.Prefs.set(PREF_SEED_KEYWORDS, value, true);
}

// =========================
// Final prompt
// =========================

export function getDefaultPrompt(): string {
  return `
You are an assistant that reads scientific papers and assigns concise reusable tags.

Rules:
- Tags must be one to three words long
- Use snake_case or simple ASCII
- Avoid overly generic terms
- Reuse identical tags across papers when referring to the same concept

For each paper generate three to eight tags covering:
- Topic
- Method or technique
- Material system or model organism

Return only valid JSON.
- Do not use markdown.
- Do not use fences.
- Do not include explanations.
- Return only raw JSON in the following format:
{
  "items": [
    {
      "key": "<Zotero item key>",
      "tags": ["tag1", "tag2"]
    }
  ]
}
`.trim();
}

export function getFinalPrompt(): string {
  try {
    const raw = Zotero.Prefs.get(PREF_FINAL_PROMPT, true);
    return raw == null || !String(raw).trim()
      ? getDefaultPrompt()
      : String(raw);
  } catch {
    return getDefaultPrompt();
  }
}

export function setFinalPrompt(value: string): void {
  Zotero.Prefs.set(PREF_FINAL_PROMPT, value, true);
}

// =========================
// Prompt content options
// =========================

export function getIncludeTitle(): boolean {
  return getBoolPref(PREF_INCLUDE_TITLE, true);
}

export function setIncludeTitle(value: boolean): void {
  setBoolPref(PREF_INCLUDE_TITLE, value);
}

export function getIncludeCreators(): boolean {
  return getBoolPref(PREF_INCLUDE_CREATORS, true);
}

export function setIncludeCreators(value: boolean): void {
  setBoolPref(PREF_INCLUDE_CREATORS, value);
}

export function getIncludePublicationTitle(): boolean {
  return getBoolPref(PREF_INCLUDE_PUBLICATION_TITLE, true);
}

export function setIncludePublicationTitle(value: boolean): void {
  setBoolPref(PREF_INCLUDE_PUBLICATION_TITLE, value);
}

export function getIncludeDate(): boolean {
  return getBoolPref(PREF_INCLUDE_DATE, true);
}

export function setIncludeDate(value: boolean): void {
  setBoolPref(PREF_INCLUDE_DATE, value);
}

export function getIncludeExistingTags(): boolean {
  return getBoolPref(PREF_INCLUDE_EXISTING_TAGS, true);
}

export function setIncludeExistingTags(value: boolean): void {
  setBoolPref(PREF_INCLUDE_EXISTING_TAGS, value);
}

export function getIncludeAbstract(): boolean {
  return getBoolPref(PREF_INCLUDE_ABSTRACT, true);
}

export function setIncludeAbstract(value: boolean): void {
  setBoolPref(PREF_INCLUDE_ABSTRACT, value);
}

export function getIncludePdfText(): boolean {
  return getBoolPref(PREF_INCLUDE_PDF_TEXT, false);
}

export function setIncludePdfText(value: boolean): void {
  setBoolPref(PREF_INCLUDE_PDF_TEXT, value);
}

export function getPdfTextMode(): PdfTextMode {
  const raw = getStringPref(PREF_PDF_TEXT_MODE).trim().toLowerCase();
  return raw === "full_text" ? "full_text" : "first_n_chars";
}

export function setPdfTextMode(value: PdfTextMode): void {
  setStringPref(PREF_PDF_TEXT_MODE, value);
}

export function getPdfTextCharLimit(): number {
  return getIntPref(PREF_PDF_TEXT_CHAR_LIMIT, 4000);
}

export function setPdfTextCharLimit(value: number): void {
  const n = Number(value);
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 4000;
  setIntPref(PREF_PDF_TEXT_CHAR_LIMIT, safe);
}

export function getPromptContentOptions(): PromptContentOptions {
  return {
    includeTitle: getIncludeTitle(),
    includeCreators: getIncludeCreators(),
    includePublicationTitle: getIncludePublicationTitle(),
    includeDate: getIncludeDate(),
    includeExistingTags: getIncludeExistingTags(),
    includeAbstract: getIncludeAbstract(),
    includePdfText: getIncludePdfText(),
    pdfTextMode: getPdfTextMode(),
    pdfTextCharLimit: getPdfTextCharLimit(),
  };
}

// =========================
// Settings dialog (Services.prompt with window.* fallbacks)
// =========================

function selectDialog(
  win: _ZoteroTypes.MainWindow,
  title: string,
  text: string,
  options: string[],
  defaultIndex: number,
): number | null {
  // Preferred: Services.prompt.select
  if (Services?.prompt?.select) {
    const selection: any = { value: defaultIndex };
    const ok = Services.prompt.select(win, title, text, options, selection);
    return ok ? Number(selection.value) : null;
  }

  // Fallback: window.prompt asking for option number
  const list = options.map((o, i) => `${i + 1}) ${o}`).join("\n");
  const raw = (win as any).prompt(
    `${title}\n\n${text}\n\n${list}\n\nEnter choice (1-${options.length}):`,
    String(defaultIndex + 1),
  );
  if (raw == null) return null;

  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 1 || n > options.length) return null;
  return n - 1;
}

function promptDialog(
  win: _ZoteroTypes.MainWindow,
  title: string,
  text: string,
  initial: string,
): string | null {
  if (Services?.prompt?.prompt) {
    const input: any = { value: initial };
    const ok = Services.prompt.prompt(win, title, text, input, null, {});
    return ok ? String(input.value ?? "") : null;
  }

  const raw = (win as any).prompt(`${title}\n\n${text}`, initial);
  return raw == null ? null : String(raw);
}

function confirmDialog(
  win: _ZoteroTypes.MainWindow,
  title: string,
  text: string,
): boolean {
  if (Services?.prompt?.confirm) {
    return !!Services.prompt.confirm(win, title, text);
  }
  return !!(win as any).confirm(`${title}\n\n${text}`);
}

function yesNoDialog(
  win: _ZoteroTypes.MainWindow,
  title: string,
  text: string,
  currentValue: boolean,
): boolean | null {
  const options = ["Yes", "No"];
  const picked = selectDialog(win, title, text, options, currentValue ? 0 : 1);
  if (picked == null) return null;
  return picked === 0;
}

// =========================
// Settings dialog
// =========================

export function openAutotagSettings(win: _ZoteroTypes.MainWindow): void {
  // ---------- Provider selection ----------
  const providerLabels = ["OpenAI", "Gemini", "DeepSeek", "Local (Ollama)"];
  const providerValues = ["openai", "gemini", "deepseek", "local"];

  const currentProvider = getSelectedProvider();
  const providerIndex = Math.max(providerValues.indexOf(currentProvider), 0);

  const pickedProviderIndex = selectDialog(
    win,
    "Autotag settings",
    "Select which LLM provider you want to use:",
    providerLabels,
    providerIndex,
  );
  if (pickedProviderIndex == null) return;

  const provider = providerValues[pickedProviderIndex] || "openai";
  setSelectedProvider(provider);

  // ---------- Model selection ----------
  let modelOptions: string[] = [];
  let defaultModel = "";

  switch (provider) {
    case "openai":
      modelOptions = ["gpt-4o-mini", "gpt-3.5-turbo", "gpt-4o", "gpt-4.1", "o3"];
      defaultModel = "gpt-4o-mini";
      break;

    case "gemini":
      modelOptions = ["gemini-3.1-pro-preview", "gemini-2.5-flash", "gemini-2.5-pro"];
      defaultModel = "gemini-2.5-flash";
      break;

    case "deepseek":
      modelOptions = ["deepseek-chat", "deepseek-reasoner"];
      defaultModel = "deepseek-chat";
      break;

    case "local":
      defaultModel = "";
      break;
  }

  let selectedModel = "";

  if (provider === "local") {
    const raw = promptDialog(
      win,
      "Autotag settings",
      "Enter the local model name exactly as shown by `ollama list`:",
      getModelForProvider("local") || "",
    );
    if (raw == null) return;
    selectedModel = raw.trim();
  } else {
    const currentModel = getModelForProvider(provider) || defaultModel;
    const modelIndex = Math.max(modelOptions.indexOf(currentModel), 0);

    const pickedModelIndex = selectDialog(
      win,
      "Autotag settings",
      "Select the model you want to use:",
      modelOptions,
      modelIndex,
    );
    if (pickedModelIndex == null) return;

    selectedModel = modelOptions[pickedModelIndex] || "";
  }

  if (selectedModel) {
    setModelForProvider(provider, selectedModel);
  }

  // ---------- API key ----------
  if (provider !== "local") {
    const raw = promptDialog(
      win,
      "Autotag settings",
      `Enter your ${provider.toUpperCase()} API key:`,
      getApiKeyForProvider(provider),
    );
    if (raw != null) {
      setApiKeyForProvider(provider, raw.trim());
    }
  }

  // ---------- Content selection ----------
  const includeTitle = yesNoDialog(
    win,
    "Autotag settings",
    "Send paper titles to the LLM?",
    getIncludeTitle(),
  );
  if (includeTitle == null) return;
  setIncludeTitle(includeTitle);

  const includeCreators = yesNoDialog(
    win,
    "Autotag settings",
    "Send authors/creators to the LLM?",
    getIncludeCreators(),
  );
  if (includeCreators == null) return;
  setIncludeCreators(includeCreators);

  const includePublicationTitle = yesNoDialog(
    win,
    "Autotag settings",
    "Send publication/journal title to the LLM?",
    getIncludePublicationTitle(),
  );
  if (includePublicationTitle == null) return;
  setIncludePublicationTitle(includePublicationTitle);

  const includeDate = yesNoDialog(
    win,
    "Autotag settings",
    "Send publication date to the LLM?",
    getIncludeDate(),
  );
  if (includeDate == null) return;
  setIncludeDate(includeDate);

  const includeExistingTags = yesNoDialog(
    win,
    "Autotag settings",
    "Send existing Zotero tags to the LLM?",
    getIncludeExistingTags(),
  );
  if (includeExistingTags == null) return;
  setIncludeExistingTags(includeExistingTags);

  const includeAbstract = yesNoDialog(
    win,
    "Autotag settings",
    "Send abstract text to the LLM?",
    getIncludeAbstract(),
  );
  if (includeAbstract == null) return;
  setIncludeAbstract(includeAbstract);

  const includePdfText = yesNoDialog(
    win,
    "Autotag settings",
    "Send extracted PDF text to the LLM when available?",
    getIncludePdfText(),
  );
  if (includePdfText == null) return;
  setIncludePdfText(includePdfText);

  if (includePdfText) {
    const modeOptions = [
      "First N characters of extracted PDF text",
      "Full extracted PDF text",
    ];
    const currentMode = getPdfTextMode();
    const modeIndex = currentMode === "full_text" ? 1 : 0;

    const pickedModeIndex = selectDialog(
      win,
      "Autotag settings",
      "Choose how much extracted PDF text to send:",
      modeOptions,
      modeIndex,
    );
    if (pickedModeIndex == null) return;

    const mode: PdfTextMode =
      pickedModeIndex === 1 ? "full_text" : "first_n_chars";
    setPdfTextMode(mode);

    if (mode === "first_n_chars") {
      const rawLimit = promptDialog(
        win,
        "Autotag settings",
        "Enter the number of characters of extracted PDF text to send per item:",
        String(getPdfTextCharLimit()),
      );
      if (rawLimit == null) return;

      const parsedLimit = Number(String(rawLimit).trim());
      setPdfTextCharLimit(
        Number.isFinite(parsedLimit) && parsedLimit > 0
          ? Math.floor(parsedLimit)
          : 4000,
      );
    }
  }

  // ---------- Seed keywords ----------
  const seedsRaw = promptDialog(
    win,
    "Autotag settings",
    "Optional seed keywords as comma separated list:",
    getSeedKeywords(),
  );
  if (seedsRaw != null) {
    setSeedKeywords(seedsRaw.trim());
  }

  // ---------- Final prompt (simple editor) ----------
  const promptRaw = promptDialog(
    win,
    "Autotag settings",
    "Edit the prompt Autotag sends to the LLM.\n\n" +
      "This prompt will be reused for all future runs.",
    getFinalPrompt(),
  );
  if (promptRaw != null) {
    setFinalPrompt(promptRaw.trim());
  }

  // ---------- Final summary ----------
  const summary = getPromptContentOptions();
  const pdfSummary = summary.includePdfText
    ? summary.pdfTextMode === "full_text"
      ? "enabled (full text)"
      : `enabled (${summary.pdfTextCharLimit} chars)`
    : "disabled";

  confirmDialog(
    win,
    "Autotag settings saved",
    [
      `Provider: ${provider}`,
      `Model: ${selectedModel || "(unchanged)"}`,
      "",
      "Content sent to LLM:",
      `- title: ${summary.includeTitle ? "yes" : "no"}`,
      `- creators: ${summary.includeCreators ? "yes" : "no"}`,
      `- publication title: ${summary.includePublicationTitle ? "yes" : "no"}`,
      `- date: ${summary.includeDate ? "yes" : "no"}`,
      `- existing tags: ${summary.includeExistingTags ? "yes" : "no"}`,
      `- abstract: ${summary.includeAbstract ? "yes" : "no"}`,
      `- PDF text: ${pdfSummary}`,
    ].join("\n"),
  );
}