// 加盟店連携リクエストの承認/拒否、および連携済み関係の解除/再申請。
//
// アクターと許可される遷移:
//   approve / reject (pending -> approved / rejected): 受信側(partner_company_id)の
//     company_admin、またはsystem_admin。joined_atはapprove時にセットする。
//   disconnect (approved -> disconnected): 送信側(parent_company_id、本部側)の
//     company_admin、またはsystem_admin。
//   reconnect (disconnected -> pending): 送信側(parent_company_id)のcompany_admin、
//     またはsystem_admin。再度相手の承認が必要(即座にapprovedへは戻さない)。
//
// 二重承認・二重処理を防ぐため、UPDATEは常に「対象id AND 現在期待するstatus」を条件にし、
// 該当行が返らなければ「既に処理済み」として409を返す(同時に2回押された場合、後発は
// 必ず失敗する)。company_id・加盟店側の実データには一切触れない — company_partnerships
// の状態列だけを更新する。
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
  console.error(`[update-franchise-relationship] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

const VALID_ACTIONS = ["approve", "reject", "disconnect", "reconnect"];

// action -> { 遷移元status, 遷移先status, どちら側の会社の権限が必要か }
const ACTION_RULES: Record<string, { from: string; to: string; actorSide: "parent" | "partner" }> = {
  approve: { from: "pending", to: "approved", actorSide: "partner" },
  reject: { from: "pending", to: "rejected", actorSide: "partner" },
  disconnect: { from: "approved", to: "disconnected", actorSide: "parent" },
  reconnect: { from: "disconnected", to: "pending", actorSide: "parent" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let relationshipId = "";
  let action = "";
  try {
    const body = await req.json();
    relationshipId = String(body?.relationshipId || "").trim();
    action = String(body?.action || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!relationshipId || !action) {
    return json({ error: "relationshipId と action は必須です" }, 400);
  }
  if (!VALID_ACTIONS.includes(action)) {
    return json({ error: "不正なactionです" }, 400);
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
    if (!callerProfile || !callerProfile.is_active) {
      return json({ error: "操作権限がありません" }, 403);
    }
    if (callerProfile.role !== "system_admin" && callerProfile.role !== "company_admin") {
      return json({ error: "操作権限がありません" }, 403);
    }

    const { data: relationship, error: relationshipError } = await admin
      .from("company_partnerships")
      .select("id, parent_company_id, partner_company_id, status")
      .eq("id", relationshipId)
      .maybeSingle();
    if (relationshipError) throw relationshipError;
    if (!relationship) {
      return json({ error: "対象の連携リクエストが見つかりません" }, 404);
    }

    const rule = ACTION_RULES[action];
    const requiredCompanyId = rule.actorSide === "parent" ? relationship.parent_company_id : relationship.partner_company_id;
    const isAuthorized = callerProfile.role === "system_admin" || callerProfile.company_id === requiredCompanyId;
    if (!isAuthorized) {
      return json({ error: "この操作を行う権限がありません" }, 403);
    }

    if (relationship.status !== rule.from) {
      return json({ error: `現在の状態(${relationship.status})ではこの操作はできません` }, 409);
    }

    const updatePayload: Record<string, unknown> = {
      status: rule.to,
      updated_at: new Date().toISOString(),
    };
    if (action === "approve") {
      updatePayload.joined_at = new Date().toISOString().slice(0, 10);
      updatePayload.responded_by = callerProfile.id;
      updatePayload.responded_at = new Date().toISOString();
    } else if (action === "reject") {
      updatePayload.responded_by = callerProfile.id;
      updatePayload.responded_at = new Date().toISOString();
    } else if (action === "reconnect") {
      // 再申請: 前回の承認応答情報をクリアし、相手に改めて承認してもらう。
      updatePayload.responded_by = null;
      updatePayload.responded_at = null;
      updatePayload.joined_at = null;
    }

    // idと現在期待するstatusの両方を条件にする — 同時に2回リクエストが飛んだ場合、
    // 後発のUPDATEは対象行が0件になり(status列は既に変わっているため)、maybeSingle()が
    // nullを返す。これを「既に処理済み」として検出する(二重承認防止)。
    const { data: updated, error: updateError } = await admin
      .from("company_partnerships")
      .update(updatePayload)
      .eq("id", relationshipId)
      .eq("status", rule.from)
      .select("id, status")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      return json({ error: "既に他の操作で処理済みです" }, 409);
    }

    return json({ ok: true, id: updated.id, status: updated.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "加盟店連携の更新に失敗しました";
    logStage("unhandled_error", { relationshipId, action, message });
    return json({ error: message }, 500);
  }
});
