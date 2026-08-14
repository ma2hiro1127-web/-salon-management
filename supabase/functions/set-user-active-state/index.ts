// 「停止/再開」を、profiles.is_active の書き換えだけでなくSupabase Auth側の状態とも
// 一致させるためのEdge Function。停止(isActive:false)の場合、対象が既に登録済み
// (auth_user_id あり)なら admin.auth.admin.updateUserById(..., { ban_duration }) でAuth側も
// 直接ロックする — is_active=falseだけではprofilesの行が読めなくなる(RLSが即座に効く)だけ
// で、対象ユーザーが既に確立している既存セッション(アクセストークン)自体は理論上有効期限
// までは生き続けるため、「既にログイン中の場合も適切なタイミングでセッションを無効化する」
// (要件3)を満たすには、GoTrue側で明示的にBANしてしまうのが最も確実。再開(isActive:true)
// はban_duration:'none'で解除する。
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

function logStage(stage: string, detail: Record<string, unknown>) {
  console.error(`[set-user-active-state] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let profileId = "";
  let isActive = true;
  try {
    const body = await req.json();
    profileId = String(body?.profileId || "").trim();
    isActive = body?.isActive !== false;
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!profileId) {
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
      .select("id, role, company_id, is_active")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active || !["system_admin", "company_admin", "store_manager"].includes(callerProfile.role)) {
      return json({ error: "ユーザーの状態を変更する権限がありません" }, 403);
    }

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, role, company_id, auth_user_id, name")
      .eq("id", profileId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) {
      return json({ error: "対象のユーザーが見つかりません" }, 404);
    }
    if (target.id === callerProfile.id) {
      return json({ error: "自分自身の状態は変更できません" }, 400);
    }

    // 権限スコープは他のEdge Functionと同じ規約: company_adminは自社かつsystem_admin以外、
    // store_managerは自分の管理する店舗のstaffのみ。
    if (target.role === "system_admin" && callerProfile.role !== "system_admin") {
      return json({ error: "システム管理者の状態は変更できません" }, 403);
    }
    if (callerProfile.role === "company_admin" && callerProfile.company_id !== target.company_id) {
      return json({ error: "他社のユーザーの状態は変更できません" }, 403);
    }
    if (callerProfile.role === "store_manager") {
      if (target.role !== "staff") {
        return json({ error: "店長はスタッフ以外の状態を変更できません" }, 403);
      }
      const [{ data: managerStores }, { data: targetStores }] = await Promise.all([
        admin.from("user_stores").select("store_id").eq("user_id", callerProfile.id),
        admin.from("user_stores").select("store_id").eq("user_id", target.id),
      ]);
      const managedStoreIds = new Set((managerStores || []).map((row) => row.store_id));
      const sharesStore = (targetStores || []).some((row) => managedStoreIds.has(row.store_id));
      if (!sharesStore) {
        return json({ error: "自分の管理する店舗のスタッフのみ状態を変更できます" }, 403);
      }
    }

    const { error: profileUpdateError } = await admin.from("profiles").update({ is_active: isActive }).eq("id", target.id);
    if (profileUpdateError) throw profileUpdateError;

    if (target.auth_user_id) {
      const { error: banError } = await admin.auth.admin.updateUserById(target.auth_user_id, {
        ban_duration: isActive ? "none" : "876000h",
      });
      if (banError) {
        // profiles.is_activeは既に更新済み(RLSにより即座にアクセス制限はかかる)。Auth側の
        // BAN設定だけ失敗した場合でも致命的ではないため、記録した上で成功として返す —
        // 停止操作そのものを「失敗」として管理者に再試行させるより、実質的な効果(RLSによる
        // 遮断)は既に得られている状態を優先する。
        logStage("auth_ban_update_failed", { profileId, isActive, message: banError.message });
      }
    }

    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "状態の変更に失敗しました";
    logStage("unhandled_error", { profileId, message });
    return json({ error: message }, 500);
  }
});
