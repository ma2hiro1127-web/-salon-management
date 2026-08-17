// 会社の契約状態(トライアル/契約中/停止中)を変更する。system_admin限定 — companiesの
// UPDATE自体はcompanies_update_system_only RLSで既にsystem_admin以外は拒否されるが、
// 他のEdge Function群(update-store-status等)と同じ規約でサーバー側でも明示的に再検証する。
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
  console.error(`[update-company-status] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

// action -> { fromStatuses, toStatus } — activateはトライアル/停止中どちらからも契約中へ
// (「契約中へ変更」「契約中へ復帰」を同じ操作として扱う)、suspendはトライアル/契約中
// どちらからも停止中へ。想定外の遷移(既に契約中の会社をactivateする等)は明示的に拒否する。
const TRANSITIONS: Record<string, { fromStatuses: string[]; toStatus: string }> = {
  activate: { fromStatuses: ["trial", "suspended"], toStatus: "active" },
  suspend: { fromStatuses: ["trial", "active"], toStatus: "suspended" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let companyId = "";
  let action = "";
  try {
    const body = await req.json();
    companyId = String(body?.companyId || "").trim();
    action = String(body?.action || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!companyId || !action) {
    return json({ error: "companyId, action は必須です" }, 400);
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
      .select("id, role, is_active")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active || callerProfile.role !== "system_admin") {
      return json({ error: "会社の契約状態を変更する権限がありません" }, 403);
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, name, contract_status")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) {
      return json({ error: "対象の会社が見つかりません" }, 404);
    }

    if (!transition.fromStatuses.includes(company.contract_status)) {
      return json({ error: `この会社は現在「${company.contract_status}」のため、この操作は行えません` }, 409);
    }

    const { error: updateError } = await admin
      .from("companies")
      .update({ contract_status: transition.toStatus, updated_at: new Date().toISOString() })
      .eq("id", companyId);
    if (updateError) throw updateError;

    return json({ ok: true, status: transition.toStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "会社の契約状態変更に失敗しました";
    logStage("unhandled_error", { companyId, action, message });
    return json({ error: message }, 500);
  }
});
