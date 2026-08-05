import { supabase } from "./supabase.js";

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
  const creator = resolveProfileUserId(user) || resolveAuthUserId(user) || "user";
  return `${companyId}:${storeId}:${resolvedMonth}:${creator}`;
};

export const buildTenantSnapshotRow = ({ company, store, user, appState, targetMonth = null }) => {
  const resolvedMonth = targetMonth || appState?.selectedMonth || new Date().toISOString().slice(0, 7);
  const resolvedCompanyId = company?.id || appState?.currentCompanyId || "";
  const resolvedStoreId = store?.id || null;
  const resolvedUserId = resolveProfileUserId(user);
  const resolvedAuthUserId = resolveAuthUserId(user);
  const payload = {
    ...(appState || {}),
    selectedStore: store?.name || appState?.selectedStore || "",
    selectedMonth: resolvedMonth,
    currentCompanyId: resolvedCompanyId,
    currentUserId: resolvedUserId,
    currentAuthUserId: resolvedAuthUserId,
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

export const upsertTenantSnapshot = async ({ company, store, user, appState, targetMonth = null, force = false } = {}) => {
  if (!isRemoteSupabaseAvailable || !company || !store || !user) return { ok: true, skipped: true };
  try {
    const row = buildTenantSnapshotRow({ company, store, user, appState, targetMonth });
    const { data, error } = await supabase.from("tenant_snapshots").upsert(row, { onConflict: "id" }).select().single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    const status = error?.message || "";
    if (force) {
      return { ok: false, error };
    }
    if (status.includes("does not exist") || status.includes("relation") || status.includes("schema cache")) {
      return { ok: true, skipped: true, error };
    }
    return { ok: false, error };
  }
};

export const loadLatestTenantSnapshot = async ({ companyId, storeId = null, targetMonth, createdBy = null, allowOfflineFallback = false } = {}) => {
  if (!isRemoteSupabaseAvailable || !companyId || !targetMonth) return null;
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
    if (!snapshots.length) return null;
    const sorted = [...snapshots].sort((left, right) => new Date(right.updated_at || 0) - new Date(left.updated_at || 0));
    const exactStoreMatch = sorted.find((row) => !storeId || row.store_id === storeId);
    return exactStoreMatch || sorted[0] || null;
  } catch (error) {
    const status = error?.message || "";
    if (status.includes("does not exist") || status.includes("relation") || status.includes("schema cache")) {
      return null;
    }
    return null;
  }
};
