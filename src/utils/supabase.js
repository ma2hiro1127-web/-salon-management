import { createClient } from "@supabase/supabase-js";
import { createInitialAppState, defaultDailyFieldSettings, defaultMonthlyTargetFieldSettings, costCategoryKeys } from "../data/defaults.js";
import { normalizeRole } from "./permissions.js";
import { buildStoreProfilesByStoreId } from "./storage.js";

const getEnvValue = (key) => {
  const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
  return env[key] || "";
};

const supabaseUrl = getEnvValue("VITE_SUPABASE_URL");
const supabaseAnonKey = getEnvValue("VITE_SUPABASE_ANON_KEY");

// GoTrue/PostgRESTがJWTを検証する際、サーバー間のクロックドリフトや端末の時計ずれ(特に
// PWA復帰直後・スリープ復帰直後)が原因で「JWT issued at future」のような一時的な401を返す
// ことがある。ユーザーには何もできないエラーなので、通常のAPI呼び出しではこの1箇所
// (fetchWithAuthRetry)で検知して自動的にセッションを再取得・再送し、失敗した場合だけ
// 呼び出し元の通常のエラー処理(getSupabaseErrorMessage経由で再ログイン案内)に委ねる。
const AUTH_TIMING_ERROR_PATTERN = /jwt|token.*expired|expired.*token|refresh token|invalid.*session|session.*expired|not authenticated|pgrst301/i;
export const isAuthTimingErrorMessage = (message) => AUTH_TIMING_ERROR_PATTERN.test(String(message || ""));
export const AUTH_SESSION_EXPIRED_MESSAGE = "ログイン情報の有効期限が切れました。お手数ですが再度ログインしてください。";

// /auth/v1/token(セッション更新そのもの)への呼び出しはリトライ対象から除外する — refreshSession
// 自身がこのエンドポイントを叩くため、除外しないとJWTタイミングエラーが再帰的にrefreshSession
// を呼び直し続けるループになりかねない。
const isAuthTokenEndpoint = (input) => {
  const url = typeof input === "string" ? input : (input?.url || "");
  return url.includes("/auth/v1/token");
};

// 販売前チェックで発見: ここのfetch()にはタイムアウトが一切無かった——不安定な回線・
// モバイル回線の瞬断・Supabase側の一時的な遅延などでリクエストが1件でもハングすると、
// このawaitが永久に(ブラウザのデフォルトの非常に長いタイムアウトまで)返らず、
// hydrateFromSupabase側がPromise.allで複数クエリを並列発行するようになった(パフォーマンス
// 改善の副作用)ことで「1件がハングすると18件全部がその1件を待ち続ける」状態になり、
// 「更新中です…」が2分経っても終わらない不具合の直接の原因になっていた。AbortControllerで
// 明示的な上限を設け、上限を超えたら確実に失敗(reject)させる——失敗すればhydrateFromSupabase
// 側の既存のリトライ・上限回数・エラー表示(HYDRATE_MAX_AUTO_RETRY_ATTEMPTS)が正しく機能する。
const FETCH_TIMEOUT_MS = 15000;

const fetchWithTimeout = (input, init = {}) => {
  const controller = new AbortController();
  // 呼び出し元が既にsignalを渡している場合(将来的な拡張)を壊さないよう、どちらかが
  // abortしたら全体をabortする形にする。
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const externalSignal = init.signal;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
};

const fetchWithAuthRetry = async (input, init = {}) => {
  const response = await fetchWithTimeout(input, init);
  if (response.status !== 401 || isAuthTokenEndpoint(input)) return response;

  let bodyText;
  try {
    bodyText = await response.clone().text();
  } catch {
    return response;
  }
  if (!isAuthTimingErrorMessage(bodyText)) return response;

  // 1回だけセッションを再取得して再送する(無限リトライにはしない)。refreshSessionが失敗
  // した場合は元の401レスポンスをそのまま返し、呼び出し元の通常のエラー処理に委ねる。
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data?.session?.access_token) return response;
    const retryHeaders = new Headers(init.headers || {});
    retryHeaders.set("Authorization", `Bearer ${data.session.access_token}`);
    return await fetchWithTimeout(input, { ...init, headers: retryHeaders });
  } catch {
    return response;
  }
};

// system_adminの「新規契約フローをテスト」(?owner-signup=1&testKey=...)は、system_admin
// 自身が既にログイン中の同じブラウザで新しいタブとして開かれることが多い(2026-09追加)。
// Supabaseのセッションは既定でlocalStorageの共通キーに保存されるため、そのタブで新規登録
// (別アカウント)しても既定の共通キーのままだと、system_admin自身の元タブのセッションを
// 上書き・混同してしまう恐れがある(signOut自体をscope:"local"にしても、localStorageの
// キーを共有している限り、後から書き込まれるsignIn/selfSignup後のセッションが上書きする
// 問題は残る)。このURLパターンの時だけ専用のstorageKeyを使い、完全に別のセッションとして
// 隔離することで、system_adminの元のログイン状態への影響を構造的にゼロにする
// (要件: 「system_adminの現在のログイン状態を壊さない」)。通常のURL(このパラメータが
// 無い、大多数のアクセス)では従来どおり既定のキーのままで、一切の変更が無い。
// 不具合修正(2026-09-05発見): Stripe Checkoutは外部サイト(checkout.stripe.com)への
// 本当のページ遷移を伴うため、決済完了後にsuccess_urlへ戻ってきた時点でこのモジュールが
// 最初から読み込み直される。戻り先URL(?checkout=success)にはowner-signup/testKeyが
// 付いていないため、URLだけを見るとisOwnerSignupTestLinkがfalseに戻ってしまい、
// 隔離したstorageKeyへ保存していたテストアカウントのセッションを見失って、決済完了後に
// ログイン画面へ戻されてしまっていた(要件: 決済完了後に正常に戻れること)。
// sessionStorageのマーカー(タブ単位で保持され、外部サイトへの往復をまたいでも残る)を
// 併用することで、同じタブ内である限りURLが変わっても隔離を維持できるようにする。
const TEST_CONTRACT_SESSION_MARKER = "sb-test-contract-flow-marker";
const urlHasOwnerSignupTestLink =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("owner-signup") === "1" &&
  Boolean(new URLSearchParams(window.location.search).get("testKey"));
// 障害調査用(2026-09): マーカーを新規に書き込む「前」の時点で既に立っていたかどうかを
// 別途記録しておく——「今回のURLで新たにtrueになった」のか「前回までのページ読み込みで
// 既に立っていたものを引き継いだ」のかを、この後のログで区別できるようにするため。
let sessionMarkerWasAlreadyPresent = false;
if (typeof window !== "undefined") {
  try {
    sessionMarkerWasAlreadyPresent = window.sessionStorage.getItem(TEST_CONTRACT_SESSION_MARKER) === "1";
  } catch {
    sessionMarkerWasAlreadyPresent = false;
  }
}
if (urlHasOwnerSignupTestLink) {
  try {
    window.sessionStorage.setItem(TEST_CONTRACT_SESSION_MARKER, "1");
  } catch {
    // プライベートブラウジング等でsessionStorageが使えない場合はベストエフォート
    // (この場合はStripe決済からの復帰時にログイン画面へ戻るだけで、致命的ではない)。
  }
}
const isOwnerSignupTestLink = urlHasOwnerSignupTestLink || sessionMarkerWasAlreadyPresent;

// 障害調査用(2026-09、決済完了後にログイン画面へ戻る不具合のトレース)。App.jsx側の
// 初期化処理から、このモジュール読み込み時点でのURL・マーカー状態・実際に選ばれた
// storageKeyをclient_diagnostic_logsへ記録できるよう、スナップショットとして公開する。
export const TEST_CONTRACT_FLOW_DEBUG_SNAPSHOT = {
  href: typeof window !== "undefined" ? window.location.href : "",
  search: typeof window !== "undefined" ? window.location.search : "",
  urlHasOwnerSignupTestLink,
  sessionMarkerWasAlreadyPresent,
  isOwnerSignupTestLink,
  appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
};

export const supabase = createClient(supabaseUrl || "https://example.supabase.co", supabaseAnonKey || "dummy-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    ...(isOwnerSignupTestLink ? { storageKey: "sb-test-contract-flow-auth-token" } : {}),
  },
  global: {
    fetch: fetchWithAuthRetry,
  },
});

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl !== "https://example.supabase.co");

export const getSupabaseConfigurationIssue = () => {
  const hasUrl = Boolean(supabaseUrl && supabaseUrl.trim() && supabaseUrl !== "https://example.supabase.co");
  const hasAnonKey = Boolean(supabaseAnonKey && supabaseAnonKey.trim());

  if (!hasUrl && !hasAnonKey) return "URL未設定・ANON_KEY未設定";
  if (!hasUrl) return "URL未設定";
  if (!hasAnonKey) return "ANON_KEY未設定";
  return null;
};

// JWT/セッションのタイミング起因エラー(クロックスキュー等、上のfetchWithAuthRetryで自動
// 復旧を試みた後もなお失敗したケース)は、生のメッセージを画面に出さず再ログインを促す
// 文言に差し替える。それ以外のSupabaseエラーは従来通りそのまま返す(保存失敗時の具体的な
// 原因表示など、既存の挙動は変えない)。
const SUPABASE_ERROR_FALLBACK_MESSAGE = "Supabase エラーが発生しました";
// このアプリが意図的に投げるエラー(throw new Error("店舗情報を確認できませんでした")等、
// 呼び出し元がユーザー向けに書いた文言)は例外なく日本語(ひらがな/カタカナ/漢字)で
// 書かれている——販売前総合チェックで発見: それ以外のケース、つまりPostgREST/Postgresが
// 返す生のエラー文(基本的に英語、例:"duplicate key value violates unique constraint..."や
// "new row violates row-level security policy for table...")がここを素通りして利用者へ
// そのまま表示されてしまう経路が複数箇所にあった(要件23: 生のSupabaseエラーを一般利用者へ
// 出さない、に反する)。日本語を含まないメッセージは「アプリ側が用意した文言ではない」と
// みなし、一般的な文言に差し替える——詳細は呼び出し元がlogSupabaseErrorで必ずconsoleへ
// 記録しているため、原因調査(要件19)は引き続き可能。
const containsJapaneseText = (text) => /[぀-ヿ㐀-鿿]/.test(text);
export const getSupabaseErrorMessage = (error) => {
  const message = error?.message || "";
  if (isAuthTimingErrorMessage(message)) return AUTH_SESSION_EXPIRED_MESSAGE;
  if (!message) return SUPABASE_ERROR_FALLBACK_MESSAGE;
  if (!containsJapaneseText(message)) return SUPABASE_ERROR_FALLBACK_MESSAGE;
  return message;
};

// Common error-reporting shape for every Supabase read/write in the app: which operation,
// which table, and the identifying keys involved (userId/companyId/storeId/date), so a failure
// is traceable instead of a bare "an error occurred". Always logs full detail to the console
// (harmless in prod — it's not user-facing UI) and returns the detail object so callers can
// also fold it into a user-facing notice via getSupabaseErrorMessage(error).
export const logSupabaseError = ({ operation, table, userId = null, companyId = null, storeId = null, targetMonth = null, businessDate = null, error } = {}) => {
  const detail = {
    operation: operation || "unknown",
    table: table || "unknown",
    userId,
    companyId,
    storeId,
    targetMonth,
    businessDate,
    message: error?.message || String(error || "unknown error"),
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
  };
  console.error("[supabase-error]", detail, error);
  // 障害調査用ログ(要件9)。アプリ全体のSupabaseエラーがすべてこの1関数を経由するため、
  // ここに1箇所追加するだけで既存の全呼び出し元(App.jsx側、数十箇所)へ横展開される
  // ——個別の呼び出し元を1つずつ書き換える必要はない。message欄には売上金額・氏名・
  // メールアドレス等ではなく、operation/table/error codeという既存の構造化情報だけを渡す
  // (logClientDiagnostic自体もベストエフォートで失敗を握りつぶすため、ここが失敗しても
  // 元のエラー処理・UI表示には一切影響しない)。
  logClientDiagnostic({
    companyId,
    storeId,
    userId,
    screen: table || "unknown",
    actionType: operation || "unknown",
    errorType: detail.code || "unknown",
    message: `${detail.operation}/${detail.table}: ${detail.code || detail.message || "unknown error"}`,
  });
  return detail;
};

// Refuses to proceed with a save when any required identifying key is missing, instead of
// silently writing a row with a null company_id/store_id/date that would be invisible to RLS
// (and to every future query keyed on those columns). Returns null when valid, or a
// user-facing Japanese error string naming exactly what's missing.
export const validateRequiredKeys = (keys = {}) => {
  const labels = {
    companyId: "会社ID",
    storeId: "店舗ID",
    userId: "ユーザーID",
    targetMonth: "対象年月",
    businessDate: "日付",
    costItemId: "費用項目ID",
  };
  const missing = Object.entries(keys)
    .filter(([, value]) => value === undefined || value === null || value === "")
    .map(([key]) => labels[key] || key);
  if (!missing.length) return null;
  return `${missing.join("・")}が未設定のため保存できません`;
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const getConfiguredAdminEmails = () => [
  getEnvValue("VITE_ADMIN_EMAIL"),
  getEnvValue("VITE_SUPABASE_ADMIN_EMAIL"),
  "hirotomatsumoto+salonadmin@gmail.com",
].filter(Boolean);

export const resolveRoleForEmail = (email, { forceAdmin = false } = {}) => {
  const normalizedEmail = normalizeEmail(email);
  const configuredAdminEmails = new Set(getConfiguredAdminEmails());
  if (forceAdmin || configuredAdminEmails.has(normalizedEmail)) return "system_admin";
  return "staff";
};

const resolveDefaultRole = (email, { forceAdmin = false } = {}) => resolveRoleForEmail(email, { forceAdmin });

const ensureInitialCompanyAndStore = async ({ companyId = null, preferredCompanyName = "サロン本社", preferredStoreName = "本店" }) => {
  let resolvedCompanyId = companyId;
  let resolvedStoreId = null;

  // When a specific companyId is passed (e.g. an invited user joining an existing company),
  // check for THAT company, not just "does any company exist anywhere" — the previous version
  // ignored the passed companyId entirely and could silently attach the user to a different,
  // unrelated company that merely happened to be the first row.
  const { data: existingCompanies, error: companyLookupError } = companyId
    ? await supabase.from("companies").select("id").eq("id", companyId).limit(1)
    : await supabase.from("companies").select("id").limit(1);
  if (companyLookupError) throw companyLookupError;

  let created = false;
  if (!existingCompanies?.length) {
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .insert({
        name: preferredCompanyName,
        code: `salon-${Date.now().toString(36)}`,
        is_active: true,
      })
      .select()
      .single();

    if (companyError) throw companyError;
    resolvedCompanyId = company.id;
    created = true;

    const { data: store, error: storeError } = await supabase
      .from("stores")
      .insert({
        company_id: company.id,
        name: preferredStoreName,
        code: "main",
        is_active: true,
      })
      .select()
      .single();

    if (storeError) throw storeError;
    resolvedStoreId = store.id;
  } else {
    resolvedCompanyId = existingCompanies[0].id;
    const { data: existingStores, error: storeLookupError } = await supabase.from("stores").select("id").eq("company_id", resolvedCompanyId).limit(1);
    if (storeLookupError) throw storeLookupError;
    if (existingStores?.length) {
      resolvedStoreId = existingStores[0].id;
    }
  }

  // `created` tells the caller this user is the one who just founded the company, so they can
  // be granted management access immediately instead of defaulting to "staff" (see
  // ensureProfileForAuthUser) — without it, a brand-new owner would be locked out of their own
  // company's monthly targets / month-closing / store & user management on their very first login.
  return { companyId: resolvedCompanyId, storeId: resolvedStoreId, created };
};

const createDefaultCompanySettings = () => ({
  currency: "JPY",
  fiscalYearStartMonth: "1",
  salesDisplayMode: "inclusive",
  retailSalesLabel: "店販売上",
  closingDay: "月末",
  editDeadlineDays: 7,
  allowStaffPastEdit: false,
  visibleSalesFields: ["technicalSales", "retailSales", "otherSales"],
  activeKpis: ["sales", "customers", "retailRatio"],
});

const createDefaultStoreSettings = () => ({
  monthlyTargetSales: "",
  retailTargetSales: "",
  customerTarget: "",
  newCustomerTarget: "",
  businessDays: "",
  holidayDays: "",
  openingHour: "09:00",
  closingHour: "20:00",
  closedDays: "月",
  dailyFieldSettings: defaultDailyFieldSettings(),
  managerName: "",
  staffIds: [],
  laborCostMode: "fixed",
  laborCostRate: 0,
  purchaseCostMode: "fixed",
  purchaseCostRate: 0,
});

// Merges a stores.daily_field_settings JSON value (possibly null, or saved before a field
// like memo existed) with the current defaults, so a partial/older saved shape never causes
// a field to silently disappear or a UI crash.
export const normalizeDailyFieldSettings = (value) => {
  const fallback = defaultDailyFieldSettings();
  if (!value || typeof value !== "object") return fallback;
  return {
    mode: typeof value.mode === "string" ? value.mode : fallback.mode,
    fields: { ...fallback.fields, ...(value.fields && typeof value.fields === "object" ? value.fields : {}) },
  };
};

export const normalizeMonthlyTargetFieldSettings = (value) => {
  const fallback = defaultMonthlyTargetFieldSettings();
  if (!value || typeof value !== "object") return fallback;
  return {
    fields: { ...fallback.fields, ...(value.fields && typeof value.fields === "object" ? value.fields : {}) },
  };
};

// 月締めチェックリストで「対象外」にした費用カテゴリkeyの一覧。costCategoryKeysに実在する
// keyだけを残す(旧データ・手動編集で無効なkeyが紛れ込んでも、フィルタが効かず全項目非表示に
// なるような事態を防ぐ)。
export const normalizeHiddenClosingCategories = (value) => {
  if (!Array.isArray(value)) return [];
  const validKeys = new Set(costCategoryKeys.map((item) => item.key));
  return [...new Set(value.filter((key) => validKeys.has(key)))];
};

// store_input_settings is the authoritative per-store field-visibility source (see
// 20260807000000_create_store_input_settings.sql). Fetched company-wide in one call — same
// pattern as loadDailySalesForCompanyRange/loadMonthlyClosingsForCompany — so hydrating any
// store's settings never requires a second round trip, and RLS naturally scopes the result to
// whatever stores this user can actually see.
export const loadStoreInputSettingsForCompany = async ({ companyId }) => {
  if (!isSupabaseConfigured || !companyId) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase.from("store_input_settings").select("*").eq("company_id", companyId);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadStoreInputSettingsForCompany", table: "store_input_settings", companyId, error });
    return { ok: false, error, data: [] };
  }
};

