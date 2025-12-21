// src/modules/autotagPrefs.ts

// Zotero global from the app
declare const Zotero: _ZoteroTypes.Zotero;
// ChromeUtils is provided by the Zotero Firefox platform
declare const ChromeUtils: any;

const { Services } = ChromeUtils.import(
  "resource://gre/modules/Services.jsm",
);

// =========================
// Preference namespace
// =========================

const PREF_BRANCH = "extensions.autotag.";

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

// Seed keywords
const PREF_SEED_KEYWORDS = `${PREF_BRANCH}seedKeywords`;

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
    case "openai":
    default:
      return PREF_MODEL_OPENAI;
  }
}

// =========================
// API key access
// =========================

export function getApiKeyForProvider(provider: string): string {
  const prefKey = getApiKeyPref(provider);
  try {
    const raw = Zotero.Prefs.get(prefKey, true);
    return raw == null ? "" : String(raw);
  } catch {
    return "";
  }
}

export function setApiKeyForProvider(
  provider: string,
  value: string,
): void {
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

export function setModelForProvider(
  provider: string,
  model: string,
): void {
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
// Settings dialog
// =========================

export function openAutotagSettings(
  win: _ZoteroTypes.MainWindow,
): void {
  // ======================
  // Provider selection
  // ======================
  const providerLabels = [
    "OpenAI",
    "Gemini",
    "DeepSeek",
    "Local (Ollama)",
  ];
  const providerValues = [
    "openai",
    "gemini",
    "deepseek",
    "local",
  ];

  const currentProvider = getSelectedProvider();
  const providerIndex = Math.max(
    providerValues.indexOf(currentProvider),
    0,
  );

  const providerSelection: any = { value: providerIndex };

  const okProvider = Services.prompt.select(
    win,
    "Autotag settings",
    "Select which LLM provider you want to use:",
    providerLabels,
    providerSelection,
  );

  if (!okProvider) return;

  const provider = providerValues[providerSelection.value];
  setSelectedProvider(provider);

  // ======================
  // Model selection
  // ======================
  let modelOptions: string[] = [];
  let defaultModel = "";

  switch (provider) {
    case "openai":
      modelOptions = [
        "gpt-4o-mini",
        "gpt-3.5-turbo",
        "gpt-4o",
        "gpt-4.1-mini",
        "gpt-4.1",
        "o4-mini",
        "o3-mini",
        "o3",
        "gpt-4-turbo",
        "gpt-4",
      ];
      defaultModel = "gpt-4o-mini";
      break;

    case "gemini":
      modelOptions = [
        "gemini-1.5-flash",
        "gemini-1.5-flash-8b",
        "gemini-1.5-pro",
        "gemini-1.0-pro (legacy, may fail)",
        "gemini-2.0-flash-exp (experimental)",
      ];
      defaultModel = "gemini-1.5-flash";
      break;

    case "deepseek":
      modelOptions = [
        "deepseek-chat",
        "deepseek-reasoner",
        "deepseek-coder",
        "deepseek-coder-v2",
      ];
      defaultModel = "deepseek-chat";
      break;

    case "local":
      modelOptions = [
        "llama3.1:latest",
        "llama3.1:8b",
        "mistral:latest",
        "qwen2.5:7b",
      ];
      defaultModel = "";
      break;
  }

  const storedModel = getModelForProvider(provider);
  const currentModel =
    storedModel && modelOptions.includes(storedModel)
      ? storedModel
      : defaultModel;

  const modelIndex = Math.max(
    modelOptions.indexOf(currentModel),
    0,
  );

  const modelSelection: any = { value: modelIndex };

  let selectedModel = "";

if (provider === "local") {
  // Step 2a: optional dropdown for suggestions
  const okSuggest = Services.prompt.select(
    win,
    "Autotag settings",
    "Optional: select a local model suggestion.\n" +
      "You can also type a model name manually next.",
    modelOptions,
    modelSelection,
  );

  if (!okSuggest) return;

  const suggested =
    modelOptions[modelSelection.value] || "";

  // Step 2b: manual text input (this is authoritative)
  const manualInput: any = {
    value:
      getModelForProvider("local") ||
      suggested ||
      "",
  };

  const okManual = Services.prompt.prompt(
    win,
    "Autotag settings",
    "Enter the exact local model name as shown by `ollama list`.\n\n" +
      "Example: llama3.1:latest",
    manualInput,
    null,
    {},
  );

  if (!okManual) return;

  selectedModel = manualInput.value.trim();
  } else {
    // Existing dropdown behavior for cloud providers
    const okModel = Services.prompt.select(
      win,
      "Autotag settings",
      `Select a ${provider.toUpperCase()} model.\n\n` +
        "Some models may require paid access or may not be available for your account.",
      modelOptions,
      modelSelection,
    );

    if (!okModel) return;

    selectedModel = modelOptions[modelSelection.value]
      .split(" ")[0];
  }

  if (!selectedModel) {
    throw new Error(
      "No model selected. Please enter a model name.",
    );
  }

setModelForProvider(provider, selectedModel);


  // ======================
  // API key (skip for local)
  // ======================
  if (provider !== "local") {
    const currentKey = getApiKeyForProvider(provider);
    const keyInput: any = { value: currentKey };

    const okKey = Services.prompt.prompt(
      win,
      "Autotag settings",
      `Enter your ${provider.toUpperCase()} API key:`,
      keyInput,
      null,
      {},
    );

    if (okKey) {
      setApiKeyForProvider(provider, keyInput.value.trim());
    }
  }

  // ======================
  // Seed keywords
  // ======================
  const currentSeeds = getSeedKeywords();
  const seedsInput: any = { value: currentSeeds };

  const okSeeds = Services.prompt.prompt(
    win,
    "Autotag settings",
    "Optional: enter seed keywords as a comma separated list.\n" +
      "Example: adaptive_evolution, behavioral_genetics, epigenetics",
    seedsInput,
    null,
    {},
  );

  if (okSeeds) {
    setSeedKeywords(seedsInput.value.trim());
  }
}

