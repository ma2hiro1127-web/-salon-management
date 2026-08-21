import { logSupabaseError, supabase } from "./supabase.js";
import { mergeRemoteAppState, normalizeAppState } from "./storage.js";

// tenant_snapshots is a legacy whole-appState cache/fallback, never the production source of
// truth for anything it embeds. Every domain that has its own dedicated table (companies,
// stores, profiles, user_stores, daily_sales, monthly_targets, monthly_closings,
// store_input_settings, fixed_costs, variable_costs, monthly_closing_items, company_settings,
// store_profiles) is fetched fresh from that table in hydrateFromSupabase (App.jsx) and always
// wins over whatever a stale snapshot's payload happens to contain — see the "never from this
// snapshot's embedded copy" comments throughout hydrateFromSupabase for the specific precedence
// each field follows. What a snapshot is still useful for: a fast first paint before those
// per-table fetches resolve, and an offline/degraded fallback if a fetch fails outright. It
// should never gain a new field that isn't also backed by a real table — if a new domain needs
// to persist reliably, it needs its own table the same way this session's fixes added one for
// fixed_costs/variable_costs/monthly_closing_items/company_settings/store_profiles, not a new
// reliance on this blob.
//
// statement timeout不具合の根本修正(buildTenantSnapshotRow参照): 以前はappStateを丸ごと
// このpayloadへコピーしており、上記の「各ドメインが自前のテーブルを持つ」設計に反して、
// 同じデータを二重に(日次データ等は日単位で増え続ける形で)保存していた。長期間使われた
// 会社では1行が3MBを超え、店舗切替のような些細な変更でもこのJSONを丸ごとUPDATEすることに
// なり、statement_timeoutへ到達していた。buildTenantSnapshotRowは現在、companies/users/
// 選択状態など「個別テーブルでカバーされない軽量な情報」だけをallowlist方式で書き込む
// ——このためloadLatestTenantSnapshot以下の「複数行をマージする」ロジックも、実質的には
// companies/usersの断片を補い合う程度の役割になっている(重いフィールドはどの行にも
// 含まれないため、マージしても増えない)。

const getEnvValue = (key) => {
  const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
  return env[key] || "";
};

export const isRemoteSupabaseAvailable = Boolean(getEnvValue("VITE_SUPABASE_URL") && getEnvValue("VITE_SUPABASE_ANON_KEY") && getEnvValue("VITE_SUPABASE_URL") !== "https://example.supabase.co");

const resolveProfileUserId = (user) => user?.profileId || user?.id || user?.email || "";
const resolveAuthUserId = (user) => user?.authUserId || user?.email || "";

const buildSnapshotId = ({ company, store, user, targetMonth }) => {
  const companyId = company?.id || "company";
  const storeId = store?.id || "store";
  const resolvedMonth = targetMonth || new Date().toISOString().slice(0, 7);
  return `${companyId}:${storeId}:${resolvedMonth}`;
};