// Partial upserts are safe here: PostgREST's upsert only sets the columns present in the
// payload, so saving just dailyFields (or just monthlyTargetFields) can never null out the
// other column on an existing row.
export const upsertStoreInputSettings = async ({ companyId, storeId, dailyFields, monthlyTargetFields, useInventoryTracking, useCashBreakdown, hiddenClosingCategories, laborCostMode, laborCostRate, purchaseCostMode, purchaseCostRate }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertStoreInputSettings", table: "store_input_settings", companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  const payload = { company_id: companyId, store_id: storeId };
  if (dailyFields !== undefined) payload.daily_fields = dailyFields;
  if (monthlyTargetFields !== undefined) payload.monthly_target_fields = monthlyTargetFields;
  if (useInventoryTracking !== undefined) payload.use_inventory_tracking = Boolean(useInventoryTracking);
  if (useCashBreakdown !== undefined) payload.use_cash_breakdown = Boolean(useCashBreakdown);
  if (hiddenClosingCategories !== undefined) payload.hidden_closing_categories = hiddenClosingCategories;
  // 人件費・仕入の計算方法(固定額/売上連動)・率(要件2・6)。率は0以上の数値に正規化する
  // (NaN・負値がDBへ渡ってcheck制約以外のところで壊れないようにする)。
  if (laborCostMode !== undefined) payload.labor_cost_mode = laborCostMode === "sales_linked" ? "sales_linked" : "fixed";
  if (laborCostRate !== undefined) payload.labor_cost_rate = Math.max(0, Number(laborCostRate) || 0);
  if (purchaseCostMode !== undefined) payload.purchase_cost_mode = purchaseCostMode === "sales_linked" ? "sales_linked" : "fixed";
  if (purchaseCostRate !== undefined) payload.purchase_cost_rate = Math.max(0, Number(purchaseCostRate) || 0);
  try {
    const { data, error } = await supabase.from("store_input_settings").upsert(payload, { onConflict: "company_id,store_id" }).select().single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertStoreInputSettings", table: "store_input_settings", companyId, storeId, error });
    return { ok: false, error };
  }
};

// 人件費・仕入の「その月だけの手動確定額」(store_monthly_cost_overrides)。company全体を
// 1回で取得する — store_input_settings/fixed_costs等と同じ規約(RLSが可視範囲を自然に絞る)。
export const loadStoreMonthlyCostOverridesForCompany = async ({ companyId }) => {
  if (!isSupabaseConfigured || !companyId) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase.from("store_monthly_cost_overrides").select("*").eq("company_id", companyId);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadStoreMonthlyCostOverridesForCompany", table: "store_monthly_cost_overrides", companyId, error });
    return { ok: false, error, data: [] };
  }
};

// 部分更新: laborCostOverride/purchaseCostOverrideのうち渡された方だけを書き換える
// (upsertStoreInputSettingsと同じ「undefinedなら触れない」パターン)。「自動計算に戻す」は
// 該当引数へ明示的にnullを渡す呼び出し——行の削除ではなく、該当列をnullへ戻すUPDATE/INSERTに
// なる(要件11: 押すたびに最新の実売上×設定率で再計算されるようにするため、値そのものを
// 消して自動推定側へフォールバックさせる)。
export const upsertStoreMonthlyCostOverride = async ({ companyId, storeId, targetMonth, laborCostOverride, purchaseCostOverride }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId, targetMonth });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertStoreMonthlyCostOverride", table: "store_monthly_cost_overrides", companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  const payload = { company_id: companyId, store_id: storeId, target_month: targetMonth };
  if (laborCostOverride !== undefined) payload.labor_cost_override = laborCostOverride === null ? null : Number(laborCostOverride);
  if (purchaseCostOverride !== undefined) payload.purchase_cost_override = purchaseCostOverride === null ? null : Number(purchaseCostOverride);
  try {
    const { data, error } = await supabase.from("store_monthly_cost_overrides").upsert(payload, { onConflict: "store_id,target_month" }).select().single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertStoreMonthlyCostOverride", table: "store_monthly_cost_overrides", companyId, storeId, error });
    return { ok: false, error };
  }
};

export const signUpWithEmail = async (email, password) => {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error("Supabase の設定がありません") };
  }
  return supabase.auth.signUp({ email: normalizeEmail(email), password });
};

export const signInWithEmail = async (email, password) => {
  if (!isSupabaseConfigured) {
    return { data: null, error: new Error("Supabase の設定がありません") };
  }
  return supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
};

// scope省略時は既存どおりデフォルト("global" — このユーザーの全セッション・全タブを
// サインアウトする)。scope:"local"は、このブラウザタブだけをサインアウトし、同じ
// アカウントの他のタブ・他デバイスのセッションには一切影響しない(2026-09追加:
// system_adminが「新規契約フローをテスト」で発行したリンクを、自分がログイン中の
// ブラウザで新しいタブとして開いた場合に、元のタブのログイン状態を壊さずにこの新しい
// タブだけを未ログイン状態へ戻すために使う)。
export const signOutFromSupabase = async ({ scope } = {}) => {
  const { error } = await supabase.auth.signOut(scope ? { scope } : undefined);
  return { error };
};

// Anonymous-callable (get_invite_info is SECURITY DEFINER — see
// 20260809000000_invite_flow_hardening.sql): lets the signup page validate an invite token
// *before* the invitee has any session, which a plain RLS-protected profiles select could never
// do. Returns null for an unknown/already-claimed-and-cleared token.
export const getInviteInfo = async (token) => {
  if (!token) return null;
  const { data, error } = await supabase.rpc("get_invite_info", { p_token: token });
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
};

// Completes an invite via the accept-invite Edge Function (service-role, never exposed to the
// browser) — see supabase/functions/accept-invite. Needed because this project requires email
// confirmation, so a plain client-side signUp() never returns a session; the Edge Function
// creates the invitee's account pre-confirmed with the password they just chose, and links it
// to the profile row the inviting admin already created.
export const acceptInvite = async ({ token, email, password }) => {
  const { data, error } = await supabase.functions.invoke("accept-invite", {
    body: { token, email, password },
  });
  if (error) {
    // FunctionsHttpError wraps the actual JSON error body in error.context — surface that
    // message (e.g. "この招待リンクは期限切れです") instead of the generic HTTP failure text.
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, data };
};

// 新規オーナー・セルフサインアップのfeature flag状態(要件11)。get_invite_infoと同じ、
// 未ログインでも呼べるSECURITY DEFINER RPC(20260903000000)経由——テーブル自体はsystem_admin
// のみ閲覧可のため、このRPCがフロントから読める唯一の窓口。取得失敗時はfalse側に倒す
// (フラグが読めない=非公開として扱う、フェイルクローズ)。
export const isSelfSignupEnabled = async () => {
  if (!isSupabaseConfigured) return false;
  try {
    const { data, error } = await supabase.rpc("is_self_signup_enabled");
    if (error) throw error;
    return Boolean(data);
  } catch (error) {
    logSupabaseError({ operation: "isSelfSignupEnabled", table: "app_feature_flags", error });
    return false;
  }
};

// 新規オーナーのセルフサインアップ本体 — self-signup Edge Function(service-role)経由。
// company/store/company_admin付与を1回のサーバー側呼び出しでまとめて行う(冪等・途中離脱
// 復旧はEdge Function側の責務、詳細はsupabase/functions/self-signup/index.ts参照)。招待
// フロー(acceptInvite)とは完全に別の関数・別のEdge Function——処理を混同しない(要件7)。
// utmSource/utmCampaign/utmContent(要件6・7、AI広告自動運用システムV1)は任意——広告経由
// ではない通常のセルフ登録では空のまま渡ってよく、self-signup Edge Function側もutm_sourceが
// 空ならコンバージョンイベントを記録しない。
export const selfSignup = async ({ email, password, ownerName, companyName, testKey, utmSource, utmCampaign, utmContent }) => {
  const { data, error } = await supabase.functions.invoke("self-signup", {
    body: { email, password, ownerName, companyName, testKey, utmSource, utmCampaign, utmContent },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, data };
};

// Actually sends the invitation email via the send-invite-email Edge Function (service-role,
// calls supabase.auth.admin.inviteUserByEmail) — see that function for why this has to run
// server-side. Unlike the old client-only "招待メール再発行" button, this can genuinely fail
// (permission denied, already registered, Supabase mail service error) and the caller must
// surface that instead of assuming success.
export const sendInviteEmail = async ({ token, redirectOrigin }) => {
  const { data, error } = await supabase.functions.invoke("send-invite-email", {
    body: { token, redirectOrigin },
  });
  if (error) {
    let message = error.message;
    let code = "";
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      // ignore — fall back to error.message
    }
    // code(例: "rate_limited")は呼び出し側がレート制限専用の日本語文言に差し替えるために
    // 使う(招待フロー整理の要件5) — Errorオブジェクトのプロパティとして持ち回す。
    const wrapped = new Error(message);
    wrapped.code = code;
    return { ok: false, error: wrapped };
  }
  if (data?.error) {
    const wrapped = new Error(data.error);
    wrapped.code = data.code || "";
    return { ok: false, error: wrapped };
  }
  return { ok: true, data };
};

// メールを送らず、Supabase Authの正式な招待リンク(admin.auth.admin.generateLink)をその場で
// 生成して返す — generate-invite-link Edge Function(service-role)経由(招待メールが
// Bounced/Suppressed等で届かない場合の代替経路)。返ってきたactionLinkはこの呼び出し限りの
// ものとして扱い、呼び出し元でDBへ保存しない(招待URLの安全性要件)。
export const generateInviteLink = async ({ token, redirectOrigin }) => {
  const { data, error } = await supabase.functions.invoke("generate-invite-link", {
    body: { token, redirectOrigin },
  });
  if (error) {
    let message = error.message;
    let code = "";
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      // ignore — fall back to error.message
    }
    const wrapped = new Error(message);
    wrapped.code = code;
    return { ok: false, error: wrapped };
  }
  if (data?.error) {
    const wrapped = new Error(data.error);
    wrapped.code = data.code || "";
    return { ok: false, error: wrapped };
  }
  return { ok: true, actionLink: data?.actionLink || "", inviteToken: data?.inviteToken || "", inviteExpiresAt: data?.inviteExpiresAt || "" };
};

// メールアドレスの変更をupdate-user-email Edge Function(service-role)経由で行う — 既に
// 登録済みのユーザーの場合はSupabase Auth側(auth.users.email)も同時に書き換えるため、
// 直接のprofiles更新(updateProfileDetails)だけでは対応できない(Auth側に古いメールアドレス
// が残ってしまう)。未登録(招待中)ユーザーの場合は、サーバー側で招待トークンも新しく
// 発行し直される(古いメールアドレス宛のリンクを無効化するため)。
export const updateUserEmail = async ({ profileId, email }) => {
  const { data, error } = await supabase.functions.invoke("update-user-email", {
    body: { profileId, email },
  });
  if (error) {
    let message = error.message;
    let code = "";
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      // ignore — fall back to error.message
    }
    const wrapped = new Error(message);
    wrapped.code = code;
    return { ok: false, error: wrapped };
  }
  if (data?.error) {
    const wrapped = new Error(data.error);
    wrapped.code = data.code || "";
    return { ok: false, error: wrapped };
  }
  return { ok: true, data };
};

// 「停止/再開」をset-user-active-state Edge Function(service-role)経由で行う —
// profiles.is_activeの書き換えに加えて、登録済みユーザーを停止する場合はSupabase Auth側も
// admin.auth.admin.updateUserById(..., { ban_duration })でロックする。is_active=falseだけ
// ではRLSが即座に効いてデータへはアクセスできなくなるが、Authトークン自体は理論上有効期限
// まで生き続けるため、既にログイン中のセッションも確実に無効化するにはAuth側のBANが必要。
export const setUserActiveState = async ({ profileId, isActive }) => {
  const { data, error } = await supabase.functions.invoke("set-user-active-state", {
    body: { profileId, isActive },
  });
  if (error) {
    let message = error.message;
    let code = "";
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      // ignore — fall back to error.message
    }
    const wrapped = new Error(message);
    wrapped.code = code;
    return { ok: false, error: wrapped };
  }
  if (data?.error) {
    const wrapped = new Error(data.error);
    wrapped.code = data.code || "";
    return { ok: false, error: wrapped };
  }
  return { ok: true, data };
};

