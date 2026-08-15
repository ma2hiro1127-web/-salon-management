// AI分析ON/OFFがChrome通常タブでは直っているのにPWA版だけ再現する、という切り分けのための
// 診断ツール。main.jsxが起動時に自動で1回実行するのに加えて、window.salonManagerDiagnostics()
// として公開する — devtoolsコンソールから「ONにした直後」「OFFへ戻った直後」等、好きな
// タイミングで手動実行できる(会社管理画面を都度リロードせずに比較できるようにするため)。
//
// ここではオブジェクト/配列をそのままconsole.infoへ渡さず、必ずJSON.stringifyしたテキストを
// 出す — devtools上で"Array(1)"のように折りたたまれ、開くまで値が見えない状態を避けるため。
import { supabase } from "./supabase.js";

const STORAGE_KEY = "salon-goal-app-v2";

const readLocalStorageCompanies = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { found: false, companies: [] };
    const parsed = JSON.parse(raw);
    return {
      found: true,
      companies: (parsed?.companies || []).map((c) => ({ id: c.id, name: c.name, aiAnalysisEnabled: c.aiAnalysisEnabled })),
    };
  } catch (error) {
    return { found: false, error: error?.message || String(error) };
  }
};

const readIndexedDbDatabases = async () => {
  try {
    if (!window.indexedDB?.databases) return "(indexedDB.databases() not supported in this browser)";
    const dbs = await window.indexedDB.databases();
    return dbs.length ? dbs.map((db) => `${db.name}(v${db.version})`) : "(no IndexedDB databases exist for this origin)";
  } catch (error) {
    return `error: ${error?.message || error}`;
  }
};

const readCacheStorageNames = async () => {
  try {
    if (!window.caches) return "(Cache Storage API not available)";
    return await window.caches.keys();
  } catch (error) {
    return `error: ${error?.message || error}`;
  }
};

const readServiceWorkerInfo = async () => {
  try {
    if (!("serviceWorker" in navigator)) return "(serviceWorker not supported)";
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      controllerScriptURL: navigator.serviceWorker.controller?.scriptURL || null,
      activeScriptURL: registration?.active?.scriptURL || null,
      activeState: registration?.active?.state || null,
      waitingScriptURL: registration?.waiting?.scriptURL || null,
      installingScriptURL: registration?.installing?.scriptURL || null,
      updateViaCache: registration?.updateViaCache || null,
    };
  } catch (error) {
    return `error: ${error?.message || error}`;
  }
};

// companyIdを渡した場合のみ、Supabase companiesテーブルを直接読み直して比較対象に含める
// (main.jsxからの起動時呼び出しはまだどの会社を見ているか分からないためcompanyIdなしで
// 呼ばれる — App.jsx側でcompanyIdが分かるタイミング(会社管理画面表示時・トグル操作後)に
// 改めて呼び直す)。
export async function collectSalonManagerDiagnostics(label = "manual", { companyId, companyName } = {}) {
  const localStorageResult = readLocalStorageCompanies();
  let supabaseLiveValue = "(companyId not provided to this call)";
  if (companyId) {
    try {
      const { data, error } = await supabase.from("companies").select("id, name, ai_analysis_enabled").eq("id", companyId).maybeSingle();
      supabaseLiveValue = error ? `error: ${error.message}` : { id: data?.id, name: data?.name, ai_analysis_enabled: data?.ai_analysis_enabled };
    } catch (error) {
      supabaseLiveValue = `error: ${error?.message || error}`;
    }
  }
  const result = {
    label,
    companyId: companyId || null,
    companyName: companyName || null,
    timestamp: new Date().toISOString(),
    buildTime: typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "(unknown)",
    buildCommit: (typeof __BUILD_COMMIT__ !== "undefined" && __BUILD_COMMIT__) || "(local build, no commit hash)",
    origin: window.location.origin,
    displayMode: window.matchMedia("(display-mode: standalone)").matches ? "standalone(PWA)" : "browser",
    navigatorStandalone: typeof navigator.standalone === "boolean" ? navigator.standalone : "(not applicable, not iOS Safari)",
    supabaseLiveCompaniesRow: supabaseLiveValue,
    localStorageFound: localStorageResult.found,
    localStorageCompanies: localStorageResult.companies,
    sessionStorageKeyCount: window.sessionStorage ? Object.keys(window.sessionStorage).length : "(sessionStorage unavailable)",
    indexedDbDatabases: await readIndexedDbDatabases(),
    cacheStorageNames: await readCacheStorageNames(),
    serviceWorker: await readServiceWorkerInfo(),
  };
  console.info("[salon-manager-diagnostics]", JSON.stringify(result, null, 2));
  return result;
}

if (typeof window !== "undefined") {
  window.salonManagerDiagnostics = collectSalonManagerDiagnostics;
}
