import {
  createInitialAppState,
  defaultClosingItem,
  defaultDailyEntry,
  defaultFixedCostItem,
  defaultTarget,
  defaultVariableCostItem,
  expenseCategories,
  ALL_STORES_VALUE,
} from "../data/defaults.js";

export { createInitialAppState } from "../data/defaults.js";

export const STORAGE_KEYS = {
  theme: "salon-theme",
  appState: "salon-goal-app-v2",
};

export const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

// Every per-store/month map in appState is keyed "storeName__month", not by store_id — a
// pragmatic tradeoff kept from the original design rather than a full id-keyed rewrite (out of
// scope for a rename fix). Renaming a store must never look like that store's data vanished:
// this atomically moves every "oldName__*" key in every one of these maps to "newName__*" in
// the same appState update the rename applies, so nothing is ever dropped or duplicated. The
// real source of truth (daily_sales/monthly_targets/monthly_closings) is keyed by store_id and
// is unaffected either way — this only keeps the in-memory/local view consistent immediately,
// without waiting for the next hydrate to re-derive it from the store_id-keyed tables.
const STORE_NAME_KEYED_MAPS = [
  "dailyResults", "dayClosingStates", "dayClosingUpdatedAt", "targets", "businessDaySettings",
  "monthClosingStatus", "fixedCosts", "variableCosts", "monthClosing", "dailyResultBackups",
];

export const rekeyStoreNamedMaps = (state, oldName, newName) => {
  if (!oldName || !newName || oldName === newName) return state;
  const oldPrefix = `${oldName}__`;
  const newPrefix = `${newName}__`;
  const next = { ...state };
  STORE_NAME_KEYED_MAPS.forEach((mapKey) => {
    const source = state[mapKey];
    if (!source || typeof source !== "object") return;
    const rekeyed = {};
    let changed = false;
    Object.entries(source).forEach(([key, value]) => {
      if (key.startsWith(oldPrefix)) {
        rekeyed[newPrefix + key.slice(oldPrefix.length)] = value;
        changed = true;
      } else {
        rekeyed[key] = value;
      }
    });
    if (changed) next[mapKey] = rekeyed;
  });
  if (state.selectedStore === oldName) next.selectedStore = newName;
  return next;
};

// "2026-08" -> "2026年8月". Storage always stays in the "YYYY-MM" form; this is display-only.
export const formatMonthLabel = (monthValue) => {
  const [year, month] = String(monthValue || "").split("-");
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  if (!Number.isFinite(yearNumber) || !Number.isFinite(monthNumber) || !yearNumber || !monthNumber) return "";
  return `${yearNumber}年${monthNumber}月`;
};

export const getBusinessDaySettings = (state, storeName, monthValue) => {
  const key = buildMonthKey(storeName, monthValue);
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

  const preserveNumber = (existingValue) => parseNumber(existingValue ?? 0);
  const preserveText = (existingValue) => existingValue ?? "";

  const technicalSales = showTechnical ? parseNumber(form.technicalSales) : preserveNumber(existingEntry?.technicalSales);
  const retailSales = showRetail ? parseNumber(form.retailSales) : preserveNumber(existingEntry?.retailSales);
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
    otherSales: parseNumber(form.otherSales || 0),
    customers,
    newCustomers,
    repeatCustomers,
    reviewCount,
    memo,
  };
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

export const buildDailyStateFromRows = (rows = [], storeIdToName = {}) => {
  const dailyResults = {};
  const dayClosingStates = {};
  const dayClosingUpdatedAt = {};

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const storeName = storeIdToName[row.store_id];
    if (!storeName || !row.business_date) return;
    const month = String(row.business_date).slice(0, 7);
    const key = buildMonthKey(storeName, month);
    const entry = dailySalesRowToEntry(row);

    dailyResults[key] = [...(dailyResults[key] || []), entry];
    dayClosingStates[key] = { ...(dayClosingStates[key] || {}), [entry.date]: entry.isDayClosed };
    dayClosingUpdatedAt[key] = { ...(dayClosingUpdatedAt[key] || {}), [entry.date]: row.closed_at || entry.updatedAt || "" };
  });

  return { dailyResults, dayClosingStates, dayClosingUpdatedAt };
};