// Deletes a user (Supabase Auth account + profiles + user_stores) via the delete-user Edge
// Function (service-role) — see that function for why: deleting the auth account needs the
// admin API, and the "last admin in this company" guard needs to see across the whole company,
// which a normal RLS-scoped client call from the browser can't safely do itself. Historical
// business data the user created is untouched (see 20260809050000_profile_delete_preserves_
// history.sql) — only their account and store assignments are removed.
export const deleteUserAccount = async ({ profileId }) => {
  const { data, error } = await supabase.functions.invoke("delete-user", {
    body: { profileId },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, data };
};

export const getSupabaseSession = async () => {
  const { data, error } = await supabase.auth.getSession();
  return { data, error };
};

export const ensureProfileForAuthUser = async ({ authUserId, email, role = null, companyId = null }) => {
  if (!authUserId || !email) return null;

  const normalizedEmail = normalizeEmail(email);
  const profileSelect = "id, auth_user_id, company_id, name, email, role, is_active, invitation_status";
  let existingProfile = null;

  if (authUserId) {
    const { data, error } = await supabase.from("profiles").select(profileSelect).eq("auth_user_id", authUserId).is("deleted_at", null).maybeSingle();
    if (error) throw error;
    existingProfile = data;
  }

  if (!existingProfile) {
    // deleted_at IS NULL に絞らないと、論理削除済みの古い行(auth_user_idはnull化済み)が
    // ここでヒットしてしまい、別会社からの新しい招待を受けてログインしたはずの人が誤って
    // 削除済みの古いprofileへ再アタッチされてしまう(2026-09-04)。
    const { data, error } = await supabase.from("profiles").select(profileSelect).eq("email", normalizedEmail).is("deleted_at", null).maybeSingle();
    if (error) throw error;
    existingProfile = data;
  }

  if (existingProfile) {
    const updates = {};
    if (!existingProfile.auth_user_id) updates.auth_user_id = authUserId;
    if (!existingProfile.company_id) {
      const tenant = await ensureInitialCompanyAndStore({ companyId, preferredCompanyName: "サロン本社", preferredStoreName: "本店" });
      updates.company_id = tenant.companyId;
    }
    if (!existingProfile.name) updates.name = normalizedEmail.split("@")[0];
    // Role is deliberately left alone for an existing profile. This function runs on every
    // login and every session restore (see App.jsx's initializeAuth/handleLogin), always
    // called with `role` derived fresh from the email. Re-applying that derived role here used
    // to silently overwrite whatever role an admin had actually set — an invite's
    // store_manager, or a promotion via the 権限変更 button — back to the email-based default
    // on the user's very next login. The only role change ever applied automatically is
    // upgrading the hardcoded bootstrap admin email to system_admin, and only upgrading, never
    // downgrading, so it can't undo a deliberate demotion either.
    if (resolveRoleForEmail(normalizedEmail) === "system_admin" && normalizeRole(existingProfile.role) !== "system_admin") {
      updates.role = "system_admin";
    } else if (!existingProfile.role) {
      updates.role = normalizeRole(role || resolveDefaultRole(normalizedEmail));
    }
    if (Object.keys(updates).length) {
      const { data, error } = await supabase.from("profiles").update(updates).eq("id", existingProfile.id).select().single();
      if (error) throw error;
      return data;
    }
    return existingProfile;
  }

  const tenant = await ensureInitialCompanyAndStore({ companyId, preferredCompanyName: "サロン本社", preferredStoreName: "本店" });
  // The user who causes a brand-new company to be provisioned is its founding owner: default
  // them to plain "staff" and they'd be locked out of their own company's monthly targets,
  // month-closing, and store/user management from their very first login (all restricted to
  // company_admin/system_admin/store_manager by RLS). Only applies when this signup is what
  // actually created the company — an invited user joining an existing company still gets
  // whatever role their invite specified.
  const resolvedRole = tenant.created
    ? "company_admin"
    : normalizeRole(role || resolveDefaultRole(normalizedEmail));
  const profile = await createUserProfileRecord({
    name: normalizedEmail.split("@")[0],
    email: normalizedEmail,
    role: resolvedRole,
    companyId: tenant.companyId,
    storeIds: tenant.storeId ? [tenant.storeId] : [],
    primaryStoreId: tenant.storeId || "",
    authUserId,
  });

  return profile;
};

// SupabaseプロジェクトのPostgREST設定(supabase/config.toml の [api] max_rows)により、
// .limit()を指定しない/大きな値を指定しても1リクエストあたり最大1000行しか返らない
// (max_rowsはサーバー側のハード上限で、クライアント側の.limit()では超えられない)。
// system_admin向けの全社横断クエリ(companies/stores/profiles/user_stores、いずれも
// company_idで絞り込まない)は、会社数・ユーザー数が増えるとこの上限に達し、1000件目
// より後(created_at昇順で後ろ)の行が黙って欠落する——本番で「新規追加した会社の
// ユーザー数がsystem_admin画面に反映されない」形で顕在化した実際の不具合。
// queryBuilderFnが返すクエリに.range()でページングをかけ、1000件未満の応答が返るまで
// 繰り返し全件取得する。呼び出し側のクエリはorder("created_at", {ascending:true})を
// 指定済みである前提(ページ境界をまたいでも順序が安定するため)。
const fetchAllRowsPaginated = async (queryBuilderFn, pageSize = 1000) => {
  let offset = 0;
  let allRows = [];
  for (;;) {
    const { data, error } = await queryBuilderFn().range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    const rows = data || [];
    allRows = allRows.concat(rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return { data: allRows, error: null };
};

// companiesの契約管理まわりの列一覧。loadTenantStateFromSupabaseとloadFranchiseCompanyMetadata
// (フランチャイズ相手企業の閲覧用ローダー)の両方で同じ列を取得するため1箇所にまとめている
// (2026-09-02、契約管理の拡張。supabase/migrations/20260906000000_contract_billing_fields.sql
// で追加した列を含む)。
const COMPANY_CONTRACT_SELECT_COLUMNS =
  "id, name, code, is_active, contract_status, free_reason, deleted_at, deleted_by, deletion_scheduled_at, " +
  "created_at, updated_at, plan, trial_started_at, trial_ends_at, subscription_status, " +
  "stripe_customer_id, stripe_subscription_id, free_started_at, free_ends_at, contract_started_at, " +
  "stopped_at, billing_starts_at, next_billing_at, current_price_id, current_price_amount, payment_status, " +
  // 2026-09-02、Stripe決済導入で追加した3列(billing_interval/current_period_start/
  // cancel_at_period_end)。current_period_endに相当する値は既存のnext_billing_atを
  // そのまま流用する(新しい列は追加しない)。
  "billing_interval, current_period_start, cancel_at_period_end, " +
  // 2026-09-05、運営専用の検証会社(テストサロン)フラグ。会社名では判定しない。
  "is_test_company, " +
  // 2026-09-12、Stripe契約フロー実機検証用の使い捨て会社フラグ(is_test_companyとは別軸)。
  "is_test_contract_run";

export const loadTenantStateFromSupabase = async ({ authUserId, email, currentProfile = null }) => {
  const profile = currentProfile || (await ensureProfileForAuthUser({ authUserId, email }));
  if (!profile) {
    return createInitialAppState();
  }

  const role = normalizeRole(profile.role || "staff");
  const companyFilter = role === "system_admin" ? null : profile.company_id;

  const [{ data: companiesData, error: companiesError }, { data: storesData, error: storesError }, { data: profilesData, error: profilesError }, { data: userStoresData, error: userStoresError }, { data: storeProfilesData, error: storeProfilesError }] = await Promise.all([
    // ai_analysis_enabledはここでは選択しない — AI分析設定はgetCompanyAiAnalysisSettings/
    // updateCompanyAiAnalysisSettingだけを経由する独立した状態として扱う(tenant_snapshot/
    // このログイン時ブートストラップ経由では取得・保持しない)。
    companyFilter
      ? supabase.from("companies").select(COMPANY_CONTRACT_SELECT_COLUMNS).eq("id", companyFilter).order("created_at", { ascending: true })
      : fetchAllRowsPaginated(() => supabase.from("companies").select(COMPANY_CONTRACT_SELECT_COLUMNS).order("created_at", { ascending: true })),
    // Ordered by creation time, not name: a fresh session/device with no cached selection
    // below defaults to stores[0], and name-alphabetical ordering means a store rename (or
    // simply naming a newly added store earlier in the alphabet) can silently reshuffle which
    // store that lands on — including onto a brand-new, still-empty store. Creation order is
    // stable across renames and naturally favors whichever store has been in use longest.
    companyFilter
      ? supabase.from("stores").select("id, company_id, name, code, is_active, status, daily_field_settings").eq("company_id", companyFilter).order("created_at", { ascending: true })
      : fetchAllRowsPaginated(() => supabase.from("stores").select("id, company_id, name, code, is_active, status, daily_field_settings").order("created_at", { ascending: true })),
    // deleted_at IS NULL に絞り、論理削除済みのスタッフをユーザー一覧に出さない(2026-09-04)。
    role === "system_admin"
      ? fetchAllRowsPaginated(() => supabase.from("profiles").select("id, auth_user_id, company_id, name, email, role, is_active, invitation_status, invite_token, invite_expires_at").is("deleted_at", null).order("created_at", { ascending: true }))
      : supabase.from("profiles").select("id, auth_user_id, company_id, name, email, role, is_active, invitation_status, invite_token, invite_expires_at").eq("company_id", profile.company_id).is("deleted_at", null).order("created_at", { ascending: true }),
    fetchAllRowsPaginated(() => supabase.from("user_stores").select("user_id, company_id, store_id, is_primary").order("created_at", { ascending: true })),
    // store_profiles(在籍スタッフ数・生産性計算人数・住所・電話番号等)。以前はここで取得
    // しておらず、ログイン直後のこの軽量ブートストラップだけで作った store オブジェクトは
    // staffCount等が常にundefinedだった——その後の完全なhydrateFromSupabase(store_profiles
    // を実際に取得する側)が完了するまでの短い間、「店舗基本設定」フォームがこの未読込状態
    // (staffCount=undefined)を先に読み込んでしまい、他のフィールドを何も変更していなくても
    // 保存時にstaffCount等が0へ、住所等の未編集項目が空文字へ巻き戻る不具合の直接の原因だった
    // (handleSaveStoreの「フォーム未入力時は既存値を維持する」フォールバックが、undefinedを
    // 「既存値が0/空」と誤認していたため)。ここで最初から一緒に取得することでその空白期間
    // 自体を無くす。
    companyFilter
      ? supabase.from("store_profiles").select("*").eq("company_id", companyFilter)
      : supabase.from("store_profiles").select("*"),
  ]);

  if (companiesError) throw companiesError;
  if (storesError) throw storesError;
  if (profilesError) throw profilesError;
  if (userStoresError) throw userStoresError;
  // store_profilesはstore_status_audit_logと同じくベストエフォート扱い——RLSで空配列が
  // 返っても(通常は起こらないはずだが)ログイン自体をブロックしない。後続のhydrate
  // FromSupabaseが同じテーブルを再取得して確実に埋める。
  if (storeProfilesError) {
    logSupabaseError({ operation: "loadTenantStateFromSupabase", table: "store_profiles", error: storeProfilesError });
  }
  const storeProfilesByStoreId = buildStoreProfilesByStoreId(storeProfilesData);

  const storesByCompany = new Map();
  (storesData || []).forEach((store) => {
    const bucket = storesByCompany.get(store.company_id) || [];
    bucket.push(store);
    storesByCompany.set(store.company_id, bucket);
  });

  const userStoresByUser = new Map();
  (userStoresData || []).forEach((row) => {
    const bucket = userStoresByUser.get(row.user_id) || [];
    bucket.push(row);
    userStoresByUser.set(row.user_id, bucket);
  });

  const normalizedCompanies = (companiesData || []).map((company) => ({
    id: company.id,
    name: company.name,
    code: company.code,
    isActive: company.is_active !== false,
    // 以前はここで常に"active"を返しており、トライアルとして作成した会社もハイドレートの
    // たびに契約中扱いへ戻ってしまっていた(要件1の直接の原因)。companies.contract_status
    // (20260819000000で追加)をそのまま採用する。
    contractStatus: company.contract_status || "trial",
    // 無料利用理由・論理削除状態(20260821000000で追加)。deletedAtが設定されている会社は
    // 「ゴミ箱」でのみ表示し、通常の会社一覧からは除外する(App.jsx側でフィルタ)。
    freeReason: company.free_reason || "",
    deletedAt: company.deleted_at || "",
    deletedBy: company.deleted_by || "",
    deletionScheduledAt: company.deletion_scheduled_at || "",
    // 契約管理の拡張(2026-09-02)。すべて未設定ならnull(空文字ではなく)を返す——
    // 「値が無い」と「0時刻」を区別できるようにするため(formatDateLabel/formatUsageDuration
    // 等はnullを渡すと空文字を返す設計になっている)。
    plan: company.plan || "",
    trialStartedAt: company.trial_started_at || null,
    trialEndsAt: company.trial_ends_at || null,
    subscriptionStatus: company.subscription_status || "",
    stripeCustomerId: company.stripe_customer_id || "",
    stripeSubscriptionId: company.stripe_subscription_id || "",
    freeStartedAt: company.free_started_at || null,
    freeEndsAt: company.free_ends_at || null,
    contractStartedAt: company.contract_started_at || null,
    stoppedAt: company.stopped_at || null,
    billingStartsAt: company.billing_starts_at || null,
    nextBillingAt: company.next_billing_at || null,
    currentPriceId: company.current_price_id || "",
    currentPriceAmount:
      company.current_price_amount === null || company.current_price_amount === undefined
        ? null
        : Number(company.current_price_amount),
    paymentStatus: company.payment_status || "",
    billingInterval: company.billing_interval || "",
    currentPeriodStart: company.current_period_start || null,
    cancelAtPeriodEnd: Boolean(company.cancel_at_period_end),
    // 運営専用の検証会社(テストサロン)フラグ。会社名では判定しない(要件)。
    isTestCompany: Boolean(company.is_test_company),
    // Stripe契約フロー実機検証用の使い捨て会社かどうか(2026-09-12)。
    isTestContractRun: Boolean(company.is_test_contract_run),
    startedAt: company.created_at || new Date().toISOString(),
    lastUpdatedAt: company.updated_at || new Date().toISOString(),
    setup: { company: true, store: true, admin: true, settings: true, complete: true },
    settings: createDefaultCompanySettings(),
    stores: (storesByCompany.get(company.id) || []).map((store) => ({
      id: store.id,
      name: store.name,
      code: store.code,
      companyId: company.id,
      postalCode: "",
      address: "",
      phone: "",
      managerName: "",
      openingDate: "",
      openingHour: "09:00",
      closingHour: "20:00",
      closedDays: "月",
      isActive: store.is_active !== false,
      status: store.status || "active",
      settings: { ...createDefaultStoreSettings(), dailyFieldSettings: normalizeDailyFieldSettings(store.daily_field_settings) },
      // store_profiles(在籍スタッフ数・生産性計算人数・住所等)が既に登録済みの店舗は、この
      // 時点で正しい値を反映する(上のデフォルト値は「まだ一度もstore_profilesへ保存して
      // いない、真に新規の店舗」の場合だけ使われる)。undefinedのまま後続のhydrateFrom
      // Supabase任せにしないことが今回の在籍スタッフ数0リセット不具合の根本修正——詳細は
      // 上のstore_profiles取得クエリのコメント参照。
      ...(storeProfilesByStoreId[store.id] || {}),
    })),
  }));

  const normalizedUsers = (profilesData || []).map((item) => {
    const assignedStores = (userStoresByUser.get(item.id) || []).map((store) => store.store_id);
    const primaryStore = (userStoresByUser.get(item.id) || []).find((store) => store.is_primary);
    return {
      id: item.id,
      name: item.name,
      email: item.email,
      role: item.role || "staff",
      companyId: item.company_id || "",
      storeIds: assignedStores,
      primaryStoreId: primaryStore?.store_id || assignedStores[0] || "",
      isActive: item.is_active !== false,
      invitationStatus: item.invitation_status || "active",
      lastLoginAt: "",
      authUserId: item.auth_user_id || "",
      // 「招待リンクをコピー」("再招待"を経由せずいきなりコピーする場合)がgenerate-invite-link
      // Edge Functionを呼ぶ際のトークン特定に使う。以前はここに含まれておらず、再読み込み後は
      // 常に空になってしまい(inviteToken/inviteExpiresAtがローカル状態にしか無かったため)、
      // ページを開き直した招待済みユーザーの「招待リンクをコピー」がその都度失敗する原因に
      // なっていた。
      inviteToken: item.invite_token || "",
      inviteExpiresAt: item.invite_expires_at || "",
    };
  });

  const selectedCompany = normalizedCompanies.find((company) => company.id === profile.company_id) || normalizedCompanies[0] || null;
  const selectedStore = selectedCompany?.stores?.[0] || null;
  const seedState = createInitialAppState();
  const companiesWithSnapshots = normalizedCompanies.reduce((accumulator, company) => {
    accumulator[company.id] = {
      ...seedState,
      stores: company.stores.map((store) => store.name),
      selectedStore: company.stores[0]?.name || "",
      selectedStoreId: company.stores[0]?.id || "",
      selectedMonth: seedState.selectedMonth,
    };
    return accumulator;
  }, {});

  return {
    ...seedState,
    companies: normalizedCompanies,
    users: normalizedUsers,
    currentCompanyId: selectedCompany?.id || "",
    currentUserId: profile.id,
    companySnapshots: companiesWithSnapshots,
    stores: selectedCompany?.stores?.map((store) => store.name) || [],
    selectedStore: selectedStore?.name || "",
    selectedStoreId: selectedStore?.id || "",
  };
};

// Stripe契約フロー実機検証(2026-09追加)。system_admin向けの「契約フローのテスト」一覧に
// 表示する「登録メールアドレス」を、対象会社のcompany_adminプロフィールから取得する
// (companiesテーブル自体にはメール列が無いため)。1社に複数のcompany_adminがいる場合は
// 作成日時が最も古い1件(=自己サインアップした本人)を採用する。
export const loadCompanyAdminEmails = async ({ companyIds }) => {
  if (!isSupabaseConfigured || !Array.isArray(companyIds) || companyIds.length === 0) return { ok: true, data: {} };
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("company_id, email, created_at")
      .in("company_id", companyIds)
      .eq("role", "company_admin")
      .order("created_at", { ascending: true });
    if (error) throw error;
    const emailByCompanyId = {};
    (data || []).forEach((row) => {
      if (!emailByCompanyId[row.company_id]) emailByCompanyId[row.company_id] = row.email || "";
    });
    return { ok: true, data: emailByCompanyId };
  } catch (error) {
    logSupabaseError({ operation: "loadCompanyAdminEmails", table: "profiles", error });
    return { ok: false, error, data: {} };
  }
};

// 加盟店連携(閲覧専用)で、対象の加盟店会社1社分のcompanies/stores基本情報だけを取得する
// 軽量版ローダー。loadTenantStateFromSupabaseと同じ正規化(company.stores[].settings等)を
// 使うが、store_input_settings等の上書きはApp.jsx側のhydrateFromSupabase(companyIdOverride
// 付き)が後続で行うため、ここでは基本情報だけ返せば十分。RLS側はcurrent_user_can_view_
// franchise_company()が承認済み(approved)の連携がある場合だけSELECTを許可する — 未承認の
// 会社を指定した場合は空(0行)で返る。
export const loadFranchiseCompanyMetadata = async ({ companyId }) => {
  if (!isSupabaseConfigured || !companyId) return { ok: false, error: new Error("companyId is required") };
  try {
    const [{ data: companyRow, error: companyError }, { data: storesData, error: storesError }, { data: storeProfilesData, error: storeProfilesError }] = await Promise.all([
      supabase.from("companies").select(COMPANY_CONTRACT_SELECT_COLUMNS).eq("id", companyId).maybeSingle(),
      supabase.from("stores").select("id, company_id, name, code, is_active, status, daily_field_settings").eq("company_id", companyId).order("created_at", { ascending: true }),
      // loadTenantStateFromSupabaseと同じ理由(在籍スタッフ数0リセット不具合の根本修正) —
      // 加盟店閲覧に切り替えた直後もstore_profilesを最初から一緒に取得し、undefinedの
      // 空白期間を作らない。
      supabase.from("store_profiles").select("*").eq("company_id", companyId),
    ]);
    if (companyError) throw companyError;
    if (storesError) throw storesError;
    if (storeProfilesError) {
      logSupabaseError({ operation: "loadFranchiseCompanyMetadata", table: "store_profiles", companyId, error: storeProfilesError });
    }
    if (!companyRow) {
      return { ok: false, error: new Error("加盟店の会社情報を取得できませんでした（連携が承認されていない可能性があります）") };
    }
    const storeProfilesByStoreId = buildStoreProfilesByStoreId(storeProfilesData);

    const company = {
      id: companyRow.id,
      name: companyRow.name,
      code: companyRow.code,
      isActive: companyRow.is_active !== false,
      contractStatus: companyRow.contract_status || "trial",
      freeReason: companyRow.free_reason || "",
      deletedAt: companyRow.deleted_at || "",
      plan: companyRow.plan || "",
      trialStartedAt: companyRow.trial_started_at || null,
      trialEndsAt: companyRow.trial_ends_at || null,
      subscriptionStatus: companyRow.subscription_status || "",
      stripeCustomerId: companyRow.stripe_customer_id || "",
      stripeSubscriptionId: companyRow.stripe_subscription_id || "",
      freeStartedAt: companyRow.free_started_at || null,
      freeEndsAt: companyRow.free_ends_at || null,
      contractStartedAt: companyRow.contract_started_at || null,
      stoppedAt: companyRow.stopped_at || null,
      billingStartsAt: companyRow.billing_starts_at || null,
      nextBillingAt: companyRow.next_billing_at || null,
      currentPriceId: companyRow.current_price_id || "",
      currentPriceAmount:
        companyRow.current_price_amount === null || companyRow.current_price_amount === undefined
          ? null
          : Number(companyRow.current_price_amount),
      paymentStatus: companyRow.payment_status || "",
      billingInterval: companyRow.billing_interval || "",
      currentPeriodStart: companyRow.current_period_start || null,
      cancelAtPeriodEnd: Boolean(companyRow.cancel_at_period_end),
      startedAt: companyRow.created_at || new Date().toISOString(),
      lastUpdatedAt: companyRow.updated_at || new Date().toISOString(),
      setup: { company: true, store: true, admin: true, settings: true, complete: true },
      settings: createDefaultCompanySettings(),
      stores: (storesData || []).map((store) => ({
        id: store.id,
        name: store.name,
        code: store.code,
        companyId: companyRow.id,
        postalCode: "",
        address: "",
        phone: "",
        managerName: "",
        openingDate: "",
        openingHour: "09:00",
        closingHour: "20:00",
        closedDays: "月",
        isActive: store.is_active !== false,
        status: store.status || "active",
        settings: { ...createDefaultStoreSettings(), dailyFieldSettings: normalizeDailyFieldSettings(store.daily_field_settings) },
        ...(storeProfilesByStoreId[store.id] || {}),
      })),
    };

    return { ok: true, company };
  } catch (error) {
    logSupabaseError({ operation: "loadFranchiseCompanyMetadata", table: "companies", companyId, error });
    return { ok: false, error };
  }
};

export const createCompanyRecord = async ({ name, code, contractStatus }) => {
  const { data, error } = await supabase
    .from("companies")
    .insert({
      name,
      code,
      is_active: true,
      contract_status: contractStatus || "trial",
    })
    .select()
    .single();

  if (error) throw error;

  return data;
};

// 会社の契約状態(無料利用/トライアル/契約中/停止中)・無料利用理由を変更する —
// update-company-status Edge Function(service-role)経由。system_admin限定、targetStatusは
// 対象companyの現在の状態から許可されていない遷移(例: 契約中からトライアルへ戻す)であれば
// サーバー側で拒否される。targetStatusを省略しfreeReasonだけ渡すと、既に無料利用中の会社の
// 理由だけを状態遷移なしで更新できる。クライアントからcompanies.contract_status/free_reason
// を直接書ける経路は残さない(companies_update_system_only RLSにも守られているが、遷移
// そのものの妥当性検証はRLSだけではできないため)。
// freeEndsAt: targetStatusが"free"のときだけ意味を持つ。undefinedなら変更しない、
// nullまたは空文字なら「終了日を設定しない」、日付文字列ならその日を無料利用終了日として
// 保存する(2026-09-02、契約管理の拡張)。レスポンスにはEdge Function側で実際に計算・保存
// した日付フィールド一式(free_started_at/free_ends_at/trial_started_at/trial_ends_at/
// contract_started_at/stopped_at/billing_starts_at)がそのまま含まれる——
// 「送った値をそのまま信じる」のではなく実際に保存された値を画面へ反映するため。
export const updateCompanyContractStatus = async ({ companyId, targetStatus, freeReason, freeEndsAt }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("update-company-status", {
    body: { companyId, targetStatus, freeReason, freeEndsAt },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return {
    ok: true,
    status: data?.contract_status || "",
    freeReason: data?.free_reason,
    freeStartedAt: data?.free_started_at,
    freeEndsAt: data?.free_ends_at,
    trialStartedAt: data?.trial_started_at,
    trialEndsAt: data?.trial_ends_at,
    contractStartedAt: data?.contract_started_at,
    stoppedAt: data?.stopped_at,
    billingStartsAt: data?.billing_starts_at,
  };
};

// Stripe Checkout Sessionの作成(2026-09-02、Stripe決済導入) —
// create-checkout-session Edge Function(service-role)経由。company_admin限定。
// company_idはこちらからは一切送らない(Edge Function側が呼び出し元のJWTから解決する)。
// 成功時はcheckoutページへのURLを返すだけ——呼び出し元(App.jsx)がリダイレクトする。
export const createCheckoutSession = async ({ billingInterval }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("create-checkout-session", {
    body: { billingInterval },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, url: data?.url };
};

// Stripe Customer Portal Sessionの作成 — create-portal-session Edge Function経由。
// company_admin限定。カード変更・支払い方法変更・契約状況確認・解約予約は、この
// URLへリダイレクトしたStripeホスト側の画面で行う(自作の決済管理画面は作らない)。
export const createPortalSession = async () => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("create-portal-session", { body: {} });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, url: data?.url };
};

// 店舗数変更後の追加店舗Price同期 — sync-store-billing-quantity Edge Function経由。
// ベストエフォート(失敗しても店舗の追加・アーカイブ自体は既に完了しているため、
// 呼び出し元は結果を強くは待たない想定)。無料利用/トライアル/停止中の会社では
// サーバー側が自動的に何もしない(実際のStripeサブスクリプションが無いため)。
export const syncStoreBillingQuantity = async ({ companyId } = {}) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("sync-store-billing-quantity", {
    body: { companyId },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, addonQuantity: data?.addonQuantity };
};

// Stripe契約フロー実機検証(2026-09追加)。system_admin限定。実際の新規顧客と全く同じ
// 「新規登録→プラン選択→Stripe Checkout→決済→Webhook→利用開始」の導線を、使い捨ての
// テスト会社で検証するための入口——ここではURLを発行するだけで、登録・契約ロジック自体は
// 一切複製しない(create-checkout-session/stripe-webhook等の既存経路をそのまま使う)。
export const generateTestSignupLink = async () => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("generate-test-signup-link", { body: {} });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, url: data?.url, suggestedCompanyName: data?.suggestedCompanyName, suggestedEmail: data?.suggestedEmail };
};

// テスト契約フロー専用の使い捨て会社(is_test_contract_run=true)だけを対象に、Stripe側の
// サブスクリプションを即時キャンセルする(誤課金防止の導線、要件6)。DBの契約状態は
// このAPI自体では書き換えない——本物のcustomer.subscription.deleted Webhookが届いた時点で
// 既存のstripe-webhookロジックがそのまま反映する(要件8)。
export const cancelTestContract = async ({ companyId }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("cancel-test-contract", { body: { companyId } });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, data };
};

