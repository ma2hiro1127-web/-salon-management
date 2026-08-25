import {
  createInitialAppState,
  defaultClosingItem,
  defaultDailyEntry,
  defaultFixedCostItem,
  defaultTarget,
  defaultVariableCostItem,
  expenseCategories,
  ALL_STORES_VALUE,
  costCategoryKeys,
  UNCATEGORIZED_KEY,
} from "../data/defaults.js";
import { canViewAllStores } from "./permissions.js";

export { createInitialAppState } from "../data/defaults.js";

// company_id境界の整理(総合品質チェックで発見した問題F): currentCompanyId(appState.
// currentCompanyId、またはpersistToSupabase等が扱う任意のstateスナップショットの同名
// フィールド)がcompanies配列のどのidとも一致しない場合、companies[0](=配列の先頭、実際には
// 「誰の会社か」は並び順次第の任意の会社)へ静かにフォールバックしない——書き込み系
// (resolveTargetCompanyAndStore、persistToSupabase)は元々このケースをnull(=保存不可)として
// 明示的にブロックしていたが、表示系(App.jsxのcurrentCompany)だけがcompanies[0]へ
// フォールバックしており、「画面には別会社のデータが表示され続けるのに保存だけ静かに失敗する」
// というcompany_idの境界が実質的に崩れかねない不整合があった(system_adminのように複数社を
// 扱うロールで、currentCompanyIdが指す会社が削除された直後などに顕在化し得る)。
// currentCompanyIdが一致しない状態は「読み込み中」または「壊れた状態」のどちらかであり、
// どちらの場合も任意の別会社のデータへ静かに切り替えるのではなくnullを返すのが正しい——
// 単体テストできる純粋関数として切り出し、表示系・書き込み系の両方がこの1つの実装だけを
// 参照するようにする。
export const resolveCurrentCompany = (companies, currentCompanyId) =>
  (Array.isArray(companies) ? companies : []).find((company) => company.id === currentCompanyId) || null;

// loadTenantStateFromSupabase always defaults selectedStore to the alphabetically-first store in
// the company. Every login/session-restore path needs to override that with whatever store this
// device actually had selected — but resolving that by NAME alone breaks the instant another
// device renames the store (the cached name goes stale while the id stays valid), silently
// stranding the session on a different, often-empty store while things like store ranking (which
// always reads the company's current store list, never a cached selection) keep looking correct.
// Resolving by the durable selectedStoreId first, and only falling back to a name match or
// Supabase's own default when there's truly no id match, is what makes every entry point below
// self-heal to the SAME store across a rename instead of drifting to an arbitrary one.
//
// 緊急障害(App.jsxのTDZクラッシュ)対応でApp.jsxからstorage.jsへ移設・export化した——
// 元々App.jsxのコンポーネント関数内に生のconstとして置かれており、単体テストできなかった
// (「company_admin/store_manager/staff×加盟店あり/なし×店舗1件/複数件×localStorageに
// 古いIDあり」等の組み合わせを自動テストしたい、という再発防止要件に応えるための移設)。
// ロジック自体は一切変更していない。
export const resolvePreferredStoreSelection = ({ tenantState, localRecoveredState, currentCompanyId, role = "staff" }) => {
  const targetStores = (tenantState?.companies || []).find((company) => company.id === currentCompanyId)?.stores
    || tenantState?.companies?.[0]?.stores
    || [];
  const availableStoreNames = new Set(targetStores.map((store) => store.name));
  const storeMatchedById = localRecoveredState?.selectedStoreId
    ? targetStores.find((store) => store.id === localRecoveredState.selectedStoreId)
    : null;
  // 「全店舗」は実店舗ではないのでavailableStoreNamesには含まれない。権限がある間は
  // 実店舗へ戻さず、そのまま維持する。
  if (localRecoveredState?.selectedStore === ALL_STORES_VALUE && canViewAllStores(role)) {
    return { selectedStore: ALL_STORES_VALUE, selectedStoreId: "" };
  }
  const selectedStore = storeMatchedById
    ? storeMatchedById.name
    : (localRecoveredState?.selectedStore && availableStoreNames.has(localRecoveredState.selectedStore)
      ? localRecoveredState.selectedStore
      : (tenantState?.selectedStore || localRecoveredState?.selectedStore || ""));
  const selectedStoreId = storeMatchedById
    ? storeMatchedById.id
    : (targetStores.find((store) => store.name === selectedStore)?.id || tenantState?.selectedStoreId || "");
  return { selectedStore, selectedStoreId };
};

// 店舗追加時の重複作成防止(完全一致・表記ゆれレベルの判定専用)。店舗名の「似ている」
// 警告(本店/支店等の接尾辞まで剥がすゆるい正規化、App.jsxのnormalizeStoreNameForSimilarity)
// とは意図的に別の、より保守的な正規化——前後・連続する空白(全角スペースはNFKCで半角化
// される)と大文字小文字の表記ゆれだけを吸収する。DB側の一意インデックス
// (stores_company_id_normalized_name_unique: company_id, lower(btrim(name)))が吸収できる
// 範囲(空白・大文字小文字)とも意図的に揃えてあり、クライアント側の事前チェックとDB側の
// 最終防御が同じ基準で判定する。
export const normalizeStoreNameForDuplicateCheck = (name) =>
  String(name || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

// hydrateFromSupabase(App.jsx)の呼び出し調停ロジック。同じcompany_id×対象月への取得は
// focus/visibilitychange/pageshow/Supabase Realtime購読など複数の経路からほぼ同時に発火
// し得るため、既に同じキーの取得が進行中なら後発の呼び出しを即座に打ち切り(先行呼び出しに
// 任せる)、そうでなければ実際に取得へ進む——その判定と、進む場合だけのリクエスト番号発行
// (新しい呼び出しほど後続の結果を優先するための、単調増加するカウンタ)を1つの純粋関数に
// まとめたもの。
//
// このロジックは元々App.jsxのhydrateFromSupabase内にref比較として直接書かれていたが、
// 同じ箇所で関連する2件の不具合が続けて発生したため(いずれも「何もしない打ち切りのはずの
// 呼び出しが、実は何かを変えてしまっていた」という同じ型のバグ):
//   1. 打ち切られる呼び出しもリクエスト番号を消費していたため、本当に取得中だった側の
//      正しい結果が「自分より新しい呼び出しが始まった」と誤判定されて捨てられ得た。
//   2. 打ち切られる呼び出しがガードより前に無条件でUIの"syncing"状態をセットしていたため、
//      先行する取得が既に成功して"loaded"になった後にこの呼び出しが発火すると、正しい
//      状態を"syncing"へ巻き戻すだけで、その後何もしないまま返ってしまい、
//      「データを更新中です…」が永久に消えなくなっていた。
// 両方とも根本原因は同じ(打ち切られる呼び出しが共有状態に触れてしまう設計)だったため、
// ここへ抽出してテストし、「打ち切られる呼び出しは本当に何もしない」という不変条件を
// 直接検証できるようにする。
//
// - currentInFlightKey: hydrateInFlightRef.currentの現在値(進行中の取得のキー、無ければnull)
// - candidateKey: これから呼ばれようとしている呼び出しのキー(`${companyId}::${targetMonth}`)
// - currentRequestCounter: hydrateRequestRef.currentの現在値
export const resolveHydrateDispatch = ({ currentInFlightKey, candidateKey, currentRequestCounter }) => {
  if (currentInFlightKey === candidateKey) {
    // 打ち切り: 呼び出し元の共有状態(inFlightRef/requestCounter/syncStatus等)には
    // 一切触れない、という契約を型で示すため、変更しない値をそのまま返す。
    return { shouldProceed: false, nextInFlightKey: currentInFlightKey, requestId: null, nextRequestCounter: currentRequestCounter };
  }
  const nextRequestCounter = currentRequestCounter + 1;
  return { shouldProceed: true, nextInFlightKey: candidateKey, requestId: nextRequestCounter, nextRequestCounter };
};

export const STORAGE_KEYS = {
  theme: "salon-theme",
  appState: "salon-goal-app-v2",
};

export const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// まとめて入力専用。既存のparseNumberは空欄/未入力を必ず0に丸める(daily_salesが「未入力」
// という概念を持たず、常に確定した数値を保存する設計のため) — まとめ入力は逆に「未入力」と
// 「0」を区別しなければならない(要件)ので、空欄/undefined/nullは0ではなくnullのまま返す
// 専用のパーサーを別に用意する。既存のparseNumberは一切変更しない(daily_sales側の保存が
// これに依存しているため)。
export const parseNullableNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// <input type="number"> has a well-known browser quirk: once the typed content isn't a
// strictly valid HTML floating-point number (e.g. full-width Japanese digits like "４" from an
// IME — very common on Japanese keyboards/numpads), the DOM reports an EMPTY string via
// event.target.value while the browser keeps showing the raw typed characters in the field
// ("bad input" state). A controlled React input bound to that empty value therefore silently
// saves 0 while the number the user typed visibly stays on screen — exactly the "店舗を追加した
// のにスタッフ数が0のまま、フォームには数字が残る" bug. The fix is to use type="text" with this
// sanitizer instead of relying on the browser's native number parsing: normalize full-width
// digits/period to half-width, then strip anything that still isn't a digit (or a single
// decimal point when allowDecimal).
const FULLWIDTH_NUMERIC_CHARS = { "０": "0", "１": "1", "２": "2", "３": "3", "４": "4", "５": "5", "６": "6", "７": "7", "８": "8", "９": "9", "．": "." };

export const sanitizeNumericInputValue = (value, { allowDecimal = false } = {}) => {
  const converted = String(value ?? "").replace(/[０-９．]/g, (char) => FULLWIDTH_NUMERIC_CHARS[char] || char);
  const cleaned = converted.replace(allowDecimal ? /[^0-9.]/g : /[^0-9]/g, "");
  if (!allowDecimal) return cleaned;
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
};

export const readStorage = (key, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
};

export const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getMonthOffset = (monthValue, offset) => {
  const [year, month] = monthValue.split("-").map(Number);
  const nextDate = new Date(year, month - 1 + offset, 1);
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
};

export const getMonthInfo = (monthValue) => {
  const [year, month] = monthValue.split("-").map(Number);
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  return {
    yearNumber,
    monthNumber,
    daysInMonth: new Date(yearNumber, monthNumber, 0).getDate(),
    firstDate: new Date(yearNumber, monthNumber - 1, 1),
    lastDate: new Date(yearNumber, monthNumber, 0),
  };
};

export const buildMonthKey = (store, month) => `${store}__${month}`;

// Every per-store/month map in appState is keyed "storeId__month" (buildMonthKey's first
// argument is always a store's stable Supabase id now, never its display name) — a store rename
// changes nothing about these keys, since the id never changes. That wasn't always true: this
// used to be name-keyed, which meant a rename had to atomically rewrite every "oldName__*" key
// to "newName__*" (see git history for the old rekeyStoreNamedMaps) to avoid looking like the
// store's data had vanished. Any data written to localStorage or a Supabase tenant_snapshots row
// under that old scheme still has old-format "storeName__month" keys sitting in it — those rows
// predate this migration and won't rewrite themselves. migrateNameKeyedMapsToStoreId (below)
// is what makes reading that old data safe: it runs unconditionally on every normalizeAppState
// call and rewrites any surviving name-keyed entries to id-keyed ones in place, using whichever
// companies/stores list happens to be embedded in that same state blob to resolve name -> id.
const STORE_KEYED_MAPS = [
  "dailyResults", "dayClosingStates", "dayClosingUpdatedAt", "targets", "businessDaySettings",
  "monthClosingStatus", "fixedCosts", "variableCosts", "monthClosing", "dailyResultBackups",
  "storeHolidays",
];

// Combines an old (name-keyed) and new (id-keyed) entry that both ended up mapping to the same
// target key — should be rare (only possible if a partial migration or a merge already produced
// an id-keyed entry alongside a not-yet-migrated name-keyed one for the same store/month) but
// must never silently drop one side. Arrays (dailyResults/fixedCosts/variableCosts/monthClosing/
// storeHolidays/dailyResultBackups) concatenate and dedupe (`id` field if present, else exact
// value); plain objects (dayClosingStates/dayClosingUpdatedAt/targets/businessDaySettings/
// monthClosingStatus) shallow-merge.
const mergeMigratedEntry = (existing, incoming) => {
  if (existing === undefined) return incoming;
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    const seen = new Set();
    const merged = [];
    [...existing, ...incoming].forEach((item) => {
      const dedupeKey = item && typeof item === "object" ? (item.id ?? JSON.stringify(item)) : item;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      merged.push(item);
    });
    return merged;
  }
  if (existing && incoming && typeof existing === "object" && typeof incoming === "object") {
    return { ...existing, ...incoming };
  }
  return incoming ?? existing;
};

export const migrateNameKeyedMapsToStoreId = (state) => {
  if (!state || typeof state !== "object") return state;
  const companies = Array.isArray(state.companies) ? state.companies : [];
  const nameToId = new Map();
  companies.forEach((company) => {
    (company?.stores || []).forEach((store) => {
      if (store?.name && store?.id && !nameToId.has(store.name)) {
        nameToId.set(store.name, store.id);
      }
    });
  });
  if (!nameToId.size) return state;

  let anyChanged = false;
  const next = { ...state };
  STORE_KEYED_MAPS.forEach((mapKey) => {
    const source = state[mapKey];
    if (!source || typeof source !== "object") return;
    let mapChanged = false;
    const rekeyed = {};
    Object.entries(source).forEach(([key, value]) => {
      const separatorIndex = key.indexOf("__");
      const prefix = separatorIndex === -1 ? key : key.slice(0, separatorIndex);
      const mappedId = nameToId.get(prefix);
      const targetKey = mappedId && separatorIndex !== -1 ? `${mappedId}${key.slice(separatorIndex)}` : key;
      if (targetKey !== key) mapChanged = true;
      rekeyed[targetKey] = mergeMigratedEntry(rekeyed[targetKey], value);
    });
    if (mapChanged) {
      next[mapKey] = rekeyed;
      anyChanged = true;
    }
  });
  return anyChanged ? next : state;
};

// "2026-08" -> "2026年8月". Storage always stays in the "YYYY-MM" form; this is display-only.
export const formatMonthLabel = (monthValue) => {
  const [year, month] = String(monthValue || "").split("-");
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  if (!Number.isFinite(yearNumber) || !Number.isFinite(monthNumber) || !yearNumber || !monthNumber) return "";
  return `${yearNumber}年${monthNumber}月`;
};

export const getBusinessDaySettings = (state, storeId, monthValue) => {
  const key = buildMonthKey(storeId, monthValue);
  return state.businessDaySettings?.[key] || {};
};

// The returned `backups` array is a local-only historical log (see dailyResultBackups in
// defaults.js) of whichever duplicate entries lost out during this pass — it is NEVER read back
// in to influence a future dedup decision, so it cannot resurrect a duplicate that was correctly
// dropped once, and it cannot cause a Supabase-deleted daily_sales row to reappear either
// (dailyResults itself always comes from a fresh Supabase fetch — see applyDailySalesOverlay in
// App.jsx — not from this backup log).
export const deduplicateDailyEntries = (entries = []) => {
  const deduped = [];
  const backups = [];
  const byDate = new Map();

  (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    const date = String(entry?.date || "").trim();
    if (!date) {
      deduped.push(entry);
      return;
    }

    const current = entry;
    const previous = byDate.get(date);
    if (!previous) {
      byDate.set(date, current);
      return;
    }

    const previousUpdatedAt = String(previous.updatedAt || previous.updated_at || "");
    const currentUpdatedAt = String(current.updatedAt || current.updated_at || "");
    const pickCurrent = currentUpdatedAt && previousUpdatedAt ? currentUpdatedAt >= previousUpdatedAt : index > (entries || []).findIndex((item) => String(item?.date || "") === date);
    const retained = pickCurrent ? current : previous;
    const removed = pickCurrent ? previous : current;

    if (removed && removed !== retained) {
      backups.push(removed);
    }
    byDate.set(date, retained);
  });

  byDate.forEach((entry) => deduped.push(entry));
  deduped.sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));

  return { entries: deduped, backups };
};

// A store can hide technicalSales/retailSales/customers/newCustomers/repeatCustomers/memo
// from its daily entry form (see dailyFieldSettings). This builds the saved entry so that a
// hidden field's *existing* saved value is preserved untouched, never zeroed/blanked out just
// because its input isn't on screen.
//
// totalSales and customers are treated as single-source-of-truth values living on `form`
// itself, not recomputed here from technicalSales+retailSales / newCustomers+repeatCustomers:
// the UI (updateDailyField) is what keeps form.totalSales/form.customers in sync live as the
// user actually edits the constituent fields. Recomputing independently at save time would
// re-derive from whatever technicalSales/retailSales happen to be sitting in `form` even when
// the user never touched them this session (e.g. a legacy total-sales-only entry loaded back
// into a now-detailed-mode form, where technicalSales/retailSales read as 0) — which would
// silently zero out a total that was only ever entered as one number, exactly the retroactive
// split the spec says not to do.
// newCustomers/repeatCustomers are only ever treated as "shown" when customers itself is also
// shown, since a new/repeat breakdown without a customer-count context isn't meaningful.
export const buildDailyEntryPayload = ({ form, existingEntry = null, fieldSettings, entryId } = {}) => {
  const fields = fieldSettings?.fields || {};
  const showTechnical = Boolean(fields.technicalSales);
  const showRetail = Boolean(fields.retailSales);
  const showCustomers = Boolean(fields.customers);
  const showNewCustomers = showCustomers && Boolean(fields.newCustomers);
  const showRepeatCustomers = showCustomers && Boolean(fields.repeatCustomers);
  const showMemo = Boolean(fields.memo);
  const showReviewCount = Boolean(fields.reviewCount);
  const showOtherSales = Boolean(fields.otherSales);

  const preserveNumber = (existingValue) => parseNumber(existingValue ?? 0);
  const preserveText = (existingValue) => existingValue ?? "";

  const technicalSales = showTechnical ? parseNumber(form.technicalSales) : preserveNumber(existingEntry?.technicalSales);
  const retailSales = showRetail ? parseNumber(form.retailSales) : preserveNumber(existingEntry?.retailSales);
  const otherSales = showOtherSales ? parseNumber(form.otherSales) : preserveNumber(existingEntry?.otherSales);
  const totalSales = parseNumber(form.totalSales || 0);

  const newCustomers = showNewCustomers ? parseNumber(form.newCustomers) : preserveNumber(existingEntry?.newCustomers);
  const repeatCustomers = showRepeatCustomers ? parseNumber(form.repeatCustomers) : preserveNumber(existingEntry?.repeatCustomers);
  const customers = showCustomers ? parseNumber(form.customers) : preserveNumber(existingEntry?.customers);
  const reviewCount = showReviewCount ? parseNumber(form.reviewCount) : preserveNumber(existingEntry?.reviewCount);

  const memo = showMemo ? (form.memo || "") : preserveText(existingEntry?.memo);

  return {
    ...form,
    id: entryId,
    updatedAt: new Date().toISOString(),
    totalSales,
    technicalSales,
    retailSales,
    otherSales,
    customers,
    newCustomers,
    repeatCustomers,
    reviewCount,
    memo,
  };
};

// 日次入力の「編集」ボタン表示可否と、入力欄の実際の編集可否を、同じロック理由(isLocked)
// から1か所で計算する純粋関数。この2つを別々の式で計算していると、片方だけ条件を直したときに
// もう片方が古いまま取り残され「編集ボタンは押せるのに入力欄はロックされたまま」という不具合
// (根本原因の再発)を招くため、意図的に1つの関数へ統合する。
//   - canShowEditButton: 閲覧中(dailyMode==="view")で、対象日に保存済みのデータがあり、
//     ロック理由が無い場合だけ「編集」ボタンを表示する。
//   - canEditDailyEntry: 実際に作成中/編集中のモードで、店休日でもロック中でもない場合だけ
//     入力欄(技術売上・店販売上・新規客数・再来客数・日計・口コミ数・メモ)を編集可能にする。
// ロック理由(isLocked = まとめて入力ロック or staffの日締め済みロック or staffの過去/未来日
// ロック)はcanShowEditButton/canEditDailyEntry両方が同じ値を参照するため、原理的に食い違えない。
export const resolveDailyEntryEditState = ({
  dailyMode,
  hasEntryId,
  isDailyFormDateHoliday,
  isDailyDateBatchLocked,
  isDailyEntryLockedForStaff,
  isStaffPastOrFutureDateLocked,
}) => {
  const isLocked = Boolean(isDailyDateBatchLocked) || Boolean(isDailyEntryLockedForStaff) || Boolean(isStaffPastOrFutureDateLocked);
  const canShowEditButton = dailyMode === "view" && Boolean(hasEntryId) && !isLocked;
  const canEditDailyEntry = (dailyMode === "create" || dailyMode === "edit") && !isDailyFormDateHoliday && !isLocked;
  return { canShowEditButton, canEditDailyEntry, isLocked };
};

// 二重送信防止の共通パターン(販売前総合チェックで発見: まとめて入力・会社作成・ユーザー招待
// の保存が、Reactのstateだけ(setBusy)でガードされていた)。React state の更新は次の
// レンダーまで反映されないため、同じイベント処理の中で連打・二重タップにより2回目の呼び出しが
// 走ると、まだ古い(false の)値を見て両方ともガードを素通りしてしまう。ここでは呼び出しと
// 同時に同期的に読み書きできる参照(guardRef、React側ではuseRefのオブジェクトを渡す想定——
// {current: boolean}という最小限の形だけに依存するため、Reactに依存しないpure関数として
// storage.js側でテストできる)を先にチェック・セットすることで、そのすり抜けを構造的に防ぐ。
// guardRef.currentが既にtrueの間に呼ばれた場合は、taskを一切実行せず即座に返す
// (二重実行・二重POST・二重upsertを防ぐ)。
export const runWithSaveGuard = async (guardRef, task) => {
  if (guardRef.current) return { ok: false, skipped: true };
  guardRef.current = true;
  try {
    return await task();
  } finally {
    guardRef.current = false;
  }
};