// Same idea as buildDailyStateFromRows but for monthly_closings rows -> monthClosingStatus.
export const buildMonthClosingStateFromRows = (rows = [], storeIdToName = {}) => {
  const monthClosingStatus = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const storeName = storeIdToName[row.store_id];
    if (!storeName || !row.year_month) return;
    const key = buildMonthKey(storeName, row.year_month);
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
export const buildTargetStateFromRows = (rows = [], storeIdToName = {}) => {
  const targets = {};
  const businessDaySettings = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const storeName = storeIdToName[row.store_id];
    if (!storeName || !row.target_month) return;
    const key = buildMonthKey(storeName, row.target_month);
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
export const buildFixedCostsStateFromRows = (rows = [], storeIdToName = {}) => {
  const fixedCosts = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const storeName = storeIdToName[row.store_id];
    if (!storeName || !row.entry_month) return;
    const key = buildMonthKey(storeName, row.entry_month);
    const item = {
      id: row.id,
      name: row.name || "",
      amount: row.amount,
      category: row.category || "",
      memo: row.memo || "",
      startMonth: row.start_month || "",
      endMonth: row.end_month || "",
      applyMode: row.apply_mode || "this-month",
    };
    fixedCosts[key] = [...(fixedCosts[key] || []), item];
  });
  return { fixedCosts };
};

// variable_costs (販管費) — direct month lookup (target_month), no carry-forward.
export const buildVariableCostsStateFromRows = (rows = [], storeIdToName = {}) => {
  const variableCosts = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const storeName = storeIdToName[row.store_id];
    if (!storeName || !row.target_month) return;
    const key = buildMonthKey(storeName, row.target_month);
    const item = {
      id: row.id,
      name: row.name || "",
      amount: row.amount,
      category: row.category || "",
      memo: row.memo || "",
      incurredDate: row.incurred_date || "",
      type: row.type || "regular",
    };
    variableCosts[key] = [...(variableCosts[key] || []), item];
  });
  return { variableCosts };
};