// 加盟店連携リクエストの送信 — create-franchise-request Edge Function(service-role)経由。
// system_admin限定。company_id・既存データには一切触れず、company_partnershipsの1行を
// pending状態で作成(または過去に拒否/解除された行をpendingへ再利用)する。
export const createFranchiseRequest = async ({ parentCompanyId, partnerCompanyId }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("create-franchise-request", {
    body: { parentCompanyId, partnerCompanyId },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, id: data?.id || "", status: data?.status || "pending" };
};

// 加盟店連携リクエストの承認/拒否/解除/再申請 — update-franchise-relationship Edge Function
// (service-role)経由。承認はrelationshipのpartner_company_id側のcompany_admin(または
// system_admin)のみ、解除・再申請はparent_company_id側のcompany_admin(またはsystem_admin)
// のみ行える(サーバー側で再検証)。
export const updateFranchiseRelationship = async ({ relationshipId, action }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("update-franchise-relationship", {
    body: { relationshipId, action },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, id: data?.id || "", status: data?.status || "" };
};

// company_partnerships の一覧取得。RLS(company_partnerships_select)により、system_adminは
// 全件、それ以外は自社がparent/partnerどちらかの行だけが返る — クライアント側でのフィルタは
// 不要(取得できた時点で見てよい行だけになっている)。
export const loadCompanyPartnerships = async () => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true, data: [] };
  try {
    // 送信元/送信先の会社名をこの1回のクエリで一緒に取得する(通知バナー・詳細画面で
    // 「〇〇株式会社から」を表示するため)。RLS(companies_select_company_scoped、
    // 20260823010000で追加した分岐)がpending/approvedの関係にある相手の会社名だけを
    // company_adminに許可しているので、業務データが漏れることはない。
    const { data, error } = await supabase
      .from("company_partnerships")
      .select(
        "id, parent_company_id, partner_company_id, relationship_type, status, joined_at, can_view_sales, can_view_daily, can_view_dashboard, can_view_pl, can_view_costs, requested_by, responded_by, responded_at, created_at, updated_at, parent_company:companies!company_partnerships_parent_company_id_fkey(id, name, code), partner_company:companies!company_partnerships_partner_company_id_fkey(id, name, code)"
      )
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadCompanyPartnerships", table: "company_partnerships", error });
    return { ok: false, error, data: [] };
  }
};

