// 店舗の状態(運営中/停止中/アーカイブ)を変更する。停止/再開/アーカイブ/復元の4操作すべてを
// このEdge Function経由にする理由: (1) 操作ログ(store_status_audit_log)をservice-role経由
// でのみ書き込めるようにし、クライアントから改ざん・削除できないようにするため、(2) 権限
// スコープ(store_managerは操作不可、company_adminは自社のみ)をRLSに加えてサーバー側でも
// 再検証するため(profiles_update等の他のEdge Functionと同じ規約)。
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
  console.error(`[update-store-status] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

// action -> { fromStatuses, toStatus, auditAction } — suspend/resumeはactive<->suspendedのみ、
// archive/restoreはarchived<->(active|suspended)を行き来する。想定外の遷移(例:
// アーカイブ済みの店舗を「再開」しようとする)は明示的に拒否し、あいまいな状態遷移を防ぐ。
const TRANSITIONS: Record<string, { fromStatuses: string[]; toStatus: string; auditAction: string }> = {
  suspend: { fromStatuses: ["active"], toStatus: "suspended", auditAction: "suspended" },
  resume: { fromStatuses: ["suspended"], toStatus: "active", auditAction: "resumed" },
  archive: { fromStatuses: ["active", "suspended"], toStatus: "archived", auditAction: "archived" },
  restore: { fromStatuses: ["archived"], toStatus: "active", auditAction: "restored" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let storeId = "";
  let action = "";
  try {
    const body = await req.json();
    storeId = String(body?.storeId || "").trim();
    action = String(body?.action || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!storeId || !action) {
    return json({ error: "storeId, action は必須です" }, 400);
  }
  const transition = TRANSITIONS[action];
  if (!transition) {
    return json({ error: "不正な操作です" }, 400);
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
      .select("id, name, role, company_id, is_active")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    // store_manager/staffはこの画面自体に到達できない想定だが、Edge Function側でも明示的に
    // 拒否する(要件6: UIを隠すだけでなくサーバー側でも防止する)。
    if (!callerProfile || !callerProfile.is_active || !["system_admin", "company_admin"].includes(callerProfile.role)) {
      return json({ error: "店舗の状態を変更する権限がありません" }, 403);
    }

    const { data: store, error: storeError } = await admin
      .from("stores")
      .select("id, name, company_id, status")
      .eq("id", storeId)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store) {
      return json({ error: "対象の店舗が見つかりません" }, 404);
    }
    if (callerProfile.role === "company_admin" && callerProfile.company_id !== store.company_id) {
      return json({ error: "他社の店舗の状態は変更できません" }, 403);
    }

    if (!transition.fromStatuses.includes(store.status)) {
      return json({ error: `この店舗は現在「${store.status}」のため、この操作は行えません` }, 409);
    }

    // .select()でUPDATE後の実際の行を読み戻す(要件: クライアントへは「送った値の
    // エコーバック」ではなく「実際にDBへ書き込まれた値」を返す——保存後にクライアント側で
    // 再度整合性確認できるようにするため)。
    const { data: updatedStore, error: updateError } = await admin
      .from("stores")
      .update({ status: transition.toStatus, updated_at: new Date().toISOString() })
      .eq("id", storeId)
      .select("status")
      .single();
    if (updateError) throw updateError;

    const { error: logError } = await admin.from("store_status_audit_log").insert({
      store_id: store.id,
      store_name: store.name,
      company_id: store.company_id,
      action: transition.auditAction,
      performed_by: callerProfile.id,
      performed_by_name: callerProfile.name || "",
    });
    if (logError) {
      // 状態の更新自体は成功しているため、監査ログの記録失敗だけでこの操作全体を失敗として
      // 返すことはしない(店舗が意図しない状態のまま止まる方が実害が大きい) — ただし記録は
      // 必ず残す。
      logStage("audit_log_insert_failed", { storeId, action, message: logError.message });
    }

    return json({ ok: true, status: updatedStore.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "店舗の状態変更に失敗しました";
    logStage("unhandled_error", { storeId, action, message });
    return json({ error: message }, 500);
  }
});
