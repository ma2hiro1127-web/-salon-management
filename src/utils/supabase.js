import { createClient } from "@supabase/supabase-js";
import { createInitialAppState, defaultDailyFieldSettings } from "../data/defaults.js";
import { normalizeRole } from "./permissions.js";

const getEnvValue = (key) => {
  const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
  return env[key] || "";
};

const supabaseUrl = getEnvValue("VITE_SUPABASE_URL");
const supabaseAnonKey = getEnvValue("VITE_SUPABASE_ANON_KEY");

export const supabase = createClient(supabaseUrl || "https://example.supabase.co", supabaseAnonKey || "dummy-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
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

export const getSupabaseErrorMessage = (error) => error?.message || "Supabase エラーが発生しました";

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

  const { data: existingCompanies, error: companyLookupError } = await supabase.from("companies").select("id").limit(1);
  if (companyLookupError) throw companyLookupError;

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

  return { companyId: resolvedCompanyId, storeId: resolvedStoreId };
};

export const initializeFirstTenantForUser = async ({ authUserId, email, role = null }) => {
  if (!authUserId || !email) return null;

  const normalizedEmail = normalizeEmail(email);
  const resolvedRole = normalizeRole(role || resolveDefaultRole(normalizedEmail));
  const tenant = await ensureInitialCompanyAndStore({ preferredCompanyName: "サロン本社", preferredStoreName: "本店" });

  const profile = await createUserProfileRecord({
    name: normalizedEmail.split("@")[0],
    email: normalizedEmail,
    role: resolvedRole,
    companyId: tenant.companyId,
    storeIds: tenant.storeId ? [tenant.storeId] : [],
    primaryStoreId: tenant.storeId || "",
    authUserId,
  });

  return { profile, companyId: tenant.companyId, storeId: tenant.storeId };
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

export const signOutFromSupabase = async () => {
  const { error } = await supabase.auth.signOut();
  return { error };
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
    const { data, error } = await supabase.from("profiles").select(profileSelect).eq("auth_user_id", authUserId).maybeSingle();
    if (error) throw error;
    existingProfile = data;
  }

  if (!existingProfile) {
    const { data, error } = await supabase.from("profiles").select(profileSelect).eq("email", normalizedEmail).maybeSingle();
    if (error) throw error;
    existingProfile = data;
  }

  if (existingProfile) {
    const resolvedRole = normalizeRole(role || resolveDefaultRole(normalizedEmail));
    const updates = {};
    if (!existingProfile.auth_user_id) updates.auth_user_id = authUserId;
    if (!existingProfile.company_id) {
      const tenant = await ensureInitialCompanyAndStore({ companyId, preferredCompanyName: "サロン本社", preferredStoreName: "本店" });
      updates.company_id = tenant.companyId;
    }
    if (!existingProfile.name) updates.name = normalizedEmail.split("@")[0];
    if (!existingProfile.role || normalizeRole(existingProfile.role) !== resolvedRole) updates.role = resolvedRole;
    if (Object.keys(updates).length) {
      const { data, error } = await supabase.from("profiles").update(updates).eq("id", existingProfile.id).select().single();
      if (error) throw error;
      return data;
    }
    return existingProfile;
  }

  const tenant = await ensureInitialCompanyAndStore({ companyId, preferredCompanyName: "サロン本社", preferredStoreName: "本店" });
  const profile = await createUserProfileRecord({
    name: normalizedEmail.split("@")[0],
    email: normalizedEmail,
    role: normalizeRole(role || resolveDefaultRole(normalizedEmail)),
    companyId: tenant.companyId,
    storeIds: tenant.storeId ? [tenant.storeId] : [],
    primaryStoreId: tenant.storeId || "",
    authUserId,
  });

  return profile;
};