// 会社の論理削除・復元 — soft-delete-company Edge Function(service-role)経由。system_admin
// 限定。削除(action: "delete")は対象会社名の完全一致(confirmName)が必須で、
// company_idに紐づくデータには一切触れず、companies行のdeleted_at/deleted_by/
// deletion_scheduled_atだけを更新する。復元(action: "restore")はその3列をnullへ戻すだけ —
// 店舗・ユーザー・売上等はそもそも削除されていないため、復元すれば即座に以前の状態のまま
// 利用を再開できる。
export const softDeleteCompany = async ({ companyId, action, confirmName }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("soft-delete-company", {
    body: { companyId, action, confirmName },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, data };
};

// 会社の完全削除(3段階のうち最終段階) — delete-company Edge Function(service-role)経由。
// system_admin限定、論理削除済み(deleted_atが設定済み)の会社にしか実行できず、対象会社名の
// 完全一致(confirmName)に加えて固定フレーズ「完全削除」の入力(confirmPhrase)も必須(要件8:
// 論理削除より確認を1段厳重にする)。stores個別削除(deleteStoreCompletely)と異なり関連
// データの有無で拒否せず、company_idに紐づく全データを明示的にcascade削除する(要件)。
export const deleteCompanyCompletely = async ({ companyId, confirmName, confirmPhrase }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("delete-company", {
    body: { companyId, confirmName, confirmPhrase },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, data };
};

// AI分析ON/OFFの唯一のsource of truthは companies.ai_analysis_enabled。tenant_snapshot・
// hydrateFromSupabase・localStorage・appStateのどれも経由せず、常にこの2関数だけを通じて
// companiesテーブルへ直接読み書きする(App.jsx側は独立したaiAnalysisSettings stateとして
// 保持し、他の同期処理からは一切触らない)。
export const getCompanyAiAnalysisSettings = async ({ companyIds }) => {
  const ids = Array.from(new Set((companyIds || []).filter(Boolean)));
  if (!isSupabaseConfigured || !ids.length) return { ok: true, data: [] };
  try {
    const { data, error } = await supabase.from("companies").select("id, ai_analysis_enabled").in("id", ids);
    if (error) throw error;
    return { ok: true, data: (data || []).map((row) => ({ id: row.id, aiAnalysisEnabled: Boolean(row.ai_analysis_enabled) })) };
  } catch (error) {
    logSupabaseError({ operation: "getCompanyAiAnalysisSettings", table: "companies", error });
    return { ok: false, error, data: [] };
  }
};

// AI分析(AI経営アシスタント)の会社単位ON/OFF。companiesのUPDATE用RLS(companies_update_
// system_only)が既にsystem_admin限定になっているため、他の会社管理操作(createCompanyRecord
// 等)と同じくEdge Functionを介さず直接クライアントから更新する — RLSそのものが権限の実体。
export const updateCompanyAiAnalysisSetting = async ({ companyId, enabled }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "updateCompanyAiAnalysisSetting", table: "companies", companyId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  try {
    const { data, error } = await supabase.from("companies").update({ ai_analysis_enabled: Boolean(enabled), updated_at: new Date().toISOString() }).eq("id", companyId).select("id, ai_analysis_enabled").single();
    if (error) throw error;
    return { ok: true, data: { id: data.id, aiAnalysisEnabled: Boolean(data.ai_analysis_enabled) } };
  } catch (error) {
    logSupabaseError({ operation: "updateCompanyAiAnalysisSetting", table: "companies", companyId, error });
    return { ok: false, error };
  }
};

export const createStoreRecord = async ({ companyId, name, code }) => {
  const { data, error } = await supabase
    .from("stores")
    .insert({
      company_id: companyId,
      name,
      code,
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
};

// Updates a store's own row in place — store_id never changes, so every daily_sales/
// monthly_targets/monthly_closings/user_stores row already keyed to this store_id stays
// correctly linked. Only the display name changes; nothing about how the store is identified
// anywhere else in the schema does.
export const updateStoreRecord = async ({ storeId, name }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ storeId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "updateStoreRecord", table: "stores", storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  try {
    const { data, error } = await supabase.from("stores").update({ name, updated_at: new Date().toISOString() }).eq("id", storeId).select().single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "updateStoreRecord", table: "stores", storeId, error });
    return { ok: false, error };
  }
};

// 店舗の状態(運営中/停止中/アーカイブ)を変更する — update-store-status Edge Function
// (service-role)経由。停止/再開/アーカイブ/復元の4操作全てをこの1関数でカバーする
// (action: "suspend"|"resume"|"archive"|"restore")。stores.is_active を直接書き換えるクライア
// ント直更新はもう使わない — stores.status を書き換えると、DB側のtriggerが is_active を
// 自動的に同期する(archived以外はtrue)ため、statusとis_activeが食い違う状態を作れない。
// 状態変更のたびにservice-role経由でstore_status_audit_logへ記録も残るため(要件7)、
// クライアントから直接is_active/statusを書ける経路を残さないことが重要 — 会社管理者・
// システム管理者であっても、この関数を経由しない限り記録の残らない状態変更はできない。
export const updateStoreStatus = async ({ storeId, action }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("update-store-status", {
    body: { storeId, action },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, status: data?.status || "" };
};

// 店舗の完全削除 — delete-store Edge Function(service-role)経由。system_admin限定、
// 対象店舗名の完全一致(confirmName)が必須、日次売上/月間目標/費用/月締め/在庫/スタッフ所属
// 等の関連データが1件でもあれば拒否される(要件3)。stores.id は daily_sales/monthly_targets/
// 等へ on delete cascade で連鎖するため、このチェックを通過しない限り実際にDELETE文を発行
// することはない。
export const deleteStoreCompletely = async ({ storeId, confirmName }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("delete-store", {
    body: { storeId, confirmName },
  });
  if (error) {
    let message = error.message;
    let code = "";
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      // ignore — fall back to error.message
    }
    const wrapped = new Error(message);
    wrapped.code = code;
    return { ok: false, error: wrapped };
  }
  if (data?.error) {
    const wrapped = new Error(data.error);
    wrapped.code = data.code || "";
    return { ok: false, error: wrapped };
  }
  return { ok: true, data };
};

export const updateStoreDailyFieldSettings = async ({ storeId, settings }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ storeId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "updateStoreDailyFieldSettings", table: "stores", storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }

  const { data, error } = await supabase
    .from("stores")
    .update({ daily_field_settings: normalizeDailyFieldSettings(settings) })
    .eq("id", storeId)
    .select()
    .single();

  if (error) {
    logSupabaseError({ operation: "updateStoreDailyFieldSettings", table: "stores", storeId, error });
    return { ok: false, error };
  }
  return { ok: true, data };
};

// メールアドレス重複判定を、appState.users(ローカルキャッシュ——ログイン時にしか再取得
// されず、他デバイス/他タブでの削除等を反映しない。system_adminの場合は全社分を1つの配列で
// 保持しているため、会社をまたいだ古い招待とも単純なメール一致で衝突していた)ではなく、
// 送信直前にSupabaseへ直接問い合わせて判定するための取得。RLS(profiles_select_company_
// scoped)がそのまま適用されるため、company_admin/store_managerは自社の行だけが返り、
// system_adminは全社分が返る——「別会社の行が見えるかどうか」自体を呼び出し側で権限分岐
// する必要が無い(見えない場合は単にこの配列に含まれないだけ)。
export const checkExistingProfilesByEmail = async ({ email }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!isSupabaseConfigured || !normalizedEmail) return { ok: true, data: [] };
  try {
    // 論理削除済み(deleted_at設定済み)の行は「現在有効な所属・招待」ではないため対象外
    // (2026-09-04)。削除済みのスタッフを理由に新規招待をブロックしない、という要件どおり。
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, company_id, role, is_active, invitation_status, invite_expires_at, auth_user_id")
      .eq("email", normalizedEmail)
      .is("deleted_at", null);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "checkExistingProfilesByEmail", table: "profiles", error });
    return { ok: false, error, data: [] };
  }
};

export const createUserProfileRecord = async ({ name, email, role, companyId, storeIds = [], primaryStoreId = "", authUserId = null, invitationStatus = "active", inviteToken = null, inviteExpiresAt = null }) => {
  const normalizedEmail = normalizeEmail(email);
  const resolvedRole = normalizeRole(role || resolveDefaultRole(normalizedEmail));
  // The id is generated client-side (instead of relying on the column's gen_random_uuid()
  // default + reading it back via .select().single()) because a store_manager inviting staff
  // can insert this row (profiles_insert_company_scoped allows it) but can't yet SELECT it back
  // — profiles_select_company_scoped only grants a store_manager visibility into a staff
  // profile via its user_stores row, which doesn't exist until the second insert below runs.
  // Knowing the id upfront sidesteps that ordering problem entirely instead of racing it.
  const profileId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const insertPayload = {
    id: profileId,
    auth_user_id: authUserId,
    company_id: companyId,
    name,
    email: normalizedEmail,
    role: resolvedRole,
    is_active: true,
    invitation_status: invitationStatus,
    invite_token: inviteToken,
    invite_expires_at: inviteExpiresAt,
  };
  const { error: profileError } = await supabase.from("profiles").insert(insertPayload);
  if (profileError) {
    // profiles.emailはDB側でUNIQUE制約(profiles_email_key)——1つのメールアドレスは常に
    // 1つの会社にしか登録できない、というこのアプリの会社分離の前提そのもの。
    // checkExistingProfilesByEmail(呼び出し元、handleSaveUser)による事前チェックは
    // RLSの範囲でしか他社の行を見られない(company_admin/store_managerには他社の行が
    // そもそも見えない)ため、事前チェックをすり抜けて実際にこの一意性違反へ到達する
    // ケースが起こり得る——ここで拾って、生のPostgresエラー(意味の伝わらない文言)では
    // なく、原因が分かる日本語メッセージへ翻訳する。
    if (profileError.code === "23505" && /profiles_email_key/.test(profileError.message || profileError.details || "")) {
      throw new Error("このメールアドレスは既に別の会社に登録されています。1つのメールアドレスは1つの会社にのみ登録できます。先にその会社側で招待の削除・所属解除を行ってから、あらためて招待してください。");
    }
    throw profileError;
  }
  const profile = { ...insertPayload, id: profileId };

  if (storeIds.length || primaryStoreId) {
    const storeList = (storeIds.length ? storeIds : [primaryStoreId]).filter(Boolean);
    const assignments = storeList.map((storeId, index) => ({
      user_id: profile.id,
      company_id: companyId,
      store_id: storeId,
      is_primary: primaryStoreId ? storeId === primaryStoreId : index === 0,
    }));
    const { error: userStoreError } = await supabase.from("user_stores").insert(assignments);
    if (userStoreError) {
      // profilesへのinsertは既に成功しているが、店舗の紐付けだけ失敗した状態 — このまま
      // 放置すると「メールアドレスは既に登録されている(=重複扱い)のに店舗が1件も紐付いて
      // いない」中途半端な招待が残ってしまい、同じメールアドレスでの再招待もブロックして
      // しまう(招待フロー整理の要件1)。PostgRESTは複数テーブルにまたがるトランザクションを
      // クライアントから張れないため、ここではprofiles側を明示的に削除して補償する
      // (store_managerが自分のスタッフを取り消せるprofiles_delete_company_scopedの
      // auth_user_id is nullの分岐を利用 — このprofileはauth_user_idがまだnullなので必ず
      // 削除対象に入る)。
      await supabase.from("profiles").delete().eq("id", profileId);
      logSupabaseError({ operation: "createUserProfileRecord", table: "user_stores", companyId, error: userStoreError });
      throw new Error("店舗の紐付けに失敗したため、招待の作成を取り消しました。もう一度お試しください。");
    }
  }

  return profile;
};

// Used by the "再送" (resend invite) action to push a refreshed expiry (and, for a brand-new
// token, the new token) to the real profiles row — without this the copy-able invite link and
// Supabase's own invite_token/invite_expires_at would drift apart, and the "resent" link would
// still fail get_invite_info's expiry check.
export const refreshInviteState = async ({ profileId, inviteToken, inviteExpiresAt }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  try {
    const { data, error } = await supabase
      .from("profiles")
      .update({ invite_token: inviteToken, invite_expires_at: inviteExpiresAt, invitation_status: "invited" })
      .eq("id", profileId)
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "refreshInviteState", table: "profiles", userId: profileId, error });
    return { ok: false, error };
  }
};

// The Users management page's 権限変更/所属店舗変更 buttons used to only update appState.users
// (local state + the legacy tenant_snapshots blob) — never the profiles/user_stores rows that
// RLS and every other read path actually check. That made a role "change" pure UI theater: the
// promoted user's next login would still see their old role, since ensureProfileForAuthUser
// reads straight from profiles.role.
// Covers the fields the previous edit flow silently dropped: it reused the invite-creation form
// for edits too, but that form only ever wrote to local appState — name/email/active-status
// changes never reached Supabase at all, so they reverted on the next hydrate. This is the
// dedicated edit save path; role and store assignments still go through updateProfileRole /
// updateProfileStoreAssignments (called alongside this one from the same edit-save handler).
export const updateProfileDetails = async ({ profileId, name, email, isActive }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ userId: profileId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "updateProfileDetails", table: "profiles", userId: profileId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  try {
    const { data, error } = await supabase
      .from("profiles")
      .update({ name, email: normalizeEmail(email), is_active: isActive !== false })
      .eq("id", profileId)
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "updateProfileDetails", table: "profiles", userId: profileId, error });
    return { ok: false, error };
  }
};

export const updateProfileRole = async ({ profileId, role }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ userId: profileId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "updateProfileRole", table: "profiles", userId: profileId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  try {
    const { data, error } = await supabase.from("profiles").update({ role: normalizeRole(role) }).eq("id", profileId).select().single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "updateProfileRole", table: "profiles", userId: profileId, error });
    return { ok: false, error };
  }
};

// Replaces this profile's full store assignment set (delete-then-insert, since user_stores has
// no natural single-row conflict target for "this user's whole assignment list").
export const updateProfileStoreAssignments = async ({ profileId, companyId, storeIds = [], primaryStoreId = "" }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ userId: profileId, companyId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "updateProfileStoreAssignments", table: "user_stores", userId: profileId, companyId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  try {
    const { error: deleteError } = await supabase.from("user_stores").delete().eq("user_id", profileId);
    if (deleteError) throw deleteError;

    const storeList = (storeIds || []).filter(Boolean);
    if (!storeList.length) return { ok: true, data: [] };

    const assignments = storeList.map((storeId, index) => ({
      user_id: profileId,
      company_id: companyId,
      store_id: storeId,
      is_primary: primaryStoreId ? storeId === primaryStoreId : index === 0,
    }));
    const { data, error: insertError } = await supabase.from("user_stores").insert(assignments).select();
    if (insertError) throw insertError;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "updateProfileStoreAssignments", table: "user_stores", userId: profileId, companyId, error });
    return { ok: false, error };
  }
};

// daily_sales is the row-per-day source of truth for daily sales figures: one row per
// (company_id, store_id, business_date), upserted so re-saving the same date updates it in
// place instead of creating a duplicate. Day-closing state (is_day_closed/closed_at) is
// intentionally NOT touched here — see updateDailySalesClosingState — so a plain sales-entry
// save can never accidentally re-open or re-close a day.
export const upsertDailySalesEntry = async ({ companyId, storeId, userId, entry }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId, userId, businessDate: entry?.date });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertDailySalesEntry", table: "daily_sales", userId, companyId, storeId, businessDate: entry?.date, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }

  const payload = {
    company_id: companyId,
    store_id: storeId,
    business_date: entry.date,
    sales_amount: Number(entry.totalSales || 0),
    technical_sales_amount: Number(entry.technicalSales || 0),
    retail_sales_amount: Number(entry.retailSales || 0),
    other_sales_amount: Number(entry.otherSales || 0),
    customer_count: Number(entry.customers || 0),
    new_customer_count: Number(entry.newCustomers || 0),
    repeat_customer_count: Number(entry.repeatCustomers || 0),
    review_count: Number(entry.reviewCount || 0),
    memo: String(entry.memo || ""),
    created_by: userId,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from("daily_sales")
      .upsert(payload, { onConflict: "company_id,store_id,business_date" })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertDailySalesEntry", table: "daily_sales", userId, companyId, storeId, businessDate: entry?.date, error });
    return { ok: false, error };
  }
};