// daily_sales is the row-per-day Supabase source of truth (see upsertDailySalesEntry /
// loadDailySalesForCompanyRange in utils/supabase.js). These convert between its column
// shape and the app's in-memory entry shape, and rebuild the dailyResults/dayClosingStates/
// dayClosingUpdatedAt maps straight from freshly-queried rows — no merge-with-local needed
// here, since a fresh table query is always authoritative (unlike the old tenant_snapshots
// blob, where "freshest row wins" could still be stale for a specific store/date).
export const dailySalesRowToEntry = (row = {}) => ({
  id: row.id,
  date: row.business_date,
  totalSales: parseNumber(row.sales_amount),
  technicalSales: parseNumber(row.technical_sales_amount),
  retailSales: parseNumber(row.retail_sales_amount),
  otherSales: parseNumber(row.other_sales_amount),
  customers: parseNumber(row.customer_count),
  newCustomers: parseNumber(row.new_customer_count),
  repeatCustomers: parseNumber(row.repeat_customer_count),
  reviewCount: parseNumber(row.review_count),
  memo: row.memo || "",
  isDayClosed: Boolean(row.is_day_closed),
  updatedAt: row.updated_at || "",
});

export const buildDailyStateFromRows = (rows = []) => {
  const dailyResults = {};
  const dayClosingStates = {};
  const dayClosingUpdatedAt = {};

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.store_id || !row.business_date) return;
    const month = String(row.business_date).slice(0, 7);
    const key = buildMonthKey(row.store_id, month);
    const entry = dailySalesRowToEntry(row);

    dailyResults[key] = [...(dailyResults[key] || []), entry];
    dayClosingStates[key] = { ...(dayClosingStates[key] || {}), [entry.date]: entry.isDayClosed };
    dayClosingUpdatedAt[key] = { ...(dayClosingUpdatedAt[key] || {}), [entry.date]: row.closed_at || entry.updatedAt || "" };
  });

  return { dailyResults, dayClosingStates, dayClosingUpdatedAt };
};

// まとめて入力(daily_batch_entries)。daily_salesとは完全に別のテーブル・別のstateキー
// (dailyBatchEntries)として持つ — 日別データ(dailyResults)へは絶対に混ぜない(要件3:
// まとめ入力は日別データへ分割しない)。dailySalesRowToEntry/buildDailyStateFromRowsと
// 対になる関数だが、決定的な違いとして各項目はparseNumber(常に数値、未入力は0)ではなく
// row由来のnullをそのまま通す — 「未入力」と「0」を区別するのがこの機能の核なので、ここで
// 0に丸めてしまうと以降の集計で区別できなくなる。
export const dailyBatchEntryRowToEntry = (row = {}) => ({
  id: row.id,
  startDate: row.start_date,
  endDate: row.end_date,
  totalSales: row.sales_amount === null || row.sales_amount === undefined ? null : Number(row.sales_amount),
  technicalSales: row.technical_sales_amount === null || row.technical_sales_amount === undefined ? null : Number(row.technical_sales_amount),
  retailSales: row.retail_sales_amount === null || row.retail_sales_amount === undefined ? null : Number(row.retail_sales_amount),
  otherSales: row.other_sales_amount === null || row.other_sales_amount === undefined ? null : Number(row.other_sales_amount),
  customers: row.customer_count === null || row.customer_count === undefined ? null : Number(row.customer_count),
  newCustomers: row.new_customer_count === null || row.new_customer_count === undefined ? null : Number(row.new_customer_count),
  repeatCustomers: row.repeat_customer_count === null || row.repeat_customer_count === undefined ? null : Number(row.repeat_customer_count),
  reviewCount: row.review_count === null || row.review_count === undefined ? null : Number(row.review_count),
  cashAmount: row.cash_amount === null || row.cash_amount === undefined ? null : Number(row.cash_amount),
  cashlessAmount: row.cashless_amount === null || row.cashless_amount === undefined ? null : Number(row.cashless_amount),
  pointAmount: row.point_amount === null || row.point_amount === undefined ? null : Number(row.point_amount),
  memo: row.memo || "",
  createdBy: row.created_by || "",
  updatedAt: row.updated_at || "",
});

// state.dailyBatchEntries[storeId__month] = [...entries]。まとめ入力は必ず単一暦月内
// (DBのCHECK制約でも強制済み)なので、buildMonthKeyのキー1つに必ず収まる。
export const buildBatchEntryStateFromRows = (rows = []) => {
  const dailyBatchEntries = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.store_id || !row.start_date) return;
    const month = String(row.start_date).slice(0, 7);
    const key = buildMonthKey(row.store_id, month);
    dailyBatchEntries[key] = [...(dailyBatchEntries[key] || []), dailyBatchEntryRowToEntry(row)];
  });
  return { dailyBatchEntries };
};

export const getBatchEntriesForStoreMonth = (state, storeId, monthValue) =>
  state.dailyBatchEntries?.[buildMonthKey(storeId, monthValue)] || [];

// buildDailyEntryPayloadと対だが、未入力は0ではなくnullのまま送る(parseNullableNumber)。
// 既存のbuildDailyEntryPayloadは変更しない(daily_sales側の挙動に一切影響させないため)。
// 日次と同じ「総売上は単一の情報源」規約(storage.js内buildDailyEntryPayloadのコメント参照)
// を踏襲するが、まとめ入力では総売上欄自体が未入力ならnullのまま(技術+店販が両方未入力の
// ときに0円確定させない)。
export const buildDailyBatchEntryPayload = ({ form, fieldSettings } = {}) => {
  const fields = fieldSettings?.fields || {};
  const showTechnical = Boolean(fields.technicalSales);
  const showRetail = Boolean(fields.retailSales);
  const showOther = Boolean(fields.otherSales);
  const showCustomers = Boolean(fields.customers);
  const showNewCustomers = showCustomers && Boolean(fields.newCustomers);
  const showRepeatCustomers = showCustomers && Boolean(fields.repeatCustomers);
  const showReviewCount = Boolean(fields.reviewCount);

  return {
    startDate: form.startDate,
    endDate: form.endDate,
    totalSales: parseNullableNumber(form.totalSales),
    technicalSales: showTechnical ? parseNullableNumber(form.technicalSales) : null,
    retailSales: showRetail ? parseNullableNumber(form.retailSales) : null,
    otherSales: showOther ? parseNullableNumber(form.otherSales) : null,
    customers: showCustomers ? parseNullableNumber(form.customers) : null,
    newCustomers: showNewCustomers ? parseNullableNumber(form.newCustomers) : null,
    repeatCustomers: showRepeatCustomers ? parseNullableNumber(form.repeatCustomers) : null,
    reviewCount: showReviewCount ? parseNullableNumber(form.reviewCount) : null,
    cashAmount: parseNullableNumber(form.cashAmount),
    cashlessAmount: parseNullableNumber(form.cashlessAmount),
    pointAmount: parseNullableNumber(form.pointAmount),
    memo: form.memo || "",
  };
};

// 項目単位の重複検知(要件7・8)。日次入力側は「その項目の値が入っている(0より大きい)日が
// 範囲内にあるか」で判定する — daily_salesは未入力/0を区別できないため、実質的な入力の
// 有無をこの近似で判定する(0円と明示入力された日を誤検知することはあるが、安全側に倒す)。
// まとめ入力側は「同じ項目がnullでない既存レコードの期間と重なるか」で判定する。ブロックは
// せず、警告対象の項目キー一覧を返すだけの純粋関数(呼び出し側でwindow.confirm等に使う)。
const BATCH_OVERLAP_FIELD_TO_DAILY_KEYS = {
  sales: ["totalSales", "technicalSales"],
  customers: ["customers"],
  newCustomers: ["newCustomers"],
  repeatCustomers: ["repeatCustomers"],
  reviewCount: ["reviewCount"],
  cash: ["cashAmount"],
  cashless: ["cashlessAmount"],
  point: ["pointAmount"],
};
const BATCH_OVERLAP_FIELD_TO_BATCH_KEYS = {
  sales: ["totalSales", "technicalSales", "retailSales", "otherSales"],
  customers: ["customers"],
  newCustomers: ["newCustomers"],
  repeatCustomers: ["repeatCustomers"],
  reviewCount: ["reviewCount"],
  cash: ["cashAmount"],
  cashless: ["cashlessAmount"],
  point: ["pointAmount"],
};
const rangesOverlap = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;

export const detectBatchEntryFieldOverlap = ({ dailyEntries = [], batchEntries = [], startDate, endDate, fieldKeys = [], excludeBatchEntryId = "" } = {}) => {
  const conflicts = [];
  fieldKeys.forEach((fieldKey) => {
    const dailyKeys = BATCH_OVERLAP_FIELD_TO_DAILY_KEYS[fieldKey] || [];
    const batchKeys = BATCH_OVERLAP_FIELD_TO_BATCH_KEYS[fieldKey] || [];

    const dailyConflict = dailyEntries.some((entry) => {
      const date = String(entry?.date || "");
      if (!date || date < startDate || date > endDate) return false;
      return dailyKeys.some((key) => parseNumber(entry?.[key]) > 0);
    });

    const batchConflict = batchEntries.some((entry) => {
      if (excludeBatchEntryId && entry.id === excludeBatchEntryId) return false;
      if (!rangesOverlap(startDate, endDate, entry.startDate, entry.endDate)) return false;
      return batchKeys.some((key) => entry[key] !== null && entry[key] !== undefined);
    });

    if (dailyConflict || batchConflict) {
      conflicts.push({ fieldKey, dailyConflict, batchConflict });
    }
  });
  return conflicts;
};

// 日計(現金/キャッシュレス/ポイント利用の内訳)。daily_cash_breakdownは完全に独立したテーブル
// なので、buildDailyStateFromRowsのdailyResults(daily_sales由来)とは合流させず、
// buildMonthKey(storeId, month) -> { [date]: {cashAmount, cashlessAmount, pointAmount} } という
// 別のマップとして持つ — 総売上等の既存集計ロジックがこのマップを一切参照しない限り、
// 二重計上の経路そのものが構造的に存在しない。
export const buildCashBreakdownStateFromRows = (rows = []) => {
  const cashBreakdownResults = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.store_id || !row.business_date) return;
    const month = String(row.business_date).slice(0, 7);
    const key = buildMonthKey(row.store_id, month);
    cashBreakdownResults[key] = {
      ...(cashBreakdownResults[key] || {}),
      [row.business_date]: {
        cashAmount: Number(row.cash_amount || 0),
        cashlessAmount: Number(row.cashless_amount || 0),
        pointAmount: Number(row.point_amount || 0),
      },
    };
  });
  return { cashBreakdownResults };
};

const WEEKDAY_LABELS_JA = ["日", "月", "火", "水", "木", "金", "土"];

// 日次入力画面のスマホUI改善(要件6): 対象日を「8月24日（月）」のように明確に表示するための
// 純粋関数。<input type="date">はブラウザ・OSのロケール設定によって表示が空白/読みにくく
// 見えることがあるため、この文字列を別途常時表示することで対象日を確実に伝える(値自体・
// onChange先はhandleDailyDateChangeのまま無変更、表示専用の追加)。不正な形式(空文字列・
// パース不能な値)ではUIを壊さないよう空文字列を返す。
export const formatDailyDateLabel = (dateIso) => {
  const match = typeof dateIso === "string" ? dateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = WEEKDAY_LABELS_JA[new Date(year, month - 1, day).getDay()];
  return `${month}月${day}日（${weekday}）`;
};

// 月別日計一覧(画面・CSV共通の元データ)。対象月の全日を1行ずつ組み立てる — 店休日・
// 日計未入力日・総売上未入力日をそれぞれ区別できるよう、金額そのものではなく
// hasCashBreakdown/hasTotalSales/isHolidayの3フラグを持たせる(要件13: 未入力を0円と
// 誤認させない)。dailyResults(daily_sales由来)は日付配列なので、まず日付をキーにした
// ルックアップに変換してから引く。cashBreakdownResults/dailyResultsのどちらを読んでも、
// 既存の集計(月次ダッシュボード・損益表等)には一切書き込まない完全な読み取り専用処理。
export const getMonthlyCashBreakdownRows = (state, storeId, monthValue) => {
  const { yearNumber, monthNumber, daysInMonth } = getMonthInfo(monthValue);
  const key = buildMonthKey(storeId, monthValue);
  const cashBreakdownByDate = state.cashBreakdownResults?.[key] || {};
  const dailyEntryByDate = {};
  (state.dailyResults?.[key] || []).forEach((entry) => {
    dailyEntryByDate[entry.date] = entry;
  });
  const holidayDates = getStoreHolidayDates(state, storeId, monthValue);

  const rows = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${yearNumber}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const weekday = WEEKDAY_LABELS_JA[new Date(yearNumber, monthNumber - 1, day).getDay()];
    const isHoliday = isHolidayDate(holidayDates, date);

    const breakdown = cashBreakdownByDate[date];
    const hasCashBreakdown = Boolean(breakdown);
    const cashAmount = breakdown ? breakdown.cashAmount : 0;
    const cashlessAmount = breakdown ? breakdown.cashlessAmount : 0;
    const pointAmount = breakdown ? breakdown.pointAmount : 0;
    const cashBreakdownTotal = cashAmount + cashlessAmount + pointAmount;

    const dailyEntry = dailyEntryByDate[date];
    const hasTotalSales = Boolean(dailyEntry);
    const totalSales = dailyEntry ? dailyEntry.totalSales : 0;

    const hasComparison = hasCashBreakdown && hasTotalSales;
    const diff = hasComparison ? totalSales - cashBreakdownTotal : 0;
    const isMatched = hasComparison && diff === 0;

    let status;
    if (isHoliday && !hasCashBreakdown) status = "holiday";
    else if (!hasCashBreakdown) status = "unfilled";
    else if (!hasTotalSales) status = "no_sales_data";
    else if (isMatched) status = "matched";
    else status = "mismatch";

    rows.push({
      date, weekday, isHoliday,
      hasCashBreakdown, cashAmount, cashlessAmount, pointAmount, cashBreakdownTotal,
      hasTotalSales, totalSales,
      hasComparison, diff, isMatched, status,
    });
  }
  return rows;
};

// 月間合計。要件7: 月間差額は日別差額の絶対値合計ではなく「月間総売上－月間日計合計」で
// 計算する(日別の±が相殺されるのは意図通り — 月全体で見て支払方法の記録漏れ・記録超過が
// ネットでどちらに寄っているかを示す値のため)。
export const summarizeMonthlyCashBreakdown = (rows = []) => {
  const totals = rows.reduce((acc, row) => {
    acc.cashTotal += row.cashAmount;
    acc.cashlessTotal += row.cashlessAmount;
    acc.pointTotal += row.pointAmount;
    acc.cashBreakdownGrandTotal += row.cashBreakdownTotal;
    acc.salesTotal += row.totalSales;
    return acc;
  }, { cashTotal: 0, cashlessTotal: 0, pointTotal: 0, cashBreakdownGrandTotal: 0, salesTotal: 0 });
  return { ...totals, diffTotal: totals.salesTotal - totals.cashBreakdownGrandTotal };
};

// Same idea as buildDailyStateFromRows but for monthly_closings rows -> monthClosingStatus.
export const buildMonthClosingStateFromRows = (rows = []) => {
  const monthClosingStatus = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.store_id || !row.year_month) return;
    const key = buildMonthKey(row.store_id, row.year_month);
    monthClosingStatus[key] = {
      closed: Boolean(row.is_closed),
      lockedAt: row.closed_at || "",
      note: row.is_closed ? "月締め済み" : "未確定",
    };
  });
  return monthClosingStatus;
};

// Same idea as buildMonthClosingStateFromRows but for monthly_targets rows -> the targets/
// businessDaySettings maps calculateMonthSummary/getBusinessDaySummary actually read.
export const buildTargetStateFromRows = (rows = []) => {
  const targets = {};
  const businessDaySettings = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.store_id || !row.target_month) return;
    const key = buildMonthKey(row.store_id, row.target_month);
    targets[key] = {
      targetSales: row.target_sales,
      targetTechnicalSales: row.target_technical_sales,
      targetRetailSales: row.target_retail_sales,
      targetCustomers: row.target_customers,
      targetAverageSpend: row.target_average_spend,
      targetNewCustomers: row.target_new_customers,
      targetRepeatCustomers: row.target_repeat_customers,
      targetRepeatRate: row.target_repeat_rate,
      targetAverageCustomersPerDay: row.target_average_customers_per_day,
      targetLaborRate: row.target_labor_rate,
      targetMaterialRate: row.target_material_rate,
      targetAdRate: row.target_ad_rate,
      targetOperatingMargin: row.target_operating_margin,
      targetReviewCount: row.target_review_count,
    };
    businessDaySettings[key] = {
      mode: row.business_day_mode || "",
      businessDayCount: row.business_day_count,
      holidayCount: row.holiday_count,
    };
  });
  return { targets, businessDaySettings };
};

// Rebuilds the fixedCosts map (storeName__entryMonth -> item[]) from fixed_costs rows, in the
// exact shape getFixedCostsForStoreMonth already expects — entry_month is the month the item
// was originally filed under, which is what that function's "翌月以降も継続" lookback keys on.
// The row's own legacy `amount` (pre-per-month-amount data) is intentionally not carried into the
// item. baseAmount (継続費用の基本値) IS carried in — it's the fallback getCostMonthlyAmount uses
// for an "ongoing" item's month with no explicit override row in costMonthlyAmounts.
export const buildFixedCostsStateFromRows = (rows = []) => {
  const fixedCosts = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.store_id || !row.entry_month) return;
    const key = buildMonthKey(row.store_id, row.entry_month);
    const item = {
      id: row.id,
      name: row.name || "",
      category: row.category || "",
      categoryKey: row.category_key || "uncategorized",
      memo: row.memo || "",
      // period_type is the explicit "継続/期間限定" choice. Rows saved before this column
      // existed have no value here, so fall back to the old implicit rule (no end_month = 継続)
      // for backward compatibility with data entered under the previous UI.
      periodType: row.period_type || (row.end_month ? "limited" : "ongoing"),
      startMonth: row.start_month || "",
      endMonth: row.end_month || "",
      baseAmount: parseNumber(row.base_amount),
      sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
      updatedAt: row.updated_at || "",
    };
    fixedCosts[key] = [...(fixedCosts[key] || []), item];
  });
  return { fixedCosts };
};

// cost_monthly_amounts — the per-month amount for a given cost item, keyed by
// `${cost_item_id}__${target_month}` for O(1) lookup from getCostMonthlyAmount below. A cost
// item with no entry for a given month has simply never had its amount entered/confirmed for
// that month (see getFixedCostsForStoreMonth's header comment) — it contributes 0, not a
// carried-forward guess, matching the "ユーザーがコピーして確認" requirement.
export const buildCostMonthlyAmountsStateFromRows = (rows = []) => {
  const costMonthlyAmounts = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.cost_item_id || !row.target_month) return;
    const key = `${row.cost_item_id}__${row.target_month}`;
    costMonthlyAmounts[key] = { id: row.id, amount: row.amount, updatedAt: row.updated_at || "" };
  });
  return { costMonthlyAmounts };
};

// store_inventory_balances — the closing (月末) inventory amount for a store, per target month,
// keyed by `${store_id}__${target_month}` for O(1) lookup from getInventoryBalance below. The
// "期首在庫" (opening inventory, used only the first time a store turns inventory tracking on)
// is stored under the same shape at target_month = (first tracked month - 1) — see
// getPreviousMonthInventoryBalance and its caller in calculateMonthSummary.
export const buildStoreInventoryBalancesStateFromRows = (rows = []) => {
  const storeInventoryBalances = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.store_id || !row.target_month) return;
    const key = `${row.store_id}__${row.target_month}`;
    storeInventoryBalances[key] = { id: row.id, amount: row.closing_amount, updatedAt: row.updated_at || "" };
  });
  return { storeInventoryBalances };
};

// variable_costs (販管費) — direct month lookup (target_month), no carry-forward.
export const buildVariableCostsStateFromRows = (rows = []) => {
  const variableCosts = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.store_id || !row.target_month) return;
    const key = buildMonthKey(row.store_id, row.target_month);
    const item = {
      id: row.id,
      name: row.name || "",
      amount: row.amount,
      category: row.category || "",
      categoryKey: row.category_key || "uncategorized",
      memo: row.memo || "",
      incurredDate: row.incurred_date || "",
      type: row.type || "regular",
    };
    variableCosts[key] = [...(variableCosts[key] || []), item];
  });
  return { variableCosts };
};

// monthly_closing_items (月締め項目) — same shape of fix as variable_costs above.
export const buildMonthlyClosingItemsStateFromRows = (rows = []) => {
  const monthClosing = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.store_id || !row.target_month) return;
    const key = buildMonthKey(row.store_id, row.target_month);
    const item = {
      id: row.id,
      name: row.name || "",
      amount: row.amount,
      category: row.category || "",
      categoryKey: row.category_key || "uncategorized",
      updatedAt: row.updated_at || "",
    };
    monthClosing[key] = [...(monthClosing[key] || []), item];
  });
  return { monthClosing };
};

// company_settings — a single row for the whole company; returns null fields (not a default
// object) when no row exists yet, so the caller can tell "not registered" apart from "registered
// with default values" the same way targets/fixed_costs do.
export const buildCompanySettingsFromRow = (row) => {
  if (!row) return null;
  return {
    settings: {
      businessType: row.business_type || "salon",
      currency: row.currency || "JPY",
      fiscalYearStartMonth: row.fiscal_year_start_month || "1",
      salesDisplayMode: row.sales_display_mode || "inclusive",
      retailSalesLabel: row.retail_sales_label || "店販売上",
      closingDay: row.closing_day || "月末",
      editDeadlineDays: row.edit_deadline_days ?? 7,
      allowStaffPastEdit: Boolean(row.allow_staff_past_edit),
      visibleSalesFields: Array.isArray(row.visible_sales_fields) ? row.visible_sales_fields : ["technicalSales", "retailSales", "otherSales"],
      activeKpis: Array.isArray(row.active_kpis) ? row.active_kpis : ["sales", "customers", "retailRatio"],
    },
    taxSettings: {
      rate: row.tax_rate ?? 0.1,
      roundingMode: row.tax_rounding_mode || "half-up",
      salesInputMode: row.tax_sales_input_mode || "inclusive",
      expenseInputMode: row.tax_expense_input_mode || "inclusive",
      considerConsumptionTax: Boolean(row.consider_consumption_tax),
      consumptionTaxReserveRate: row.consumption_tax_reserve_rate ?? 0,
    },
    showOtherSales: Boolean(row.show_other_sales),
  };
};

