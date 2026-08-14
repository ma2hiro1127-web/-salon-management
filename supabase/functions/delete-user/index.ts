// Deletes a user completely and safely: Supabase Auth account + profiles row + user_stores
// assignments + any pending invite state. Runs with the service role key (never exposed to the
// browser) because deleting an auth.users row requires the admin API, and because verifying
// "is this the last admin" needs to see across the whole company, not just what RLS would let
// the caller see of themselves.
//
// Historical business data (daily_sales, monthly_closings, monthly_targets, fixed_costs,
// variable_costs, monthly_closing_items, store_business_holidays, company_all_stores_*,
// store_profiles, company_settings) is deliberately NOT touched here — see
// 20260809050000_profile_delete_preserves_history.sql, which switched every created_by/
// updated_by/closed_by foreign key referencing profiles(id) to ON DELETE SET NULL. Deleting the
// profiles row lets Postgres itself null out those references automatically; the business rows
// stay exactly as they were, just without an attributed user.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let targetProfileId = "";
  try {
    const body = await req.json();
    targetProfileId = String(body?.profileId || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!targetProfileId) {
    return json({ error: "profileId は必須です" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "サーバー設定が不足しています" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: callerAuth, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerAuth?.user) {
    return json({ error: "認証が必要です" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("id, role, company_id, is_active, auth_user_id")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active || !["system_admin", "company_admin", "store_manager"].includes(callerProfile.role)) {
      return json({ error: "ユーザーを削除する権限がありません" }, 403);
    }

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, auth_user_id, role, company_id, name")
      .eq("id", targetProfileId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) {
      return json({ error: "対象のユーザーが見つかりません" }, 404);
    }

    // Guard: never delete yourself from this screen — prevents an accidental self-lockout.
    if (target.id === callerProfile.id) {
      return json({ error: "自分自身のアカウントは削除できません" }, 400);
    }

    // Guard: system_admin can never be deleted through this screen, by anyone — including
    // another system_admin. Previously this was only blocked for company_admin/store_manager
    // callers (below); a system_admin caller had no such guard at all, relying solely on the
    // "last admin in the company" count check further down, which only fires once every other
    // admin is already gone. This is an unconditional, explicit protection per the "誤操作で
    // 削除できない" requirement.
    if (target.role === "system_admin") {
      return json({ error: "システム管理者は削除できません" }, 403);
    }

    // Permission scoping mirrors profiles_update/delete_company_scoped RLS: company_admin only
    // within their own company; store_manager only ever a staff member assigned to a store they
    // themselves manage.
    if (callerProfile.role === "company_admin") {
      if (callerProfile.company_id !== target.company_id) {
        return json({ error: "他社のユーザーは削除できません" }, 403);
      }
    }
    if (callerProfile.role === "store_manager") {
      if (target.role !== "staff") {
        return json({ error: "店長はスタッフ以外を削除できません" }, 403);
      }
      const [{ data: managerStores }, { data: targetStores }] = await Promise.all([
        admin.from("user_stores").select("store_id").eq("user_id", callerProfile.id),
        admin.from("user_stores").select("store_id").eq("user_id", target.id),
      ]);
      const managedStoreIds = new Set((managerStores || []).map((row) => row.store_id));
      const sharesStore = (targetStores || []).some((row) => managedStoreIds.has(row.store_id));
      if (!sharesStore) {
        return json({ error: "自分の管理する店舗のスタッフのみ削除できます" }, 403);
      }
    }

    // Guard: never leave a company with zero company_admin/system_admin left to manage it.
    if (target.role === "company_admin" || target.role === "system_admin") {
      const { count, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("company_id", target.company_id)
        .eq("is_active", true)
        .in("role", ["system_admin", "company_admin"])
        .neq("id", target.id);
      if (countError) throw countError;
      if (!count) {
        return json({ error: "この会社に管理者がいなくなるため削除できません。先に別の管理者を設定してください。" }, 409);
      }
    }

    if (target.auth_user_id) {
      const { error: deleteAuthError } = await admin.auth.admin.deleteUser(target.auth_user_id);
      // "User not found" here just means the auth account was already gone (e.g. a previous
      // partial delete attempt) — treat as success and continue cleaning up the rest.
      if (deleteAuthError && !/not.*found/i.test(String(deleteAuthError.message || ""))) {
        throw deleteAuthError;
      }
    }

    const { error: storesError } = await admin.from("user_stores").delete().eq("user_id", target.id);
    if (storesError) throw storesError;

    const { error: profileDeleteError } = await admin.from("profiles").delete().eq("id", target.id);
    if (profileDeleteError) throw profileDeleteError;

    return json({ ok: true, deletedName: target.name });
  } catch (error) {
    console.error("delete-user error", error);
    const message = error instanceof Error ? error.message : "ユーザーの削除に失敗しました";
    return json({ error: message }, 500);
  }
});
