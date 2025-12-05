// src/modules/autotagPrefs.ts

// Zotero global from the app
declare const Zotero: _ZoteroTypes.Zotero;
// ChromeUtils is provided by the Zotero/Firefox platform
declare const ChromeUtils: any;

const { Services } = ChromeUtils.import(
  "resource://gre/modules/Services.jsm",
);

// We'll namespace all prefs under this branch
const PREF_BRANCH = "extensions.autotag.";

const PREF_API_KEY = `${PREF_BRANCH}apiKey`;
const PREF_SEED_KEYWORDS = `${PREF_BRANCH}seedKeywords`;

/**
 * Get stored API key (or empty string if none).
 */
export function getApiKey(): string {
  try {
    const raw = Zotero.Prefs.get(PREF_API_KEY, true);
    return raw == null ? "" : String(raw);
  } catch (e) {
    return "";
  }
}


/**
 * Save API key.
 */
export function setApiKey(value: string): void {
  Zotero.Prefs.set(PREF_API_KEY, value, true);
}

/**
 * Get stored seed keywords as a single comma-separated string.
 */
export function getSeedKeywords(): string {
  try {
    const raw = Zotero.Prefs.get(PREF_SEED_KEYWORDS, true);
    return raw == null ? "" : String(raw);
  } catch (e) {
    return "";
  }
}


/**
 * Save seed keywords (comma-separated string).
 */
export function setSeedKeywords(value: string): void {
  Zotero.Prefs.set(PREF_SEED_KEYWORDS, value, true);
}

/**
 * Open a simple settings dialog using the built-in prompt service.
 * Users can edit:
 *  - API key
 *  - Seed keywords (comma-separated)
 */
export function openAutotagSettings(
  win: _ZoteroTypes.MainWindow,
): void {
  // --- API key prompt ---
  const currentKey = getApiKey();
  const keyInput: any = { value: currentKey };

  const okKey = Services.prompt.prompt(
    win,
    "Autotag settings",
    "Enter your LLM API key (e.g., OpenAI):",
    keyInput,
    null,
    {},
  );
  if (okKey) {
    setApiKey(keyInput.value.trim());
  }

  // --- Seed keywords prompt ---
  const currentSeeds = getSeedKeywords();
  const seedsInput: any = { value: currentSeeds };

  const okSeeds = Services.prompt.prompt(
    win,
    "Autotag settings",
    "Optional: enter seed keywords (comma-separated).\n" +
      "Example: adaptive_evolution, behavioral_genetics, epigenetics",
    seedsInput,
    null,
    {},
  );
  if (okSeeds) {
    setSeedKeywords(seedsInput.value.trim());
  }
}