// store_profiles — keyed by store_id (not name), merged directly onto each store object by id.
export const buildStoreProfilesByStoreId = (rows = []) => {
  const byStoreId = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    byStoreId[row.store_id] = {
      postalCode: row.postal_code || "",
      address: row.address || "",
      phone: row.phone || "",
      managerName: row.manager_name || "",
      representativeName: row.representative_name || "",
      openingDate: row.opening_date || "",
      openingHour: row.opening_hour || "09:00",
      closingHour: row.closing_hour || "20:00",
      closedDays: row.closed_days || "",
      businessHours: row.business_hours || "",
      description: row.description || "",
      website: row.website || "",
      instagram: row.instagram || "",
      googleMapUrl: row.google_map_url || "",
      serviceTypes: Array.isArray(row.service_types) ? row.service_types.join(", ") : "",
      urls: Array.isArray(row.urls) ? row.urls : [],
      // status intentionally NOT read from here — the store's operational status (active/
      // suspended/archived) lives on stores.status now (see 20260815010000_store_lifecycle_
      // status.sql), fetched separately and set on the base store object in
      // loadTenantStateFromSupabase. This overlay is applied on top of that base object, so
      // including a status field here (store_profiles.status, a leftover unused column) would
      // silently clobber the real, authoritative value with whatever's in store_profiles.
      staffCount: Number(row.staff_count) || 0,
      productivityStaffCount: Number(row.productivity_staff_count) || 0,
      // 初期設定チェックリストの恒久的な完了フラグ(不具合修正: 過去月へ切り替えると
      // チェックリストが再表示されていた問題)。月ごとのデータ有無ではなく、店舗単位で
      // 一度trueになったら以後ずっとtrueのまま——company.setup(会社作成ウィザードの
      // 完了状態)とは別の概念。
      initialSetupCompleted: Boolean(row.initial_setup_completed),
    };
  });
  return byStoreId;
};

// Shared by every Supabase-backed map field (targets, fixedCosts, variableCosts, monthClosing,
// ...): mergeShallowMap/mergeItemArrayMap only ever union local+remote in, so a key that used to
// exist locally (old localStorage, a row since deleted from Supabase, a leftover from before a
// table existed) survives forever unless something explicitly drops it. Call this after merging,
// passing every key we just authoritatively fetched for (expectedKeys) and the fresh overlay we
// fetched it into (freshMap) — any expected key NOT in freshMap is confirmed gone and pruned.
export const pruneStaleKeys = (mergedMap, expectedKeys, freshMap) => {
  const pruned = { ...mergedMap };
  expectedKeys.forEach((key) => {
    if (!(key in freshMap)) delete pruned[key];
  });
  return pruned;
};

// pruneStaleKeysの限界を補うためのもの: 配列値マップ(1キー = 複数の項目、例:
// fixedCosts["storeId__month"] = [item, item, ...])では、キー自体は生き続けたまま配列の
// 中の特定の1件だけが削除される(例: 費用項目の削除)ことがある。pruneStaleKeysはキー単位
// でしか要不要を判定できないため、同じキーに他の項目が1件でも残っていると、削除済みの項目
// ごと配列全体をそのまま素通りさせてしまう — これが「削除したのに再取得すると復活する」
// 不具合の原因だった(削除後もローカル/localStorageに残っていた項目が、次回のhydrate時に
// mergeItemArrayMapのidベースunionマージで復活していた)。
// このため、対象ドメインが無制限(会社全体)取得である場合に限り、各キーの配列を「fresh側の
// idセットに実在する項目だけ」へ絞り込む — fresh側はその会社について完全な情報を持つため、
// fresh側に無いid(=Supabase上で既に削除済み)は安全に除外できる。keyPrefixesに一致しない
// キー(例: 他社の会社切り替え前の残留データ等、今回の取得対象外)は一切変更しない。
export const pruneDeletedItemsFromItemArrayMap = (mergedMap, freshMap, keyPrefixes) => {
  const pruned = { ...(mergedMap || {}) };
  Object.keys(pruned).forEach((key) => {
    if (!keyPrefixes.some((prefix) => key.startsWith(prefix))) return;
    const freshIds = new Set((freshMap?.[key] || []).map((item) => item?.id));
    pruned[key] = (pruned[key] || []).filter((item) => freshIds.has(item?.id));
  });
  return pruned;
};

const mergeDailyResultsMap = (localMap = {}, remoteMap = {}) => {
  const safeLocal = localMap && typeof localMap === "object" ? localMap : {};
  const safeRemote = remoteMap && typeof remoteMap === "object" ? remoteMap : {};
  const keys = new Set([...Object.keys(safeLocal), ...Object.keys(safeRemote)]);
  const merged = {};
  keys.forEach((key) => {
    const localList = Array.isArray(safeLocal[key]) ? safeLocal[key] : [];
    const remoteList = Array.isArray(safeRemote[key]) ? safeRemote[key] : [];
    merged[key] = deduplicateDailyEntries([...localList, ...remoteList]).entries;
  });
  return merged;
};

// dayClosingStates is a plain boolean per date, so a naive union can't tell "remote never
// knew about this close" (should keep local's true) apart from "remote has a newer, explicit
// un-close" (should keep remote's false) — both look like "remote is missing a true". We
// resolve that with a parallel per-date updatedAt map: whichever side recorded the more
// recent change to that specific date wins outright. Only when neither side has a timestamp
// for a date (older data predating this tracking) do we fall back to OR, which never discards
// a close but also can never un-discard one — acceptable since new toggles always carry a
// timestamp going forward.
const mergeDayClosingStatesMap = (localMap = {}, remoteMap = {}, localTimestamps = {}, remoteTimestamps = {}) => {
  const safeLocal = localMap && typeof localMap === "object" ? localMap : {};
  const safeRemote = remoteMap && typeof remoteMap === "object" ? remoteMap : {};
  const safeLocalTimestamps = localTimestamps && typeof localTimestamps === "object" ? localTimestamps : {};
  const safeRemoteTimestamps = remoteTimestamps && typeof remoteTimestamps === "object" ? remoteTimestamps : {};
  const keys = new Set([...Object.keys(safeLocal), ...Object.keys(safeRemote)]);
  const merged = {};
  keys.forEach((key) => {
    const localDates = safeLocal[key] || {};
    const remoteDates = safeRemote[key] || {};
    const localDateTimestamps = safeLocalTimestamps[key] || {};
    const remoteDateTimestamps = safeRemoteTimestamps[key] || {};
    const dateKeys = new Set([...Object.keys(localDates), ...Object.keys(remoteDates)]);
    const mergedDates = {};
    dateKeys.forEach((date) => {
      const localAt = String(localDateTimestamps[date] || "");
      const remoteAt = String(remoteDateTimestamps[date] || "");
      if (localAt && remoteAt) {
        mergedDates[date] = localAt >= remoteAt ? Boolean(localDates[date]) : Boolean(remoteDates[date]);
      } else if (localAt) {
        mergedDates[date] = Boolean(localDates[date]);
      } else if (remoteAt) {
        mergedDates[date] = Boolean(remoteDates[date]);
      } else {
        mergedDates[date] = Boolean(localDates[date]) || Boolean(remoteDates[date]);
      }
    });
    merged[key] = mergedDates;
  });
  return merged;
};

const mergeDayClosingUpdatedAtMap = (localMap = {}, remoteMap = {}) => {
  const safeLocal = localMap && typeof localMap === "object" ? localMap : {};
  const safeRemote = remoteMap && typeof remoteMap === "object" ? remoteMap : {};
  const keys = new Set([...Object.keys(safeLocal), ...Object.keys(safeRemote)]);
  const merged = {};
  keys.forEach((key) => {
    const localDates = safeLocal[key] || {};
    const remoteDates = safeRemote[key] || {};
    const dateKeys = new Set([...Object.keys(localDates), ...Object.keys(remoteDates)]);
    const mergedDates = {};
    dateKeys.forEach((date) => {
      const localAt = String(localDates[date] || "");
      const remoteAt = String(remoteDates[date] || "");
      mergedDates[date] = localAt >= remoteAt ? (localAt || remoteAt) : remoteAt;
    });
    merged[key] = mergedDates;
  });
  return merged;
};

const mergeItemsById = (localList = [], remoteList = []) => {
  const safeLocal = Array.isArray(localList) ? localList : [];
  const safeRemote = Array.isArray(remoteList) ? remoteList : [];
  const byId = new Map();
  safeLocal.forEach((item) => { if (item?.id) byId.set(item.id, item); });
  safeRemote.forEach((item) => { if (item?.id) byId.set(item.id, item); });
  const withoutId = [...safeLocal.filter((item) => !item?.id), ...safeRemote.filter((item) => !item?.id)];
  return [...byId.values(), ...withoutId];
};

const mergeItemArrayMap = (localMap = {}, remoteMap = {}) => {
  const safeLocal = localMap && typeof localMap === "object" ? localMap : {};
  const safeRemote = remoteMap && typeof remoteMap === "object" ? remoteMap : {};
  const keys = new Set([...Object.keys(safeLocal), ...Object.keys(safeRemote)]);
  const merged = {};
  keys.forEach((key) => {
    merged[key] = mergeItemsById(safeLocal[key], safeRemote[key]);
  });
  return merged;
};

const mergeShallowMap = (localMap = {}, remoteMap = {}) => ({
  ...(localMap && typeof localMap === "object" ? localMap : {}),
  ...(remoteMap && typeof remoteMap === "object" ? remoteMap : {}),
});

// 「更新中」表示が無限に点滅し続けた不具合(全ユーザー共通の根本原因)の修正で追加。
//
// 根本原因: appStateの自動保存(persist)effectは「前回persistした内容と今のappStateが
// 同じかどうか」をJSON.stringifyの文字列比較だけで判定していたが、比較対象の2つの値の
// 「形」自体が最初から一致しない設計になっていた——hydrateFromSupabase完了時にセットする
// 比較用シグネチャは、日次売上・目標・固定費等の各専用テーブルからの取得結果(overlay)を
// 反映する前のnextRemoteState(tenant_snapshotsの生payload相当)から作っていたのに対し、
// persist effect側は実際のappState(overlay適用後のmerged結果、常により多くのデータを含む)
// から作っていた。この2つは構造的に同じ内容になり得ないため、hydrateのたびに「変化あり」と
// 誤検知してtenant_snapshotsへ書き込み→Supabase Realtimeが自分自身の書き込みを検知して
// 再hydrate→また「変化あり」と誤検知……という自己増殖ループになっていた(書き込みのたびに
// 「更新中」バナーが点滅する)。日次売上等を編集した実ユーザー(=このoverlayの差分が大きい)
// ほど発生しやすく、ほとんど編集をしないsystem_admin自身の検証アカウントでは目立たなかった
// と考えられる。加えて、各テーブルのSELECTにORDER BYが無く行の物理順序がUPDATE後に変わり
// 得ること(例: 日締めのUPDATE)も、たとえ内容が同一でも配列の並び順だけで別内容と誤判定
// される追加の誤検知要因になっていた。
//
// 修正方針: (1)比較に使う「形」を1箇所に集約し、hydrate側・persist側が必ず同じ変換を通す
// ようにする(buildPersistenceComparableState)。(2)配列・オブジェクトの並び順の違いだけでは
// 「変化あり」と判定しないよう、キー・配列要素を正規化してから比較する
// (canonicalStringifyForComparison)。どちらか一方だけでは再発し得るため両方セットで直す —
// (1)だけでは配列の並び順ゆらぎで誤検知が残り、(2)だけでは形自体が違う2つを比較しても
// 意味が無い。
export const canonicalStringifyForComparison = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringifyForComparison(item)).sort().join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined && typeof value[key] !== "function")
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringifyForComparison(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

// hydrate完了直後の比較用シグネチャ(App.jsx側)と、自動保存effectの比較(同じくApp.jsx側)を
// 必ず同じ「形」から作るための共通の下ごしらえ。companySnapshots内の入れ子companySnapshots
// (自己参照的に肥大化するだけで比較に意味が無い)を取り除く点だけを行う——それ以外は
// 呼び出し側がappStateそのもの(hydrate後のmerged結果、または現在のappState)を渡す。
//
// 文字入力時の画面ガクつき調査(月次レビュー)で発見した実際の原因の1つ: buildTenantSnapshotRow
// (supabaseRemote.js)は、日次データ・費用・目標・月次レビュー等の「独自のSupabaseテーブルを
// 持つフィールド」をtenant_snapshotsのpayloadへ意図的に一切含めない(理由はそちら側のコメント
// 参照——statement timeout不具合の再発防止)。ところがこの比較関数はそれを知らずappState
// そのものをそのまま比較していたため、月次レビューの文章を保存してmonthlyReviewsだけが
// 変わっても「差分あり」と誤判定し、実際には中身が1バイトも変わらない(=完全に無駄な)
// tenant_snapshots書き込みを発生させていた。この書き込みがSupabase Realtimeの
// postgres_changesイベントを発火させ、それを自分自身が購読している(App.jsx側の
// remoteSyncChannelRef)ため、保存の1〜3秒後(書き込み・Realtimeの往復分の遅延)に
// 自分自身のhydrateFromSupabase(全面的な再取得)が誘発され、月次レビュー画面に限らず
// 「入力を止めてしばらくしてから画面全体がガクつく」現象の真因になっていた。
// buildTenantSnapshotRowが除外しているフィールドと完全に同じ一覧をここでも除外することで、
// これらのフィールドの変更だけではtenant_snapshotsへの書き込み自体が発生しなくなる
// (=無駄な書き込み・Realtime自己通知・再取得の連鎖が構造的に無くなる)。日次データや
// 会社/店舗構造など、実際にtenant_snapshotsのpayloadに含まれるフィールドの変更検知には
// 一切影響しない。
export const buildPersistenceComparableState = (state = {}) => ({
  ...state,
  companySnapshots: Object.fromEntries(Object.entries(state.companySnapshots || {}).map(([key, value]) => [key, {
    ...(value || {}),
    companySnapshots: undefined,
  }])),
  dailyResults: undefined,
  targets: undefined,
  fixedCosts: undefined,
  costMonthlyAmounts: undefined,
  storeInventoryBalances: undefined,
  variableCosts: undefined,
  monthClosing: undefined,
  monthClosingStatus: undefined,
  storeHolidays: undefined,
  allStoresTargets: undefined,
  allStoresBusinessDaySettings: undefined,
  allStoresHolidays: undefined,
  monthlyReviews: undefined,
  storeStatusAuditLog: undefined,
  cashBreakdownResults: undefined,
  dailyBatchEntries: undefined,
  businessDaySettings: undefined,
  dayClosingStates: undefined,
  dayClosingUpdatedAt: undefined,
  dailyResultBackups: undefined,
});

// Combines a freshly-fetched Supabase snapshot into the in-memory app state without
// discarding store/month data the snapshot's payload doesn't happen to include: every
// snapshot row embeds the *entire* multi-store app state as of whichever save produced
// it, so a naive `{...local, ...remote}` swap can silently wipe out another store's (or
// a more recently edited store's) data whenever an older/other-store snapshot is fetched.
export const mergeRemoteAppState = (localState = {}, remoteState = {}) => ({
  ...localState,
  ...remoteState,
  dailyResults: mergeDailyResultsMap(localState.dailyResults, remoteState.dailyResults),
  dayClosingStates: mergeDayClosingStatesMap(localState.dayClosingStates, remoteState.dayClosingStates, localState.dayClosingUpdatedAt, remoteState.dayClosingUpdatedAt),
  dayClosingUpdatedAt: mergeDayClosingUpdatedAtMap(localState.dayClosingUpdatedAt, remoteState.dayClosingUpdatedAt),
  dailyResultBackups: mergeItemArrayMap(localState.dailyResultBackups, remoteState.dailyResultBackups),
  // まとめて入力(daily_batch_entries)もfixedCosts/variableCosts等と同じ「idを持つ配列を
  // storeId__monthでキー化したマップ」構造 — 同じmergeItemArrayMapで、フェッチ範囲外の
  // store/monthのローカルキャッシュを消さずに保持する(dailyResultsと同じ理由)。
  dailyBatchEntries: mergeItemArrayMap(localState.dailyBatchEntries, remoteState.dailyBatchEntries),
  fixedCosts: mergeItemArrayMap(localState.fixedCosts, remoteState.fixedCosts),
  costMonthlyAmounts: mergeShallowMap(localState.costMonthlyAmounts, remoteState.costMonthlyAmounts),
  storeInventoryBalances: mergeShallowMap(localState.storeInventoryBalances, remoteState.storeInventoryBalances),
  monthlyReviews: mergeShallowMap(localState.monthlyReviews, remoteState.monthlyReviews),
  cashBreakdownResults: mergeShallowMap(localState.cashBreakdownResults, remoteState.cashBreakdownResults),
  variableCosts: mergeItemArrayMap(localState.variableCosts, remoteState.variableCosts),
  monthClosing: mergeItemArrayMap(localState.monthClosing, remoteState.monthClosing),
  targets: mergeShallowMap(localState.targets, remoteState.targets),
  allStoresTargets: mergeShallowMap(localState.allStoresTargets, remoteState.allStoresTargets),
  allStoresBusinessDaySettings: mergeShallowMap(localState.allStoresBusinessDaySettings, remoteState.allStoresBusinessDaySettings),
  storeHolidays: mergeShallowMap(localState.storeHolidays, remoteState.storeHolidays),
  allStoresHolidays: mergeShallowMap(localState.allStoresHolidays, remoteState.allStoresHolidays),
  businessDaySettings: mergeShallowMap(localState.businessDaySettings, remoteState.businessDaySettings),
  monthClosingStatus: mergeShallowMap(localState.monthClosingStatus, remoteState.monthClosingStatus),
});

// 営業進捗 = 選択中の店舗・対象月の日次データのうち、日締め済みになっているユニークな
// 営業日の日付数。dayClosingStates が唯一の正となる情報源で、その日付に実際の日次データが
// あるものだけを数える(日締めは常に saveDailyEntry を経てから立つため、通常は1:1で対応する)。
// 保存しただけ(日締め未実施)や、日締めを解除した日はここに含まれない。
export const getBusinessDaySummary = (state, storeId, monthValue) => {
  const key = buildMonthKey(storeId, monthValue);
  const settings = getBusinessDaySettings(state, storeId, monthValue);
  const monthInfo = getMonthInfo(monthValue);
  const holidayDates = getStoreHolidayDates(state, storeId, monthValue);
  const holidayDateSet = new Set(holidayDates);
  const holidayCount = Math.max(parseNumber(settings.holidayCount), 0);
  const manualBusinessDayCount = parseNumber(settings.businessDayCount);
  // 優先順位: カレンダーで具体的な日付が設定されていればそれを最優先(実際の日数を数える)。
  // 次に手動営業日数の上書き。どちらも無ければ既存の休業日「数」から算出する(後方互換)。
  const businessDayCount = holidayDateSet.size > 0
    ? Math.max(monthInfo.daysInMonth - holidayDateSet.size, 0)
    : (settings.mode === "manual" && Number.isInteger(manualBusinessDayCount) && manualBusinessDayCount > 0
      ? manualBusinessDayCount
      : Math.max(monthInfo.daysInMonth - holidayCount, 0));
  const closingMap = state.dayClosingStates?.[key] || {};
  const dailyEntryDates = new Set(
    deduplicateDailyEntries(state.dailyResults?.[key] || []).entries
      .map((entry) => String(entry?.date || ""))
      .filter(Boolean)
  );

  // 店休日は営業完了数に含めない(要件11)。
  const closingBasedClosedDates = Object.entries(closingMap)
    .filter(([date, isClosed]) => Boolean(isClosed) && String(date).startsWith(`${monthValue}-`) && dailyEntryDates.has(String(date)) && !holidayDateSet.has(String(date)))
    .map(([date]) => String(date));
  // まとめて入力で反映された日も「入力済み・完了」として営業進捗に数える(要件17)。
  // getBatchAllocatedEntries自体が店休日・既存の実日次データを既に除外して計算するため、
  // ここで追加のフィルタは不要 — 単純に和集合を取るだけでよい。まとめ入力を使っていない
  // 店舗はこの集合が常に空なので、既存店舗のcompletedDays/progressRateは一切変わらない。
  // 未来日は緑(完了)にしない(要件9)。日次入力の日締めは既にUI側(toggleDayClosing)で
  // 未来日を拒否しているため通常は起こらないが、まとめて入力(daily_batch_entries)は
  // 終了日に未来日制限が無く、期間終了日の指定次第では配分結果(getBatchAllocatedDatesSet)
  // に未来日が含まれ得る — ここで一律に遮断し、入力経路によらず「未来日は未完了」を保証する。
  const todayIso = formatLocalDate(new Date());
  const closedDateList = [...new Set([...closingBasedClosedDates, ...getBatchAllocatedDatesSet(state, storeId, monthValue)])]
    .filter((date) => date <= todayIso)
    .sort((a, b) => a.localeCompare(b));

  return {
    businessDayCount,
    completedDays: closedDateList.length,
    remainingBusinessDays: businessDayCount === null ? null : Math.max(businessDayCount - closedDateList.length, 0),
    progressRate: businessDayCount === null ? null : (closedDateList.length / Math.max(businessDayCount, 1)) * 100,
    closedDates: closedDateList,
    holidayDates,
  };
};

// 「全店舗」専用の営業進捗。店舗数に応じて営業日数が増えないよう、営業日数・休業日は
// company_adminが設定する全店舗共通の値(getAllStoresBusinessDaySettings)を使い、各店舗の
// businessDayCountは一切合算しない。
// 「営業完了」の判定も店舗横断の特別ルール: ある日付が「全店舗として営業完了」になるのは、
// 登録されている全ての実店舗がその日の日締めを終えている時だけ(店舗ごとのclosedDatesの積集合)。
// 1店舗でも未締めなら、他の店舗が締めていてもその日はまだカウントしない。
// storesInput: {id, openingDate}形式の店舗オブジェクトの配列(openingDateが分かれば要件26の
// 「新規店舗追加時に過去日を未締め扱いにしない」判定に使う)。文字列(id)だけの配列も後方
// 互換として受け付ける(openingDateなし=常に開店済み扱い)。
export const getAllStoresBusinessDaySummary = (state, companyId, storesInput, monthValue) => {
  const stores = (storesInput || [])
    .map((item) => (typeof item === "string" ? { id: item, openingDate: "" } : item))
    .filter((item) => item && item.id);

  const settings = getAllStoresBusinessDaySettings(state, companyId, monthValue);
  const monthInfo = getMonthInfo(monthValue);
  const holidayDates = getAllStoresHolidayDates(state, companyId, monthValue);
  const holidayDateSet = new Set(holidayDates);
  const holidayCount = Math.max(parseNumber(settings.holidayCount), 0);
  const manualBusinessDayCount = parseNumber(settings.businessDayCount);
  // 実店舗と同じ優先順位: カレンダー日付 > 手動営業日数 > 従来の休業日「数」。
  const businessDayCount = holidayDateSet.size > 0
    ? Math.max(monthInfo.daysInMonth - holidayDateSet.size, 0)
    : (settings.mode === "manual" && Number.isInteger(manualBusinessDayCount) && manualBusinessDayCount > 0
      ? manualBusinessDayCount
      : Math.max(monthInfo.daysInMonth - holidayCount, 0));

  if (!stores.length) {
    return { businessDayCount, completedDays: 0, remainingBusinessDays: Math.max(businessDayCount, 0), progressRate: businessDayCount ? 0 : null, closedDates: [], holidayDates };
  }

  const perStoreClosedDateSets = stores.map((store) => new Set(getBusinessDaySummary(state, store.id, monthValue).closedDates || []));
  // 全店舗カレンダーの「緑」判定不具合の修正: 各店舗自身の店休日(store_business_holidays、
  // 会社共通のholidayDateSetとは別物)を、その日の「営業対象店舗」から除外するために必要。
  // これが無いと、ある店舗がその日だけ個別に店休日でも、その店舗には当然完了データが
  // 存在しない(closedDatesに入らない)ため、他の全店舗が入力済みでも「1店舗でも未完了」
  // として扱われ、緑にならなかった。
  const perStoreHolidayDateSets = stores.map((store) => new Set(getStoreHolidayDates(state, store.id, monthValue) || []));
  // 未来日は「入力データ・まとめ入力の有無」に関わらず絶対に緑(営業完了)にしない(要件9)。
  // まとめて入力(daily_batch_entries)の期間終了日には未来日制限が無いため、理論上は
  // 未来日にも配分結果(getBatchAllocatedDatesSet)が存在し得る — この関数側で必ず遮断する。
  const todayIso = formatLocalDate(new Date());

  // 日付ごとに判定する(要件2・3・5・10・26): 全店舗共通の休業日(holidayDateSet)は対象外、
  // 各店舗の開店前(openingDate)・その店舗自身の店休日・その日付時点で停止/アーカイブ済み
  // だった店舗は、その日の「営業対象店舗」から除外する — isStoreApplicableOnDateへ集約
  // (getUnclosedStoresForDateと共通)。「その日に営業対象となっている店舗だけ」で判定し、
  // 営業対象店舗が1件も無い日(全店舗が個別店休日 or 全店舗停止中等)は「全店舗の店休日」
  // (赤)として扱う(要件5) — holidayDatesへ合流させる。
  const closedDateList = [];
  const computedAllOffDates = [];
  for (let day = 1; day <= monthInfo.daysInMonth; day += 1) {
    const dateIso = `${monthValue}-${String(day).padStart(2, "0")}`;
    if (holidayDateSet.has(dateIso)) continue;
    const applicableIndexes = [];
    stores.forEach((store, index) => {
      if (isStoreApplicableOnDate(state, store, dateIso, perStoreHolidayDateSets[index])) applicableIndexes.push(index);
    });
    if (!applicableIndexes.length) {
      computedAllOffDates.push(dateIso);
      continue;
    }
    if (dateIso > todayIso) continue;
    const allClosed = applicableIndexes.every((index) => perStoreClosedDateSets[index].has(dateIso));
    if (allClosed) closedDateList.push(dateIso);
  }

  const combinedHolidayDates = [...new Set([...holidayDates, ...computedAllOffDates])].sort((a, b) => a.localeCompare(b));

  return {
    businessDayCount,
    completedDays: closedDateList.length,
    remainingBusinessDays: Math.max(businessDayCount - closedDateList.length, 0),
    progressRate: businessDayCount ? (closedDateList.length / Math.max(businessDayCount, 1)) * 100 : null,
    closedDates: closedDateList,
    holidayDates: combinedHolidayDates,
  };
};

// ある1日について、営業対象なのにまだ日締めが完了していない店舗名を返す(要件13:
// 「全店舗締めたと思っていたが、実際には1店舗だけ未締めだった」を即座に特定できるように
// する管理性改善)。判定基準はgetAllStoresBusinessDaySummaryと完全に同じ
// isStoreApplicableOnDateを共有するため、カレンダーの緑判定とこの内訳表示が食い違うことは
// ない(要件12)。
export const getUnclosedStoresForDate = (state, companyId, storesInput, monthValue, dateIso) => {
  const stores = (storesInput || [])
    .map((item) => (typeof item === "string" ? { id: item, name: item, openingDate: "" } : item))
    .filter((item) => item && item.id);
  const holidayDateSet = new Set(getAllStoresHolidayDates(state, companyId, monthValue));
  if (holidayDateSet.has(dateIso)) {
    return { applicableStoreNames: [], unclosedStoreNames: [], isAllStoresHoliday: false };
  }
  const applicableStores = stores.filter((store) => {
    const storeHolidayDateSet = new Set(getStoreHolidayDates(state, store.id, monthValue));
    return isStoreApplicableOnDate(state, store, dateIso, storeHolidayDateSet);
  });
  const unclosedStores = applicableStores.filter((store) => {
    const closedDateSet = new Set(getBusinessDaySummary(state, store.id, monthValue).closedDates || []);
    return !closedDateSet.has(dateIso);
  });
  return {
    applicableStoreNames: applicableStores.map((store) => store.name || store.id),
    unclosedStoreNames: unclosedStores.map((store) => store.name || store.id),
    isAllStoresHoliday: applicableStores.length === 0,
  };
};

export const getBusinessDayDates = (monthValue, holidayDates = []) => {
  const { yearNumber, monthNumber, daysInMonth } = getMonthInfo(monthValue);
  const holidaySet = new Set((holidayDates || []).map((item) => String(item).trim()).filter(Boolean));
  const list = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(yearNumber, monthNumber - 1, day);
    const iso = formatLocalDate(date);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    if (!isWeekend && !holidaySet.has(iso)) {
      list.push(iso);
    }
  }

  return list;
};

