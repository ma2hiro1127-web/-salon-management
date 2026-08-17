// 会社の契約状態(無料利用/トライアル/契約中/停止中)を変更する。system_admin限定 —
// companiesのUPDATE自体はcompanies_update_system_only RLSで既にsystem_admin以外は拒否
// されるが、他のEdge Function群(update-store-status等)と同じ規約でサーバー側でも明示的に
// 再検証する。
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

const VALID_STATUSES = ["free", "trial", "active", "suspended"];

// 現在の状態 -> 遷移可能な状態の一覧。要件で明示された組み合わせのみを許可する
// (例: 契約中からトライアルへ戻す遷移は要件に含まれていないため許可しない)。
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  free: ["active", "suspended"],
  trial: ["active", "free", "suspended"],
  active: ["suspended", "free"],
  suspended: ["active", "free", "trial"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let companyId = "";
  let targetStatus = "";
  try {
    const body = await req.json();
    companyId = String(body?.companyId || "").trim();
    targetStatus = String(body?.targetStatus || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!companyId || !targetStatus) {
    return json({ error: "companyId, targetStatus は必須です" }, 400);
  }
  if (!VALID_STATUSES.includes(targetStatus)) {
    return json({ error: "不正な契約状態です" }, 400);
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

    const currentStatus = company.contract_status || "trial";
    if (currentStatus === targetStatus) {
      return json({ error: "既にその契約状態です" }, 409);
    }
    if (!(ALLOWED_TRANSITIONS[currentStatus] || []).includes(targetStatus)) {
      return json({ error: `この会社は現在「${currentStatus}」のため、その契約状態へは変更できません` }, 409);
    }

    // company_id・関連データには一切触れない。契約状態の列を1つ更新するだけ。
    const { error: updateError } = await admin
      .from("companies")
      .update({ contract_status: targetStatus, updated_at: new Date().toISOString() })
      .eq("id", companyId);
    if (updateError) throw updateError;

    return json({ ok: true, status: targetStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "会社の契約状態変更に失敗しました";
    logStage("unhandled_error", { companyId, targetStatus, message });
    return json({ error: message }, 500);
  }
});
