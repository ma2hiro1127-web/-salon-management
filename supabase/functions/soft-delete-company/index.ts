// 会社の論理削除(action: "delete")と復元(action: "restore")。system_admin限定。
//
// 「会社データを削除」ボタンはこれまでdelete-company経由で即座に物理削除していたが、誤操作
// 対策として3段階(停止→削除(論理)→完全削除(物理、delete-company))へ変更した。この関数は
// その真ん中の段階を担う — company_idに紐づくどのデータにも一切触れず、companies行の
// deleted_at/deleted_by/deletion_scheduled_at の3列だけを更新する(削除)、または3列とも
// nullへ戻す(復元)。店舗・ユーザー・売上等は削除時も復元時も完全にそのまま残っているため、
// 復元すれば即座に以前の状態で利用を再開できる。
//
// deletion_scheduled_at は削除操作の30日後 — 完全削除(delete-company)を許可する猶予期間の
// 目安として保存するだけで、自動削除ジョブは今回実装しない(要件通り、現時点はsystem_admin
// による手動完全削除のみ)。
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
  console.error(`[soft-delete-company] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

const RETENTION_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let companyId = "";
  let action = "";
  let confirmName = "";
  try {
    const body = await req.json();
    companyId = String(body?.companyId || "").trim();
    action = String(body?.action || "").trim();
    confirmName = String(body?.confirmName || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!companyId || !action) {
    return json({ error: "companyId, action は必須です" }, 400);
  }
  if (action !== "delete" && action !== "restore") {
    return json({ error: "不正な操作です" }, 400);
  }
  if (action === "delete" && !confirmName) {
    return json({ error: "confirmName は必須です" }, 400);
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
      .select("id, role, is_active")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active || callerProfile.role !== "system_admin") {
      return json({ error: "会社の削除・復元はシステム管理者のみ実行できます" }, 403);
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, name, deleted_at")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) {
      return json({ error: "対象の会社が見つかりません" }, 404);
    }

    if (action === "delete") {
      if (company.deleted_at) {
        return json({ error: "この会社は既に削除済みです" }, 409);
      }
      if (confirmName !== company.name) {
        return json({ error: "入力された会社名が一致しません" }, 400);
      }
      const now = new Date();
      const scheduledAt = new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const { error: deleteError } = await admin
        .from("companies")
        .update({
          deleted_at: now.toISOString(),
          deleted_by: callerProfile.id,
          deletion_scheduled_at: scheduledAt.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", companyId);
      if (deleteError) throw deleteError;
      logStage("company_soft_deleted", { companyId, companyName: company.name, performedBy: callerProfile.id });
      return json({ ok: true, deletedAt: now.toISOString(), deletionScheduledAt: scheduledAt.toISOString() });
    }

    // action === "restore"
    if (!company.deleted_at) {
      return json({ error: "この会社は削除されていません" }, 409);
    }
    const { error: restoreError } = await admin
      .from("companies")
      .update({ deleted_at: null, deleted_by: null, deletion_scheduled_at: null, updated_at: new Date().toISOString() })
      .eq("id", companyId);
    if (restoreError) throw restoreError;
    logStage("company_restored", { companyId, companyName: company.name, performedBy: callerProfile.id });
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "会社の削除・復元に失敗しました";
    logStage("unhandled_error", { companyId, action, message });
    return json({ error: message }, 500);
  }
});
