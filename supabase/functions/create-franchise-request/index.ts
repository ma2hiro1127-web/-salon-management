// 加盟店連携リクエストの送信。system_admin限定 — company_partnerships自体のINSERT RLS
// (company_partnerships_insert_system_admin_only)も既にsystem_admin以外を拒否するが、
// 他のEdge Function群と同じ規約でサーバー側でも明示的に再検証する。
//
// 同じ(parent, partner)ペアで既にpending/approvedの行がある場合は拒否する(重複リクエスト
// 防止)。rejected/disconnectedの行がある場合は同じ行をpendingへ戻す(unique制約があるため
// 新規INSERTではなく既存行の再利用が必要)。逆方向のペア(partner側が既にこのparentへ
// parentとして連携している状態)がpending/approvedで存在する場合も拒否する(双方向の
// 連携が同時に成立するのを防ぐ)。company_id・既存データには一切触れない。
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
  console.error(`[create-franchise-request] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let parentCompanyId = "";
  let partnerCompanyId = "";
  try {
    const body = await req.json();
    parentCompanyId = String(body?.parentCompanyId || "").trim();
    partnerCompanyId = String(body?.partnerCompanyId || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!parentCompanyId || !partnerCompanyId) {
    return json({ error: "parentCompanyId と partnerCompanyId は必須です" }, 400);
  }
  if (parentCompanyId === partnerCompanyId) {
    return json({ error: "自社を加盟店として指定することはできません" }, 400);
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
      return json({ error: "加盟店連携リクエストを送信する権限がありません" }, 403);
    }

    const { data: companies, error: companiesError } = await admin
      .from("companies")
      .select("id, name, deleted_at")
      .in("id", [parentCompanyId, partnerCompanyId]);
    if (companiesError) throw companiesError;
    const parentCompany = (companies || []).find((c) => c.id === parentCompanyId);
    const partnerCompany = (companies || []).find((c) => c.id === partnerCompanyId);
    if (!parentCompany || !partnerCompany) {
      return json({ error: "対象の会社が見つかりません" }, 404);
    }
    if (parentCompany.deleted_at || partnerCompany.deleted_at) {
      return json({ error: "削除済みの会社とは加盟店連携できません" }, 409);
    }

    // 逆方向ペア(partnerが既にparentとしてこちらを連携している)をpending/approvedで
    // チェックする — 双方向の連携を同時に成立させない。
    const { data: reversePair, error: reverseError } = await admin
      .from("company_partnerships")
      .select("id, status")
      .eq("parent_company_id", partnerCompanyId)
      .eq("partner_company_id", parentCompanyId)
      .in("status", ["pending", "approved"])
      .maybeSingle();
    if (reverseError) throw reverseError;
    if (reversePair) {
      return json({ error: "逆方向の加盟店連携が既に存在するため、この組み合わせではリクエストできません" }, 409);
    }

    const { data: existing, error: existingError } = await admin
      .from("company_partnerships")
      .select("id, status")
      .eq("parent_company_id", parentCompanyId)
      .eq("partner_company_id", partnerCompanyId)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing && (existing.status === "pending" || existing.status === "approved")) {
      return json({ error: existing.status === "pending" ? "既にリクエスト送信済みです" : "既に加盟店連携済みです" }, 409);
    }

    if (existing) {
      // rejected/disconnectedの既存行を再利用してpendingへ戻す(unique(parent,partner)制約
      // があるため、新規INSERTではなくUPDATEで再申請する)。
      const { error: reactivateError } = await admin
        .from("company_partnerships")
        .update({
          status: "pending",
          requested_by: callerProfile.id,
          responded_by: null,
          responded_at: null,
          joined_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (reactivateError) throw reactivateError;
      return json({ ok: true, id: existing.id, status: "pending" });
    }

    const { data: inserted, error: insertError } = await admin
      .from("company_partnerships")
      .insert({
        parent_company_id: parentCompanyId,
        partner_company_id: partnerCompanyId,
        relationship_type: "franchise",
        status: "pending",
        requested_by: callerProfile.id,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    return json({ ok: true, id: inserted.id, status: "pending" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "加盟店連携リクエストの送信に失敗しました";
    logStage("unhandled_error", { parentCompanyId, partnerCompanyId, message });
    return json({ error: message }, 500);
  }
});