// statement timeout不具合の根本修正(2026年、実運用で3.4MBに達した行が確認された):
// このpayloadは以前 `{...(appState || {})}` で丸ごとappStateをコピーしていたため、
// dailyResults/fixedCosts/targets等——いずれもdaily_sales/fixed_costs/monthly_targets等、
// 独自のSupabaseテーブルを持ち、hydrateFromSupabaseが毎回そこから直接取得し直すフィールド
// ——まで含めて、ここへ二重に保存していた。会社が長期間使われて日次データ・費用等が蓄積
// するほどこのJSONペイロードが肥大化し、店舗切替のような些細な変更のたびに数MBのJSONを
// UPDATEすることになり、Postgresのstatement_timeoutへ到達していた(実際に3,386,046バイトの
// 行を確認済み)。
//
// tenant_snapshotsはログイン直後の「取得完了前の暫定表示」「hydrateFromSupabase失敗時の
// 劣化フォールバック」専用であり(loadLatestTenantSnapshotの説明参照)、正式なデータは
// 常に個別テーブルが真実の情報源——このpayloadに含めるのは、それらのテーブルでは
// カバーされない軽量な選択状態・構造情報だけにする(allowlist方式。除外リストではなく
// 許可リストにすることで、将来appStateへ大きなフィールドが追加されても自動的にここへは
// 含まれない=同じ肥大化が再発しない)。
export const buildTenantSnapshotRow = ({ company, store, user, appState, targetMonth = null }) => {
  const resolvedMonth = targetMonth || appState?.selectedMonth || new Date().toISOString().slice(0, 7);
  const resolvedCompanyId = company?.id || appState?.currentCompanyId || "";
  const resolvedStoreId = store?.id || null;
  const resolvedUserId = resolveProfileUserId(user);
  const resolvedAuthUserId = resolveAuthUserId(user);
  const payload = {
    // 構造情報(companies/users): 各店舗のstore_profiles/store_input_settings由来の値も
    // 含む店舗一覧だが、これ自体は日次データのような日単位で増え続けるものではなく、
    // 店舗数に応じた緩やかなサイズに留まるため許容する——「ログイン直後、まだ何も取得
    // していない一瞬」に会社名・店舗一覧だけでも表示できることの価値の方が大きい。
    companies: appState?.companies || [],
    users: appState?.users || [],
    // 選択状態(すべて数十バイト程度の軽量な値)。
    stores: appState?.stores || [],
    selectedStore: store?.name || appState?.selectedStore || "",
    selectedStoreId: resolvedStoreId || appState?.selectedStoreId || "",
    selectedMonth: resolvedMonth,
    isViewingFranchise: Boolean(appState?.isViewingFranchise),
    homeCompanyIdBeforeFranchiseView: appState?.homeCompanyIdBeforeFranchiseView || "",
    preferences: appState?.preferences || {},
    taxSettings: appState?.taxSettings || {},
    currentCompanyId: resolvedCompanyId,
    currentUserId: resolvedUserId,
    currentAuthUserId: resolvedAuthUserId,
    // dailyResults/targets/fixedCosts/costMonthlyAmounts/storeInventoryBalances/
    // variableCosts/monthClosing/monthClosingStatus/storeHolidays/allStoresTargets/
    // allStoresBusinessDaySettings/allStoresHolidays/monthlyReviews/storeStatusAuditLog/
    // cashBreakdownResults/dailyBatchEntries/businessDaySettings/dayClosingStates/
    // dayClosingUpdatedAt/dailyResultBackups/companySnapshotsは意図的に含めない——上の
    // コメント参照。呼び出し元(hydrateFromSupabaseの「snapshotがある」分岐)はこれらの
    // キーが無いことを前提に、必ず個別テーブルの取得結果で埋める設計になっている。
  };

  return {
    id: buildSnapshotId({ company, store, user, targetMonth: resolvedMonth }),
    company_id: resolvedCompanyId || null,
    store_id: resolvedStoreId || null,
    target_month: resolvedMonth,
    created_by: resolvedUserId || null,
    updated_at: new Date().toISOString(),
    payload,
  };
};

const isMissingTableError = (error) => {
  const status = error?.message || "";
  return status.includes("does not exist") || status.includes("relation") || status.includes("schema cache");
};

export const upsertTenantSnapshot = async ({ company, store, user, appState, targetMonth = null, force = false } = {}) => {
  if (!isRemoteSupabaseAvailable || !company || !store || !user) return { ok: true, skipped: true };
  try {
    const row = buildTenantSnapshotRow({ company, store, user, appState, targetMonth });
    const { data, error } = await supabase.from("tenant_snapshots").upsert(row, { onConflict: "id" }).select().single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    if (!force && isMissingTableError(error)) {
      return { ok: true, skipped: true, error };
    }
    logSupabaseError({ operation: "upsertTenantSnapshot", table: "tenant_snapshots", userId: user?.id, companyId: company?.id, storeId: store?.id, targetMonth, error });
    return { ok: false, error };
  }
};