// まとめて入力の期間内の「営業日数」を数えるための日付一覧(要件14・15: カレンダー日数では
// なく営業日数で平均を出す)。getBusinessDayDates(上)とは違い週末を一律除外しない — これは
// getBusinessDaySummaryのbusinessDayCountが「明示的な店休日カレンダー(getStoreHolidayDates)
// が設定されていればそれだけを除外する、無ければ除外しない」という既存の定義そのものに
// 合わせるため(週末を勝手に除外すると、月全体のbusinessDayCountの定義と食い違ってしまう)。
// startDate〜endDateは常に単一暦月内(DBのCHECK制約で保証済み)。
export const getBusinessDayDatesInRange = (state, storeId, startDate, endDate) => {
  if (!startDate || !endDate) return [];
  const monthValue = String(startDate).slice(0, 7);
  const holidaySet = new Set(getStoreHolidayDates(state, storeId, monthValue));
  const dates = [];
  let cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cursor <= end) {
    const iso = formatLocalDate(cursor);
    if (!holidaySet.has(iso)) dates.push(iso);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  return dates;
};

// まとめて入力の期間合計を「その日その日の実績」としてカレンダー・営業進捗・日次入力の
// 閲覧専用表示に使えるよう、その都度(店休日設定・既存の実日次入力・他のまとめ入力の状況に
// 応じて)動的に配分する。結果はDBへは一切保存しない — 店休日設定が変わるたびに常に最新の
// 状態から計算し直されるため、明示的な「再計算トリガー」を書く必要がない(要件5・6・8は
// この関数を都度呼ぶだけで自動的に満たされる)。月間合計(calculateMonthSummaryのsales等)は
// この配分結果からではなく、daily_batch_entriesの期間合計を直接合算する既存ロジックのまま
// なので、配分ロジックのどんな計算結果も月間合計には一切影響しない(要件18の核心的な保証)。
//
// 最大剰余法(largest remainder method): 合計を日数で割った商を全日に配り、割り切れない
// 余りを日付の早い方から1ずつ追加で配る。客数31人/10日なら3人×9日+4人×1日のように、
// 分配後の合計が必ず元の合計と一致する(要件6・11)。金額もこのアプリでは常に整数円のため
// 同じロジックを使う。
const distributeIntegerAcrossDates = (total, dateCount) => {
  if (!Number.isFinite(total) || dateCount <= 0) return [];
  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(Math.round(total));
  const base = Math.floor(absTotal / dateCount);
  const remainder = absTotal - base * dateCount;
  return Array.from({ length: dateCount }, (_, index) => sign * (base + (index < remainder ? 1 : 0)));
};

const BATCH_ALLOCATABLE_FIELDS = ["totalSales", "technicalSales", "retailSales", "otherSales", "customers", "newCustomers", "repeatCustomers", "reviewCount", "cashAmount", "cashlessAmount", "pointAmount"];

// 対象店舗・対象月のまとめ入力すべてを、日別の「配分エントリ」の配列へ展開する。
// isBatchDerived: true と batchEntryId を必ず持たせる(要件2: どのまとめ入力由来かを
// 常に追跡できるようにする)。
//   - 開始日が早い(同じ日ならid順)まとめ入力から順に処理し、後続のまとめ入力は既に
//     「claimed」された日付を対象から除外する(要件14: まとめ入力同士の二重計上防止)。
//   - 実日次入力(dailyResults)が既にある日付は最初から候補に含めない(要件12・13:
//     既存データを保護)。
//   - getBusinessDayDatesInRange自体が店休日カレンダーを除外するため、店休日は候補にすら
//     入らない(要件5・7: 店休日には0円/0人を割り当てず、対象外として扱う)。
export const getBatchAllocatedEntries = (state, storeId, monthValue) => {
  const batchEntries = [...getBatchEntriesForStoreMonth(state, storeId, monthValue)]
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || String(a.id).localeCompare(String(b.id)));
  if (!batchEntries.length) return [];

  const realEntryDates = new Set(getDailyResultsForStoreMonth(state, storeId, monthValue).map((entry) => String(entry?.date || "")).filter(Boolean));
  const claimedDates = new Set();
  const allocated = [];

  batchEntries.forEach((entry) => {
    const candidateDates = getBusinessDayDatesInRange(state, storeId, entry.startDate, entry.endDate)
      .filter((date) => !realEntryDates.has(date) && !claimedDates.has(date));
    if (!candidateDates.length) return;

    const perFieldDistribution = {};
    BATCH_ALLOCATABLE_FIELDS.forEach((field) => {
      const value = entry[field];
      perFieldDistribution[field] = value === null || value === undefined
        ? candidateDates.map(() => null)
        : distributeIntegerAcrossDates(value, candidateDates.length);
    });

    candidateDates.forEach((date, index) => {
      claimedDates.add(date);
      const dayEntry = { date, batchEntryId: entry.id, isBatchDerived: true };
      BATCH_ALLOCATABLE_FIELDS.forEach((field) => {
        dayEntry[field] = perFieldDistribution[field][index];
      });
      allocated.push(dayEntry);
    });
  });

  return allocated;
};

// カレンダー・営業進捗など、日付集合だけあれば十分な用途向けの軽量版。
export const getBatchAllocatedDatesSet = (state, storeId, monthValue) =>
  new Set(getBatchAllocatedEntries(state, storeId, monthValue).map((entry) => entry.date));

export const normalizeObjectMap = (value) => {
  if (!value || typeof value !== "object") return {};
  return value;
};

const normalizeUserList = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      ...item,
      authUserId: typeof item.authUserId === "string" ? item.authUserId : "",
    }));
};

const resolveCurrentProfileId = ({ users, currentUserId, currentAuthUserId }) => {
  const normalizedCurrentUserId = typeof currentUserId === "string" ? currentUserId : "";
  if (!normalizedCurrentUserId) return "";
  if (users.some((user) => user.id === normalizedCurrentUserId)) return normalizedCurrentUserId;

  const authUserId = typeof currentAuthUserId === "string" && currentAuthUserId.trim()
    ? currentAuthUserId.trim()
    : normalizedCurrentUserId;
  const matchedUser = users.find((user) => user.authUserId && user.authUserId === authUserId);
  return matchedUser?.id || normalizedCurrentUserId;
};

export const normalizeAppState = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const seeded = createInitialAppState();
  const stores = Array.isArray(source.stores)
    ? source.stores.filter(Boolean).map(String)
    : [];
  const fallbackSelectedStore = typeof source.selectedStore === "string" && source.selectedStore.trim() ? source.selectedStore : "";
  // 「全店舗」(company_admin専用の仮想ビュー)は実店舗名の一覧(stores)には絶対に含まれない
  // ため、それだけを理由にstores[0](実店舗)へ戻してしまわないようにする。権限チェック自体は
  // ここでは行わない(role情報を持たない低レベル関数のため) — 呼び出し側(App.jsxの
  // self-healing effect等)が権限を失ったユーザーを実店舗へ戻す責務を持つ。
  const selectedStore = fallbackSelectedStore === ALL_STORES_VALUE
    ? ALL_STORES_VALUE
    : (stores.includes(fallbackSelectedStore) ? fallbackSelectedStore : (stores[0] || fallbackSelectedStore));
  const selectedMonth = source.selectedMonth || seeded.selectedMonth;
  const users = normalizeUserList(source.users);
  const currentUserId = resolveCurrentProfileId({
    users,
    currentUserId: source.currentUserId,
    currentAuthUserId: source.currentAuthUserId,
  });
  const matchedCurrentUser = users.find((user) => user.id === currentUserId) || null;
  const currentAuthUserId = typeof source.currentAuthUserId === "string" && source.currentAuthUserId.trim()
    ? source.currentAuthUserId.trim()
    : matchedCurrentUser?.authUserId || "";

  const normalized = {
    ...seeded,
    ...source,
    users,
    stores,
    selectedStore,
    selectedMonth,
    currentUserId,
    currentAuthUserId,
    targets: normalizeObjectMap(source.targets),
    dailyResults: normalizeObjectMap(source.dailyResults),
    fixedCosts: normalizeObjectMap(source.fixedCosts),
    costMonthlyAmounts: normalizeObjectMap(source.costMonthlyAmounts),
    storeInventoryBalances: normalizeObjectMap(source.storeInventoryBalances),
    variableCosts: normalizeObjectMap(source.variableCosts),
    monthClosing: normalizeObjectMap(source.monthClosing),
    monthClosingStatus: normalizeObjectMap(source.monthClosingStatus),
    dailyResultBackups: normalizeObjectMap(source.dailyResultBackups),
    preferences: {
      ...(source.preferences || {}),
      showOtherSales: Boolean(source.preferences?.showOtherSales),
    },
    businessDaySettings: normalizeObjectMap(source.businessDaySettings),
    dayClosingStates: normalizeObjectMap(source.dayClosingStates),
    dayClosingUpdatedAt: normalizeObjectMap(source.dayClosingUpdatedAt),
    storeHolidays: normalizeObjectMap(source.storeHolidays),
    saveStatus: {
      status: source.saveStatus?.status || "saved",
      message: source.saveStatus?.message || "自動保存済み",
      timestamp: source.saveStatus?.timestamp || "",
      error: Boolean(source.saveStatus?.error),
    },
  };

  // Self-healing: rewrites any surviving "storeName__month" keys (from data saved before the
  // store_id-keyed migration) to "storeId__month", using this same blob's own companies/stores
  // list. Safe to run unconditionally on every normalize — a no-op once everything's already
  // id-keyed, since no stored key's prefix will ever match a store's *name* at that point.
  return migrateNameKeyedMapsToStoreId(normalized);
};

export const readAppState = () => {
  try {
    const saved = readStorage(STORAGE_KEYS.appState, null);
    if (saved) {
      return normalizeAppState(saved);
    }
  } catch {
    // fall through to initial state
  }
  return createInitialAppState();
};

export const writeAppState = (state) => {
  try {
    const nextState = normalizeAppState(state);
    localStorage.setItem(STORAGE_KEYS.appState, JSON.stringify(nextState));
    return nextState;
  } catch {
    return state;
  }
};

export const money = (value) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

export const moneyDiff = (value) => `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`;

export const number = (value) => new Intl.NumberFormat("ja-JP").format(Number(value || 0));

export const percent = (value) => `${Number.isFinite(value) ? value.toFixed(1) : "0.0"}%`;

export const roundCurrency = (value, roundingMode = "half-up") => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;

  if (roundingMode === "floor") {
    return Math.floor(amount);
  }
  if (roundingMode === "ceil") {
    return Math.ceil(amount);
  }
  return Math.round(amount);
};

export const calculateTaxSummary = (input = {}) => {
  const salesInclusive = parseNumber(input.sales);
  const expensesInclusive = parseNumber(input.totalExpenses);
  const taxRate = Number(input.taxRate ?? 0.1);
  const rate = Number.isFinite(taxRate) && taxRate >= 0 ? taxRate : 0.1;
  const roundingMode = input.roundingMode || "half-up";
  const taxExclusiveSales = salesInclusive / (1 + rate);
  const taxAmount = salesInclusive - taxExclusiveSales;
  const taxExclusiveExpenses = expensesInclusive / (1 + rate);
  const taxAmountOnExpenses = expensesInclusive - taxExclusiveExpenses;
  const estimatedTax = roundCurrency(taxAmount, roundingMode);
  const estimatedTaxOnExpenses = roundCurrency(taxAmountOnExpenses, roundingMode);

  return {
    grossSales: roundCurrency(salesInclusive, roundingMode),
    taxExclusiveSales: roundCurrency(taxExclusiveSales, roundingMode),
    taxAmount: roundCurrency(taxAmount, roundingMode),
    taxExclusiveExpenses: roundCurrency(taxExclusiveExpenses, roundingMode),
    taxAmountOnExpenses: roundCurrency(estimatedTaxOnExpenses, roundingMode),
    rate,
    estimatedTax: roundCurrency(estimatedTax + estimatedTaxOnExpenses, roundingMode),
    roundingMode,
  };
};

export const getTargetForStoreMonth = (state, storeId, monthValue) => ({
  ...defaultTarget,
  ...(state.targets?.[buildMonthKey(storeId, monthValue)] || {}),
});

// 「全店舗」(company_admin専用の仮想集計ビュー)専用のキー。実店舗のbuildMonthKeyとは別の
// マップ(state.allStoresTargets/state.allStoresBusinessDaySettings)を使うので、店舗名と
// 衝突する心配がない。company_idを含めるのは、system_adminが会社を切り替えた際に前の会社の
// 全店舗目標が新しい会社のビューに残留(≒他社データ混在)しないようにするため。
export const buildCompanyMonthKey = (companyId, monthValue) => `${companyId}__${monthValue}`;

export const getAllStoresTargetForCompanyMonth = (state, companyId, monthValue) => ({
  ...defaultTarget,
  ...(state.allStoresTargets?.[buildCompanyMonthKey(companyId, monthValue)] || {}),
});

export const getAllStoresBusinessDaySettings = (state, companyId, monthValue) =>
  state.allStoresBusinessDaySettings?.[buildCompanyMonthKey(companyId, monthValue)] || {};

// company_all_stores_targets の行から、targets形状(店舗別targetsと同じキー名)と
// businessDaySettings形状に分けて復元する。monthly_targetsの行をbuildTargetStateFromRowsが
// targets/businessDaySettingsの2マップに分けているのと同じ考え方。
export const buildAllStoresTargetStateFromRows = (rows = []) => {
  const allStoresTargets = {};
  const allStoresBusinessDaySettings = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.company_id || !row.target_month) return;
    const key = buildCompanyMonthKey(row.company_id, row.target_month);
    allStoresTargets[key] = {
      targetSales: row.target_sales,
      targetTechnicalSales: row.target_technical_sales,
      targetRetailSales: row.target_retail_sales,
      targetCustomers: row.target_customers,
      targetAverageSpend: row.target_average_spend,
      targetNewCustomers: row.target_new_customers,
      targetRepeatCustomers: row.target_repeat_customers,
      targetReviewCount: row.target_review_count,
    };
    allStoresBusinessDaySettings[key] = {
      mode: row.business_day_mode || "",
      businessDayCount: row.business_day_count,
      holidayCount: row.holiday_count,
    };
  });
  return { allStoresTargets, allStoresBusinessDaySettings };
};

// 店休日(カレンダーの具体的な日付)。実店舗はbuildMonthKey、全店舗はbuildCompanyMonthKeyで
// キー化し、値はその月のISO日付文字列の配列("2026-08-08"等)。設定されていなければ空配列
// (=カレンダーでは未設定。既存のholidayCount数値のほうにフォールバックする)。
export const getStoreHolidayDates = (state, storeId, monthValue) =>
  state.storeHolidays?.[buildMonthKey(storeId, monthValue)] || [];

export const getAllStoresHolidayDates = (state, companyId, monthValue) =>
  state.allStoresHolidays?.[buildCompanyMonthKey(companyId, monthValue)] || [];