// Day-closing used to be UPDATE-only, on the assumption that a prior upsertDailySalesEntry
// call had already guaranteed the row exists (see toggleDayClosing in App.jsx, which called
// saveDailyEntry first specifically for this reason). That assumption had a real gap:
// saveDailyEntry silently no-ops whenever dailyMode is "view" — the normal state right after
// opening an already-saved entry, which is exactly when a user goes to close it — so if the
// row's actual persistence was ever in question, this UPDATE would find nothing to update and
// day-closing would fail (or, before an earlier fix, fail silently). Accepting an optional
// `entry` here turns this into a full upsert: it can create the row itself if needed instead
// of only ever assuming one already exists, closing that gap entirely regardless of what did
// or didn't happen earlier in the flow.
export const updateDailySalesClosingState = async ({ companyId, storeId, businessDate, userId, isClosed, entry = null }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId, businessDate });
  if (validationError) {
    const detail = logSupabaseError({ operation: "updateDailySalesClosingState", table: "daily_sales", userId, companyId, storeId, businessDate, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }

  // updated_at must be bumped here even though it also reflects sales-figure edits elsewhere:
  // buildDailyStateFromRows/dailySalesRowToEntry fall back to it as the dayClosingUpdatedAt for
  // this date whenever closed_at is null (i.e. un-closing, which clears closed_at). Without
  // this, un-closing left dayClosingUpdatedAt pointing at whatever the last unrelated
  // sales-figure save happened to be — a stale timestamp that could lose a last-write-wins
  // merge (see mergeDayClosingStatesMap) against a different device's stale cached "closed"
  // state, silently reviving a day the user had just un-closed.
  const closingPayload = {
    is_day_closed: Boolean(isClosed),
    closed_at: isClosed ? new Date().toISOString() : null,
    closed_by: isClosed ? (userId || null) : null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  try {
    if (entry) {
      // created_by is included so RLS's insert path (which requires created_by = the acting
      // user for non-admin roles) can succeed if this is the first time the row is written —
      // on an existing row this does mean the original creator gets overwritten by whoever
      // closes the day, a minor audit-trail tradeoff accepted in exchange for day-closing
      // never silently failing because the row didn't already exist.
      const payload = {
        company_id: companyId,
        store_id: storeId,
        business_date: businessDate,
        sales_amount: Number(entry.totalSales || 0),
        technical_sales_amount: Number(entry.technicalSales || 0),
        retail_sales_amount: Number(entry.retailSales || 0),
        other_sales_amount: Number(entry.otherSales || 0),
        customer_count: Number(entry.customers || 0),
        new_customer_count: Number(entry.newCustomers || 0),
        repeat_customer_count: Number(entry.repeatCustomers || 0),
        review_count: Number(entry.reviewCount || 0),
        memo: String(entry.memo || ""),
        created_by: userId,
        ...closingPayload,
      };
      const { data, error } = await supabase
        .from("daily_sales")
        .upsert(payload, { onConflict: "company_id,store_id,business_date" })
        .select()
        .single();
      if (error) throw error;
      return { ok: true, data };
    }

    const { data, error } = await supabase
      .from("daily_sales")
      .update(closingPayload)
      .eq("company_id", companyId)
      .eq("store_id", storeId)
      .eq("business_date", businessDate)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const notFound = new Error("対象の日次売上データが見つかりませんでした");
      logSupabaseError({ operation: "updateDailySalesClosingState", table: "daily_sales", userId, companyId, storeId, businessDate, error: notFound });
      return { ok: false, error: notFound };
    }
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "updateDailySalesClosingState", table: "daily_sales", userId, companyId, storeId, businessDate, error });
    return { ok: false, error };
  }
};

// Fetches every daily_sales row in [startDate, endDate] the current user can see (RLS
// scopes this to their company, and to their assigned stores unless they're a company/system
// admin) — used to rebuild dailyResults/dayClosingStates for every store at once, which is
// what both the selected store's daily entries and the cross-store ranking view need.
export const loadDailySalesForCompanyRange = async ({ companyId, startDate, endDate }) => {
  if (!isSupabaseConfigured || !companyId || !startDate || !endDate) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("daily_sales")
      .select("*")
      .eq("company_id", companyId)
      .gte("business_date", startDate)
      .lte("business_date", endDate);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadDailySalesForCompanyRange", table: "daily_sales", companyId, error });
    return { ok: false, error, data: [] };
  }
};

// 日計(現金/キャッシュレス/ポイント利用の内訳)。daily_sales(技術売上/店販売上/総売上)とは
// 完全に別テーブル・別の保存経路 — is_day_closed/closed_at/closed_byを一切扱わないため、
// この関数がdaily_salesの日締め状態を書き換えることは構造的に起こらない。
export const upsertDailyCashBreakdown = async ({ companyId, storeId, userId, businessDate, cashAmount, cashlessAmount, pointAmount }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId, userId, businessDate });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertDailyCashBreakdown", table: "daily_cash_breakdown", userId, companyId, storeId, businessDate, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }

  const payload = {
    company_id: companyId,
    store_id: storeId,
    business_date: businessDate,
    cash_amount: Number(cashAmount || 0),
    cashless_amount: Number(cashlessAmount || 0),
    point_amount: Number(pointAmount || 0),
    created_by: userId,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from("daily_cash_breakdown")
      .upsert(payload, { onConflict: "company_id,store_id,business_date" })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertDailyCashBreakdown", table: "daily_cash_breakdown", userId, companyId, storeId, businessDate, error });
    return { ok: false, error };
  }
};

// loadDailySalesForCompanyRangeと同じ範囲取得パターン — 日次入力画面の対象月+前2か月分を
// 一度に取得し、店舗ごとのdailyResultsと同じ要領でクライアント側にキャッシュする。
export const loadDailyCashBreakdownForCompanyRange = async ({ companyId, startDate, endDate }) => {
  if (!isSupabaseConfigured || !companyId || !startDate || !endDate) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("daily_cash_breakdown")
      .select("*")
      .eq("company_id", companyId)
      .gte("business_date", startDate)
      .lte("business_date", endDate);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadDailyCashBreakdownForCompanyRange", table: "daily_cash_breakdown", companyId, error });
    return { ok: false, error, data: [] };
  }
};

// まとめて入力(daily_batch_entries)。daily_salesとは完全に別テーブル・別の保存経路 —
// 未入力項目はnullのまま送る(Number(x || 0)にしない、これがdaily_sales側との決定的な
// 違い)。start_date基準で範囲取得する(end_dateは常に同一月内、DBのCHECK制約で保証済み)。
export const loadDailyBatchEntriesForCompanyRange = async ({ companyId, startDate, endDate }) => {
  if (!isSupabaseConfigured || !companyId || !startDate || !endDate) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("daily_batch_entries")
      .select("*")
      .eq("company_id", companyId)
      .gte("start_date", startDate)
      .lte("start_date", endDate);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadDailyBatchEntriesForCompanyRange", table: "daily_batch_entries", companyId, error });
    return { ok: false, error, data: [] };
  }
};

const buildDailyBatchEntryRow = ({ companyId, storeId, entry }) => ({
  company_id: companyId,
  store_id: storeId,
  start_date: entry.startDate,
  end_date: entry.endDate,
  sales_amount: entry.totalSales,
  technical_sales_amount: entry.technicalSales,
  retail_sales_amount: entry.retailSales,
  other_sales_amount: entry.otherSales,
  customer_count: entry.customers,
  new_customer_count: entry.newCustomers,
  repeat_customer_count: entry.repeatCustomers,
  review_count: entry.reviewCount,
  cash_amount: entry.cashAmount,
  cashless_amount: entry.cashlessAmount,
  point_amount: entry.pointAmount,
  memo: entry.memo || null,
});

export const createDailyBatchEntry = async ({ companyId, storeId, userId, entry }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId, userId, startDate: entry?.startDate, endDate: entry?.endDate });
  if (validationError) {
    const detail = logSupabaseError({ operation: "createDailyBatchEntry", table: "daily_batch_entries", userId, companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  try {
    const { data, error } = await supabase
      .from("daily_batch_entries")
      .insert({ ...buildDailyBatchEntryRow({ companyId, storeId, entry }), created_by: userId, updated_by: userId })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "createDailyBatchEntry", table: "daily_batch_entries", userId, companyId, storeId, error });
    return { ok: false, error };
  }
};

export const updateDailyBatchEntry = async ({ id, companyId, storeId, userId, entry }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ id, companyId, storeId, userId, startDate: entry?.startDate, endDate: entry?.endDate });
  if (validationError) {
    const detail = logSupabaseError({ operation: "updateDailyBatchEntry", table: "daily_batch_entries", userId, companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  try {
    const { data, error } = await supabase
      .from("daily_batch_entries")
      .update({ ...buildDailyBatchEntryRow({ companyId, storeId, entry }), updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "updateDailyBatchEntry", table: "daily_batch_entries", userId, companyId, storeId, error });
    return { ok: false, error };
  }
};

export const deleteDailyBatchEntry = async ({ id }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ id });
  if (validationError) {
    const detail = logSupabaseError({ operation: "deleteDailyBatchEntry", table: "daily_batch_entries", error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  try {
    const { error } = await supabase.from("daily_batch_entries").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    logSupabaseError({ operation: "deleteDailyBatchEntry", table: "daily_batch_entries", error });
    return { ok: false, error };
  }
};

// monthly_closings already existed in the schema (company-scoped RLS included) but the app's
// month-closing toggle never actually wrote to it — it only lived in the tenant_snapshots
// blob. This makes it a real per (company_id, store_id, year_month) row.
export const upsertMonthlyClosingState = async ({ companyId, storeId, yearMonth, userId, isClosed }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId, targetMonth: yearMonth });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertMonthlyClosingState", table: "monthly_closings", userId, companyId, storeId, targetMonth: yearMonth, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }

  const payload = {
    company_id: companyId,
    store_id: storeId,
    year_month: yearMonth,
    is_closed: Boolean(isClosed),
    closed_by: isClosed ? (userId || null) : null,
    closed_at: isClosed ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from("monthly_closings")
      .upsert(payload, { onConflict: "company_id,store_id,year_month" })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertMonthlyClosingState", table: "monthly_closings", userId, companyId, storeId, targetMonth: yearMonth, error });
    return { ok: false, error };
  }
};

// Fetches every store's monthly_closings row across the given months in one call, mirroring
// loadDailySalesForCompanyRange — used so the month-closing badge is correct on a fresh
// device/session instead of only reflecting whatever happened to be in the tenant_snapshots
// blob.
export const loadMonthlyClosingsForCompany = async ({ companyId, yearMonths = [] }) => {
  if (!isSupabaseConfigured || !companyId || !yearMonths.length) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("monthly_closings")
      .select("*")
      .eq("company_id", companyId)
      .in("year_month", yearMonths);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadMonthlyClosingsForCompany", table: "monthly_closings", companyId, error });
    return { ok: false, error, data: [] };
  }
};

export const upsertMonthlyTargetToSupabase = async ({ companyId, storeId, targetMonth, userId, target }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId, userId, targetMonth });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertMonthlyTargetToSupabase", table: "monthly_targets", userId, companyId, storeId, targetMonth, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }

  const payload = {
    company_id: companyId,
    store_id: storeId,
    target_month: targetMonth,
    target_sales: Number(target?.targetSales || 0),
    target_technical_sales: Number(target?.targetTechnicalSales || 0),
    target_retail_sales: Number(target?.targetRetailSales || 0),
    target_customers: Number(target?.targetCustomers || 0),
    target_average_spend: Number(target?.targetAverageSpend || 0),
    target_new_customers: Number(target?.targetNewCustomers || 0),
    target_repeat_customers: Number(target?.targetRepeatCustomers || 0),
    target_repeat_rate: Number(target?.targetRepeatRate || 0),
    target_average_customers_per_day: Number(target?.targetAverageCustomersPerDay || 0),
    target_labor_rate: Number(target?.targetLaborRate || 0),
    target_material_rate: Number(target?.targetMaterialRate || 0),
    target_ad_rate: Number(target?.targetAdRate || 0),
    target_operating_margin: Number(target?.targetOperatingMargin || 0),
    target_review_count: Number(target?.targetReviewCount || 0),
    business_day_mode: String(target?.businessDayMode || ""),
    business_day_count: Number(target?.businessDayCount || 0),
    holiday_count: Number(target?.holidayCount || 0),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from("monthly_targets")
      .upsert(payload, { onConflict: "company_id,store_id,target_month" })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertMonthlyTargetToSupabase", table: "monthly_targets", userId, companyId, storeId, targetMonth, error });
    return { ok: false, error };
  }
};

// company_all_stores_targets (「全店舗」company_admin専用の集計ビュー用の目標/営業日設定) —
// store_idを持たず company_id + target_month で一意。実績データはここには保存しない
// (実績は各店舗のdaily_salesから都度集計する。calculateAllStoresMonthSummary参照)。
export const loadAllStoresTargetsForCompany = async ({ companyId, yearMonths = [] }) => {
  if (!isSupabaseConfigured || !companyId || !yearMonths.length) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("company_all_stores_targets")
      .select("*")
      .eq("company_id", companyId)
      .in("target_month", yearMonths);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadAllStoresTargetsForCompany", table: "company_all_stores_targets", companyId, error });
    return { ok: false, error, data: [] };
  }
};

export const loadAllStoresTargetFromSupabase = async ({ companyId, targetMonth }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true, data: null };
  if (!companyId || !targetMonth) return { ok: true, skipped: true, data: null };
  try {
    const { data, error } = await supabase
      .from("company_all_stores_targets")
      .select("*")
      .eq("company_id", companyId)
      .eq("target_month", targetMonth)
      .maybeSingle();
    if (error) throw error;
    return { ok: true, data: data || null };
  } catch (error) {
    logSupabaseError({ operation: "loadAllStoresTargetFromSupabase", table: "company_all_stores_targets", companyId, targetMonth, error });
    return { ok: false, error, data: null };
  }
};

export const upsertAllStoresTargetToSupabase = async ({ companyId, targetMonth, userId, target }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, userId, targetMonth });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertAllStoresTargetToSupabase", table: "company_all_stores_targets", userId, companyId, targetMonth, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }

  const payload = {
    company_id: companyId,
    target_month: targetMonth,
    target_sales: Number(target?.targetSales || 0),
    target_technical_sales: Number(target?.targetTechnicalSales || 0),
    target_retail_sales: Number(target?.targetRetailSales || 0),
    target_customers: Number(target?.targetCustomers || 0),
    target_average_spend: Number(target?.targetAverageSpend || 0),
    target_new_customers: Number(target?.targetNewCustomers || 0),
    target_repeat_customers: Number(target?.targetRepeatCustomers || 0),
    target_review_count: Number(target?.targetReviewCount || 0),
    business_day_mode: String(target?.businessDayMode || ""),
    business_day_count: Number(target?.businessDayCount || 0),
    holiday_count: Number(target?.holidayCount || 0),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from("company_all_stores_targets")
      .upsert(payload, { onConflict: "company_id,target_month" })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertAllStoresTargetToSupabase", table: "company_all_stores_targets", userId, companyId, targetMonth, error });
    return { ok: false, error };
  }
};

// store_business_holidays / company_all_stores_holidays — 店休日を「日数」ではなく具体的な
// 日付で管理する。1日=1行(company_id/store_id/holiday_dateで一意)。トグル操作は呼び出し側
// (App.jsx)が既存行の有無を見てupsert/deleteを使い分ける。
export const loadStoreHolidaysForCompanyRange = async ({ companyId, startDate, endDate }) => {
  if (!isSupabaseConfigured || !companyId || !startDate || !endDate) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("store_business_holidays")
      .select("*")
      .eq("company_id", companyId)
      .gte("holiday_date", startDate)
      .lte("holiday_date", endDate);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadStoreHolidaysForCompanyRange", table: "store_business_holidays", companyId, error });
    return { ok: false, error, data: [] };
  }
};