export const loadTenantStateFromSupabase = async ({ authUserId, email, currentProfile = null }) => {
  const profile = currentProfile || (await ensureProfileForAuthUser({ authUserId, email }));
  if (!profile) {
    return createInitialAppState();
  }

  const role = normalizeRole(profile.role || "staff");
  const companyFilter = role === "system_admin" ? null : profile.company_id;

  const [{ data: companiesData, error: companiesError }, { data: storesData, error: storesError }, { data: profilesData, error: profilesError }, { data: userStoresData, error: userStoresError }] = await Promise.all([
    companyFilter
      ? supabase.from("companies").select("id, name, code, is_active, created_at, updated_at").eq("id", companyFilter).order("created_at", { ascending: true })
      : supabase.from("companies").select("id, name, code, is_active, created_at, updated_at").order("created_at", { ascending: true }),
    companyFilter
      ? supabase.from("stores").select("id, company_id, name, code, is_active, daily_field_settings").eq("company_id", companyFilter).order("name", { ascending: true })
      : supabase.from("stores").select("id, company_id, name, code, is_active, daily_field_settings").order("name", { ascending: true }),
    role === "system_admin"
      ? supabase.from("profiles").select("id, auth_user_id, company_id, name, email, role, is_active, invitation_status").order("created_at", { ascending: true })
      : supabase.from("profiles").select("id, auth_user_id, company_id, name, email, role, is_active, invitation_status").eq("company_id", profile.company_id).order("created_at", { ascending: true }),
    supabase.from("user_stores").select("user_id, company_id, store_id, is_primary").order("created_at", { ascending: true }),
  ]);

  if (companiesError) throw companiesError;
  if (storesError) throw storesError;
  if (profilesError) throw profilesError;
  if (userStoresError) throw userStoresError;

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
    contractStatus: "active",
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
      settings: { ...createDefaultStoreSettings(), dailyFieldSettings: normalizeDailyFieldSettings(store.daily_field_settings) },
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
  };
};

export const createCompanyRecord = async ({ name, code, createdByProfileId }) => {
  const { data, error } = await supabase
    .from("companies")
    .insert({
      name,
      code,
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;

  if (createdByProfileId) {
    const { error: profileError } = await supabase.from("profiles").update({ company_id: data.id, role: "company_admin" }).eq("id", createdByProfileId);
    if (profileError) throw profileError;
  }

  return data;
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

export const createUserProfileRecord = async ({ name, email, role, companyId, storeIds = [], primaryStoreId = "", authUserId = null }) => {
  const normalizedEmail = normalizeEmail(email);
  const resolvedRole = normalizeRole(role || resolveDefaultRole(normalizedEmail));
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .insert({
      auth_user_id: authUserId,
      company_id: companyId,
      name,
      email: normalizedEmail,
      role: resolvedRole,
      is_active: true,
      invitation_status: "active",
    })
    .select()
    .single();

  if (profileError) throw profileError;

  if (storeIds.length || primaryStoreId) {
    const storeList = (storeIds.length ? storeIds : [primaryStoreId]).filter(Boolean);
    const assignments = storeList.map((storeId, index) => ({
      user_id: profile.id,
      company_id: companyId,
      store_id: storeId,
      is_primary: primaryStoreId ? storeId === primaryStoreId : index === 0,
    }));
    const { error: userStoreError } = await supabase.from("user_stores").insert(assignments);
    if (userStoreError) throw userStoreError;
  }

  return profile;
};

export const getProfileByEmail = async (email) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const { data, error } = await supabase.from("profiles").select("id, auth_user_id, company_id, name, email, role, is_active, invitation_status").eq("email", normalizedEmail).maybeSingle();
  if (error) throw error;
  return data || null;
};

export const getProfilesForDebug = async () => {
  const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return data || [];
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

export const updateDailySalesClosingState = async ({ companyId, storeId, businessDate, userId, isClosed }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId, businessDate });
  if (validationError) {
    const detail = logSupabaseError({ operation: "updateDailySalesClosingState", table: "daily_sales", userId, companyId, storeId, businessDate, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }

  try {
    const { data, error } = await supabase
      .from("daily_sales")
      .update({
        is_day_closed: Boolean(isClosed),
        closed_at: isClosed ? new Date().toISOString() : null,
        closed_by: isClosed ? (userId || null) : null,
      })
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

export const loadMonthlyClosingState = async ({ companyId, storeId, yearMonth }) => {
  if (!isSupabaseConfigured || !companyId || !storeId || !yearMonth) return { ok: true, skipped: true, data: null };
  try {
    const { data, error } = await supabase
      .from("monthly_closings")
      .select("*")
      .eq("company_id", companyId)
      .eq("store_id", storeId)
      .eq("year_month", yearMonth)
      .maybeSingle();
    if (error) throw error;
    return { ok: true, data: data || null };
  } catch (error) {
    logSupabaseError({ operation: "loadMonthlyClosingState", table: "monthly_closings", companyId, storeId, targetMonth: yearMonth, error });
    return { ok: false, error, data: null };
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
