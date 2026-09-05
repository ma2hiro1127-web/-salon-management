// Stripe Checkout Session IDを基準にした契約状態の確認(2026-09、決済完了後にログイン画面へ
// 戻ってしまう不具合の再修正)。
//
// 背景: 決済完了後の復帰判定を、ブラウザのsessionStorage/localStorage/URLの目印だけに
// 依存させると、実機で「決済用のブラウジングコンテキストが元のタブと同一視されない」
// ケースがあり、ストレージが引き継がれず不安定だった。Stripeが公式に案内している方式
// (success_urlへ{CHECKOUT_SESSION_ID}を埋め込み、戻ってきたら そのIDでStripeへ照会する)
// に切り替え、認証セッションの有無に一切依存せず契約状態を確認できるようにする。
//
// 重要な設計方針:
//   - この関数はJWT認証を要求しない(verify_jwt=false、supabase/config.toml参照)。
//     決済直後にSupabase Authセッションが(何らかの理由で)確立していなくても、
//     支払い自体が完了しているかどうかは確認できる必要があるため。
//   - Checkout Session IDはStripeが生成する高エントロピーな値であり、それ自体が
//     「このセッションを完了した本人だけが知り得る」実質的なアクセストークンとして
//     機能する(Stripe公式のsuccess_url確認パターンと同じ設計)。
//   - この関数はDBへ一切書き込みを行わない(読み取り専用)。契約状態(contract_status)を
//     確定させる正はあくまでWebhook(stripe-webhook)のみ——このAPIはあくまで
//     「Stripe側の実際の状態」と「現時点でDBに反映されている状態」の両方を返すだけ。
//     フロント側はこれを数秒おきにポーリングし、Webhook反映を待つUIに使う。
//   - client_reference_idだけを唯一の根拠にはしない。DBのcompaniesテーブルに保存済みの
//     stripe_customer_idと、Stripeから返ってきたsession.customerが一致するかも
//     突合する(不一致はログに残すが、読み取り専用のためエラーにはせず情報として返す)。
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
  console.error(`[confirm-checkout-session] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

async function stripeGet(path: string, secretKey: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const responseJson = await res.json();
  if (!res.ok) {
    const message = responseJson?.error?.message || `Stripe API error (${res.status})`;
    throw new Error(message);
  }
  return responseJson;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let sessionId = "";
  try {
    const body = await req.json();
    sessionId = String(body?.sessionId || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  // cs_test_.../cs_live_... の形式チェック(プレフィックスでライブ/テストのどちらの
  // Secret Keyを使うか判定する。両モードは同じStripeアカウントでも完全に別データ空間の
  // ため、モードを取り違えると"No such checkout session"で拒否される)。
  const isTestSession = sessionId.startsWith("cs_test_");
  const isLiveSession = sessionId.startsWith("cs_live_");
  if (!sessionId || (!isTestSession && !isLiveSession)) {
    return json({ error: "sessionId の形式が不正です" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const stripeTestSecretKey = Deno.env.get("STRIPE_TEST_SECRET_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    logStage("missing_server_config", {});
    return json({ error: "サーバー設定が不足しています" }, 500);
  }
  const effectiveSecretKey = isTestSession ? stripeTestSecretKey : stripeSecretKey;
  if (!effectiveSecretKey) {
    logStage("missing_stripe_key", { isTestSession });
    return json({ error: "Stripe設定が不足しています" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const session = await stripeGet(
      `checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`,
      effectiveSecretKey
    );

    const companyId = typeof session.client_reference_id === "string" ? session.client_reference_id : "";
    if (!companyId) {
      logStage("no_client_reference_id", { sessionId });
      return json({ error: "このCheckout Sessionには会社情報が紐付いていません" }, 404);
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, name, contract_status, plan, is_test_contract_run, stripe_customer_id, deleted_at")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company || company.deleted_at) {
      return json({ error: "会社情報が見つかりません" }, 404);
    }

    const sessionCustomerId = typeof session.customer === "string" ? session.customer : "";
    if (company.stripe_customer_id && sessionCustomerId && company.stripe_customer_id !== sessionCustomerId) {
      // 読み取り専用のAPIのため処理は続行するが、本来一致するはずの値が食い違っている
      // ことは異常系として必ずログに残す(調査用)。
      logStage("customer_id_mismatch", { companyId, sessionCustomerId, storedCustomerId: company.stripe_customer_id });
    }

    const subscription = typeof session.subscription === "object" && session.subscription ? session.subscription : null;

    logStage("confirmed", {
      companyId,
      sessionStatus: session.status,
      paymentStatus: session.payment_status,
      subscriptionStatus: subscription?.status,
      dbContractStatus: company.contract_status,
    });

    return json({
      ok: true,
      session: {
        id: session.id,
        status: session.status,
        paymentStatus: session.payment_status,
        customerEmail: session.customer_details?.email || session.customer_email || "",
      },
      stripeSubscriptionStatus: subscription?.status || null,
      company: {
        id: company.id,
        name: company.name,
        contractStatus: company.contract_status,
        plan: company.plan,
        isTestContractRun: Boolean(company.is_test_contract_run),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "確認に失敗しました";
    logStage("unhandled_error", { message, sessionId });
    return json({ error: message }, 500);
  }
});
