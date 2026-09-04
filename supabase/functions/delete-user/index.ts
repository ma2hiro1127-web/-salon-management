// Removes a user's ability to sign in and their store/company affiliation, without destroying
// their history. Runs with the service role key (never exposed to the browser) because deleting
// an auth.users row requires the admin API, and because verifying "is this the last admin" needs
// to see across the whole company, not just what RLS would let the caller see of themselves.
//
// Two different deletion shapes depending on whether the target ever actually registered
// (2026-09-04, changed from a full profiles row DELETE to a soft delete — see
// 20260909000000_profiles_soft_delete.sql):
//
// - Still-pending invite (target.auth_user_id is null): nothing they could have created any
//   business data with yet, so this stays a hard delete of the profiles row (and any orphaned
//   unconfirmed auth.users shell — see the comment further down) exactly as before.
// - Already registered (target.auth_user_id is set): the profiles row is preserved and marked
//   deleted_at instead of being removed. Historical business data (daily_sales,
//   monthly_closings, monthly_targets, fixed_costs, variable_costs, monthly_closing_items,
//   store_business_holidays, company_all_stores_*, store_profiles, company_settings) keeps
//   pointing at this same profiles.id — created_by/updated_by/closed_by stay resolvable to a
//   name instead of going null, unlike the old ON DELETE SET NULL behavior
//   (20260809050000_profile_delete_preserves_history.sql). The Supabase Auth account itself is
//   still deleted here (not banned) — this profiles.email is a completely ordinary email again
//   afterward: profiles_email_active_key (the migration above) only enforces uniqueness among
//   deleted_at IS NULL rows, and every profiles query that lists/looks up active staff or checks
//   for a duplicate invite (checkExistingProfilesByEmail, ensureProfileForAuthUser,
//   loadTenantStateFromSupabase — see src/utils/supabase.js) filters deleted_at IS NULL, so a
//   soft-deleted row is invisible to all of them. A brand-new invite to the same email, from any
//   company, creates a completely fresh profiles row and a completely fresh auth.users account
//   (accept-invite's admin.auth.admin.createUser call succeeds cleanly since the old auth
//   account is gone) — there is no stale ban or leftover invite state to fight through.
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
      .select("id, auth_user_id, role, company_id, name, email")
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

    // Guard: an actually-registered system_admin (auth_user_id set — they've completed signup
    // and could really sign in) can never be deleted through this screen, by anyone — including
    // another system_admin. This is an unconditional, explicit protection per the "誤操作で
    // 削除できない" requirement.
    //
    // 2026-09-04: narrowed to auth_user_id != null. Previously this blocked *any* row labeled
    // system_admin, including one that never got past a pending invite — e.g. an email that
    // resolveRoleForEmail auto-promotes to system_admin (src/utils/supabase.js) gets that role
    // stamped onto its profiles row the moment it's invited, before the person has ever signed
    // in. Such a row holds zero real privilege (no auth account exists yet) and zero business
    // data, but the old blanket guard made it permanently undeletable — exactly the stuck state
    // reported for a suspended, never-accepted invite. A still-pending row instead falls through
    // to the ordinary hard-delete path below (it has no history to preserve).
    if (target.role === "system_admin" && target.auth_user_id) {
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
    } else {
      // 誤った会社・店舗へ招待した後、承認前(profiles.auth_user_idがまだnull)に削除する
      // ケースへの対応。send-invite-email(招待メールの実送信)はSupabase Auth標準の
      // admin.inviteUserByEmailを使っており、これは呼んだ時点でauth.usersに未確認
      // (confirmed_at null)の行を作る——だがそのauth_user_idがprofiles側へ書き込まれるのは
      // 本人がaccept-invite経由で登録を完了した時だけ(このファイル冒頭のコメント・
      // handleSaveUserのコメント参照)。そのため「招待メールは送ったが本人はまだ登録して
      // いない」段階でこのprofilesを削除すると、target.auth_user_idがnullのままここへ来て
      // しまい、実際には存在するauth.usersの残骸(orphan shell)が削除されずに残ってしまう。
      // profiles.emailにはUNIQUE制約があるため、この残骸は実害が無い(次にprofilesへ挿入
      // する時点でemailの一意性チェックにも引っかからない)が、Supabase Auth側に未確認の
      // ユーザーが残り続け、その後「同じメールアドレスへ別会社から再招待」した際に
      // send-invite-email側の同種のクリーンアップ処理に依存しきりになってしまう
      // (今回kkfine.a@gmail.comで実際に確認された状態)。ここでも同じ理由・同じ方法で
      // 先んじて片付けておく——メール文字列の部分一致ではなく、完全一致するものだけを対象に
      // する。
      const lookupResp = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(target.email || "")}`, {
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
      }).catch(() => null);
      if (lookupResp?.ok) {
        const lookupJson = await lookupResp.json().catch(() => null);
        const candidates = Array.isArray(lookupJson?.users) ? lookupJson.users : (Array.isArray(lookupJson) ? lookupJson : []);
        const orphanAuthUser = candidates.find((item) => String(item?.email || "").toLowerCase() === String(target.email || "").toLowerCase());
        if (orphanAuthUser?.id) {
          await admin.auth.admin.deleteUser(orphanAuthUser.id).catch(() => {});
        }
      }
    }

    const { error: storesError } = await admin.from("user_stores").delete().eq("user_id", target.id);
    if (storesError) throw storesError;

    // 招待中(一度もログインしていない)なら業務データを一切生んでいないため、そのまま
    // 物理削除する(従来通り)。登録済み(実際にauth.usersと紐付いた)なら論理削除に切り替え、
    // profiles行そのものは残す(コメント冒頭を参照)。
    if (target.auth_user_id) {
      const { error: softDeleteError } = await admin
        .from("profiles")
        .update({
          deleted_at: new Date().toISOString(),
          auth_user_id: null,
          is_active: false,
          invitation_status: "disabled",
          invite_token: null,
          invite_expires_at: null,
        })
        .eq("id", target.id);
      if (softDeleteError) throw softDeleteError;
    } else {
      const { error: profileDeleteError } = await admin.from("profiles").delete().eq("id", target.id);
      if (profileDeleteError) throw profileDeleteError;
    }

    return json({ ok: true, deletedName: target.name });
  } catch (error) {
    console.error("delete-user error", error);
    const message = error instanceof Error ? error.message : "ユーザーの削除に失敗しました";
    return json({ error: message }, 500);
  }
});