// stores.statusは「現在」の状態しか持たない(履歴が無い)。過去の特定日時点でその店舗が
// 営業対象だったかを正しく判定するには、store_status_audit_log(action: suspended/resumed/
// archived/restored/deleted、created_at付き。停止/再開/アーカイブ/復元/削除の都度、
// update-store-status・delete-store の各Edge Functionが必ず記録する)を遡って確認する
// 必要がある。これが無いと「今日時点でsuspended」というだけの理由で、停止より前の
// 過去日まで一律「営業対象外」として扱ってしまい、停止前にちゃんと日締めしていた日が
// 全店舗カレンダーで急に未完了扱いへ変わってしまう(要件3で明示的に禁止されている壊れ方)。
// 戻り値: "active" | "inactive" | null("null"はその店舗の変更履歴が1件も無い=この監査
// ログ機能導入より前に状態変更されたなど、判定不能な場合。呼び出し側はstores.statusの
// 現在値で代替判定する)。
export const getStoreStatusAsOfDate = (state, storeId, dateIso) => {
  const logs = (state.storeStatusAuditLog || []).filter((log) => log?.storeId === storeId);
  if (!logs.length) return null;
  const upToDate = logs
    .filter((log) => String(log.createdAt || "").slice(0, 10) <= dateIso)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (!upToDate.length) return "active";
  const latestAction = upToDate[upToDate.length - 1].action;
  return (latestAction === "suspended" || latestAction === "archived" || latestAction === "deleted") ? "inactive" : "active";
};

// 全店舗判定における「その日にその店舗が営業対象かどうか」の統一判定(要件2・3・12):
// 開店前(openingDate)・その店舗自身の店休日・その日付時点での状態(停止/アーカイブ済みか)、
// この3条件をこの関数だけに集約する。getAllStoresBusinessDaySummary(カレンダー/営業進捗の
// 緑判定)とgetUnclosedStoresForDate(未締め店舗の内訳表示)の両方がこれを呼ぶことで、
// 2箇所の判定基準が将来ズレることを構造的に防ぐ。
const isStoreApplicableOnDate = (state, store, dateIso, storeHolidayDateSet) => {
  const hasOpened = !store.openingDate || store.openingDate <= dateIso;
  if (!hasOpened) return false;
  if (storeHolidayDateSet.has(dateIso)) return false;
  const statusAsOf = getStoreStatusAsOfDate(state, store.id, dateIso);
  if (statusAsOf === "inactive") return false;
  if (statusAsOf === null && (store.status === "archived" || store.status === "suspended")) return false;
  return true;
};

export const isHolidayDate = (holidayDates, dateIso) => (holidayDates || []).includes(dateIso);

export const buildStoreHolidaysStateFromRows = (rows = []) => {
  const storeHolidays = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.store_id || !row.holiday_date) return;
    const month = String(row.holiday_date).slice(0, 7);
    const key = buildMonthKey(row.store_id, month);
    storeHolidays[key] = [...(storeHolidays[key] || []), String(row.holiday_date)];
  });
  return { storeHolidays };
};

export const buildAllStoresHolidaysStateFromRows = (rows = []) => {
  const allStoresHolidays = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.company_id || !row.holiday_date) return;
    const month = String(row.holiday_date).slice(0, 7);
    const key = buildCompanyMonthKey(row.company_id, month);
    allStoresHolidays[key] = [...(allStoresHolidays[key] || []), String(row.holiday_date)];
  });
  return { allStoresHolidays };
};

export const getDailyResultsForStoreMonth = (state, storeId, monthValue) => {
  const items = state.dailyResults?.[buildMonthKey(storeId, monthValue)] || [];
  const { entries } = deduplicateDailyEntries(items);
  return entries;
};

// 「費用入力」(継続/期間限定の2択を明示的に持つ費用マスター、金額は含まない)。periodTypeで
// 適用可否を判定する:
//   - "ongoing" (継続)       → startMonth以降ずっと対象月として表示され続ける(endMonthは無視)
//   - "limited" (期間限定)   → startMonth〜endMonthの範囲内(両端含む)だけ対象
// 金額はここでは解決しない(呼び出し側でgetCostMonthlyAmountを使う) — 月ごとにレコードを複製
// せず、1件のマスターから対象月かどうかをその都度判定する設計は従来通り。
export const getFixedCostsForStoreMonth = (state, storeId, monthValue) => {
  const itemsByKey = Object.entries(state.fixedCosts || {})
    .filter(([key]) => key.startsWith(`${storeId}__`))
    .flatMap(([key, items]) => (Array.isArray(items) ? items.map((item) => ({ ...item, _sourceKey: key })) : []));

  const matched = itemsByKey.filter((item) => {
    // entry_month (the month a row is filed/stored under locally) is NOT NULL in fixed_costs,
    // so this fallback is really just "startMonth defaults to entry_month" — it only matters
    // for a row saved without an explicit startMonth, which then behaves as if it started the
    // month it was entered.
    const startMonth = item.startMonth || item._sourceKey?.split("__")?.[1] || "";
    if (!startMonth) return item._sourceKey === buildMonthKey(storeId, monthValue);
    if (item.periodType === "limited") {
      const endMonth = item.endMonth || "";
      return monthValue >= startMonth && (!endMonth || monthValue <= endMonth);
    }
    // "ongoing"(継続、または旧データでperiodTypeが記録されていない行)は店舗に継続して
    // 存在する費用項目そのものなので、startMonth(登録された月)より前の対象月へ遡っても
    // 項目自体は表示する(不具合修正: 以前はmonthValue >= startMonthで絞っていたため、
    // 登録月より過去の対象月では継続費用の項目そのものが消えてしまっていた)。startMonthは
    // 「いつ登録されたか」の記録として保持するだけで、表示の絞り込みには使わない。金額は
    // 月ごとにcostMonthlyAmounts側で別管理されるため(getCostMonthlyAmount)、ここで対象月を
    // 絞らなくても過去月の金額を勝手に確定させることにはならない。
    return true;
  });

  // Editing an item can move it between local month-key buckets (see submitFixedCost); dedupe
  // by id defensively so a transient double-write never shows the same cost twice.
  const byId = new Map();
  const withoutId = [];
  matched.forEach((item) => {
    if (item.id) byId.set(item.id, item);
    else withoutId.push(item);
  });
  // 表示順序はsort_order昇順で固定する(要件5・9)。金額・項目編集では変わらない専用の値
  // なので、名前やカテゴリを更新しただけで並びが変わることはない。Array.sortは安定ソート
  // (ES2019以降)のため、同値の項目は取得順(=DB側のsort_order, created_atの順)のまま。
  return [...byId.values(), ...withoutId].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
};

// costItemId(fixed_costsの行id)から項目そのものを引く。店舗ごとの月キーでバケット化されて
// いるfixedCostsを横断して探す(会社全体を無制限取得しているため件数は小さい、他の同様の
// 横断探索と同じ前提)。getCostMonthlyAmountが継続費用の基本値(baseAmount)を参照するために使う。
const findFixedCostItemById = (state, costItemId) => {
  if (!costItemId) return undefined;
  for (const items of Object.values(state.fixedCosts || {})) {
    if (!Array.isArray(items)) continue;
    const match = items.find((item) => item.id === costItemId);
    if (match) return match;
  }
  return undefined;
};

// ongoing | limited — purely for display; the filtering logic above reads item.periodType
// directly, this is just a stable accessor with the same legacy fallback buildFixedCostsStateFromRows
// uses (no periodType recorded + no end_month = 継続として扱う).
export const getCostPatternLabel = (item) => item?.periodType || (item?.endMonth ? "limited" : "ongoing");

// 単月・期間限定費用(period_type='limited')専用のキャリーフォワード解決(既存仕様を維持、
// 要件10)。対象月にちょうど保存された行があれば最優先、無ければ対象月以前で最も新しい行を
// 引き継ぐ、それも無ければ対象月より後で最も古い行を使う(登録月より過去を見たときに
// 「未入力」にならないようにするため)。継続費用(ongoing)にはこの関数を使わない——
// getCostMonthlyAmountで基本値(baseAmount)ベースの別ロジックに分岐する。
const resolveEffectiveCostMonthlyAmountRow = (state, costItemId, monthValue) => {
  if (!costItemId) return undefined;
  const exactRow = state.costMonthlyAmounts?.[`${costItemId}__${monthValue}`];
  if (exactRow && exactRow.amount !== undefined) return exactRow;
  let latestMonthAtOrBefore = null;
  let latestRowAtOrBefore;
  let earliestMonthAfter = null;
  let earliestRowAfter;
  Object.entries(state.costMonthlyAmounts || {}).forEach(([key, row]) => {
    const [rowCostItemId, rowMonth] = key.split("__");
    if (rowCostItemId !== costItemId || !rowMonth) return;
    if (rowMonth <= monthValue) {
      if (!latestMonthAtOrBefore || rowMonth > latestMonthAtOrBefore) {
        latestMonthAtOrBefore = rowMonth;
        latestRowAtOrBefore = row;
      }
    } else if (!earliestMonthAfter || rowMonth < earliestMonthAfter) {
      earliestMonthAfter = rowMonth;
      earliestRowAfter = row;
    }
  });
  return latestRowAtOrBefore || earliestRowAfter;
};

// 対象月ごとの金額(cost_monthly_amounts)。
//   - 継続費用(period_type='ongoing'): 対象月にちょうど保存された上書き行があればそれを
//     最優先、無ければ費用マスター(fixed_costs)の基本値(baseAmount)を使う。過去に他の月へ
//     入力した金額を引き継ぐことは一切しない(要件1-4: 対象月だけ変更しても翌月以降は
//     自動的に基本値へ戻る)。
//   - 単月・期間限定費用(period_type='limited'): 既存仕様のキャリーフォワードのまま
//     (resolveEffectiveCostMonthlyAmountRow、要件10で変更しないと指定されている)。
// 損益集計ではundefinedを0として扱う(getCostMonthlyAmount(...) ?? 0)。
export const getCostMonthlyAmount = (state, costItemId, monthValue) => {
  const exactRow = state.costMonthlyAmounts?.[`${costItemId}__${monthValue}`];
  if (exactRow && exactRow.amount !== undefined) return exactRow.amount;
  const item = findFixedCostItemById(state, costItemId);
  if (item && item.periodType !== "limited") return item.baseAmount;
  return resolveEffectiveCostMonthlyAmountRow(state, costItemId, monthValue)?.amount;
};

// 「前月の金額をコピー」用。前月に金額が保存されていなければundefined。
export const getPreviousMonthCostAmount = (state, costItemId, monthValue) =>
  getCostMonthlyAmount(state, costItemId, getMonthOffset(monthValue, -1));

// 対象月末時点の在庫金額(store_inventory_balances)。未入力の月はundefined。
export const getInventoryBalance = (state, storeId, monthValue) => {
  if (!storeId) return undefined;
  return state.storeInventoryBalances?.[`${storeId}__${monthValue}`]?.amount;
};

// 「前月末在庫」参照用。初回利用時にこれがundefinedなら、UI側で「期首在庫」入力欄を出し、
// 入力値をmonthValueの前月分としてこのテーブルに保存する(getPreviousMonthCostAmountと同じ考え方)。
export const getPreviousMonthInventoryBalance = (state, storeId, monthValue) =>
  getInventoryBalance(state, storeId, getMonthOffset(monthValue, -1));

export const getVariableCostsForStoreMonth = (state, storeId, monthValue) => {
  const items = state.variableCosts?.[buildMonthKey(storeId, monthValue)] || [];
  return [...items];
};

export const getClosingItemsForStoreMonth = (state, storeId, monthValue) => {
  const items = state.monthClosing?.[buildMonthKey(storeId, monthValue)] || [];
  return [...items];
};

// カテゴリ別の合計金額(totals)と、そのカテゴリに1件でも登録があるか(hasEntry)を同時に返す。
// 「合計0円」と「1件も登録が無い」を区別できるようにする(月締めチェックリスト・
// 暫定利益判定の要 — 金額0円で登録済みのカテゴリを「未入力」扱いしないため)。
export const sumByCategoryKey = (items = []) => {
  const totals = {};
  const hasEntry = {};
  costCategoryKeys.forEach(({ key }) => { totals[key] = 0; hasEntry[key] = false; });
  totals[UNCATEGORIZED_KEY] = 0;
  hasEntry[UNCATEGORIZED_KEY] = false;
  (Array.isArray(items) ? items : []).forEach((item) => {
    const isKnownKey = costCategoryKeys.some((c) => c.key === item.categoryKey);
    const key = isKnownKey ? item.categoryKey : UNCATEGORIZED_KEY;
    totals[key] += parseNumber(item.amount);
    hasEntry[key] = true;
  });
  return { totals, hasEntry };
};

