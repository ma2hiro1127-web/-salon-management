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
// The row's own `amount` is legacy (pre-per-month-amount) data and is intentionally not carried
// into the item — the effective amount for a given month now always comes from
// costMonthlyAmounts (see getCostMonthlyAmount), never from this master row.
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
      status: row.status || "active",
      staffCount: Number(row.staff_count) || 0,
      productivityStaffCount: Number(row.productivity_staff_count) || 0,
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
  costMonthlyAmounts: mergeShallowMap(localState.costMonthlyAmounts, remoteState.costMonthlyAmounts),
  storeInventoryBalances: mergeShallowMap(localState.storeInventoryBalances, remoteState.storeInventoryBalances),
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
    // "ongoing" (or any legacy row without a recognized periodType) always carries forward from
    // startMonth, regardless of whatever endMonth may still be sitting on the row.
    return monthValue >= startMonth;
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

// ongoing | limited — purely for display; the filtering logic above reads item.periodType
// directly, this is just a stable accessor with the same legacy fallback buildFixedCostsStateFromRows
// uses (no periodType recorded + no end_month = 継続として扱う).
export const getCostPatternLabel = (item) => item?.periodType || (item?.endMonth ? "limited" : "ongoing");

// 対象月ごとの金額(cost_monthly_amounts)。その月にまだ入力/コピー保存されていない費用は
// undefined(=未入力)を返す — 0円ではなく「未確定」であることを呼び出し側が区別できるように
// する。損益集計ではこれを0として扱う(getCostMonthlyAmount(...) ?? 0)。
export const getCostMonthlyAmount = (state, costItemId, monthValue) => {
  if (!costItemId) return undefined;
  return state.costMonthlyAmounts?.[`${costItemId}__${monthValue}`]?.amount;
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

  const sales = effectiveEntries.reduce((total, item) => total + parseNumber(item.totalSales || item.technicalSales || 0), 0);
  const technicalSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.technicalSales || 0), 0);
  const retailSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.retailSales || 0), 0);
  const otherSales = effectiveEntries.reduce((total, item) => total + parseNumber(item.otherSales || 0), 0);
  const customers = effectiveEntries.reduce((total, item) => total + parseNumber(item.customers || 0), 0);
  const newCustomers = effectiveEntries.reduce((total, item) => total + parseNumber(item.newCustomers || 0), 0);
  const repeatCustomers = effectiveEntries.reduce((total, item) => total + parseNumber(item.repeatCustomers || 0), 0);
  const reviewCount = effectiveEntries.reduce((total, item) => total + parseNumber(item.reviewCount || 0), 0);

  // 費用入力(fixedCosts)・過去の月締め項目(closingItems)・過去の変動費(variableCosts)を
  // 1つに結合し、category_key基準で集計する。カテゴリは費用名の文字列ではなく、費用登録時に
  // ユーザーが選んだ固定key(rent/labor/advertising/...)そのものを見る — 費用名がどんな
  // 略称・表記でも正しく分類できる(AIが費用名から推測する必要も無くす)。
  // 旧カテゴリ「設備投資」の行は昔から経費合計に含めない設計(equipmentInvestmentCostとして
  // 別枠集計のみ)だったため、新しい集計からも除外して過去月の合計値を変えないようにする。
  const categorizableItems = [...fixedCosts, ...variableCosts, ...closingItems].filter((item) => item.category !== "設備投資");
  const { totals: costsByCategory, hasEntry: categoryHasEntry } = sumByCategoryKey(categorizableItems);

  const laborCost = costsByCategory.labor;
  // 材料・発注費(ディーラー請求書等の月間合計、業務材料+店販商品仕入+送料等をまとめて1件で
  // 入力してもよいし、月中に複数回に分けて入力してその月の合計として扱ってもよい)。
  const purchaseAmount = costsByCategory.materials;
  // 設備投資は新カテゴリに対応枠を持たない(要件3: 必要以上に細かい分類を避ける) — 過去の
  // 月締め項目(closingItems)に残っている旧カテゴリ「設備投資」の行だけ、後方互換のため
  // 引き続き集計する(新規入力では発生しない)。
  const equipmentInvestmentCost = closingItems.filter((item) => item.category === "設備投資").reduce((sum, item) => sum + parseNumber(item.amount), 0);
  // 「固定費」(内部合計、損益表では経費合計に統合表示): 家賃・光熱費・通信費・清掃環境費・
  // システム利用料・税金保険の6カテゴリ。labor/materials/advertisingは別枠で扱うためここには
  // 含めない。
  const fixedCost = costsByCategory.rent + costsByCategory.utilities + costsByCategory.communication
    + costsByCategory.cleaning + costsByCategory.system + costsByCategory.tax_insurance;
  // 「その他費用」カテゴリそのもの(AIコンテキスト等、個別に参照する箇所があるため独立して残す)。
  const otherCost = costsByCategory.other;
  // 「変動費」(内部合計): その他費用 + 未分類(移行時に自動判定できなかった費用、要注意)。
  const variableCost = otherCost + costsByCategory[UNCATEGORIZED_KEY];
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
  // 消費税引当額(概算): 「消費税を考慮する」がOFFでも計算はしておく(引当率が0なら0円になる
  // だけ)。表示するかどうかはUI側でstate.taxSettings.considerConsumptionTaxにより出し分ける。
  // 正式な納税額の自動計算ではなく、資金確保用の概算引当(要件17-18)。
  const consumptionTaxReserveRate = Number(state.taxSettings?.consumptionTaxReserveRate ?? 0);
  const consumptionTaxReserveAmount = sales * (consumptionTaxReserveRate / 100);
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
  const hasFixedCostData = ["rent", "utilities", "communication", "cleaning", "system", "tax_insurance"]
    .some((key) => categoryHasEntry[key]);
  const hasExpenseCostData = hasFixedCostData || categoryHasEntry.advertising || categoryHasEntry.other || categoryHasEntry[UNCATEGORIZED_KEY];

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