// monthly_closing_items (月締め項目) — same shape of fix as variable_costs above.
export const buildMonthlyClosingItemsStateFromRows = (rows = [], storeIdToName = {}) => {
  const monthClosing = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const storeName = storeIdToName[row.store_id];
    if (!storeName || !row.target_month) return;
    const key = buildMonthKey(storeName, row.target_month);
    const item = {
      id: row.id,
      name: row.name || "",
      amount: row.amount,
      category: row.category || "",
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
      status: row.status || "active",
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
  fixedCosts: mergeItemArrayMap(localState.fixedCosts, remoteState.fixedCosts),
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
export const getBusinessDaySummary = (state, storeName, monthValue) => {
  const key = buildMonthKey(storeName, monthValue);
  const settings = getBusinessDaySettings(state, storeName, monthValue);
  const monthInfo = getMonthInfo(monthValue);
  const holidayDates = getStoreHolidayDates(state, storeName, monthValue);
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
  const closedDateList = Object.entries(closingMap)
    .filter(([date, isClosed]) => Boolean(isClosed) && String(date).startsWith(`${monthValue}-`) && dailyEntryDates.has(String(date)) && !holidayDateSet.has(String(date)))
    .map(([date]) => String(date))
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
// storeNamesOrStores: 文字列(店舗名)の配列でも{name, openingDate}オブジェクトの配列でも
// どちらでも受け付ける(openingDateが分かれば要件26の「新規店舗追加時に過去日を未締め扱いに
// しない」判定に使う。文字列だけ渡された場合はopeningDateなし=常に開店済み扱いとなり、
// 従来どおりの挙動を維持する)。
export const getAllStoresBusinessDaySummary = (state, companyId, storeNamesOrStores, monthValue) => {
  const stores = (storeNamesOrStores || [])
    .map((item) => (typeof item === "string" ? { name: item, openingDate: "" } : item))
    .filter((item) => item && item.name);

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

  const perStoreClosedDateSets = stores.map((store) => new Set(getBusinessDaySummary(state, store.name, monthValue).closedDates || []));

  // 日付ごとに判定する(要件10・26): 全店舗の店休日は対象外、かつその日にまだ開店していない
  // 店舗(openingDateが未来)は「未締め店舗」として扱わない — 新店舗を追加しても過去日の
  // 営業完了数が突然減らないようにする。
  const closedDateList = [];
  for (let day = 1; day <= monthInfo.daysInMonth; day += 1) {
    const dateIso = `${monthValue}-${String(day).padStart(2, "0")}`;
    if (holidayDateSet.has(dateIso)) continue;
    const applicableIndexes = [];
    stores.forEach((store, index) => {
      if (!store.openingDate || store.openingDate <= dateIso) applicableIndexes.push(index);
    });
    if (!applicableIndexes.length) continue;
    const allClosed = applicableIndexes.every((index) => perStoreClosedDateSets[index].has(dateIso));
    if (allClosed) closedDateList.push(dateIso);
  }

  return {
    businessDayCount,
    completedDays: closedDateList.length,
    remainingBusinessDays: Math.max(businessDayCount - closedDateList.length, 0),
    progressRate: businessDayCount ? (closedDateList.length / Math.max(businessDayCount, 1)) * 100 : null,
    closedDates: closedDateList,
    holidayDates,
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

  return {
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
    saveStatus: {
      status: source.saveStatus?.status || "saved",
      message: source.saveStatus?.message || "自動保存済み",
      timestamp: source.saveStatus?.timestamp || "",
      error: Boolean(source.saveStatus?.error),
    },
  };
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

export const getTargetForStoreMonth = (state, storeName, monthValue) => ({
  ...defaultTarget,
  ...(state.targets?.[buildMonthKey(storeName, monthValue)] || {}),
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
export const getStoreHolidayDates = (state, storeName, monthValue) =>
  state.storeHolidays?.[buildMonthKey(storeName, monthValue)] || [];

export const getAllStoresHolidayDates = (state, companyId, monthValue) =>
  state.allStoresHolidays?.[buildCompanyMonthKey(companyId, monthValue)] || [];

export const isHolidayDate = (holidayDates, dateIso) => (holidayDates || []).includes(dateIso);

export const buildStoreHolidaysStateFromRows = (rows = [], storeIdToName = {}) => {
  const storeHolidays = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const storeName = storeIdToName[row.store_id];
    if (!storeName || !row.holiday_date) return;
    const month = String(row.holiday_date).slice(0, 7);
    const key = buildMonthKey(storeName, month);
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

export const getDailyResultsForStoreMonth = (state, storeName, monthValue) => {
  const items = state.dailyResults?.[buildMonthKey(storeName, monthValue)] || [];
  const { entries } = deduplicateDailyEntries(items);
  return entries;
};

// 「費用入力」(旧・固定費/販管費を統合した単一の費用マスター)。単月/期間指定/毎月継続を
// ユーザーに選ばせず、startMonth(必須)・endMonth(任意)だけで自動判定する:
//   - endMonthが空          → startMonth以降ずっと反映(毎月継続)
//   - startMonth === endMonth → その月だけ反映(単月)
//   - startMonth < endMonth   → その期間だけ毎月反映(期間指定、終了月を含む)
// 月ごとにレコードを複製せず、1件のマスターから対象月かどうかをその都度判定する設計。
export const getFixedCostsForStoreMonth = (state, storeName, monthValue) => {
  const itemsByKey = Object.entries(state.fixedCosts || {})
    .filter(([key]) => key.startsWith(`${storeName}__`))
    .flatMap(([key, items]) => (Array.isArray(items) ? items.map((item) => ({ ...item, _sourceKey: key })) : []));

  const matched = itemsByKey.filter((item) => {
    // entry_month (the month a row is filed/stored under locally) is NOT NULL in fixed_costs,
    // so this fallback is really just "startMonth defaults to entry_month" — it only matters
    // for a row saved without an explicit startMonth, which then behaves as if it started the
    // month it was entered. A missing endMonth on top of that means "still ongoing" (see below),
    // matching the same rule a row with an explicit startMonth follows.
    const startMonth = item.startMonth || item._sourceKey?.split("__")?.[1] || "";
    if (!startMonth) return item._sourceKey === buildMonthKey(storeName, monthValue);
    const endMonth = item.endMonth || "";
    return monthValue >= startMonth && (!endMonth || monthValue <= endMonth);
  });

  // Editing an item can move it between local month-key buckets (see submitFixedCost); dedupe
  // by id defensively so a transient double-write never shows the same cost twice.
  const byId = new Map();
  const withoutId = [];
  matched.forEach((item) => {
    if (item.id) byId.set(item.id, item);
    else withoutId.push(item);
  });
  return [...byId.values(), ...withoutId];
};

// single | period | ongoing — purely for display (e.g. "継続中" vs a fixed date range); the
// filtering logic above never needs this label, it's derived fresh from the same two fields.
export const getCostPatternLabel = (item) => {
  const startMonth = item?.startMonth || "";
  const endMonth = item?.endMonth || "";
  if (!endMonth) return "ongoing";
  if (startMonth && startMonth === endMonth) return "single";
  return "period";
};

export const getVariableCostsForStoreMonth = (state, storeName, monthValue) => {
  const items = state.variableCosts?.[buildMonthKey(storeName, monthValue)] || [];
  return [...items];
};

export const getClosingItemsForStoreMonth = (state, storeName, monthValue) => {
  const items = state.monthClosing?.[buildMonthKey(storeName, monthValue)] || [];
  return [...items];
};

export const calculateMonthSummary = (state, storeName, monthValue) => {
  const target = getTargetForStoreMonth(state, storeName, monthValue);
  const entries = getDailyResultsForStoreMonth(state, storeName, monthValue);
  const fixedCosts = getFixedCostsForStoreMonth(state, storeName, monthValue);
  const variableCosts = getVariableCostsForStoreMonth(state, storeName, monthValue);
  const closingItems = getClosingItemsForStoreMonth(state, storeName, monthValue);
  const businessDates = getBusinessDayDates(monthValue);
  const businessDaySummary = getBusinessDaySummary(state, storeName, monthValue);
  const taxRate = Number(state.taxSettings?.rate ?? 0.1);
  const roundingMode = state.taxSettings?.roundingMode || "half-up";
  const now = new Date();
  const todayIso = formatLocalDate(now);
  const selectedCurrentMonth = monthValue === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const effectiveEntries = entries;

  const sales = effectiveEntries.reduce((total, item) => total + parseNumber(item.totalSales || item.technicalSales || 0), 0);
  const technicalSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.technicalSales || 0), 0);
  const retailSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.retailSales || 0), 0);
  const otherSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.otherSales || 0), 0);
  const customers = effectiveEntries.reduce((total, item) => total + parseNumber(item.customers || 0), 0);
  const newCustomers = effectiveEntries.reduce((total, item) => total + parseNumber(item.newCustomers || 0), 0);
  const repeatCustomers = effectiveEntries.reduce((total, item) => total + parseNumber(item.repeatCustomers || 0), 0);
  const reviewCount = effectiveEntries.reduce((total, item) => total + parseNumber(item.reviewCount || 0), 0);

  const laborCost = closingItems.filter((item) => item.category === "人件費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const materialCost = closingItems.filter((item) => item.category === "材料費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const orderCost = closingItems.filter((item) => item.category === "発注費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const equipmentInvestmentCost = closingItems.filter((item) => item.category === "設備投資").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const fixedCost = fixedCosts.reduce((sum, item) => sum + parseNumber(item.amount), 0) + closingItems.filter((item) => item.category === "固定費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const regularVariableCost = variableCosts.filter((item) => item.type !== "temporary").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const temporaryCost = variableCosts.filter((item) => item.type === "temporary").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const variableCost = regularVariableCost + temporaryCost + closingItems.filter((item) => item.category === "販管費").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const otherCost = closingItems.filter((item) => item.category === "その他").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  // 経営指標の広告費率用。費用全体ではなく「広告費」カテゴリのみを集計する。旧「定額広告費」
  // (販管費が分かれていた頃のfixedCostCategories)で保存された既存データも壊さず引き続き
  // 広告費として集計できるよう、両方の名称を対象にする。fixedCosts/variableCosts/closingItems
  // すべてから拾うことで、統合前の既存データ(あれば)も取りこぼさない。
  const adCost = [...fixedCosts, ...variableCosts, ...closingItems]
    .filter((item) => item.category === "広告費" || item.category === "定額広告費")
    .reduce((sum, item) => sum + parseNumber(item.amount), 0);
  const expenseTotal = laborCost + materialCost + orderCost + fixedCost + variableCost + equipmentInvestmentCost + otherCost;
  const grossProfit = sales - materialCost - orderCost - laborCost;
  const operatingProfit = sales - expenseTotal;
  const adjustedOperatingProfit = sales - expenseTotal + equipmentInvestmentCost;
  const taxSummary = calculateTaxSummary({ sales, totalExpenses: expenseTotal, taxRate, roundingMode });

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
  const closedSales = closedEntries.reduce((total, item) => total + parseNumber(item.totalSales || item.technicalSales || 0), 0);
  const pace = completedDays > 0 ? closedSales / completedDays : 0;
  const forecast = completedDays > 0 && businessDaySummary.businessDayCount ? pace * businessDaySummary.businessDayCount : 0;
  const averageSales = effectiveEntries.length > 0 ? sales / effectiveEntries.length : 0;
  // 営業進捗カードの「1日平均売上」(実績)用: 総売上 ÷ 営業完了日数。averageSales(入力日数で
  // 割る既存値、pace/forecastが使う)とは別の新規フィールドで、既存のaverageSales/pace/forecast
  // の計算には一切手を入れない。
  const averageDailySales = completedDays > 0 ? sales / completedDays : 0;
  const remainingAverageSales = remainingBusinessDays ? remainingSalesTarget / remainingBusinessDays : 0;
  const todayActual = effectiveEntries.filter((entry) => entry.date === todayIso).reduce((sum, item) => sum + parseNumber(item.totalSales || item.technicalSales || 0), 0);
  const todayTarget = targetPerDay;
  const todayAchievement = todayTarget ? (todayActual / todayTarget) * 100 : 0;
  const averageSpend = customers ? sales / customers : 0;
  const laborRate = sales ? (laborCost / sales) * 100 : 0;
  const materialRate = sales ? (materialCost / sales) * 100 : 0;
  const fixedRate = sales ? (fixedCost / sales) * 100 : 0;
  const variableRate = sales ? (variableCost / sales) * 100 : 0;
  const adRate = sales ? (adCost / sales) * 100 : 0;
  const operatingMargin = sales ? (operatingProfit / sales) * 100 : 0;
  const adjustedOperatingMargin = sales ? (adjustedOperatingProfit / sales) * 100 : 0;
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
    materialCost,
    orderCost,
    equipmentInvestmentCost,
    fixedCost,
    variableCost,
    regularVariableCost,
    temporaryCost,
    otherCost,
    adCost,
    adRate,
    expenseTotal,
    grossProfit,
    operatingProfit,
    adjustedOperatingProfit,
    operatingMargin,
    adjustedOperatingMargin,
    laborRate,
    materialRate,
    fixedRate,
    variableRate,
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
    remainingAverageSales,
    customerTarget,
    customerAchievement,
    remainingCustomersTarget,
    remainingCustomersPerDay,
    forecastCustomers,
    taxSummary,
    target,
    entries,
    fixedCosts,
    variableCosts,
    closingItems,
    expenseCategories,
  };
};

// 「全店舗」(company_admin専用の仮想集計ビュー)専用の売上サマリー。calculateMonthSummaryを
// 単純に店舗ごとに呼んで合算するのではなく、各店舗の元データ(daily_sales由来のdailyResults)
// から日締め済みの日付だけを拾って直接合算し、達成率・客単価・1日平均売上・月末着地予測などの
// 比率/平均/予測は全店舗合計データから計算し直す(店舗ごとの計算結果を足し合わせない)。
// 費用・損益(人件費/材料費/粗利益など)はこの関数では扱わない — 全店舗ビューは売上ページの
// KPI/営業進捗のみが対象で、損益表・費用入力・月締めは店舗ごとの機能のまま(要件範囲外)。
export const calculateAllStoresMonthSummary = (state, company, monthValue) => {
  const companyId = company?.id || "";
  const stores = (company?.stores || []).filter((store) => store?.name);
  const storeNames = stores.map((store) => store.name);
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

  storeNames.forEach((storeName) => {
    const entries = getDailyResultsForStoreMonth(state, storeName, monthValue);
    // 日締め済みの日だけを合算対象にする(未締めのB店の当日実績はまだ全店舗に反映しない)。
    const closedDateSet = new Set(getBusinessDaySummary(state, storeName, monthValue).closedDates || []);
    entries.forEach((entry) => {
      if (!closedDateSet.has(String(entry?.date || ""))) return;
      sales += parseNumber(entry.totalSales || entry.technicalSales || 0);
      technicalSales += parseNumber(entry.technicalSales || 0);
      retailSales += parseNumber(entry.retailSales || 0);
      otherSales += parseNumber(entry.otherSales || 0);
      customers += parseNumber(entry.customers || 0);
      newCustomers += parseNumber(entry.newCustomers || 0);
      repeatCustomers += parseNumber(entry.repeatCustomers || 0);
      reviewCount += parseNumber(entry.reviewCount || 0);
    });
  });

  const closedSales = sales;
  const completedDays = businessDaySummary.completedDays;
  const remainingBusinessDays = businessDaySummary.remainingBusinessDays;
  const progressRate = businessDaySummary.progressRate;

  const targetSales = parseNumber(target.targetSales);
  const targetAchievement = targetSales ? (sales / targetSales) * 100 : 0;
  const remainingSalesTarget = Math.max(targetSales - sales, 0);
  const dailyNeededSales = remainingBusinessDays ? remainingSalesTarget / remainingBusinessDays : 0;
  const pace = completedDays > 0 ? closedSales / completedDays : 0;
  const forecast = completedDays > 0 && businessDaySummary.businessDayCount ? pace * businessDaySummary.businessDayCount : 0;
  // 1日平均売上 = 全店舗の確定済み総売上 ÷ 全店舗として営業完了した日数。
  const averageDailySales = completedDays > 0 ? sales / completedDays : 0;
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