export const calculateMonthSummary = (state, storeId, monthValue, options = {}) => {
  const target = getTargetForStoreMonth(state, storeId, monthValue);
  const entries = getDailyResultsForStoreMonth(state, storeId, monthValue);
  // fixedCosts items no longer carry their own amount (see getFixedCostsForStoreMonth) — resolve
  // each item's amount for this specific month from costMonthlyAmounts, defaulting to 0 for a
  // month nobody has entered/copied an amount for yet.
  const fixedCosts = getFixedCostsForStoreMonth(state, storeId, monthValue)
    .map((item) => ({ ...item, amount: getCostMonthlyAmount(state, item.id, monthValue) ?? 0 }));
  const variableCosts = getVariableCostsForStoreMonth(state, storeId, monthValue);
  const closingItems = getClosingItemsForStoreMonth(state, storeId, monthValue);
  const businessDates = getBusinessDayDates(monthValue);
  const businessDaySummary = getBusinessDaySummary(state, storeId, monthValue);
  const now = new Date();
  const todayIso = formatLocalDate(now);
  const selectedCurrentMonth = monthValue === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const effectiveEntries = entries;

  // まとめて入力(daily_batch_entries)。日別データ(dailyResults)には一切混ぜず、月次集計の
  // 合算にだけ加える(要件3・9)。未入力(null)の項目はここで足さない — 0として集計に影響
  // させないことがこの機能の核となる要件。
  const batchEntries = getBatchEntriesForStoreMonth(state, storeId, monthValue);
  const sumNullableBatchField = (getField) => batchEntries.reduce((total, item) => {
    const value = getField(item);
    return value === null || value === undefined ? total : total + Number(value);
  }, 0);
  const batchSales = sumNullableBatchField((item) => item.totalSales ?? item.technicalSales ?? null);
  const batchTechnicalSales = sumNullableBatchField((item) => item.technicalSales);
  const batchRetailSales = sumNullableBatchField((item) => item.retailSales);
  const batchOtherSales = sumNullableBatchField((item) => item.otherSales);
  const batchCustomers = sumNullableBatchField((item) => item.customers);
  const batchNewCustomers = sumNullableBatchField((item) => item.newCustomers);
  const batchRepeatCustomers = sumNullableBatchField((item) => item.repeatCustomers);
  const batchReviewCount = sumNullableBatchField((item) => item.reviewCount);

  const sales = effectiveEntries.reduce((total, item) => total + parseNumber(item.totalSales || item.technicalSales || 0), 0) + batchSales;
  const technicalSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.technicalSales || 0), 0) + batchTechnicalSales;
  const retailSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.retailSales || 0), 0) + batchRetailSales;
  const otherSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.otherSales || 0), 0) + batchOtherSales;
  const customers = effectiveEntries.reduce((total, item) => total + parseNumber(item.customers || 0), 0) + batchCustomers;
  const newCustomers = effectiveEntries.reduce((total, item) => total + parseNumber(item.newCustomers || 0), 0) + batchNewCustomers;
  const repeatCustomers = effectiveEntries.reduce((total, item) => total + parseNumber(item.repeatCustomers || 0), 0) + batchRepeatCustomers;
  const reviewCount = effectiveEntries.reduce((total, item) => total + parseNumber(item.reviewCount || 0), 0) + batchReviewCount;

  // 「まとめ入力の実績が存在する営業日数」。completedDays(下のbusinessDaySummary.completedDays)
  // は今回からgetBatchAllocatedDatesSet経由でまとめ入力の日を直接含むようになった(要件17)ため、
  // 通常はこちらの値と一致する。ただし「店休日・既存の実日次入力と衝突して1日も配分できな
  // かった」極端なケースでは配分結果(completedDays)が0のままになりうるため、その時だけの
  // フォールバック用に、まとめ入力が対象としている期間そのもの(配分の成否に関わらない)を
  // 別途数えておく。実日次入力(dailyEntryDateSet)は意図的に含めない — 含めてしまうと、
  // まとめ入力を一切使わず日締めもまだしていない普通の店舗まで、この後のdisplayForecast
  // フォールバックが発動して見た目が変わってしまうため。
  const salesResultDateSet = new Set();
  batchEntries.forEach((batchEntry) => {
    const hasSalesData = batchEntry.totalSales !== null || batchEntry.technicalSales !== null || batchEntry.retailSales !== null || batchEntry.otherSales !== null;
    if (!hasSalesData) return;
    getBusinessDayDatesInRange(state, storeId, batchEntry.startDate, batchEntry.endDate).forEach((date) => salesResultDateSet.add(date));
  });
  const resultsCoverageBusinessDays = salesResultDateSet.size;

  // 費用入力(fixedCosts)・過去の月締め項目(closingItems)・過去の変動費(variableCosts)を
  // 1つに結合し、category_key基準で集計する。カテゴリは費用名の文字列ではなく、費用登録時に
  // ユーザーが選んだ固定key(rent/labor/advertising/...)そのものを見る — 費用名がどんな
  // 略称・表記でも正しく分類できる(AIが費用名から推測する必要も無くす)。
  // 旧カテゴリ「設備投資」の行は昔から経費合計に含めない設計(equipmentInvestmentCostとして
  // 別枠集計のみ)だったため、新しい集計からも除外して過去月の合計値を変えないようにする。
  const categorizableItems = [...fixedCosts, ...variableCosts, ...closingItems].filter((item) => item.category !== "設備投資");
  const { totals: costsByCategory, hasEntry: rawCategoryHasEntry } = sumByCategoryKey(categorizableItems);
  // options.hiddenCategories(月締めチェックリストで店舗が「対象外」にしたカテゴリ、
  // store_input_settings.hidden_closing_categories)は「未入力」ではなく「その店舗では
  // 基本的に発生しない」項目として扱う — categoryHasEntryを解決済み扱いにする(金額は
  // costsByCategory[key]の実額、対象外なら通常0円のまま)。これにより、例えばスタッフの
  // いない店舗が人件費を対象外にした場合でも営業利益がisProvisionalProfitのまま止まらず、
  // 店舗比較表の計算が壊れない(対象外設定に基づく要件)。
  const hiddenCategorySet = new Set(Array.isArray(options.hiddenCategories) ? options.hiddenCategories : []);
  const categoryHasEntry = { ...rawCategoryHasEntry };
  hiddenCategorySet.forEach((key) => {
    if (key in categoryHasEntry) categoryHasEntry[key] = true;
  });

  const laborCost = costsByCategory.labor;
  // 材料・発注費(ディーラー請求書等の月間合計、業務材料+店販商品仕入+送料等をまとめて1件で
  // 入力してもよいし、月中に複数回に分けて入力してその月の合計として扱ってもよい)。
  const purchaseAmount = costsByCategory.materials;
  // 設備投資は新カテゴリに対応枠を持たない(要件3: 必要以上に細かい分類を避ける) — 過去の
  // 月締め項目(closingItems)に残っている旧カテゴリ「設備投資」の行だけ、後方互換のため
  // 引き続き集計する(新規入力では発生しない)。
  const equipmentInvestmentCost = closingItems.filter((item) => item.category === "設備投資").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  // 「固定費」(内部合計、月次ダッシュボード・全店舗比較表の「固定費」列の実体): 家賃・光熱費・
  // 通信費・清掃環境費・システム利用料・税金保険の6カテゴリに加え、「その他費用」(経費その他・
  // 本社経費・接待交際費・雑費など、広告費以外の継続的な費用を費用入力画面でcategoryKey="other"
  // として個別入力したもの)も合算する。入力自体は費用入力画面で名称ごとに細かく分けたままでき、
  // ダッシュボード側でのみ大分類にまとめる設計(名称ではなくcategoryKeyで判定するため、
  // 「HPB」のような名称でもcategoryKeyが広告費ならここには含まれない)。labor/materials/
  // advertisingは別枠で扱うためここには含めない。
  const fixedCost = costsByCategory.rent + costsByCategory.utilities + costsByCategory.communication
    + costsByCategory.cleaning + costsByCategory.system + costsByCategory.tax_insurance + costsByCategory.other;
  // 「その他費用」カテゴリそのもの(AIコンテキスト等、個別に参照する箇所があるため独立して残す)。
  // fixedCostにも合算されているが、二重計上ではない — otherCostは値の参照用、fixedCostは
  // ダッシュボード表示用の合計、という役割の違い(expenseCostの計算ではvariableCostからは
  // 除外している、下記参照)。
  const otherCost = costsByCategory.other;
  // 「変動費」(内部合計): 未分類(移行時に自動判定できなかった費用、要注意)のみ。その他費用は
  // 上でfixedCostに合算したため、ここに含めると二重計上になるので含めない。
  const variableCost = costsByCategory[UNCATEGORIZED_KEY];
  // 経費合計 = 固定費+変動費+広告費(labor/materialsは別枠のためここに含めない) — 10カテゴリ
  // のうちlabor/materials以外の9カテゴリを漏れなくカバーする。固定費/変動費という区分を
  // ユーザーに判断させない(表示は経費合計に統合、要件7-8)。
  const expenseCost = fixedCost + variableCost + costsByCategory.advertising;
  // 経営指標の広告費率用。
  const adCost = costsByCategory.advertising;

  // 材料・仕入原価: 在庫管理を使わない店舗(既定)は仕入・発注額をそのまま原価とする。使う店舗は
  // 前月末在庫+当月仕入・発注額-当月末在庫で計算する。前月末在庫が未入力(初回利用)の場合は
  // 0円として計算する — 「勝手に0円で確定させない」という要件は、この関数ではなくUI側で
  // 「期首在庫」の入力を促す(未入力であることを可視化する)ことで満たす。
  const useInventoryTracking = Boolean(options.useInventoryTracking);
  const openingInventory = useInventoryTracking ? (getPreviousMonthInventoryBalance(state, storeId, monthValue) ?? 0) : 0;
  const closingInventory = useInventoryTracking ? (getInventoryBalance(state, storeId, monthValue) ?? 0) : 0;
  const costOfGoodsSold = useInventoryTracking ? (openingInventory + purchaseAmount - closingInventory) : purchaseAmount;

  const expenseTotal = costOfGoodsSold + laborCost + expenseCost;
  const grossProfit = sales - costOfGoodsSold;
  const operatingProfit = grossProfit - laborCost - expenseCost;
  // 消費税引当額(概算): 「消費税を考慮する」がONの場合のみ計算する(OFFの場合は計算対象外=0)。
  // 正式な納税額の自動計算ではなく、資金確保用の概算引当(不具合修正: 権限体系整理の報告後に
  // 発覚した別件)。売上に占める消費税相当額を概算する式は「対象売上 × 税率 ÷ (100 + 税率)」
  // (税込売上から逆算する式。誤って「売上 × 税率 ÷ 100」を使うと税抜売上に課税した額になり、
  // 税込売上を基準にする仕様と食い違う)。基準は当月の対象売上(sales、税込)であり、営業利益・
  // 粗利益を基準にはしない — 営業利益が赤字でも引当額を0円にせず、そのまま
  // profitAfterConsumptionTaxReserveへ反映する(赤字だから引当を免除する、という業務ルールは
  // 存在しない)。税率が未保存(0)のままONにした場合にUI側の入力欄がプレースホルダーとして
  // 表示する日本の標準税率10%と計算結果が食い違わないよう、同じ「未保存時は10%」という
  // フォールバックをここでも使う(App.jsx側のtaxSettingsForm初期化と揃える) — これが実際の
  // 不具合(ONにしても¥0のまま)の根本原因だった: 入力欄は10%を表示するのに計算は未保存の
  // 0%を参照していたため、ユーザーが「10%に設定した」つもりでも反映されなかった。
  const considerConsumptionTax = Boolean(state.taxSettings?.considerConsumptionTax);
  const consumptionTaxReserveRate = Number(state.taxSettings?.consumptionTaxReserveRate) || 10;
  const consumptionTaxReserveAmount = considerConsumptionTax && consumptionTaxReserveRate > 0
    ? Math.round((sales * consumptionTaxReserveRate) / (100 + consumptionTaxReserveRate))
    : 0;
  const profitAfterConsumptionTaxReserve = operatingProfit - consumptionTaxReserveAmount;

  const targetSales = parseNumber(target.targetSales);
  const targetAchievement = targetSales ? (sales / targetSales) * 100 : 0;
  const remainingSalesTarget = Math.max(targetSales - sales, 0);
  const completedDays = businessDaySummary.completedDays;
  const remainingBusinessDays = businessDaySummary.remainingBusinessDays;
  const progressRate = businessDaySummary.progressRate;
  const targetPerDay = businessDaySummary.businessDayCount ? targetSales / businessDaySummary.businessDayCount : 0;
  const dailyNeededSales = remainingBusinessDays ? remainingSalesTarget / remainingBusinessDays : 0;
  const closedDateSet = new Set(businessDaySummary.closedDates || []);
  const closedEntries = effectiveEntries.filter((entry) => closedDateSet.has(String(entry?.date || "")));
  // まとめて入力の日もcompletedDays(businessDaySummary.closedDates)に含まれるようになった
  // (要件17)。分子(closedSales)にまとめ入力分を入れないとpace/forecastが薄まってしまう
  // ため、既に計算済みのbatchSales(期間合計そのもの、配分結果からの再集計ではない)を
  // そのまま足す。これはsales本体に足しているのと同じ値・同じ考え方(要件18: 配分ロジックが
  // 月間合計/pace計算に独自の数字を持ち込まない)。
  const closedSales = closedEntries.reduce((total, item) => total + parseNumber(item.totalSales || item.technicalSales || 0), 0) + batchSales;
  const pace = completedDays > 0 ? closedSales / completedDays : 0;
  const forecast = completedDays > 0 && businessDaySummary.businessDayCount ? pace * businessDaySummary.businessDayCount : 0;
  const averageSales = effectiveEntries.length > 0 ? sales / effectiveEntries.length : 0;
  // 営業進捗カードの「1日平均売上」(実績)用: 総売上 ÷ 営業完了日数。averageSales(入力日数で
  // 割る既存値、pace/forecastが使う)とは別の新規フィールドで、既存のaverageSales/pace/forecast
  // の計算には一切手を入れない。
  const averageDailySales = completedDays > 0 ? sales / completedDays : 0;
  // まとめて入力を使っている店舗向けの並行フィールド(要件14・15)。日締めは一切いじらない
  // 仕様(要件19)のためcompletedDaysは0のままになりうるが、その場合pace/forecast/
  // averageDailySalesは0(異常値)になってしまう。実績が存在する営業日数(上のresults
  // CoverageBusinessDays)で割った値を別途用意し、UI側はcompletedDaysが0でも実績がある
  // 場合だけこちらを表示に使う(displayForecast/displayAverageDailySales) — 既存の
  // forecast/averageDailySales自体は変更しない。
  const averageSalesPerResultDay = resultsCoverageBusinessDays > 0 ? sales / resultsCoverageBusinessDays : 0;
  const forecastByResults = resultsCoverageBusinessDays > 0 && businessDaySummary.businessDayCount
    ? averageSalesPerResultDay * businessDaySummary.businessDayCount
    : 0;
  const useResultsFallback = completedDays === 0 && resultsCoverageBusinessDays > 0;
  const displayForecast = useResultsFallback ? forecastByResults : forecast;
  const displayAverageDailySales = useResultsFallback ? averageSalesPerResultDay : averageDailySales;
  const remainingAverageSales = remainingBusinessDays ? remainingSalesTarget / remainingBusinessDays : 0;
  const todayActual = effectiveEntries.filter((entry) => entry.date === todayIso).reduce((sum, item) => sum + parseNumber(item.totalSales || item.technicalSales || 0), 0);
  const todayTarget = targetPerDay;
  const todayAchievement = todayTarget ? (todayActual / todayTarget) * 100 : 0;
  const averageSpend = customers ? sales / customers : 0;
  const laborRate = sales ? (laborCost / sales) * 100 : 0;
  const costOfGoodsSoldRate = sales ? (costOfGoodsSold / sales) * 100 : 0;
  const adRate = sales ? (adCost / sales) * 100 : 0;
  const operatingMargin = sales ? (operatingProfit / sales) * 100 : 0;
  const averageCustomersPerDay = businessDaySummary.businessDayCount ? customers / businessDaySummary.businessDayCount : 0;
  const repeatRate = customers ? (repeatCustomers / customers) * 100 : 0;
  const averageTicket = customers ? sales / customers : 0;
  const technicalUnitPrice = customers ? technicalSales / customers : 0;
  const retailCustomerCount = effectiveEntries.reduce((sum, item) => sum + parseNumber(item.retailCustomers || 0), 0);
  const retailRatioValue = sales > 0 ? Number(((retailSales / sales) * 100).toFixed(1)) : 0;
  const customerTarget = parseNumber(target.targetCustomers);
  const customerAchievement = customerTarget ? (customers / customerTarget) * 100 : 0;
  const remainingCustomersTarget = Math.max(customerTarget - customers, 0);
  const remainingCustomersPerDay = remainingBusinessDays ? remainingCustomersTarget / remainingBusinessDays : 0;
  const forecastCustomers = businessDaySummary.businessDayCount ? averageCustomersPerDay * businessDaySummary.businessDayCount : customers;
  const reviewCountTarget = parseNumber(target.targetReviewCount);
  const reviewCountAchievement = reviewCountTarget ? (reviewCount / reviewCountTarget) * 100 : 0;
  const remainingReviewCountTarget = Math.max(reviewCountTarget - reviewCount, 0);
  const repeatTarget = parseNumber(target.targetRepeatRate);
  const repeatTargetAchievement = repeatTarget ? (repeatRate / repeatTarget) * 100 : 0;

  // 人件費・材料/発注費は美容室の損益に直結する重要費用で、月途中は未確定なことが多い
  // (歩合給等)。この2つが1件も登録されていない月は、営業利益・営業利益率を「暫定値」として
  // 扱う(0円で確定計算してしまわないため)。他8カテゴリは未入力でも暫定扱いにしない
  // (清掃費等が無い店舗は単に「無い」だけで、暫定ではない)。
  const missingCriticalCategories = ["labor", "materials"].filter((key) => !categoryHasEntry[key]);
  const isProvisionalProfit = missingCriticalCategories.length > 0;

  // 表示用の補助フラグ: 「固定費」「経費合計」を構成するカテゴリのうち1つでも登録があるか。
  // 未入力を0として計算した数字を「－」に置き換えるかどうかの判定にのみ使い、isProvisionalProfit
  // (人件費・材料費のみを重要費用として見る既存の設計)には影響しない。
  const hasFixedCostData = ["rent", "utilities", "communication", "cleaning", "system", "tax_insurance", "other"]
    .some((key) => categoryHasEntry[key]);
  const hasExpenseCostData = hasFixedCostData || categoryHasEntry.advertising || categoryHasEntry[UNCATEGORIZED_KEY];

  return {
    sales,
    technicalSales,
    retailSales,
    otherSales,
    customers,
    newCustomers,
    repeatCustomers,
    reviewCount,
    reviewCountTarget,
    reviewCountAchievement,
    remainingReviewCountTarget,
    averageSpend,
    averageCustomersPerDay,
    repeatRate,
    repeatTarget,
    repeatTargetAchievement,
    technicalUnitPrice,
    retailCustomerCount,
    retailRatio: retailRatioValue,
    laborCost,
    purchaseAmount,
    costOfGoodsSold,
    costOfGoodsSoldRate,
    equipmentInvestmentCost,
    fixedCost,
    variableCost,
    otherCost,
    expenseCost,
    adCost,
    adRate,
    costsByCategory,
    categoryHasEntry,
    missingCriticalCategories,
    isProvisionalProfit,
    hasFixedCostData,
    hasExpenseCostData,
    expenseTotal,
    grossProfit,
    operatingProfit,
    operatingMargin,
    consumptionTaxReserveAmount,
    profitAfterConsumptionTaxReserve,
    laborRate,
    targetAchievement,
    remainingSalesTarget,
    targetPerDay,
    dailyNeededSales,
    forecast,
    closedSales,
    todayActual,
    todayTarget,
    todayAchievement,
    completedDays,
    businessDays: businessDaySummary.businessDayCount ?? businessDates.length,
    remainingBusinessDays,
    progressRate,
    averageSales,
    averageDailySales,
    resultsCoverageBusinessDays,
    averageSalesPerResultDay,
    forecastByResults,
    displayForecast,
    displayAverageDailySales,
    batchEntries,
    remainingAverageSales,
    customerTarget,
    customerAchievement,
    remainingCustomersTarget,
    remainingCustomersPerDay,
    forecastCustomers,
    target,
    entries,
    fixedCosts,
    variableCosts,
    closingItems,
    expenseCategories,
  };
};

// パフォーマンス改善(店舗売上ランキング用の軽量版): calculateMonthSummaryは費用10カテゴリの
// 集計・在庫評価・消費税引当・営業日進捗まですべて1回で計算する重い関数——ランキングは
// 「売上合計」と「前月データの有無」の2値しか使わないため、店舗数分×2か月分をそのまま
// calculateMonthSummaryで計算するのは無駄が大きい(ランキングだけ表示が遅れる主因)。
// sales/batchSalesの計算式はcalculateMonthSummaryの該当箇所と完全に同一のロジックを保つ——
// ここを変更する場合はcalculateMonthSummary側の同じ計算も必ず合わせて変更すること。
export const getStoreMonthSalesTotal = (state, storeId, monthValue) => {
  const entries = getDailyResultsForStoreMonth(state, storeId, monthValue);
  const batchEntries = getBatchEntriesForStoreMonth(state, storeId, monthValue);
  const batchSales = batchEntries.reduce((total, item) => {
    const value = item.totalSales ?? item.technicalSales ?? null;
    return value === null || value === undefined ? total : total + Number(value);
  }, 0);
  const sales = entries.reduce((total, item) => total + parseNumber(item.totalSales || item.technicalSales || 0), 0) + batchSales;
  // hasEntries: 実日次入力(daily_sales)が無くても、まとめて入力(daily_batch_entries)だけで
  // その月の実績が入っている店舗は「データあり」と判定する(不具合修正: フィーネ横浜の
  // 2026年7月が丸ごとまとめ入力1件で構成されており、entries.lengthだけを見ていたため
  // 店舗ランキングの「先月」がデータありなのに「－」表示になっていた)。
  return { sales, hasEntries: entries.length > 0 || batchEntries.length > 0 };
};

// 月締めチェックリスト: 損益表作成に必要な項目(売上+費用10カテゴリ)ごとの入力済み/未確認を
// 返す。判定は費用名の文字列ではなく、calculateMonthSummaryが算出したcategoryHasEntry
// (=実際に登録されているデータ)を基準にする。options.hiddenCategoriesに含まれる費用カテゴリ
// (店舗ごとの「対象外」設定、store_input_settings.hidden_closing_categories)はitemsから
// 除外する — 「売上」は対象外にできないため無条件で含める。除外した項目はhiddenItemsとして
// 別途返す(いつでも再表示できるよう、管理UI側で一覧・復元できるようにするため)。
export const getMonthClosingChecklist = (state, storeId, monthValue, options = {}) => {
  const summary = calculateMonthSummary(state, storeId, monthValue, options);
  const hiddenSet = new Set(Array.isArray(options.hiddenCategories) ? options.hiddenCategories : []);
  const allCostItems = costCategoryKeys.map(({ key, label }) => ({ key, label, entered: Boolean(summary.categoryHasEntry[key]), categoryKey: key }));
  const items = [
    // まとめて入力だけで売上が登録されている月(通常の日次入力が1件も無い月)を「未入力」と
    // 誤判定しないよう、まとめ入力の有無も見る。
    { key: "sales", label: "売上", entered: summary.entries.length > 0 || summary.batchEntries.length > 0, categoryKey: null },
    ...allCostItems.filter((item) => !hiddenSet.has(item.key)),
  ];
  return {
    items,
    hiddenItems: allCostItems.filter((item) => hiddenSet.has(item.key)),
    missingItems: items.filter((item) => !item.entered),
    isProvisionalProfit: summary.isProvisionalProfit,
    missingCriticalCategories: summary.missingCriticalCategories,
  };
};

// 月締め確定後(monthClosingStatus.lockedAt)に、損益に影響するデータ(費用金額・費用項目・
// 在庫)が変更されていないか判定する。新規DBカラムは不要 — 各テーブルが元々持つupdated_atを
// そのまま比較に使う。
export const needsMonthReconfirmation = (state, storeId, monthValue) => {
  const status = state.monthClosingStatus?.[buildMonthKey(storeId, monthValue)];
  if (!status?.closed || !status.lockedAt) return false;
  const fixedCosts = getFixedCostsForStoreMonth(state, storeId, monthValue);
  const timestamps = [
    // item.updatedAtはfixed_costs行自体の更新日時 — 継続費用の基本値(base_amount)の変更も
    // 同じ行のupdated_atを更新するため、ここで既に検知できる。
    ...fixedCosts.map((item) => item.updatedAt || ""),
    // 対象月ごとの上書き(cost_monthly_amounts)のupdatedAtも見る。継続費用は対象月の上書き
    // 行(あれば)だけを見れば十分(要件1-4の仕様変更でキャリーフォワードをやめたため)。
    // 単月・期間限定費用は既存仕様のまま、キャリーフォワード解決後の行のupdatedAtを見る
    // (対象月に固有の行が無い場合でも、引き継いでいる別月の行の変更を検知する必要があるため)。
    ...fixedCosts.map((item) => (item.periodType === "limited"
      ? resolveEffectiveCostMonthlyAmountRow(state, item.id, monthValue)?.updatedAt || ""
      : state.costMonthlyAmounts?.[`${item.id}__${monthValue}`]?.updatedAt || "")),
    ...getClosingItemsForStoreMonth(state, storeId, monthValue).map((item) => item.updatedAt || ""),
    state.storeInventoryBalances?.[`${storeId}__${monthValue}`]?.updatedAt || "",
  ].filter(Boolean);
  return timestamps.some((timestamp) => timestamp > status.lockedAt);
};

// 単月(periodType:"limited"、開始月=終了月)の費用は月ごとに新しいitem idになるため、
// 「前月をコピー」がcostMonthlyAmounts側では効かない(そのidに前月分の金額が無いため)。
// 費用名+カテゴリが一致する前月の項目があれば、その金額をサジェストできるようにする
// (自動入力はしない、入力欄のプレースホルダー用)。
export const getPreviousMonthAmountByNameAndCategory = (state, storeId, name, categoryKey, monthValue) => {
  if (!name || !categoryKey) return undefined;
  const previousMonth = getMonthOffset(monthValue, -1);
  const previousItems = getFixedCostsForStoreMonth(state, storeId, previousMonth);
  const match = previousItems.find((item) => item.name === name && item.categoryKey === categoryKey);
  if (!match) return undefined;
  return getCostMonthlyAmount(state, match.id, previousMonth);
};

