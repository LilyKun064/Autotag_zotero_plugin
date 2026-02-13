/* bootstrap.js — fixed to load autotag.js with required globals (Zotero 8) */

var chromeHandle;

var { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");

var Cc = Components.classes;
var Ci = Components.interfaces;

function install(data, reason) {}
function uninstall(data, reason) {}

function log(msg) {
  try {
    Zotero.debug("[Autotag] " + msg);
  } catch (e) {
    // Last resort
    try { dump("[Autotag] " + msg + "\n"); } catch (_) {
      //
    }
  }
}

async function startup({ rootURI }, reason) {
  // AddonManagerStartup
  const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(
    Ci.amIAddonManagerStartup
  );

  // Create nsIURI without Services.io
  const ios = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
  const manifestURI = ios.newURI(rootURI + "manifest.json");

  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "autotag", rootURI + "content/"],
  ]);

  // Load subscript without Services.scriptloader
  const scriptLoader = Cc["@mozilla.org/moz/jssubscript-loader;1"].getService(
    Ci.mozIJSSubScriptLoader
  );

  // Context for bundled autotag.js
  const ctx = {
    rootURI,

    // These MUST exist as free globals for many bundles
    Zotero,
    ChromeUtils,
    Components,
    Cc,
    Ci,
  };

  // Some bundles check these
  ctx._globalThis = ctx;
  ctx.globalThis = ctx;

  // Provide Services so the preview prompt uses Services.prompt.prompt
  // instead of falling back to window.prompt (often unavailable).
  try {
    const mod = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs");
    ctx.Services = mod.Services || mod.default || mod;
  } catch (e) {
    log("Failed to import Services.sys.mjs: " + String(e));
  }

  // If your bundle logs to console, provide a minimal shim so it won't crash
  // (optional, but safe)
  ctx.console = {
    log: (m) => log(String(m)),
    info: (m) => log(String(m)),
    warn: (m) => log("WARN: " + String(m)),
    error: (m) => log("ERROR: " + String(m)),
  };

  scriptLoader.loadSubScript(`${rootURI}content/scripts/autotag.js`, ctx);

  await Zotero.Autotag?.hooks?.onStartup?.();
}

async function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) return;

  await Zotero.Autotag?.hooks?.onShutdown?.();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.Autotag?.hooks?.onMainWindowLoad?.(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.Autotag?.hooks?.onMainWindowUnload?.(window);
}