export const upsertStoreHolidayToSupabase = async ({ companyId, storeId, holidayDate, userId }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId, userId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertStoreHolidayToSupabase", table: "store_business_holidays", userId, companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  try {
    const { data, error } = await supabase
      .from("store_business_holidays")
      .upsert({ company_id: companyId, store_id: storeId, holiday_date: holidayDate, created_by: userId }, { onConflict: "store_id,holiday_date" })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertStoreHolidayToSupabase", table: "store_business_holidays", userId, companyId, storeId, error });
    return { ok: false, error };
  }
};

export const deleteStoreHolidayFromSupabase = async ({ storeId, holidayDate }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  try {
    const { error } = await supabase.from("store_business_holidays").delete().eq("store_id", storeId).eq("holiday_date", holidayDate);
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    logSupabaseError({ operation: "deleteStoreHolidayFromSupabase", table: "store_business_holidays", storeId, error });
    return { ok: false, error };
  }
};

export const loadAllStoresHolidaysForCompanyRange = async ({ companyId, startDate, endDate }) => {
  if (!isSupabaseConfigured || !companyId || !startDate || !endDate) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("company_all_stores_holidays")
      .select("*")
      .eq("company_id", companyId)
      .gte("holiday_date", startDate)
      .lte("holiday_date", endDate);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadAllStoresHolidaysForCompanyRange", table: "company_all_stores_holidays", companyId, error });
    return { ok: false, error, data: [] };
  }
};

export const upsertAllStoresHolidayToSupabase = async ({ companyId, holidayDate, userId }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, userId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertAllStoresHolidayToSupabase", table: "company_all_stores_holidays", userId, companyId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  try {
    const { data, error } = await supabase
      .from("company_all_stores_holidays")
      .upsert({ company_id: companyId, holiday_date: holidayDate, created_by: userId }, { onConflict: "company_id,holiday_date" })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertAllStoresHolidayToSupabase", table: "company_all_stores_holidays", userId, companyId, error });
    return { ok: false, error };
  }
};

export const deleteAllStoresHolidayFromSupabase = async ({ companyId, holidayDate }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  try {
    const { error } = await supabase.from("company_all_stores_holidays").delete().eq("company_id", companyId).eq("holiday_date", holidayDate);
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    logSupabaseError({ operation: "deleteAllStoresHolidayFromSupabase", table: "company_all_stores_holidays", companyId, error });
    return { ok: false, error };
  }
};

// Fetches every store's monthly_targets rows across the given months in one call, mirroring
// loadMonthlyClosingsForCompany/loadDailySalesForCompanyRange. Without this, appState.targets
// was only ever populated by the 月間目標設定 panel's own per-visit fetch (for whichever
// store+month *that panel* happens to be showing, via its own independent targetSelectedMonth)
// — so anything else that reads a target (dashboard hero metrics, cross-store ranking) could
// see a store/month as "no target registered" simply because nobody had opened the target panel
// for it yet this session, not because no target was actually saved.
export const loadMonthlyTargetsForCompany = async ({ companyId, yearMonths = [] }) => {
  if (!isSupabaseConfigured || !companyId || !yearMonths.length) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("monthly_targets")
      .select("*")
      .eq("company_id", companyId)
      .in("target_month", yearMonths);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadMonthlyTargetsForCompany", table: "monthly_targets", companyId, error });
    return { ok: false, error, data: [] };
  }
};

export const loadMonthlyTargetFromSupabase = async ({ companyId, storeId, targetMonth }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true, data: null };
  if (!companyId || !storeId || !targetMonth) return { ok: true, skipped: true, data: null };

  try {
    const { data, error } = await supabase
      .from("monthly_targets")
      .select("*")
      .eq("company_id", companyId)
      .eq("store_id", storeId)
      .eq("target_month", targetMonth)
      .maybeSingle();
    if (error) throw error;
    return { ok: true, data: data || null };
  } catch (error) {
    logSupabaseError({ operation: "loadMonthlyTargetFromSupabase", table: "monthly_targets", companyId, storeId, targetMonth, error });
    return { ok: false, error, data: null };
  }
};

// fixed_costs has no month-window fetch (unlike monthly_targets/monthly_closings): a
// "翌月以降も継続" item must stay visible however many months after it was first entered, so a
// fresh device/session needs every row for the company, not just a recent slice — the list per
// store is small enough in practice that this is cheap.
export const loadFixedCostsForCompany = async ({ companyId }) => {
  if (!isSupabaseConfigured || !companyId) return { ok: true, skipped: true, data: [] };
  try {
    // ORDER BY無しだとPostgreSQLの行の物理順序(UPDATE等で変わり得る)に依存し、同じ内容でも
    // 取得のたびに配列の並びが変わり得る(「金額を変更した項目が一覧の一番下へ移動する」
    // 不具合の原因)。sort_orderを一次キーにして、同値の場合はcreated_atで安定させる。
    const { data, error } = await supabase
      .from("fixed_costs")
      .select("*")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadFixedCostsForCompany", table: "fixed_costs", companyId, error });
    return { ok: false, error, data: [] };
  }
};

// store_status_audit_log — 店舗の停止/再開/アーカイブ/復元/削除の履歴(update-store-status・
// delete-storeの各Edge Functionがservice-role経由でのみ書き込む、クライアントからは読み取り
// 専用)。全店舗カレンダーの完了判定が「今のstores.statusだけ」ではなく「その日付時点で
// 本当に営業対象だったか」を判定できるようにするために使う(storage.jsのgetStoreStatusAsOfDate
// 参照)。fixed_costsと同じ理由で月ウィンドウを設けず会社全体を丸ごと取得する — 店舗の生涯で
// 数件程度しか増えない、極めて小さいテーブルのため。
export const loadStoreStatusAuditLogForCompany = async ({ companyId }) => {
  if (!isSupabaseConfigured || !companyId) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("store_status_audit_log")
      .select("store_id, action, created_at")
      .eq("company_id", companyId)
      // ORDER BY無しだとPostgreSQLの行の物理順序(UPDATE等で変わり得る)に依存し、同じ内容でも
      // 取得のたびに配列の並びが変わり得る。これ自体は「更新中」無限点滅バグの根本原因では
      // 無くなった(比較側をcanonicalStringifyForComparisonで並び順非依存にしたため)が、念の為
      // ここでも決定的な順序にしておく。
      .order("created_at", { ascending: true });
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadStoreStatusAuditLogForCompany", table: "store_status_audit_log", companyId, error });
    return { ok: false, error, data: [] };
  }
};

// monthly_reviews — 月次レビュー(利益管理ではない自由記述4項目)。fixed_costsと同じ理由で
// 月ウィンドウを設けず会社全体を丸ごと取得する——対象月を過去へ切り替えても(直近3か月の
// ウィンドウの外でも)保存済みの文章が正しく復元される必要があるため(要件6)。件数も
// 「会社の店舗数×これまでの月数」程度で小さく、無制限取得のコストは無視できる。
export const loadMonthlyReviewsForCompany = async ({ companyId }) => {
  if (!isSupabaseConfigured || !companyId) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("monthly_reviews")
      .select("id, company_id, store_id, target_month, reflection, challenges, improvements, next_actions, updated_at")
      .eq("company_id", companyId)
      .order("target_month", { ascending: true });
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadMonthlyReviewsForCompany", table: "monthly_reviews", companyId, error });
    return { ok: false, error, data: [] };
  }
};

// 一意制約が店舗ごと/全店舗ごとで別々の部分ユニークインデックス(store_id is not null /
// store_id is null)になっている(migration参照、store_idがnullを許容するため通常の
// unique(company_id, store_id, target_month)だけでは全店舗レビューの重複防止にならない)。
// PostgreSQLのON CONFLICTで部分インデックスを対象にするにはWHERE述語の指定が必要で、
// PostgRESTのupsert(onConflict=列名のみ)経由では正しく推論できない可能性があるため、
// ON CONFLICTに頼らず「まずUPDATEを試し、対象行が無ければINSERTする」方式にする——
// 通常のUPDATE/INSERTだけで完結するため、部分インデックスの推論に依存しない分確実。
// このテーブルへの同時書き込みは同一store×同一月の自動保存デバウンス程度で、競合insert
// (=同時に初回保存)が起きても、後勝ちのINSERTがユニーク制約違反で失敗するだけなので、
// その場合だけ改めてUPDATEを試す。
export const upsertMonthlyReview = async ({ companyId, storeId, targetMonth, userId, fields }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, targetMonth, userId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertMonthlyReview", table: "monthly_reviews", userId, companyId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  const editableFields = {
    reflection: String(fields?.reflection || ""),
    challenges: String(fields?.challenges || ""),
    improvements: String(fields?.improvements || ""),
    next_actions: String(fields?.next_actions || ""),
    updated_by: userId,
  };
  const selectColumns = "id, company_id, store_id, target_month, reflection, challenges, improvements, next_actions, updated_at";
  const scopeQuery = (query) => (storeId ? query.eq("store_id", storeId) : query.is("store_id", null));
  try {
    const { data: updatedRow, error: updateError } = await scopeQuery(
      supabase.from("monthly_reviews").update(editableFields).eq("company_id", companyId).eq("target_month", targetMonth)
    ).select(selectColumns).maybeSingle();
    if (updateError) throw updateError;
    if (updatedRow) return { ok: true, data: updatedRow };

    const { data: insertedRow, error: insertError } = await supabase
      .from("monthly_reviews")
      .insert({ company_id: companyId, store_id: storeId || null, target_month: targetMonth, ...editableFields, created_by: userId })
      .select(selectColumns)
      .single();
    if (insertError) {
      // 同時初回保存で先にINSERTされていた場合(ユニーク制約違反、23505)だけ、改めてUPDATEを
      // 試す。それ以外のエラーはそのまま投げる。
      if (insertError.code === "23505") {
        const { data: retryRow, error: retryError } = await scopeQuery(
          supabase.from("monthly_reviews").update(editableFields).eq("company_id", companyId).eq("target_month", targetMonth)
        ).select(selectColumns).maybeSingle();
        if (retryError) throw retryError;
        if (retryRow) return { ok: true, data: retryRow };
      }
      throw insertError;
    }
    return { ok: true, data: insertedRow };
  } catch (error) {
    logSupabaseError({ operation: "upsertMonthlyReview", table: "monthly_reviews", userId, companyId, storeId, error });
    return { ok: false, error };
  }
};

export const upsertFixedCostToSupabase = async ({ id, companyId, storeId, entryMonth, userId, item }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ id, companyId, storeId, entryMonth, userId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertFixedCostToSupabase", table: "fixed_costs", userId, companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }

  const payload = {
    id,
    company_id: companyId,
    store_id: storeId,
    entry_month: entryMonth,
    name: String(item?.name || ""),
    category: String(item?.category || ""),
    category_key: String(item?.categoryKey || "uncategorized"),
    memo: String(item?.memo || ""),
    period_type: item?.periodType === "limited" ? "limited" : "ongoing",
    start_month: String(item?.startMonth || ""),
    end_month: String(item?.endMonth || ""),
    // 継続費用の基本値(要件1)。単月・期間限定費用には概念が無いため0のまま(呼び出し側の
    // App.jsxもongoing以外では0を渡す)。既存のcost_monthly_amounts(月別上書き値)には
    // 一切触れない——このupsertは項目マスターの更新のみを行う。
    base_amount: Number(item?.baseAmount || 0),
    // 表示順序(要件7・8・9)。呼び出し側が現在のsort_orderをそのまま渡す限り、名前/カテゴリ/
    // 金額の編集だけでは並び順は変わらない。並び替え自体はreorderFixedCostsInSupabase経由の
    // 別経路で行う(要件9: 金額変更・並び替え・項目編集を混同しない)。
    sort_order: Number.isFinite(item?.sortOrder) ? item.sortOrder : 0,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from("fixed_costs")
      .upsert(payload, { onConflict: "id" })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertFixedCostToSupabase", table: "fixed_costs", userId, companyId, storeId, error });
    return { ok: false, error };
  }
};

// 固定費一覧の並び替え(要件7・8・9)。金額・項目編集とは完全に別経路——sort_orderだけを
// 個別にupdateし、他のカラム(名前・金額・カテゴリ等)には一切触れない。1件ずつのupdateに
// するのは、upsertで一部カラムだけの配列を送ると欠けたNOT NULL列を意図せず上書きしてしまう
// リスクを避けるため(項目数は店舗ごとに数件〜数十件程度で、並び替えは低頻度の操作のため
// 複数リクエストでも実用上問題ない)。
export const reorderFixedCostsInSupabase = async ({ updates }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  if (!Array.isArray(updates) || updates.length === 0) return { ok: true, skipped: true };
  try {
    const results = await Promise.all(
      updates.map(({ id, sortOrder }) => supabase.from("fixed_costs").update({ sort_order: sortOrder }).eq("id", id))
    );
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;
    return { ok: true };
  } catch (error) {
    logSupabaseError({ operation: "reorderFixedCostsInSupabase", table: "fixed_costs", error });
    return { ok: false, error };
  }
};

export const deleteFixedCostFromSupabase = async ({ id }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  if (!id) return { ok: true, skipped: true };
  try {
    const { error } = await supabase.from("fixed_costs").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    logSupabaseError({ operation: "deleteFixedCostFromSupabase", table: "fixed_costs", id, error });
    return { ok: false, error };
  }
};

// cost_monthly_amounts — the per-month amount for a fixed_costs item. For an "ongoing" item this
// is a pure single-month override (no carry-forward — the fallback for months with no exact row
// is the item's own fixed_costs.base_amount, see storage.js's getCostMonthlyAmount). "limited"
// (単月・期間限定) items keep the older carry-forward-within-window behavior unchanged. Windowed
// the same way variable_costs/monthly_closings are below (current + recent months), since the
// monthly cost-entry screen and P&L only ever need a small recent window, not full history.
// No `id` param: the (cost_item_id, target_month) unique constraint is what upsert conflicts on,
// so the row's own id is irrelevant here — letting Postgres assign/keep it avoids any risk of a
// stale locally-cached id mismatching the actual row.
export const upsertCostMonthlyAmountToSupabase = async ({ costItemId, companyId, storeId, targetMonth, amount, userId }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ costItemId, companyId, storeId, targetMonth, userId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertCostMonthlyAmountToSupabase", table: "cost_monthly_amounts", userId, companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }

  const payload = {
    cost_item_id: costItemId,
    company_id: companyId,
    store_id: storeId,
    target_month: targetMonth,
    amount: Number(amount || 0),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from("cost_monthly_amounts")
      .upsert(payload, { onConflict: "cost_item_id,target_month" })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertCostMonthlyAmountToSupabase", table: "cost_monthly_amounts", userId, companyId, storeId, error });
    return { ok: false, error };
  }
};

// 「今月の反映を解除」用。対象月ちょうどの行だけを削除する——費用項目(fixed_costs)自体や
// 他の月のcost_monthly_amounts行には一切触れない(2026-09仕様: 費用項目そのものと、その月の
// 反映実績を明確に分離する設計の一部)。
export const deleteCostMonthlyAmountFromSupabase = async ({ costItemId, targetMonth }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  if (!costItemId || !targetMonth) return { ok: true, skipped: true };
  try {
    const { error } = await supabase
      .from("cost_monthly_amounts")
      .delete()
      .eq("cost_item_id", costItemId)
      .eq("target_month", targetMonth);
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    logSupabaseError({ operation: "deleteCostMonthlyAmountFromSupabase", table: "cost_monthly_amounts", costItemId, targetMonth, error });
    return { ok: false, error };
  }
};

