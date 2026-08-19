import { createClient } from "@supabase/supabase-js";
import { createInitialAppState, defaultDailyFieldSettings, defaultMonthlyTargetFieldSettings, costCategoryKeys } from "../data/defaults.js";
import { normalizeRole } from "./permissions.js";

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

const fetchWithAuthRetry = async (input, init = {}) => {
  const response = await fetch(input, init);
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
    return await fetch(input, { ...init, headers: retryHeaders });
  } catch {
    return response;
  }
};

export const supabase = createClient(supabaseUrl || "https://example.supabase.co", supabaseAnonKey || "dummy-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
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
export const getSupabaseErrorMessage = (error) => {
  const message = error?.message || "";
  if (isAuthTimingErrorMessage(message)) return AUTH_SESSION_EXPIRED_MESSAGE;
  return message || "Supabase エラーが発生しました";
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
export const upsertStoreInputSettings = async ({ companyId, storeId, dailyFields, monthlyTargetFields, useInventoryTracking, useCashBreakdown, hiddenClosingCategories }) => {
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
    // ai_analysis_enabledはここでは選択しない — AI分析設定はgetCompanyAiAnalysisSettings/
    // updateCompanyAiAnalysisSettingだけを経由する独立した状態として扱う(tenant_snapshot/
    // このログイン時ブートストラップ経由では取得・保持しない)。
    companyFilter
      ? supabase.from("companies").select("id, name, code, is_active, contract_status, free_reason, deleted_at, deleted_by, deletion_scheduled_at, created_at, updated_at").eq("id", companyFilter).order("created_at", { ascending: true })
      : supabase.from("companies").select("id, name, code, is_active, contract_status, free_reason, deleted_at, deleted_by, deletion_scheduled_at, created_at, updated_at").order("created_at", { ascending: true }),
    // Ordered by creation time, not name: a fresh session/device with no cached selection
    // below defaults to stores[0], and name-alphabetical ordering means a store rename (or
    // simply naming a newly added store earlier in the alphabet) can silently reshuffle which
    // store that lands on — including onto a brand-new, still-empty store. Creation order is
    // stable across renames and naturally favors whichever store has been in use longest.
    companyFilter
      ? supabase.from("stores").select("id, company_id, name, code, is_active, status, daily_field_settings").eq("company_id", companyFilter).order("created_at", { ascending: true })
      : supabase.from("stores").select("id, company_id, name, code, is_active, status, daily_field_settings").order("created_at", { ascending: true }),
    role === "system_admin"
      ? supabase.from("profiles").select("id, auth_user_id, company_id, name, email, role, is_active, invitation_status, invite_token, invite_expires_at").order("created_at", { ascending: true })
      : supabase.from("profiles").select("id, auth_user_id, company_id, name, email, role, is_active, invitation_status, invite_token, invite_expires_at").eq("company_id", profile.company_id).order("created_at", { ascending: true }),
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

// 加盟店連携(閲覧専用)で、対象の加盟店会社1社分のcompanies/stores基本情報だけを取得する
// 軽量版ローダー。loadTenantStateFromSupabaseと同じ正規化(company.stores[].settings等)を
// 使うが、store_input_settings等の上書きはApp.jsx側のhydrateFromSupabase(companyIdOverride
// 付き)が後続で行うため、ここでは基本情報だけ返せば十分。RLS側はcurrent_user_can_view_
// franchise_company()が承認済み(approved)の連携がある場合だけSELECTを許可する — 未承認の
// 会社を指定した場合は空(0行)で返る。
export const loadFranchiseCompanyMetadata = async ({ companyId }) => {
  if (!isSupabaseConfigured || !companyId) return { ok: false, error: new Error("companyId is required") };
  try {
    const [{ data: companyRow, error: companyError }, { data: storesData, error: storesError }] = await Promise.all([
      supabase.from("companies").select("id, name, code, is_active, contract_status, free_reason, deleted_at, created_at, updated_at").eq("id", companyId).maybeSingle(),
      supabase.from("stores").select("id, company_id, name, code, is_active, status, daily_field_settings").eq("company_id", companyId).order("created_at", { ascending: true }),
    ]);
    if (companyError) throw companyError;
    if (storesError) throw storesError;
    if (!companyRow) {
      return { ok: false, error: new Error("加盟店の会社情報を取得できませんでした（連携が承認されていない可能性があります）") };
    }

    const company = {
      id: companyRow.id,
      name: companyRow.name,
      code: companyRow.code,
      isActive: companyRow.is_active !== false,
      contractStatus: companyRow.contract_status || "trial",
      freeReason: companyRow.free_reason || "",
      deletedAt: companyRow.deleted_at || "",
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
export const updateCompanyContractStatus = async ({ companyId, targetStatus, freeReason }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("update-company-status", {
    body: { companyId, targetStatus, freeReason },
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
  return { ok: true, status: data?.status || "", freeReason: data?.freeReason };
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
  if (profileError) throw profileError;
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
    category: String(item?.category || ""),
    category_key: String(item?.categoryKey || "uncategorized"),
    memo: String(item?.memo || ""),
    period_type: item?.periodType === "limited" ? "limited" : "ongoing",
    start_month: String(item?.startMonth || ""),
    end_month: String(item?.endMonth || ""),
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

// cost_monthly_amounts — the per-month amount for a fixed_costs item, entered explicitly (no
// automatic carry-forward from a prior month, see storage.js's getCostMonthlyAmount). Windowed
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
