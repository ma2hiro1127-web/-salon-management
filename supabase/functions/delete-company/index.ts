// 会社の完全削除。system_admin限定(companies_delete_system_only RLS自体で既に
// company_admin以下はDELETEできないが、他のEdge Function群と同じ規約でサーバー側でも
// 明示的に再検証する)。
//
// stores個別の完全削除(delete-store)は「関連データが1件でもあれば拒否」する設計だが、
// 会社の完全削除は要件として「店舗・ユーザー・売上・日次入力・月次データ・費用・設定など
// 紐づくデータをすべて削除する」ことが明示的に求められているため、cascadeに頼らず
// company_idに紐づく全テーブルを子→親の順で明示的に削除してから、最後にcompanies行自体を
// 削除する。子から親の順にするのは、外部キー制約がcascadeでない場合でも削除順序自体で
// 失敗しないようにするため。company_idでの絞り込みを徹底することで、他社のデータへは
// 一切影響しない(要件6)。
//
// store_status_audit_logだけは意図的に削除対象から除外する — 店舗の停止/削除操作の履歴を
// 会社削除後も監査ログとして残すため(delete-storeの操作ログと同じ思想)。
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
  console.error(`[delete-company] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

// company_idに紐づく全テーブルを、子(他のテーブルから参照される側)を先に削除する順で列挙。
// tenant_snapshots.company_idはtext型(UUIDのtext表現)だが、supabase-jsはcompanyIdの文字列を
// そのまま渡すだけなので.eq()の扱いはuuid列と変わらない。
const COMPANY_SCOPED_TABLES = [
  "cost_monthly_amounts",
  "monthly_closing_items",
  "fixed_costs",
  "variable_costs",
  "monthly_targets",
  "monthly_closings",
  "daily_sales",
  "store_business_holidays",
  "company_all_stores_holidays",
  "company_all_stores_targets",
  "store_inventory_balances",
  "store_input_settings",
  "store_profiles",
  "company_settings",
  "tenant_snapshots",
  "user_stores",
  "profiles",
  "stores",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let companyId = "";
  let confirmName = "";
  try {
    const body = await req.json();
    companyId = String(body?.companyId || "").trim();
    confirmName = String(body?.confirmName || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!companyId || !confirmName) {
    return json({ error: "companyId, confirmName は必須です" }, 400);
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
      return json({ error: "会社の完全削除はシステム管理者のみ実行できます" }, 403);
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) {
      return json({ error: "対象の会社が見つかりません" }, 404);
    }

    if (confirmName !== company.name) {
      return json({ error: "入力された会社名が一致しません" }, 400);
    }

    for (const table of COMPANY_SCOPED_TABLES) {
      const { error: deleteError } = await admin.from(table).delete().eq("company_id", companyId);
      if (deleteError) {
        logStage("related_data_delete_failed", { companyId, table, message: deleteError.message });
        throw deleteError;
      }
    }

    const { error: companyDeleteError } = await admin.from("companies").delete().eq("id", companyId);
    if (companyDeleteError) throw companyDeleteError;

    logStage("company_deleted", { companyId, companyName: company.name, performedBy: callerProfile.id });
    return json({ ok: true, deletedName: company.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "会社の完全削除に失敗しました";
    logStage("unhandled_error", { companyId, message });
    return json({ error: message }, 500);
  }
});