// 「全店舗」(company_admin専用の仮想集計ビュー)専用の売上サマリー。calculateMonthSummaryを
// 単純に店舗ごとに呼んで合算するのではなく、各店舗の元データ(daily_sales由来のdailyResults)
// から日締め済みの日付だけを拾って直接合算し、達成率・客単価・1日平均売上・月末着地予測などの
// 比率/平均/予測は全店舗合計データから計算し直す(店舗ごとの計算結果を足し合わせない)。
// 費用・損益(人件費/材料費/粗利益など)はこの関数では扱わない — 全店舗ビューは売上ページの
// KPI/営業進捗のみが対象で、損益表・費用入力・月締めは店舗ごとの機能のまま(要件範囲外)。
export const calculateAllStoresMonthSummary = (state, company, monthValue) => {
  const companyId = company?.id || "";
  // App.jsx側の全店舗カレンダー(businessDaySummary、currentCompanyStoresを渡す)と必ず
  // 同じ店舗集合にする(要件7): 以前はここがcompany.stores(archived含む)を使い、
  // カレンダー側はarchived除外後のcurrentCompanyStoresを使っていたため、同じ月・同じ会社
  // でも「カレンダーは16日完了、営業進捗は18日完了」のように営業日数・完了日数が食い違う
  // 不具合になっていた。stores/openingDate/停止日基準の営業対象判定自体は
  // getAllStoresBusinessDaySummary(isStoreApplicableOnDate)側に一本化済みのため、ここでは
  // archived除外の粒度だけを揃えれば足りる。
  const stores = (company?.stores || []).filter((store) => store?.id && store.status !== "archived");
  const target = getAllStoresTargetForCompanyMonth(state, companyId, monthValue);
  const businessDaySummary = getAllStoresBusinessDaySummary(state, companyId, stores, monthValue);

  let sales = 0;
  let technicalSales = 0;
  let retailSales = 0;
  let otherSales = 0;
  let customers = 0;
  let newCustomers = 0;
  let repeatCustomers = 0;
  let reviewCount = 0;
  // 日締め済みの日だけの合計(pace/forecast/averageDailySalesの着地予測専用 — 未確定の当日を
  // 分母に混ぜて日平均が歪むのを防ぐ)。sales本体とは別に並行して集計する。かつてはsales自体が
  // ここでフィルタされ、closedSalesはその単なるエイリアスだったため、個別店舗ページの
  // summary.sales(入力済み全件)と基準が食い違い、ダッシュボードとランキングとで違う数字に
  // 見える不具合の一因になっていた。
  let closedSales = 0;
  // まとめて入力の合算(要件9・24)。日別データには混ぜず、店舗ごとにcalculateMonthSummary
  // と同じロジックで加算する。resultsCoverageBusinessDaysも店舗横断で合算し、全店舗版の
  // 着地予測フォールバックに使う(下記)。
  let resultsCoverageBusinessDays = 0;

  stores.forEach((store) => {
    const entries = getDailyResultsForStoreMonth(state, store.id, monthValue);
    const closedDateSet = new Set(getBusinessDaySummary(state, store.id, monthValue).closedDates || []);
    const batchEntries = getBatchEntriesForStoreMonth(state, store.id, monthValue);
    entries.forEach((entry) => {
      const amount = parseNumber(entry.totalSales || entry.technicalSales || 0);
      sales += amount;
      technicalSales += parseNumber(entry.technicalSales || 0);
      retailSales += parseNumber(entry.retailSales || 0);
      otherSales += parseNumber(entry.otherSales || 0);
      customers += parseNumber(entry.customers || 0);
      newCustomers += parseNumber(entry.newCustomers || 0);
      repeatCustomers += parseNumber(entry.repeatCustomers || 0);
      reviewCount += parseNumber(entry.reviewCount || 0);
      if (closedDateSet.has(String(entry?.date || ""))) {
        closedSales += amount;
      }
    });
    const storeSalesResultDateSet = new Set(entries.map((entry) => String(entry?.date || "")).filter(Boolean));
    // calculateMonthSummary(単一店舗版)のclosedSales += batchSalesと同じ理由: まとめ入力の
    // 日もclosedDateSet(≒completedDays)に含まれる(getBusinessDaySummaryがgetBatchAllocated
    // DatesSetを合算しているため)。ここでbatchSalesをclosedSalesに足さないと、分子
    // (closedSales)には入らないのに分母(completedDays)には入るため、全店舗ビューのpace/
    // forecast/averageDailySalesだけが個別店舗版より不当に低く出る不具合になっていた(修正)。
    let storeBatchSales = 0;
    batchEntries.forEach((batchEntry) => {
      const batchTotal = batchEntry.totalSales ?? batchEntry.technicalSales ?? null;
      if (batchTotal !== null) {
        sales += Number(batchTotal);
        storeBatchSales += Number(batchTotal);
      }
      if (batchEntry.technicalSales !== null) technicalSales += Number(batchEntry.technicalSales);
      if (batchEntry.retailSales !== null) retailSales += Number(batchEntry.retailSales);
      if (batchEntry.otherSales !== null) otherSales += Number(batchEntry.otherSales);
      if (batchEntry.customers !== null) customers += Number(batchEntry.customers);
      if (batchEntry.newCustomers !== null) newCustomers += Number(batchEntry.newCustomers);
      if (batchEntry.repeatCustomers !== null) repeatCustomers += Number(batchEntry.repeatCustomers);
      if (batchEntry.reviewCount !== null) reviewCount += Number(batchEntry.reviewCount);
      const hasSalesData = batchEntry.totalSales !== null || batchEntry.technicalSales !== null || batchEntry.retailSales !== null || batchEntry.otherSales !== null;
      if (hasSalesData) {
        getBusinessDayDatesInRange(state, store.id, batchEntry.startDate, batchEntry.endDate).forEach((date) => storeSalesResultDateSet.add(date));
      }
    });
    closedSales += storeBatchSales;
    resultsCoverageBusinessDays += storeSalesResultDateSet.size;
  });

  const completedDays = businessDaySummary.completedDays;
  const remainingBusinessDays = businessDaySummary.remainingBusinessDays;
  const progressRate = businessDaySummary.progressRate;

  const targetSales = parseNumber(target.targetSales);
  const targetAchievement = targetSales ? (sales / targetSales) * 100 : 0;
  const remainingSalesTarget = Math.max(targetSales - sales, 0);
  const dailyNeededSales = remainingBusinessDays ? remainingSalesTarget / remainingBusinessDays : 0;
  const pace = completedDays > 0 ? closedSales / completedDays : 0;
  const forecast = completedDays > 0 && businessDaySummary.businessDayCount ? pace * businessDaySummary.businessDayCount : 0;
  // 1日平均売上 = 全店舗の確定済み総売上 ÷ 全店舗として営業完了した日数。paceと同じ理由で
  // 未確定の当日を分母に混ぜないよう、salesではなくclosedSalesを使う。
  const averageDailySales = completedDays > 0 ? closedSales / completedDays : 0;
  // 個別店舗版と同じフォールバック(要件14・15)。まとめ入力を使っている店舗を含む全店舗
  // ビューでcompletedDaysが0のままでも、resultsCoverageBusinessDaysがあれば異常値(0円)を
  // 出さない。
  const averageSalesPerResultDay = resultsCoverageBusinessDays > 0 ? sales / resultsCoverageBusinessDays : 0;
  const forecastByResults = resultsCoverageBusinessDays > 0 && businessDaySummary.businessDayCount
    ? averageSalesPerResultDay * businessDaySummary.businessDayCount
    : 0;
  const useResultsFallback = completedDays === 0 && resultsCoverageBusinessDays > 0;
  const displayForecast = useResultsFallback ? forecastByResults : forecast;
  const displayAverageDailySales = useResultsFallback ? averageSalesPerResultDay : averageDailySales;
  const averageSpend = customers ? sales / customers : 0;

  const customerTarget = parseNumber(target.targetCustomers);
  const customerAchievement = customerTarget ? (customers / customerTarget) * 100 : 0;
  const remainingCustomersTarget = Math.max(customerTarget - customers, 0);
  const remainingCustomersPerDay = remainingBusinessDays ? remainingCustomersTarget / remainingBusinessDays : 0;

  const reviewCountTarget = parseNumber(target.targetReviewCount);
  const reviewCountAchievement = reviewCountTarget ? (reviewCount / reviewCountTarget) * 100 : 0;
  const remainingReviewCountTarget = Math.max(reviewCountTarget - reviewCount, 0);

  return {
    sales,
    technicalSales,
    retailSales,
    otherSales,
    customers,
    newCustomers,
    repeatCustomers,
    reviewCount,
    reviewCountTarget,
    reviewCountAchievement,
    remainingReviewCountTarget,
    averageSpend,
    targetAchievement,
    remainingSalesTarget,
    dailyNeededSales,
    forecast,
    closedSales,
    todayTarget: 0,
    completedDays,
    businessDays: businessDaySummary.businessDayCount,
    remainingBusinessDays,
    progressRate,
    averageSales: averageDailySales,
    averageDailySales,
    resultsCoverageBusinessDays,
    averageSalesPerResultDay,
    forecastByResults,
    displayForecast,
    displayAverageDailySales,
    customerTarget,
    customerAchievement,
    remainingCustomersTarget,
    remainingCustomersPerDay,
    target,
  };
};

export const getCustomerTargetSummary = (input = {}) => {
  const customers = parseNumber(input.customers);
  const targetCustomers = parseNumber(input.targetCustomers);
  const businessDayCount = parseNumber(input.businessDayCount);
  const completedDays = parseNumber(input.completedDays);
  const remainingBusinessDays = parseNumber(input.remainingBusinessDays);
  const targetAverageCustomersPerDay = parseNumber(input.targetAverageCustomersPerDay);
  const remainingCustomers = Math.max(targetCustomers - customers, 0);
  const remainingCustomersPerDay = remainingBusinessDays > 0 ? remainingCustomers / remainingBusinessDays : 0;
  const forecastCustomers = businessDayCount > 0 ? (customers / Math.max(completedDays, 1)) * businessDayCount : customers;
  const statusLabel = remainingBusinessDays <= 0 ? "営業日終了" : "進行中";

  return {
    customers,
    targetCustomers,
    remainingCustomers,
    achievementRate: targetCustomers ? (customers / targetCustomers) * 100 : 0,
    remainingBusinessDays,
    remainingCustomersPerDay,
    forecastCustomers,
    statusLabel,
    targetAverageCustomersPerDay,
  };
};

// 「1人あたり月間売上」= 当月総売上(または月末着地予想) ÷ 生産性計算人数。
// 生産性計算人数(小数対応、パート・アルバイト等の按分用)が入力されていればそれを優先し、
// 未入力の場合は在籍スタッフ数をそのまま使う(正社員のみの店舗は追加設定なしで使えるように
// するための仕様) — 優先順位: ①生産性計算人数 ②在籍スタッフ数。どちらも無い(0)場合のみ
// 計算せず、0除算も発生させない(hasStaffCount:false を返すだけ)。損益表・費用入力を
// 使っていない店舗でも、売上とスタッフ人数だけで完結する独立した指標として設計している。
export const getStaffProductivitySummary = ({ sales, forecast, staffCount, productivityStaffCount } = {}) => {
  const productivityCount = parseNumber(productivityStaffCount);
  const effectiveCount = productivityCount > 0 ? productivityCount : parseNumber(staffCount);
  if (!effectiveCount || effectiveCount <= 0) {
    return { hasStaffCount: false, current: 0, monthEndForecast: 0, effectiveStaffCount: 0 };
  }
  return {
    hasStaffCount: true,
    current: parseNumber(sales) / effectiveCount,
    monthEndForecast: parseNumber(forecast) / effectiveCount,
    // 呼び出し側(ダッシュボードの「1人あたり月間売上」表示条件)が、優先順位(生産性計算人数
    // →在籍スタッフ数)を重複実装せずに閾値判定できるよう、実際に使った人数をそのまま返す
    // (小数(例: 3.5人)にも対応、parseNumberは丸めない)。
    effectiveStaffCount: effectiveCount,
  };
};

// 月次経営ダッシュボード用: 前月データが「存在しない」(hasPrevious:false)場合と「存在するが
// 差分が0%」を区別してnullを返す。formatDiffOrDashとセットで使う — 0/NaN/Infinityのいずれも
// 「前月データなし」の意味には使わない(実際に0%の変化と区別できなくなるため)。
export const diffPercent = (current, previous, hasPrevious) => {
  if (!hasPrevious || !Number.isFinite(previous) || previous === 0) return null;
  return ((parseNumber(current) - previous) / previous) * 100;
};

export const formatMoneyOrDash = (value, hasData = true) =>
  hasData && Number.isFinite(Number(value)) ? `¥${Math.round(Number(value)).toLocaleString("ja-JP")}` : "－";