// Each row's payload embeds the *entire* multi-store app state as of whichever save wrote it
// (see buildTenantSnapshotRow) — but only reliably reflects the store(s) that were actually
// loaded into memory in that browser tab at the moment of that particular save, not every
// store the company has. A save made while viewing store B does not necessarily still carry
// store A's data in its payload (e.g. a fresh tab that never loaded store A yet). Picking only
// the single freshest row for the company+month therefore used to silently drop any store
// whose own most-recent save wasn't also the company's overall most-recent save — confirmed in
// production: a snapshot saved while viewing フィーネ横浜 had no 本店 key in its dailyResults at
// all, so fetching only that row made 本店's data disappear on any read that relied on it.
// Fetching every recent row and folding them together (oldest to newest, via the same
// mergeRemoteAppState used everywhere else) keeps each store's own latest known data instead
// of only whichever store happened to be saved most recently overall.
//
// Returns {ok, data, error} rather than a bare snapshot-or-null: a genuinely empty result
// ("no snapshot exists yet for this company/month") and a *failed* fetch (network blip, RLS
// denial, missing table) must never be treated the same way by the caller — collapsing them
// to null previously meant a transient fetch failure looked exactly like "you have no data",
// which is what let hydrateFromSupabase fall through to an empty/local-only state.
export const loadLatestTenantSnapshot = async ({ companyId, targetMonth, createdBy = null, allowOfflineFallback = false } = {}) => {
  if (!isRemoteSupabaseAvailable || !companyId || !targetMonth) return { ok: true, skipped: true, data: null };
  try {
    const { data, error } = await supabase
      .from("tenant_snapshots")
      .select("*")
      .eq("company_id", companyId)
      .eq("target_month", targetMonth)
      .order("updated_at", { ascending: false })
      .limit(10);
    if (error) throw error;
    const snapshots = Array.isArray(data) ? data : [];
    if (!snapshots.length) return { ok: true, data: null };
    const ascending = [...snapshots].sort((left, right) => new Date(left.updated_at || 0) - new Date(right.updated_at || 0));
    const freshest = ascending[ascending.length - 1];
    const mergedPayload = ascending
      .map((row) => normalizeAppState(row.payload || {}))
      .reduce((acc, payload) => mergeRemoteAppState(acc, payload));
    return {
      ok: true,
      data: {
        ...freshest,
        payload: mergedPayload,
      },
    };
  } catch (error) {
    if (isMissingTableError(error)) {
      return { ok: true, skipped: true, data: null };
    }
    logSupabaseError({ operation: "loadLatestTenantSnapshot", table: "tenant_snapshots", companyId, targetMonth, error });
    return { ok: false, error, data: null };
  }
};

// Fetches exactly the row a given store+month upserts to (id = company:store:month), so a
// save can be verified against the same row it just wrote instead of "whichever snapshot in
// the company happens to be freshest right now" (which loadLatestTenantSnapshot returns and
// could momentarily be a different store's row from a concurrent save elsewhere).
export const loadTenantSnapshotForStore = async ({ companyId, storeId, targetMonth } = {}) => {
  if (!isRemoteSupabaseAvailable || !companyId || !storeId || !targetMonth) return { ok: true, skipped: true, data: null };
  try {
    const { data, error } = await supabase
      .from("tenant_snapshots")
      .select("*")
      .eq("company_id", companyId)
      .eq("store_id", storeId)
      .eq("target_month", targetMonth)
      .maybeSingle();
    if (error) throw error;
    return { ok: true, data: data || null };
  } catch (error) {
    logSupabaseError({ operation: "loadTenantSnapshotForStore", table: "tenant_snapshots", companyId, storeId, targetMonth, error });
    return { ok: false, error, data: null };
  }
};
