import { createClient } from "@supabase/supabase-js";
import { createInitialAppState, defaultDailyFieldSettings, defaultMonthlyTargetFieldSettings } from "../data/defaults.js";
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

export const normalizeMonthlyTargetFieldSettings = (value) => {
  const fallback = defaultMonthlyTargetFieldSettings();
  if (!value || typeof value !== "object") return fallback;
  return {
    fields: { ...fallback.fields, ...(value.fields && typeof value.fields === "object" ? value.fields : {}) },
  };
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
export const upsertStoreInputSettings = async ({ companyId, storeId, dailyFields, monthlyTargetFields }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ companyId, storeId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertStoreInputSettings", table: "store_input_settings", companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  const payload = { company_id: companyId, store_id: storeId };
  if (dailyFields !== undefined) payload.daily_fields = dailyFields;
  if (monthlyTargetFields !== undefined) payload.monthly_target_fields = monthlyTargetFields;
  try {
    const { data, error } = await supabase.from("store_input_settings").upsert(payload, { onConflict: "company_id,store_id" }).select().single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertStoreInputSettings", table: "store_input_settings", companyId, storeId, error });
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
    // Ordered by creation time, not name: a fresh session/device with no cached selection
    // below defaults to stores[0], and name-alphabetical ordering means a store rename (or
    // simply naming a newly added store earlier in the alphabet) can silently reshuffle which
    // store that lands on — including onto a brand-new, still-empty store. Creation order is
    // stable across renames and naturally favors whichever store has been in use longest.
    companyFilter
      ? supabase.from("stores").select("id, company_id, name, code, is_active, daily_field_settings").eq("company_id", companyFilter).order("created_at", { ascending: true })
      : supabase.from("stores").select("id, company_id, name, code, is_active, daily_field_settings").order("created_at", { ascending: true }),
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

// The Users management page's 権限変更/所属店舗変更 buttons used to only update appState.users
// (local state + the legacy tenant_snapshots blob) — never the profiles/user_stores rows that
// RLS and every other read path actually check. That made a role "change" pure UI theater: the
// promoted user's next login would still see their old role, since ensureProfileForAuthUser
// reads straight from profiles.role.
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
    const { data, error } = await supabase
      .from("fixed_costs")
      .select("*")
      .eq("company_id", companyId);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadFixedCostsForCompany", table: "fixed_costs", companyId, error });
    return { ok: false, error, data: [] };
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
    amount: Number(item?.amount || 0),
    category: String(item?.category || ""),
    memo: String(item?.memo || ""),
    start_month: String(item?.startMonth || ""),
    end_month: String(item?.endMonth || ""),
    apply_mode: String(item?.applyMode || "this-month"),
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

export const upsertVariableCostToSupabase = async ({ id, companyId, storeId, targetMonth, userId, item }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ id, companyId, storeId, targetMonth, userId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertVariableCostToSupabase", table: "variable_costs", userId, companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  const payload = {
    id,
    company_id: companyId,
    store_id: storeId,
    target_month: targetMonth,
    name: String(item?.name || ""),
    amount: Number(item?.amount || 0),
    category: String(item?.category || ""),
    memo: String(item?.memo || ""),
    incurred_date: String(item?.incurredDate || ""),
    type: String(item?.type || "regular"),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await supabase.from("variable_costs").upsert(payload, { onConflict: "id" }).select().single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertVariableCostToSupabase", table: "variable_costs", userId, companyId, storeId, error });
    return { ok: false, error };
  }
};

export const deleteVariableCostFromSupabase = async ({ id }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  if (!id) return { ok: true, skipped: true };
  try {
    const { error } = await supabase.from("variable_costs").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    logSupabaseError({ operation: "deleteVariableCostFromSupabase", table: "variable_costs", id, error });
    return { ok: false, error };
  }
};

// monthly_closing_items (月締め項目) — same shape of fix as variable_costs above.
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

export const upsertMonthlyClosingItemToSupabase = async ({ id, companyId, storeId, targetMonth, userId, item }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const validationError = validateRequiredKeys({ id, companyId, storeId, targetMonth, userId });
  if (validationError) {
    const detail = logSupabaseError({ operation: "upsertMonthlyClosingItemToSupabase", table: "monthly_closing_items", userId, companyId, storeId, error: new Error(validationError) });
    return { ok: false, error: new Error(detail.message) };
  }
  const payload = {
    id,
    company_id: companyId,
    store_id: storeId,
    target_month: targetMonth,
    name: String(item?.name || ""),
    amount: Number(item?.amount || 0),
    category: String(item?.category || ""),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await supabase.from("monthly_closing_items").upsert(payload, { onConflict: "id" }).select().single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertMonthlyClosingItemToSupabase", table: "monthly_closing_items", userId, companyId, storeId, error });
    return { ok: false, error };
  }
};

export const deleteMonthlyClosingItemFromSupabase = async ({ id }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  if (!id) return { ok: true, skipped: true };
  try {
    const { error } = await supabase.from("monthly_closing_items").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    logSupabaseError({ operation: "deleteMonthlyClosingItemFromSupabase", table: "monthly_closing_items", id, error });
    return { ok: false, error };
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
