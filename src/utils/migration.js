import { supabase } from "./supabase.js";

export const backupExistingState = async () => {
  const snapshot = window.localStorage.getItem("salon-goal-app-v2");
  if (!snapshot) return null;
  const backup = {
    createdAt: new Date().toISOString(),
    snapshot,
  };
  window.localStorage.setItem("salon-backup-before-migration", JSON.stringify(backup));
  return backup;
};

export const migrateLegacyStateToSupabase = async (companyName = "Fi-Ne", companyCode = "fine") => {
  await backupExistingState();
  const existing = window.localStorage.getItem("salon-goal-app-v2");
  if (!existing) return { ok: true, skipped: true };

  const payload = JSON.parse(existing);
  const { data: companyData, error: companyError } = await supabase.from("companies").insert({ name: companyName, code: companyCode }).select().single();
  if (companyError) throw companyError;

  const companyId = companyData.id;
  const { data: storeData, error: storeError } = await supabase.from("stores").insert({ company_id: companyId, name: payload.stores?.[0] || "本店", code: `${companyCode}-main`, is_active: true }).select().single();
  if (storeError) throw storeError;

  const storeId = storeData.id;
  const { data: profileData, error: profileError } = await supabase.from("profiles").insert({
    auth_user_id: (await supabase.auth.getUser()).data.user?.id || "00000000-0000-0000-0000-000000000000",
    company_id: companyId,
    name: companyName,
    email: "admin@fine.example",
    role: "company_admin",
    is_active: true,
  }).select().single();
  if (profileError) throw profileError;

  await supabase.from("user_stores").insert({ user_id: profileData.id, company_id: companyId, store_id: storeId, is_primary: true });
  return { ok: true, companyId, storeId };
};
