// 店舗の完全削除。system_admin限定(company_adminはstores_delete_system_admin_only RLS自体で
// 既にDELETEできないが、このEdge Function側でも明示的に再チェックする)。
//
// 最優先事項は「誤操作で店舗および過去データを失わない」こと。そのため:
// - 対象店舗名の完全一致(confirmName)をサーバー側でも必須にする(クライアント側の「入力させて
//   一致したら有効化」ボタンだけに頼らない — API を直接叩かれた場合の保険)。
// - daily_sales/monthly_targets/fixed_costs/variable_costs/monthly_closings/
//   monthly_closing_items/cost_monthly_amounts/store_inventory_balances/
//   store_business_holidays/user_stores のいずれかに1件でも行があれば、無条件で削除を拒否する
//   (store_profiles/store_input_settingsは店舗自体の設定であり「業務データ」ではないため、
//   このチェック対象には含めない — 誤登録直後の空店舗を消せなくなってしまうため)。
// - 操作ログは削除の「前」に書き込み、その書き込みに失敗した場合は削除自体を中止する
//   (要件7: 完全削除については必ず操作ログを残す — ログが残せない場合は削除しない)。
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
  console.error(`[delete-store] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

// store_idに紐づく業務データを持ちうる全テーブル。1件でも見つかれば完全削除を拒否する。
const RELATED_DATA_TABLES = [
  { table: "daily_sales", label: "日次売上" },
  { table: "monthly_targets", label: "月間目標" },
  { table: "fixed_costs", label: "固定費" },
  { table: "variable_costs", label: "変動費" },
  { table: "monthly_closings", label: "月締め" },
  { table: "monthly_closing_items", label: "月締め項目" },
  { table: "cost_monthly_amounts", label: "費用月次金額" },
  { table: "store_inventory_balances", label: "在庫" },
  { table: "store_business_holidays", label: "店休日設定" },
  { table: "user_stores", label: "スタッフ所属" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let storeId = "";
  let confirmName = "";
  try {
    const body = await req.json();
    storeId = String(body?.storeId || "").trim();
    confirmName = String(body?.confirmName || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!storeId || !confirmName) {
    return json({ error: "storeId, confirmName は必須です" }, 400);
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
      .select("id, name, role, is_active")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active || callerProfile.role !== "system_admin") {
      return json({ error: "店舗の完全削除はシステム管理者のみ実行できます" }, 403);
    }

    const { data: store, error: storeError } = await admin
      .from("stores")
      .select("id, name, company_id")
      .eq("id", storeId)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store) {
      return json({ error: "対象の店舗が見つかりません" }, 404);
    }

    if (confirmName !== store.name) {
      return json({ error: "入力された店舗名が一致しません" }, 400);
    }

    for (const { table, label } of RELATED_DATA_TABLES) {
      const { count, error: countError } = await admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId);
      if (countError) {
        logStage("related_data_check_failed", { storeId, table, message: countError.message });
        throw countError;
      }
      if (count && count > 0) {
        logStage("delete_blocked_related_data", { storeId, table, count });
        return json({
          error: "この店舗には既存データがあるため完全削除できません。停止またはアーカイブしてください。",
          code: "related_data_exists",
          relatedTable: table,
          relatedLabel: label,
        }, 409);
      }
    }

    // 削除の「前」にログを書き込む — store_status_audit_log.store_idに外部キー制約が無いのは
    // このため(削除後に書こうとすると、既に存在しない店舗を参照する行を挿入することになり、
    // 順序を強制されてしまう)。ログの書き込みに失敗した場合は削除そのものを中止する。
    const { error: logError } = await admin.from("store_status_audit_log").insert({
      store_id: store.id,
      store_name: store.name,
      company_id: store.company_id,
      action: "deleted",
      performed_by: callerProfile.id,
      performed_by_name: callerProfile.name || "",
    });
    if (logError) {
      logStage("audit_log_insert_failed_aborting_delete", { storeId, message: logError.message });
      return json({ error: "操作ログの記録に失敗したため、削除を中止しました。もう一度お試しください。" }, 500);
    }

    const { error: deleteError } = await admin.from("stores").delete().eq("id", storeId);
    if (deleteError) throw deleteError;

    return json({ ok: true, deletedName: store.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "店舗の完全削除に失敗しました";
    logStage("unhandled_error", { storeId, message });
    return json({ error: message }, 500);
  }
});