// 継続費用は「その月から有効になる金額」を履歴として持ち、対象月に直接一致する行が無ければ
// 対象月以前で最も新しい行の金額を引き継ぐ(getCostMonthlyAmount参照、費用入力の金額引き継ぎ
// 仕様)。この「以前の履歴」は現在月から見て3か月より前の場合もあるため、fixed_costsと同じ
// 理由でyearMonthsによる絞り込みはできない — 会社の全cost_monthly_amountsを取得する
// (件数は「費用項目数 × これまでに金額変更した回数」程度で、fixed_costsと同様に小さい)。
export const loadCostMonthlyAmountsForCompany = async ({ companyId }) => {
  if (!isSupabaseConfigured || !companyId) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("cost_monthly_amounts")
      .select("*")
      .eq("company_id", companyId);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadCostMonthlyAmountsForCompany", table: "cost_monthly_amounts", companyId, error });
    return { ok: false, error, data: [] };
  }
};

// store_inventory_balances — the 月末在庫 amount for a store, per target month. "期首在庫" is
// saved the same way, just under the month before tracking started (see storage.js's
// getPreviousMonthInventoryBalance). No `id` param: (store_id, target_month) is the unique
// constraint the upsert conflicts on, matching upsertCostMonthlyAmountToSupabase's reasoning.
export const upsertStoreInventoryBalanceToSupabase = async ({ companyId, storeId, targetMonth, amount, userId }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId, targetMonth, userId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertStoreInventoryBalanceToSupabase", table: "store_inventory_balances", userId, companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }

  const payload = {
    company_id: companyId,
    store_id: storeId,
    target_month: targetMonth,
    closing_amount: Number(amount || 0),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from("store_inventory_balances")
      .upsert(payload, { onConflict: "store_id,target_month" })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertStoreInventoryBalanceToSupabase", table: "store_inventory_balances", userId, companyId, storeId, error });
    return { ok: false, error };
  }
};

export const loadStoreInventoryBalancesForCompany = async ({ companyId, yearMonths = [] }) => {
  if (!isSupabaseConfigured || !companyId || !yearMonths.length) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("store_inventory_balances")
      .select("*")
      .eq("company_id", companyId)
      .in("target_month", yearMonths);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadStoreInventoryBalancesForCompany", table: "store_inventory_balances", companyId, error });
    return { ok: false, error, data: [] };
  }
};

// variable_costs (販管費) — direct month lookup, no carry-forward, so unlike fixed_costs this
// can safely be windowed the same way monthly_targets/monthly_closings are (current + recent
// months) rather than fetched unbounded for the whole company.
export const loadVariableCostsForCompany = async ({ companyId, yearMonths = [] }) => {
  if (!isSupabaseConfigured || !companyId || !yearMonths.length) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("variable_costs")
      .select("*")
      .eq("company_id", companyId)
      .in("target_month", yearMonths);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadVariableCostsForCompany", table: "variable_costs", companyId, error });
    return { ok: false, error, data: [] };
  }
};

// monthly_closing_items (月締め項目) — 読み取り専用。人件費・発注費用の新規入力は費用入力
// タブ(fixed_costs)へ一本化したため、この表への書き込み関数(upsert/delete)は廃止した。
// 過去に登録済みのデータは削除せず、calculateMonthSummaryが引き続き集計に使う。
export const loadMonthlyClosingItemsForCompany = async ({ companyId, yearMonths = [] }) => {
  if (!isSupabaseConfigured || !companyId || !yearMonths.length) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase
      .from("monthly_closing_items")
      .select("*")
      .eq("company_id", companyId)
      .in("target_month", yearMonths);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadMonthlyClosingItemsForCompany", table: "monthly_closing_items", companyId, error });
    return { ok: false, error, data: [] };
  }
};

// company_settings — one row per company (business type, currency, display prefs, tax
// settings, the global showOtherSales toggle). Fetched company-wide (single row) alongside
// companies/stores in loadTenantStateFromSupabase's caller, not windowed by month.
export const loadCompanySettings = async ({ companyId }) => {
  if (!isSupabaseConfigured || !companyId) return { ok: true, skipped: true, data: null };
  try {
    const { data, error } = await supabase.from("company_settings").select("*").eq("company_id", companyId).maybeSingle();
    if (error) throw error;
    return { ok: true, data: data || null };
  } catch (error) {
    logSupabaseError({ operation: "loadCompanySettings", table: "company_settings", companyId, error });
    return { ok: false, error, data: null };
  }
};

export const upsertCompanySettings = async ({ companyId, userId, settings, taxSettings, showOtherSales }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, userId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertCompanySettings", table: "company_settings", userId, companyId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  const payload = {
    company_id: companyId,
    business_type: String(settings?.businessType || "salon"),
    currency: String(settings?.currency || "JPY"),
    fiscal_year_start_month: String(settings?.fiscalYearStartMonth || "1"),
    sales_display_mode: String(settings?.salesDisplayMode || "inclusive"),
    retail_sales_label: String(settings?.retailSalesLabel || "店販売上"),
    closing_day: String(settings?.closingDay || "月末"),
    edit_deadline_days: Number(settings?.editDeadlineDays ?? 7),
    allow_staff_past_edit: Boolean(settings?.allowStaffPastEdit),
    visible_sales_fields: Array.isArray(settings?.visibleSalesFields) ? settings.visibleSalesFields : ["technicalSales", "retailSales", "otherSales"],
    active_kpis: Array.isArray(settings?.activeKpis) ? settings.activeKpis : ["sales", "customers", "retailRatio"],
    show_other_sales: Boolean(showOtherSales),
    tax_rate: Number(taxSettings?.rate ?? 0.1),
    tax_rounding_mode: String(taxSettings?.roundingMode || "half-up"),
    tax_sales_input_mode: String(taxSettings?.salesInputMode || "inclusive"),
    tax_expense_input_mode: String(taxSettings?.expenseInputMode || "inclusive"),
    consider_consumption_tax: Boolean(taxSettings?.considerConsumptionTax),
    consumption_tax_reserve_rate: Number(taxSettings?.consumptionTaxReserveRate ?? 0),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await supabase.from("company_settings").upsert(payload, { onConflict: "company_id" }).select().single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertCompanySettings", table: "company_settings", userId, companyId, error });
    return { ok: false, error };
  }
};

// store_profiles — one row per store (address/phone/manager/representative/hours/description/
// URLs/etc), keyed by store_id so a rename can never orphan a profile.
export const loadStoreProfilesForCompany = async ({ companyId }) => {
  if (!isSupabaseConfigured || !companyId) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase.from("store_profiles").select("*").eq("company_id", companyId);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadStoreProfilesForCompany", table: "store_profiles", companyId, error });
    return { ok: false, error, data: [] };
  }
};

export const upsertStoreProfile = async ({ companyId, storeId, userId, profile }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId, userId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertStoreProfile", table: "store_profiles", userId, companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  const serviceTypesArray = Array.isArray(profile?.serviceTypes)
    ? profile.serviceTypes
    : String(profile?.serviceTypes || "").split(",").map((item) => item.trim()).filter(Boolean);
  const payload = {
    store_id: storeId,
    company_id: companyId,
    postal_code: String(profile?.postalCode || ""),
    address: String(profile?.address || ""),
    phone: String(profile?.phone || ""),
    manager_name: String(profile?.managerName || ""),
    representative_name: String(profile?.representativeName || ""),
    opening_date: String(profile?.openingDate || ""),
    opening_hour: String(profile?.openingHour || "09:00"),
    closing_hour: String(profile?.closingHour || "20:00"),
    closed_days: String(profile?.closedDays || ""),
    business_hours: String(profile?.businessHours || ""),
    description: String(profile?.description || ""),
    website: String(profile?.website || ""),
    instagram: String(profile?.instagram || ""),
    google_map_url: String(profile?.googleMapUrl || ""),
    service_types: serviceTypesArray,
    urls: Array.isArray(profile?.urls) ? profile.urls : [],
    status: String(profile?.status || "active"),
    staff_count: Number(profile?.staffCount) || 0,
    productivity_staff_count: Number(profile?.productivityStaffCount) || 0,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await supabase.from("store_profiles").upsert(payload, { onConflict: "store_id" }).select().single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertStoreProfile", table: "store_profiles", userId, companyId, storeId, error });
    return { ok: false, error };
  }
};

// 初期設定チェックリストの恒久的な完了フラグを立てるだけの、最小限の専用関数(不具合修正:
// 過去月へ切り替えるとチェックリストが再表示されていた問題)。upsertStoreProfileを流用
// しない理由: あちらはprofile全体(住所・電話番号等)を送るフル更新のため、呼び出し側が
// その時点でフルのprofile値を持っていない場合(このフラグはApp.jsx側の副作用的なチェックで
// 立てるだけなので、フォーム編集中とは限らない)に他のプロフィール項目を意図せず空文字で
// 上書きしてしまうリスクがある。ここではinitial_setup_completedの1列だけをUPDATEする——
// 呼び出し時点でstore_profiles行は既に存在している前提(hydrateFromSupabase側で
// initialSetupCompletedを読めている=行が存在する、という前提と一致)。
export const markStoreInitialSetupCompleted = async ({ companyId, storeId, userId }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId, userId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "markStoreInitialSetupCompleted", table: "store_profiles", userId, companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  try {
    const { data, error } = await supabase
      .from("store_profiles")
      .update({ initial_setup_completed: true, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("store_id", storeId)
      .eq("company_id", companyId)
      .select("initial_setup_completed")
      .maybeSingle();
    if (error) throw error;
    // 行が無い(=まだ一度もstore_profilesへ保存したことが無い、極めて初期の店舗)場合は
    // 静かにskip扱いにする——このフラグの唯一の目的は「チェックリストの再表示防止」であり、
    // 行を新規作成してまで急いで立てる必要は無い(次にstore_profilesへ何か保存された時点で
    // 行ができ、その後改めてこの関数が成功するようになる)。
    if (!data) return { ok: true, skipped: true };
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "markStoreInitialSetupCompleted", table: "store_profiles", userId, companyId, storeId, error });
    return { ok: false, error };
  }
};

// βテスト用「不具合・改善要望」送信(要件8)。使い方・FAQ画面付近の目立たない導線から呼ぶ。
// 送信専用(閲覧UIは提供しない、RLSもsystem_adminのみSELECT可)——失敗してもUIをブロックせず、
// 呼び出し元がエラー文言を出す前提でok:falseを返すだけにする。
export const submitBetaFeedback = async ({ companyId = null, storeId = null, userId, screen = "", situation = "", whatHappened = "", freeText = "", appVersion = "" }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  if (!userId) return { ok: false, error: new Error("ユーザー情報を確認できませんでした") };
  try {
    const { error } = await supabase.from("beta_feedback").insert({
      company_id: companyId || null,
      store_id: storeId || null,
      created_by: userId,
      screen,
      situation,
      what_happened: whatHappened,
      free_text: freeText,
      app_version: appVersion,
    });
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    logSupabaseError({ operation: "submitBetaFeedback", table: "beta_feedback", userId, companyId, storeId, error });
    return { ok: false, error };
  }
};

// ヘルプ・お問い合わせ(2026-09追加)。使い方の質問はFAQへ誘導し、ここは不具合・表示異常・
// 契約/料金・その他に限定した正式な問い合わせフォームからのみ呼ばれる。DB書き込み・メール送信は
// すべてsubmit-support-inquiry Edge Function(service role)側で行う——このファイルからは
// 直接テーブルへ書き込まない(company_id/氏名/メールアドレス等をクライアントに信用させない
// ため、create-checkout-session等と同じ設計)。

export const SUPPORT_ATTACHMENT_MAX_COUNT = 3;
export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
// iPhoneから一般的に送信される画像形式(HEIC/HEIF)も可能な範囲で受け付ける(要件7)。
export const SUPPORT_ATTACHMENT_ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];

const SUPPORT_ATTACHMENTS_BUCKET = "support-attachments";

const guessExtensionFromMimeType = (mimeType) => {
  const map = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };
  return map[mimeType] || "bin";
};

// 添付画像を1枚、support-attachments private bucketへ直接アップロードする。元のファイル名は
// 一切使わず(要件9)、ランダムUUIDのファイル名を生成する。パスの先頭をcompanyIdにすることで、
// storage.objects側のRLS(20260911000000_support_inquiries.sql)が自社のパスだけを許可する。
export const uploadSupportInquiryAttachment = async ({ companyId, inquiryId, file }) => {
  if (!isSupabaseConfigured) return { ok: false, error: new Error("Supabaseが設定されていません") };
  if (!companyId || !inquiryId || !file) return { ok: false, error: new Error("添付に必要な情報が不足しています") };
  const path = `${companyId}/${inquiryId}/${crypto.randomUUID()}.${guessExtensionFromMimeType(file.type)}`;
  try {
    const { error } = await supabase.storage.from(SUPPORT_ATTACHMENTS_BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (error) throw error;
    return { ok: true, path };
  } catch (error) {
    logSupabaseError({ operation: "uploadSupportInquiryAttachment", table: "storage:support-attachments", companyId, error });
    return { ok: false, error };
  }
};

// 問い合わせ本体の送信。inquiryIdは呼び出し元(FaqPage.jsx)が一度だけ生成し、通信失敗時の
// 再試行でも同じidを使い回すことで、Edge Function側のidempotency(同じidの2回目以降は
// 何もしない)により二重送信を防ぐ(要件18)。
export const submitSupportInquiry = async ({ inquiryId, category, message, storeId = "", currentPage = "", targetMonth = "", currentUrl = "", attachmentPaths = [] }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("submit-support-inquiry", {
    body: { inquiryId, category, message, storeId, currentPage, targetMonth, currentUrl, attachmentPaths },
  });
  // send-invite-email等と同じパターン: 非2xxレスポンスはerror(FunctionsHttpError)側に来て、
  // 実際のJSON本文({error: "..."})はerror.context経由でしか読めない——data.errorだけを
  // 見ているとサーバー側のエラー文言(400/403/500)を取りこぼす。
  if (error) {
    let serverMessage = "";
    try {
      const body = await error.context?.json?.();
      serverMessage = body?.error || "";
    } catch {
      // ignore — fall back to error.message
    }
    logSupabaseError({ operation: "submitSupportInquiry", table: "support_inquiries", error });
    return { ok: false, error: new Error(serverMessage || error.message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, data };
};

// 障害調査用ログ(要件9)。売上金額・氏名・メールアドレス・認証トークン等の機密情報は
// 一切含めないこと——messageには構造化された非機密情報(operation/table/error code程度)
// だけを渡す(呼び出し元の責務、logSupabaseErrorから最小限の情報だけを転記する)。
// ベストエフォート専用: 失敗しても例外を投げず、呼び出し元の処理(実際のエラー表示等)を
// 一切妨げない。ログ自体の失敗をさらにログしようとする無限再帰も起こさない
// (catchの中では console.warn のみ、logSupabaseError は呼ばない)。
export const logClientDiagnostic = ({ companyId = null, storeId = null, userId = null, screen = "", actionType = "", errorType = "", message = "" } = {}) => {
  if (!isSupabaseConfigured) return;
  try {
    void supabase.from("client_diagnostic_logs").insert({
      company_id: companyId || null,
      store_id: storeId || null,
      user_id: userId || null,
      screen,
      action_type: actionType,
      error_type: errorType,
      message: String(message || "").slice(0, 500),
    }).then(({ error }) => {
      if (error) console.warn("[diagnostic-log] insert failed (non-fatal)", error.message);
    });
  } catch (error) {
    console.warn("[diagnostic-log] unexpected failure (non-fatal)", error);
  }
};