// 月締めチェックリスト: 損益表作成に必要な項目(売上+費用10カテゴリ)ごとの入力済み/未入力を
// 返す。判定は費用名の文字列ではなく、calculateMonthSummaryが算出したcategoryHasEntry
// (=実際に登録されているデータ)を基準にする。
export const getMonthClosingChecklist = (state, storeId, monthValue, options = {}) => {
  const summary = calculateMonthSummary(state, storeId, monthValue, options);
  const items = [
    { key: "sales", label: "売上", entered: summary.entries.length > 0, categoryKey: null },
    ...costCategoryKeys.map(({ key, label }) => ({ key, label, entered: Boolean(summary.categoryHasEntry[key]), categoryKey: key })),
  ];
  return {
    items,
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
    ...fixedCosts.map((item) => item.updatedAt || ""),
    ...fixedCosts.map((item) => state.costMonthlyAmounts?.[`${item.id}__${monthValue}`]?.updatedAt || ""),
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
  const stores = (company?.stores || []).filter((store) => store?.id);
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

  stores.forEach((store) => {
    const entries = getDailyResultsForStoreMonth(state, store.id, monthValue);
    const closedDateSet = new Set(getBusinessDaySummary(state, store.id, monthValue).closedDates || []);
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
    return { hasStaffCount: false, current: 0, monthEndForecast: 0 };
  }
  return {
    hasStaffCount: true,
    current: parseNumber(sales) / effectiveCount,
    monthEndForecast: parseNumber(forecast) / effectiveCount,
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
export const getStoreDashboardRows = (state, company, monthValue) => {
  const stores = Array.isArray(company?.stores) ? company.stores : [];
  const previousMonthValue = getMonthOffset(monthValue, -1);

  return stores.map((store) => {
    const useInventoryTracking = Boolean(store.settings?.useInventoryTracking);
    const summary = calculateMonthSummary(state, store.id, monthValue, { useInventoryTracking });
    const previousSummary = calculateMonthSummary(state, store.id, previousMonthValue, { useInventoryTracking });
    const productivity = getStaffProductivitySummary({
      sales: summary.sales, forecast: summary.forecast,
      staffCount: store.staffCount, productivityStaffCount: store.productivityStaffCount,
    });
    const previousProductivity = getStaffProductivitySummary({
      sales: previousSummary.sales, forecast: previousSummary.forecast,
      staffCount: store.staffCount, productivityStaffCount: store.productivityStaffCount,
    });
    const effectiveStaffCount = parseNumber(store.productivityStaffCount) > 0
      ? parseNumber(store.productivityStaffCount) : parseNumber(store.staffCount);
    const isClosed = Boolean(state.monthClosingStatus?.[buildMonthKey(store.id, monthValue)]?.closed);
    const hasPrevious = previousSummary.entries.length > 0;

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
      laborCost: summary.laborCost,
      laborRate: summary.laborRate,
      hasLaborData: Boolean(summary.categoryHasEntry?.labor),
      purchaseCost: summary.costOfGoodsSold,
      purchaseCostRate: summary.costOfGoodsSoldRate,
      hasPurchaseData: Boolean(summary.categoryHasEntry?.materials),
      fixedCost: summary.fixedCost,
      fixedCostRate: summary.sales > 0 ? (summary.fixedCost / summary.sales) * 100 : 0,
      hasFixedCostData: summary.hasFixedCostData,
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
  const totalLaborCost = sum((row) => row.laborCost);
  const totalPurchaseCost = sum((row) => row.purchaseCost);
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
  const isProvisionalProfit = storeRows.some((row) => row.isProvisionalProfit);

  const previousTotalSales = sum((row) => row.previous.sales);
  const previousTotalOperatingProfit = sum((row) => row.previous.operatingProfit);
  const previousTotalLaborCost = sum((row) => row.previous.laborCost);
  const previousTotalPurchaseCost = sum((row) => row.previous.purchaseCost);
  const previousHasStaffCount = storeRows.some((row) => row.previous.productivity.hasStaffCount);
  const previousTotalEffectiveStaffCount = storeRows.reduce(
    (total, row) => total + (row.previous.productivity.hasStaffCount ? parseNumber(row.effectiveStaffCount) : 0), 0
  );
  const hasPrevious = storeRows.some((row) => row.previous.hasPrevious);
  const previousHasLaborData = storeRows.some((row) => row.previous.hasLaborData);
  const previousHasPurchaseData = storeRows.some((row) => row.previous.hasPurchaseData);
  const previousIsProvisionalProfit = storeRows.some((row) => row.previous.isProvisionalProfit);

  return {
    monthValue,
    isFullyClosed: storeRows.length > 0 && storeRows.every((row) => row.isClosed),
    totalSales,
    totalOperatingProfit,
    operatingMargin: totalSales > 0 ? (totalOperatingProfit / totalSales) * 100 : 0,
    isProvisionalProfit,
    totalLaborCost,
    laborRate: totalSales > 0 ? (totalLaborCost / totalSales) * 100 : 0,
    hasLaborData,
    totalPurchaseCost,
    purchaseCostRate: totalSales > 0 ? (totalPurchaseCost / totalSales) * 100 : 0,
    hasPurchaseData,
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