export const formatPercentOrDash = (value, hasData = true, digits = 1) =>
  hasData && Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}%` : "－";

export const formatDiffOrDash = (diff) => {
  if (diff === null || diff === undefined || !Number.isFinite(diff)) return "－";
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  return `${sign}${Math.abs(diff).toFixed(1)}%`;
};

// 月次経営ダッシュボード用: 会社(company.stores)配下の1店舗1行の当月・前月データをまとめて
// 返す。全店舗サマリー・棒グラフ・比較表・ランキング・CSV出力がすべてこの1関数の結果を
// 再利用し、店舗ごとにcalculateMonthSummaryを重複して呼び出さない。
// store.settings/staffCount/productivityStaffCountは、Supabaseハイドレート時に既に
// company.stores[i]へマージ済み(store_profiles/store_input_settingsのオーバーレイ)。
// 販売前総合チェックで発見したarchived店舗の漏れの修正: 呼び出し元(MonthlyDashboardPage.jsx)
// はcurrentCompanyStore(archived除外済み)ではなく、生のcurrentCompany(archived含む)を渡して
// いたため、休止・削除済み店舗の売上・費用・損益がこの関数経由で全店舗サマリー・比較表・
// ランキング・CSVへ紛れ込んでいた——sales/KPIページ側のcalculateAllStoresMonthSummaryや
// 月次レビュー側のgetMonthlyReviewSummaryは既にこの関数内でarchived除外していたのと同じ
// フィルタを、呼び出し元に依存せずここでも一律に適用する(呼び出し元がどの店舗配列を渡しても
// 必ず現在の運用対象店舗だけに絞られるようにする、根本側での修正)。個別店舗の過去データ
// 自体(calculateMonthSummary・日次入力・月次レビュー等の単一店舗ページ)には一切触れない
// ——archived店舗を直接選択して過去実績を参照する経路はそのまま残る。
export const getStoreDashboardRows = (state, company, monthValue) => {
  const stores = (Array.isArray(company?.stores) ? company.stores : []).filter((store) => store?.id && store.status !== "archived");
  const previousMonthValue = getMonthOffset(monthValue, -1);

  return stores.map((store) => {
    const useInventoryTracking = Boolean(store.settings?.useInventoryTracking);
    // 店舗ごとの「対象外」設定(store.settings.hiddenClosingCategories)を渡す — 対象外カテゴリは
    // 「未入力」として扱われず、営業利益等の計算(isProvisionalProfit)が対象外設定のせいで
    // ブロックされ続けることがない(月締めの対象外機能と同じ規約、店舗比較表が壊れないため)。
    const hiddenCategories = store.settings?.hiddenClosingCategories || [];
    const summary = calculateMonthSummary(state, store.id, monthValue, { useInventoryTracking, hiddenCategories });
    const previousSummary = calculateMonthSummary(state, store.id, previousMonthValue, { useInventoryTracking, hiddenCategories });
    const productivity = getStaffProductivitySummary({
      sales: summary.sales, forecast: summary.displayForecast,
      staffCount: store.staffCount, productivityStaffCount: store.productivityStaffCount,
    });
    const previousProductivity = getStaffProductivitySummary({
      sales: previousSummary.sales, forecast: previousSummary.displayForecast,
      staffCount: store.staffCount, productivityStaffCount: store.productivityStaffCount,
    });
    const effectiveStaffCount = parseNumber(store.productivityStaffCount) > 0
      ? parseNumber(store.productivityStaffCount) : parseNumber(store.staffCount);
    const isClosed = Boolean(state.monthClosingStatus?.[buildMonthKey(store.id, monthValue)]?.closed);
    // 実日次入力が無くても、まとめて入力だけでその月の実績がある場合は「前月データあり」と
    // 判定する(getMonthClosingChecklistの「売上」判定と同じ基準に統一。不具合修正:
    // まとめ入力オンリーの月が「比較データなし」寄りに誤判定されていた)。
    const hasPrevious = previousSummary.entries.length > 0 || previousSummary.batchEntries.length > 0;

    return {
      storeId: store.id,
      storeName: store.name,
      isClosed,
      sales: summary.sales,
      technicalSales: summary.technicalSales,
      retailSales: summary.retailSales,
      retailRatio: summary.retailRatio,
      hasRetailData: summary.sales > 0,
      customers: summary.customers,
      newCustomers: summary.newCustomers,
      repeatCustomers: summary.repeatCustomers,
      newCustomerRate: summary.customers > 0 ? (summary.newCustomers / summary.customers) * 100 : 0,
      hasCustomerData: summary.customers > 0,
      averageSpend: summary.averageSpend,
      // 粗利 = 総売上 - 発注費(材料原価)。損益表(calculateMonthSummary)のgrossProfitと同じ
      // 値をそのまま使う(ダッシュボード独自の別計算式は作らない)。発注費(materials)が
      // 未入力の店舗は原価0円で計算されてしまうため、purchaseCostと同じhasDataで「－」にする。
      grossProfit: summary.grossProfit,
      hasGrossProfitData: Boolean(summary.categoryHasEntry?.materials),
      laborCost: summary.laborCost,
      laborRate: summary.laborRate,
      hasLaborData: Boolean(summary.categoryHasEntry?.labor),
      purchaseCost: summary.costOfGoodsSold,
      purchaseCostRate: summary.costOfGoodsSoldRate,
      hasPurchaseData: Boolean(summary.categoryHasEntry?.materials),
      fixedCost: summary.fixedCost,
      fixedCostRate: summary.sales > 0 ? (summary.fixedCost / summary.sales) * 100 : 0,
      hasFixedCostData: summary.hasFixedCostData,
      adCost: summary.adCost,
      adRate: summary.adRate,
      hasAdData: Boolean(summary.categoryHasEntry?.advertising),
      targetSales: parseNumber(summary.target?.targetSales),
      hasSalesTarget: parseNumber(summary.target?.targetSales) > 0,
      targetAchievement: summary.targetAchievement,
      operatingProfit: summary.operatingProfit,
      operatingMargin: summary.operatingMargin,
      isProvisionalProfit: summary.isProvisionalProfit,
      effectiveStaffCount,
      productivity,
      previous: {
        hasPrevious,
        sales: previousSummary.sales,
        customers: previousSummary.customers,
        averageSpend: previousSummary.averageSpend,
        newCustomers: previousSummary.newCustomers,
        retailSales: previousSummary.retailSales,
        laborCost: previousSummary.laborCost,
        purchaseCost: previousSummary.costOfGoodsSold,
        grossProfit: previousSummary.grossProfit,
        hasGrossProfitData: Boolean(previousSummary.categoryHasEntry?.materials),
        operatingProfit: previousSummary.operatingProfit,
        operatingMargin: previousSummary.operatingMargin,
        hasLaborData: Boolean(previousSummary.categoryHasEntry?.labor),
        hasPurchaseData: Boolean(previousSummary.categoryHasEntry?.materials),
        hasFixedCostData: previousSummary.hasFixedCostData,
        isProvisionalProfit: previousSummary.isProvisionalProfit,
        productivity: previousProductivity,
      },
    };
  });
};

// 月次経営ダッシュボード用: 全店舗ダッシュボードの会社全体サマリー。getStoreDashboardRowsを
// 1回だけ呼び、各店舗の実額を合算してから比率を算出する(店舗ごとの比率を平均するのではない
// — calculateAllStoresMonthSummaryが同じ理由で生の実績から再計算しているのと同じ設計)。
export const getCompanyDashboardSummary = (state, company, monthValue) => {
  const storeRows = getStoreDashboardRows(state, company, monthValue);

  const sum = (picker) => storeRows.reduce((total, row) => total + parseNumber(picker(row)), 0);
  const totalSales = sum((row) => row.sales);
  const totalOperatingProfit = sum((row) => row.operatingProfit);
  const totalGrossProfit = sum((row) => row.grossProfit);
  const totalLaborCost = sum((row) => row.laborCost);
  const totalPurchaseCost = sum((row) => row.purchaseCost);
  const totalFixedCost = sum((row) => row.fixedCost);
  const totalAdCost = sum((row) => row.adCost);
  const totalTargetSales = sum((row) => row.targetSales);
  const totalEffectiveStaffCount = storeRows.reduce(
    (total, row) => total + (row.productivity.hasStaffCount ? parseNumber(row.effectiveStaffCount) : 0), 0
  );
  const hasStaffCount = storeRows.some((row) => row.productivity.hasStaffCount);
  // 会社全体としての費用データ有無: 1店舗でも登録があれば、その合計は「実際に入力された金額の
  // 合計」として意味を持つ(未入力店舗の0円は単に合算対象から実質除外されるだけ)。1店舗も
  // 登録が無い場合のみ「－」にする。営業利益/営業利益率は、1店舗でも人件費・材料費が未登録
  // (isProvisionalProfit)なら会社全体の合計も暫定扱いにする(その店舗の分だけ費用が0円として
  // 合算されてしまっているため)。
  const hasLaborData = storeRows.some((row) => row.hasLaborData);
  const hasPurchaseData = storeRows.some((row) => row.hasPurchaseData);
  const hasGrossProfitData = storeRows.some((row) => row.hasGrossProfitData);
  const hasFixedCostData = storeRows.some((row) => row.hasFixedCostData);
  const hasAdData = storeRows.some((row) => row.hasAdData);
  const hasSalesTarget = storeRows.some((row) => row.hasSalesTarget);
  const isProvisionalProfit = storeRows.some((row) => row.isProvisionalProfit);

  const previousTotalSales = sum((row) => row.previous.sales);
  const previousTotalOperatingProfit = sum((row) => row.previous.operatingProfit);
  const previousTotalGrossProfit = sum((row) => row.previous.grossProfit);
  const previousTotalLaborCost = sum((row) => row.previous.laborCost);
  const previousTotalPurchaseCost = sum((row) => row.previous.purchaseCost);
  const previousHasStaffCount = storeRows.some((row) => row.previous.productivity.hasStaffCount);
  const previousTotalEffectiveStaffCount = storeRows.reduce(
    (total, row) => total + (row.previous.productivity.hasStaffCount ? parseNumber(row.effectiveStaffCount) : 0), 0
  );
  const hasPrevious = storeRows.some((row) => row.previous.hasPrevious);
  const previousHasLaborData = storeRows.some((row) => row.previous.hasLaborData);
  const previousHasPurchaseData = storeRows.some((row) => row.previous.hasPurchaseData);
  const previousHasGrossProfitData = storeRows.some((row) => row.previous.hasGrossProfitData);
  const previousIsProvisionalProfit = storeRows.some((row) => row.previous.isProvisionalProfit);

  return {
    monthValue,
    isFullyClosed: storeRows.length > 0 && storeRows.every((row) => row.isClosed),
    storeCount: storeRows.length,
    totalSales,
    totalOperatingProfit,
    operatingMargin: totalSales > 0 ? (totalOperatingProfit / totalSales) * 100 : 0,
    isProvisionalProfit,
    totalGrossProfit,
    grossMargin: totalSales > 0 ? (totalGrossProfit / totalSales) * 100 : 0,
    hasGrossProfitData,
    totalLaborCost,
    laborRate: totalSales > 0 ? (totalLaborCost / totalSales) * 100 : 0,
    hasLaborData,
    totalPurchaseCost,
    purchaseCostRate: totalSales > 0 ? (totalPurchaseCost / totalSales) * 100 : 0,
    hasPurchaseData,
    totalFixedCost,
    fixedCostRate: totalSales > 0 ? (totalFixedCost / totalSales) * 100 : 0,
    hasFixedCostData,
    totalAdCost,
    adRate: totalSales > 0 ? (totalAdCost / totalSales) * 100 : 0,
    hasAdData,
    totalTargetSales,
    hasSalesTarget,
    targetAchievement: totalTargetSales > 0 ? (totalSales / totalTargetSales) * 100 : 0,
    staffProductivity: {
      hasStaffCount,
      current: hasStaffCount && totalEffectiveStaffCount > 0 ? totalSales / totalEffectiveStaffCount : 0,
    },
    previous: {
      hasPrevious,
      totalSales: previousTotalSales,
      totalOperatingProfit: previousTotalOperatingProfit,
      operatingMargin: previousTotalSales > 0 ? (previousTotalOperatingProfit / previousTotalSales) * 100 : 0,
      isProvisionalProfit: previousIsProvisionalProfit,
      totalGrossProfit: previousTotalGrossProfit,
      grossMargin: previousTotalSales > 0 ? (previousTotalGrossProfit / previousTotalSales) * 100 : 0,
      hasGrossProfitData: previousHasGrossProfitData,
      totalLaborCost: previousTotalLaborCost,
      laborRate: previousTotalSales > 0 ? (previousTotalLaborCost / previousTotalSales) * 100 : 0,
      hasLaborData: previousHasLaborData,
      totalPurchaseCost: previousTotalPurchaseCost,
      purchaseCostRate: previousTotalSales > 0 ? (previousTotalPurchaseCost / previousTotalSales) * 100 : 0,
      hasPurchaseData: previousHasPurchaseData,
      staffProductivity: {
        hasStaffCount: previousHasStaffCount,
        current: previousHasStaffCount && previousTotalEffectiveStaffCount > 0
          ? previousTotalSales / previousTotalEffectiveStaffCount : 0,
      },
    },
    storeRows,
  };
};

// 月次レビュー用の{current, previous, diff}組み立て。sales/customers等、比較可能な項目は
// 必ずこの1つのヘルパーだけを通す(要件2: 「同じ計算ロジックを使用」「前月が0の場合の処理も
// 共通化」) — diffPercentが「前月データなし」(hasPrevious:false)と「前月が0」の両方を
// 一律nullで返すため、呼び出し側(UI)はnullなら常に「比較データなし」を表示するだけでよく、
// 0除算・NaN・Infinityが表示されることは構造的に無い。
const buildMonthlyReviewMetric = (current, previous, hasPrevious) => ({
  current,
  previous: hasPrevious ? previous : null,
  diff: diffPercent(current, previous, hasPrevious),
});

// 月次レビュー(利益管理ではない、店舗・会社全体で共有するためのシンプルな数字サマリー)。
// 既存のcalculateMonthSummary/calculateAllStoresMonthSummary(全店舗ビュー)をそのまま呼ぶだけで、
// 売上・客数等の集計ロジック自体は一切再実装しない(要件16)。利益・営業利益・利益率は
// 意図的にこの関数の戻り値に含めない(要件13) — calculateMonthSummary内部では計算されて
// いるが、ここで拾わなければ月次レビュー側のUIに表示しようがない、という構造で担保する。
//
// storeEntity: 対象月レビューの店舗オブジェクト(company.stores[i]相当、settings/staffCount/
// productivityStaffCountを含む)。全店舗ビュー(isAllStoresView:true)の場合はnullでよい
// (代わりにcompanyStoresを渡す)。
export const getMonthlyReviewSummary = (state, { storeId, isAllStoresView, company, storeEntity, companyStores } = {}, monthValue) => {
  const previousMonthValue = getMonthOffset(monthValue, -1);

  if (isAllStoresView) {
    // 加盟店を混ぜない・自社店舗のみ集計、という既存仕様はcalculateAllStoresMonthSummary
    // (呼び出し元がcompany.storesを渡す時点で加盟店データを含めない設計)にそのまま従う——
    // ここで別途フィルタし直さない(要件5・16: 全店舗ビューの集計ロジックを新規に作らない)。
    const stores = (Array.isArray(companyStores) ? companyStores : company?.stores || []).filter((store) => store?.id && store.status !== "archived");
    const current = calculateAllStoresMonthSummary(state, company, monthValue);
    const previous = calculateAllStoresMonthSummary(state, company, previousMonthValue);
    // 全店舗版のhasPrevious: getStoreDashboardRowsの店舗別hasPrevious(前月の日次入力
    // または、まとめて入力の実績が1件でもあるか)と同じ判定基準を、店舗横断でsomeを取る
    // だけ(要件12: 未入力を0として勝手に集計しない、の会社全体版。不具合修正: まとめ入力
    // オンリーの店舗が1件でもあれば前月データありと判定する)。
    const hasPrevious = stores.some((store) => {
      const previousStoreSummary = calculateMonthSummary(state, store.id, previousMonthValue);
      return previousStoreSummary.entries.length > 0 || previousStoreSummary.batchEntries.length > 0;
    });
    const showReviewCountTarget = stores.some((store) => Boolean(store.settings?.monthlyTargetFields?.fields?.targetReviewCount));
    const targetSales = parseNumber(current.target?.targetSales);
    return {
      hasPrevious,
      showReviewCountTarget,
      hasStaffProductivity: false,
      sales: buildMonthlyReviewMetric(current.sales, previous.sales, hasPrevious),
      hasSalesTarget: targetSales > 0,
      targetSales,
      targetAchievement: targetSales > 0 ? current.targetAchievement : null,
      technicalSales: buildMonthlyReviewMetric(current.technicalSales, previous.technicalSales, hasPrevious),
      retailSales: buildMonthlyReviewMetric(current.retailSales, previous.retailSales, hasPrevious),
      customers: buildMonthlyReviewMetric(current.customers, previous.customers, hasPrevious),
      averageSpend: buildMonthlyReviewMetric(current.averageSpend, previous.averageSpend, hasPrevious),
      newCustomers: buildMonthlyReviewMetric(current.newCustomers, previous.newCustomers, hasPrevious),
      repeatCustomers: buildMonthlyReviewMetric(current.repeatCustomers, previous.repeatCustomers, hasPrevious),
      reviewCount: showReviewCountTarget ? buildMonthlyReviewMetric(current.reviewCount, previous.reviewCount, hasPrevious) : null,
      targetReviewCount: showReviewCountTarget ? parseNumber(current.target?.targetReviewCount) : null,
      reviewCountAchievement: showReviewCountTarget && parseNumber(current.target?.targetReviewCount) > 0 ? current.reviewCountAchievement : null,
      productivity: null,
    };
  }

  const hiddenCategories = storeEntity?.settings?.hiddenClosingCategories || [];
  const useInventoryTracking = Boolean(storeEntity?.settings?.useInventoryTracking);
  const current = calculateMonthSummary(state, storeId, monthValue, { useInventoryTracking, hiddenCategories });
  const previous = calculateMonthSummary(state, storeId, previousMonthValue, { useInventoryTracking, hiddenCategories });
  // 単一店舗版のhasPrevious: getStoreDashboardRowsと全く同じ基準(前月の日次入力または、
  // まとめて入力の実績が1件でもあるか)。不具合修正: 以前はentries.length(daily_sales由来)
  // だけを見ており、まとめ入力オンリーの前月(例: フィーネ横浜2026年7月、1件のまとめ入力
  // だけで月全体が構成されていたケース)が実際にはデータありなのに「比較データなし」と
  // 誤判定されていた。この判定はgetStoreDashboardRows/getStoreMonthSalesTotal/
  // getMonthClosingChecklistと共通の基準(entries || batchEntries)に揃えてある。
  const hasPrevious = previous.entries.length > 0 || previous.batchEntries.length > 0;
  const showReviewCountTarget = Boolean(storeEntity?.settings?.monthlyTargetFields?.fields?.targetReviewCount);
  const productivity = getStaffProductivitySummary({
    sales: current.sales, forecast: current.displayForecast,
    staffCount: storeEntity?.staffCount, productivityStaffCount: storeEntity?.productivityStaffCount,
  });
  const previousProductivity = getStaffProductivitySummary({
    sales: previous.sales, forecast: previous.displayForecast,
    staffCount: storeEntity?.staffCount, productivityStaffCount: storeEntity?.productivityStaffCount,
  });
  const targetSales = parseNumber(current.target?.targetSales);

  return {
    hasPrevious,
    showReviewCountTarget,
    hasStaffProductivity: productivity.hasStaffCount,
    sales: buildMonthlyReviewMetric(current.sales, previous.sales, hasPrevious),
    hasSalesTarget: targetSales > 0,
    targetSales,
    targetAchievement: targetSales > 0 ? current.targetAchievement : null,
    technicalSales: buildMonthlyReviewMetric(current.technicalSales, previous.technicalSales, hasPrevious),
    retailSales: buildMonthlyReviewMetric(current.retailSales, previous.retailSales, hasPrevious),
    customers: buildMonthlyReviewMetric(current.customers, previous.customers, hasPrevious),
    averageSpend: buildMonthlyReviewMetric(current.averageSpend, previous.averageSpend, hasPrevious),
    newCustomers: buildMonthlyReviewMetric(current.newCustomers, previous.newCustomers, hasPrevious),
    repeatCustomers: buildMonthlyReviewMetric(current.repeatCustomers, previous.repeatCustomers, hasPrevious),
    reviewCount: showReviewCountTarget ? buildMonthlyReviewMetric(current.reviewCount, previous.reviewCount, hasPrevious) : null,
    targetReviewCount: showReviewCountTarget ? parseNumber(current.target?.targetReviewCount) : null,
    reviewCountAchievement: showReviewCountTarget && parseNumber(current.target?.targetReviewCount) > 0 ? current.reviewCountAchievement : null,
    productivity: productivity.hasStaffCount ? buildMonthlyReviewMetric(productivity.current, previousProductivity.current, hasPrevious) : null,
  };
};

// 月次レビューの自由記述4項目。company_id・store_id(全店舗はnull)・target_monthの3つで
// 一意に定まる(要件6)。storeIdが空文字/未指定なら全店舗(会社全体)レビューのキーを使う——
// buildMonthKey/buildCompanyMonthKeyは既存の他機能(店休日・目標設定等)と全く同じキー生成
// 関数を再利用しているだけで、月次レビュー専用の新しいキー形式は作らない。
export const buildMonthlyReviewKey = (companyId, storeId, monthValue) =>
  storeId ? buildMonthKey(storeId, monthValue) : buildCompanyMonthKey(companyId, monthValue);

export const getMonthlyReviewText = (state, { companyId, storeId }, monthValue) => {
  const key = buildMonthlyReviewKey(companyId, storeId, monthValue);
  return state.monthlyReviews?.[key] || { reflection: "", challenges: "", improvements: "", next_actions: "", updatedAt: "" };
};

export const monthlyReviewRowToEntry = (row = {}) => ({
  id: row.id,
  reflection: row.reflection || "",
  challenges: row.challenges || "",
  improvements: row.improvements || "",
  next_actions: row.next_actions || "",
  updatedAt: row.updated_at || "",
});

export const buildMonthlyReviewStateFromRows = (rows = []) => {
  const monthlyReviews = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row.company_id || !row.target_month) return;
    const key = buildMonthlyReviewKey(row.company_id, row.store_id, row.target_month);
    monthlyReviews[key] = monthlyReviewRowToEntry(row);
  });
  return { monthlyReviews };
};

// 文字列シードから安定したインデックスを作るだけの軽量ハッシュ。同じシードなら常に同じ
// バリアントを選ぶため同一レンダー内でコメントが揺れ動くことはないが、シードに日付を含めて
// 呼び出すことで、同じ状況でも日が変われば言い回しが変わる(状態を持たずに「毎日変化し、
// 同じ文章が続かない」を実現する)。
const pickVariant = (variants, seed) => {
  const text = String(seed || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return variants[hash % variants.length];
};

const SALES_LINES = {
  ahead: ["売上は目標ペースを上回って推移しています。", "売上は好調で、目標ペースを上回るペースです。", "売上は目標ペースを上回るハイペースです。"],
  onPace: ["売上は目標ペースどおりに推移しています。", "売上はほぼ目標ペースで進んでいます。"],
  slight: ["売上はやや目標ペースを下回っています。", "売上は目標ペースに対して少し届いていません。", "売上が目標ペースにわずかに追いついていません。"],
  large: ["売上は目標ペースを大きく下回っています。", "売上が目標ペースに対して大きく遅れています。"],
};
const CUSTOMER_LINES = {
  achieving: ["客数は目標を達成しています。", "客数はしっかり目標をクリアしています。", "客数は目標をキープできています。"],
  slight: ["客数はやや目標を下回っています。", "客数はもう一歩で目標到達です。", "客数が目標にわずかに届いていません。"],
  large: ["客数が目標を大きく下回っています。", "客数の伸び悩みが課題になっています。"],
};
// 「ため、」「ことで」に自然に続くよう、あえて言い切らない活用形(丁寧語で終わらない)にしている。
const SPEND_SUPPORT_LINES = {
  achieving: ["客単価は目標を維持できている", "客単価は目標水準をキープできている", "客単価はしっかり維持できている"],
  behind: ["客単価アップを意識する", "客単価をもう一段引き上げる", "客単価の底上げを意識する"],
};
const CLOSING_GOOD_LINES = [
  "この調子で残り営業日も積み重ねていきましょう！",
  "この調子を維持して、最高の月を目指しましょう！",
  "素晴らしいペースです。このまま突き進みましょう！",
  "この調子を維持して、良い結果につなげましょう！",
];
const CLOSING_MIXED_LINES = [
  "十分巻き返せます。この調子で積み上げていきましょう！",
  "まだまだ挽回できる状況です。着実に積み重ねていきましょう！",
  "十分に取り戻せる差です。一歩ずつ積み上げていきましょう！",
];
const CLOSING_HARD_LINES = [
  "ここからでも十分挽回できます。まずは今日の目標達成を目指しましょう！",
  "まだ挽回のチャンスは十分にあります。今日からできることを一つずつ積み重ねましょう！",
  "ここからの巻き返しに期待しましょう。小さな積み重ねが結果につながります！",
];
const NO_TARGET_LINES = [
  "月間目標を設定すると、達成状況を踏まえたコメントを表示できます。",
  "月間目標を登録すると、より具体的なアドバイスを表示できるようになります。",
];

// AIコメント。以前のような「目標との差額の説明」ではなく、売上達成状況・客数達成状況・
// 客単価・月末着地予測・営業日数の進捗などを総合した「売上全体の総括コメント」を生成する。
// 常に ①今何が達成できているか ②今何が達成できていないか ③前向きな一言 の流れで、状況ごとに
// 複数の言い回しを用意し(pickVariant)、同じ状況でも日によって違う文章になるようにしている。
// tier(順調|注意|要改善)は売上ペースと客数達成の2軸のうち、達成できている軸の数で決める:
// 両方 → 順調、片方 → 注意、どちらも未達 → 要改善(どちらの目標も未登録なら順調扱い)。
export const getSalesStatusComment = (input = {}) => {
  const targetSales = parseNumber(input.targetSales);
  const cumulativeSales = parseNumber(input.closedSales);
  const businessDayCount = parseNumber(input.businessDayCount);
  const completedDays = parseNumber(input.completedDays);
  const remainingBusinessDays = parseNumber(input.remainingBusinessDays);
  const targetCustomers = parseNumber(input.targetCustomers);
  const customers = parseNumber(input.customers);
  const targetAverageSpend = parseNumber(input.targetAverageSpend);
  const averageSpend = parseNumber(input.averageSpend);
  const seed = String(input.seed || "");

  const targetGap = Math.round(targetSales - cumulativeSales);
  const targetPerDay = businessDayCount > 0 ? targetSales / businessDayCount : 0;
  const requiredSoFar = targetPerDay * completedDays;
  const paceDiff = targetSales > 0 && completedDays > 0 ? Math.round(cumulativeSales - requiredSoFar) : null;
  const dailyAverageNeeded = targetGap > 0 && remainingBusinessDays > 0 ? Math.round(targetGap / remainingBusinessDays) : 0;

  // 軸①: 売上ペース。requiredSoFar の5%(最低でも1日分の目標額)を「ほぼペースどおり」の
  // 許容幅とし、それを超えて下回っていれば "slight"、さらにその4倍を超えて下回れば "large"。
  let salesState = null;
  if (paceDiff !== null) {
    const band = Math.max(requiredSoFar * 0.05, targetPerDay || 0);
    if (paceDiff > band) salesState = "ahead";
    else if (paceDiff >= -band) salesState = "onPace";
    else if (paceDiff >= -band * 4) salesState = "slight";
    else salesState = "large";
  }

  // 軸②: 客数達成率。
  let customerAchievementRate = null;
  let customerState = null;
  if (targetCustomers > 0) {
    customerAchievementRate = (customers / targetCustomers) * 100;
    if (customerAchievementRate >= 100) customerState = "achieving";
    else if (customerAchievementRate >= 85) customerState = "slight";
    else customerState = "large";
  }

  // 軸③: 客単価。①②の補足として使うだけで、tier判定には使わない。
  const spendState = targetAverageSpend > 0
    ? (averageSpend >= targetAverageSpend ? "achieving" : "behind")
    : null;

  const salesAchieving = salesState === "ahead" || salesState === "onPace";
  const salesLagging = salesState === "slight" || salesState === "large";
  const customerAchieving = customerState === "achieving";
  const customerLagging = customerState === "slight" || customerState === "large";

  const knownAxes = [salesState, customerState].filter(Boolean).length;
  const achievingAxes = (salesAchieving ? 1 : 0) + (customerAchieving ? 1 : 0);
  const laggingAxes = (salesLagging ? 1 : 0) + (customerLagging ? 1 : 0);

  let tier;
  if (knownAxes === 0) tier = "順調";
  else if (laggingAxes === 0) tier = "順調";
  else if (achievingAxes === 0) tier = "要改善";
  else tier = "注意";

  const lines = [];

  if (knownAxes === 0) {
    lines.push(pickVariant(NO_TARGET_LINES, `${seed}-no-target`));
  } else if (salesState && customerState) {
    // 両軸とも目標がある: ①達成できている方、②できていない方の順で1文にまとめる。
    const salesLine = pickVariant(SALES_LINES[salesState], `${seed}-sales`);
    const customerLine = pickVariant(CUSTOMER_LINES[customerState] || CUSTOMER_LINES.achieving, `${seed}-customer`);
    if (salesAchieving && customerAchieving) {
      lines.push(pickVariant([
        "売上・客数ともに順調に推移しています。",
        "売上、客数ともに好調な状況です。",
        "売上・客数とも目標を上回るペースです。",
      ], `${seed}-both-good`));
    } else if (salesAchieving && customerLagging) {
      lines.push(`${salesLine.replace(/。$/, "")}が、${customerLine}`);
    } else if (customerAchieving && salesLagging) {
      lines.push(`${customerLine.replace(/。$/, "")}が、${salesLine}`);
    } else {
      lines.push(`${salesLine.replace(/。$/, "")}。${customerLine}`);
    }
  } else if (salesState) {
    lines.push(pickVariant(SALES_LINES[salesState], `${seed}-sales`));
  } else if (customerState) {
    lines.push(pickVariant(CUSTOMER_LINES[customerState] || CUSTOMER_LINES.achieving, `${seed}-customer`));
  }

  // ③ 前向きな一言。目標が何も登録されていない場合は①の案内文だけを返し、ペースも何も
  // わかっていないのに「素晴らしいペースです」のような的外れな一言を続けない。
  if (knownAxes > 0) {
    if (spendState === "behind" && laggingAxes > 0) {
      // 客単価アップの一言そのものが前向きな締めを兼ねる(例: 「客単価アップを意識すること
      // で十分巻き返せます！」)。
      lines.push(`${pickVariant(SPEND_SUPPORT_LINES.behind, `${seed}-spend`)}ことで十分巻き返せます！`);
    } else {
      const closingPool = tier === "順調" ? CLOSING_GOOD_LINES : tier === "注意" ? CLOSING_MIXED_LINES : CLOSING_HARD_LINES;
      const closingLine = pickVariant(closingPool, `${seed}-closing`);
      const closingPrefix = spendState === "achieving" && tier !== "要改善"
        ? `${pickVariant(SPEND_SUPPORT_LINES.achieving, `${seed}-spend`)}ため、`
        : "";
      lines.push(closingPrefix ? `${closingPrefix}${closingLine}` : closingLine);
    }
  }

  return {
    tier,
    headline: "売上状況",
    lines,
    message: lines.join("\n"),
    targetGap,
    paceDiff,
    dailyAverageNeeded,
    salesState,
    customerState,
    customerAchievementRate,
    spendState,
  };
};

class AiSummary extends Array {
  includes(searchElement) {
    return super.some((item) => String(item).includes(String(searchElement)));
  }
}

export const getAiAnalysis = (input = {}) => {
  const summary = new AiSummary();
  const priorities = [];
  const notes = [];

  const targetAchievement = Number(input.targetAchievement ?? 0);
  const customerAchievement = Number(input.customerAchievement ?? 0);
  const averageSpend = Number(input.averageSpend ?? 0);
  const targetAverageSpend = Number(input.targetAverageSpend ?? 0);
  const operatingMargin = Number(input.operatingMargin ?? 0);
  const targetOperatingMargin = Number(input.targetOperatingMargin ?? 0);
  const fixedCost = Number(input.fixedCost ?? 0);
  const variableCost = Number(input.variableCost ?? 0);
  const adjustedOperatingProfit = Number(input.adjustedOperatingProfit ?? 0);
  const remainingBusinessDays = Number(input.remainingBusinessDays ?? 0);
  const remainingSalesTarget = Number(input.remainingSalesTarget ?? 0);
  const remainingCustomersTarget = Number(input.remainingCustomersTarget ?? 0);
  const taxExclusiveSales = Number(input.taxExclusiveSales ?? 0);
  const taxAmount = Number(input.taxAmount ?? 0);
  const customers = Number(input.customers ?? 0);
  const targetCustomers = Number(input.customerTarget ?? input.targetCustomers ?? 0);

  if (Number.isFinite(targetAchievement)) {
    summary.push(`売上目標の達成状況: ${targetAchievement.toFixed(1)}%`);
  }
  if (Number.isFinite(customerAchievement)) {
    summary.push(`客数目標の達成状況: ${customerAchievement.toFixed(1)}%`);
  }
  if (Number.isFinite(targetAverageSpend)) {
    summary.push(`客単価目標の達成状況: ${averageSpend >= targetAverageSpend ? "達成" : "未達"}`);
  }
  if (Number.isFinite(targetOperatingMargin)) {
    summary.push(`利益目標の達成状況: ${operatingMargin >= targetOperatingMargin ? "達成" : "未達"}`);
  }

  if (customerAchievement < 100) {
    priorities.push("客数不足が売上未達の主因です");
    summary.push("未達の主因: 客数不足が主因です");
  } else {
    summary.push("未達の主因: 客数は目標達成しています");
  }

  if (averageSpend > targetAverageSpend) {
    notes.push(`客単価は目標を上回っており、${averageSpend - targetAverageSpend}円高です`);
  } else {
    notes.push("客単価は目標未達です");
  }

  if (fixedCost > 0 || variableCost > 0) {
    priorities.push("固定費と販管費の増減を確認してください");
  }

  if (adjustedOperatingProfit >= 0) {
    notes.push("設備投資を除いた調整後利益は改善傾向です");
  } else {
    notes.push("設備投資を除いた調整後利益は悪化しています");
  }

  if (remainingBusinessDays > 0) {
    notes.push(`残り営業日で必要な客数: ${Math.max(remainingCustomersTarget / remainingBusinessDays, 0).toFixed(1)}名`);
    notes.push(`残り営業日で必要な売上: ${Math.max(remainingSalesTarget / remainingBusinessDays, 0).toFixed(0)}円`);
  } else {
    notes.push("残り営業日数はありません");
  }

  if (taxExclusiveSales > 0) {
    notes.push(`税抜売上は${taxExclusiveSales.toFixed(0)}円、消費税相当額は${taxAmount.toFixed(0)}円です`);
  } else {
    notes.push("税抜売上のデータ不足");
  }

  if (customers <= 0 || targetCustomers <= 0) {
    notes.push("客数データ不足");
  }

  return {
    summary,
    priorities,
    notes,
    assumptions: [
      "消費税額は簡易計算による参考値です",
      "実際の申告額は課税区分や控除により異なる場合があります",
    ],
  };
};

export { defaultClosingItem, defaultDailyEntry, defaultFixedCostItem, defaultTarget, defaultVariableCostItem, expenseCategories };
