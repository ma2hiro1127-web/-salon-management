// Stripe契約フローの実機検証(2026-09追加)。system_admin限定。
//
// 目的: 「新規契約フローをテスト」で実際にStripe Checkoutを完了させると、本番Stripeに
// 本物のサブスクリプションが作成される(要件6: 本番Stripeを使う場合でも誤課金を防ぐため
// テスト実行後にキャンセルできる導線が必要)。このFunctionは、is_test_contract_run=true
// (=このテスト契約フロー自体で作られた使い捨て会社)である会社に限定して、Stripe側の
// サブスクリプションを即時キャンセルする。
//
// 重要: DBの契約状態(contract_status等)はここでは一切書き換えない。Stripeを直接
// キャンセルするだけで、その結果として届く本物のcustomer.subscription.deleted Webhook
// イベントが、既存のstripe-webhook Edge Functionの既存ロジックでDBへ反映する
// (要件8: 本番顧客の解約と全く同じコードパスを通す——別実装のDB更新ロジックを作らない)。
//
// 安全策: is_test_contract_run=trueの会社以外は絶対に対象にしない(誤って実際の顧客の
// サブスクリプションをキャンセルする事故を構造的に防ぐ)。
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

  let companyId = "";
  try {
    const body = await req.json();
    companyId = String(body?.companyId || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!companyId) {
    return json({ error: "companyId は必須です" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // このFunctionはis_test_contract_run=trueの会社にしか作用しない(下の安全ガード参照)。
  // そのようなテスト契約は必ずSTRIPE_TEST_SECRET_KEYで作られたテストモードのサブスク
  // リプションのため、本番のライブキー(STRIPE_SECRET_KEY)は絶対に使わない
  // (要件: 本番のライブキー・ライブPrice IDを絶対に使用しない)。
  const stripeTestSecretKey = Deno.env.get("STRIPE_TEST_SECRET_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeTestSecretKey) {
    return json({ error: "サーバー設定が不足しています(STRIPE_TEST_SECRET_KEYが未設定です)" }, 500);
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
      .select("role, is_active")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active || callerProfile.role !== "system_admin") {
      return json({ error: "テスト契約のキャンセルはシステム管理者のみ実行できます" }, 403);
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, name, is_test_contract_run, stripe_subscription_id")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) {
      return json({ error: "会社情報が見つかりません" }, 404);
    }
    // 最重要の安全ガード(要件9): テスト契約フロー専用会社以外は絶対にキャンセルさせない。
    if (!company.is_test_contract_run) {
      return json({ error: "この会社はテスト契約フロー専用会社ではないため、この操作は実行できません" }, 403);
    }

    if (!company.stripe_subscription_id) {
      // Checkoutが未完了(サブスクリプションがまだ存在しない)場合は何もキャンセルする
      // 必要が無い——エラーにはせず、その旨を伝えて正常終了する。
      return json({ ok: true, skipped: "no_subscription" });
    }

    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(company.stripe_subscription_id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${stripeTestSecretKey}` },
    });
    const resJson = await res.json();
    if (!res.ok) {
      // Stripe側で既にキャンセル済み/存在しない場合はresource_missing——テスト運用上は
      // 「もう課金は発生していない」ことが目的なので、これは実質的に成功として扱う。
      if (resJson?.error?.code === "resource_missing") {
        return json({ ok: true, skipped: "already_cancelled" });
      }
      throw new Error(resJson?.error?.message || `Stripe API error (${res.status})`);
    }

    return json({ ok: true, subscriptionStatus: resJson?.status || "canceled" });
  } catch (error) {
    console.error("cancel-test-contract error", error);
    const message = error instanceof Error ? error.message : "キャンセル処理に失敗しました";
    return json({ error: message }, 500);
  }
});
