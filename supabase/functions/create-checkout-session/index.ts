// Stripe Checkout Sessionの作成(2026-09-02、Stripe決済導入)。company_admin限定。
//
// 重要な設計方針(要件どおり):
//   - company_idはリクエストボディで一切受け取らない。呼び出し元のJWTからprofileを解決し、
//     そのprofile.company_idだけを使う(他社を指定して決済を開始することは構造的に不可能)。
//   - Stripe Secret Keyはこの関数(サーバー側)でのみ使う。フロントエンドには一切渡さない。
//   - カード情報はサロンマネージャー側を一切経由しない(Stripeの決済ページへリダイレクト
//     するだけ、Stripe.js自体も使わない——publishable keyすら不要な構成)。
//   - 店舗数はこのDBから直接数える(クライアント申告不可)。追加店舗Priceのquantityは
//     max(店舗数-1, 0)。1店舗のみの間は追加店舗アイテム自体を含めない
//     (Stripeはquantity=0のline itemを許可しないため)。
//   - Price IDはすべて環境変数から読む。コードへのベタ書きは一切しない。
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
  console.error(`[create-checkout-session] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

// Stripeの REST API はフォームエンコード(application/x-www-form-urlencoded)を要求する。
// ネストしたオブジェクト・配列はブラケット記法(line_items[0][price]=...)で表現する。
function toFormPairs(params: Record<string, unknown>, prefix = ""): string[] {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item && typeof item === "object") {
          pairs.push(...toFormPairs(item as Record<string, unknown>, `${fullKey}[${i}]`));
        } else {
          pairs.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === "object") {
      pairs.push(...toFormPairs(value as Record<string, unknown>, fullKey));
    } else {
      pairs.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs;
}

async function stripeRequest(
  method: "GET" | "POST",
  path: string,
  secretKey: string,
  params?: Record<string, unknown>
) {
  const body = params ? toFormPairs(params).join("&") : undefined;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : body,
  });
  const responseJson = await res.json();
  if (!res.ok) {
    const message = responseJson?.error?.message || `Stripe API error (${res.status})`;
    const param = responseJson?.error?.param || "";
    throw new Error(param ? `${message} (param: ${param})` : message);
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

  let billingInterval = "";
  try {
    const body = await req.json();
    billingInterval = String(body?.billingInterval || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (billingInterval !== "month" && billingInterval !== "year") {
    return json({ error: "billingInterval は month または year を指定してください" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  // .trim()が肝心(2026-09の障害調査で発見): Supabase SecretsのAPP_URLに末尾改行が
  // 混入していたため、文字列結合で組み立てるsuccess_url/cancel_urlに改行がそのまま
  // 残り、Stripeが"Not a valid URL"で拒否していた(new URL()経由の箇所はWHATWG URL
  // パーサーが前後の空白・制御文字を自動で取り除くため気づかれなかった)。secret値自体も
  // 修正するが、コード側でも防御的にtrimしておく。
  const appUrl = Deno.env.get("APP_URL")?.trim();
  const priceBaseMonthly = Deno.env.get("STRIPE_PRICE_BASE_MONTHLY");
  const priceBaseYearly = Deno.env.get("STRIPE_PRICE_BASE_YEARLY");
  const priceAddonMonthly = Deno.env.get("STRIPE_PRICE_STORE_ADDON_MONTHLY");
  const priceAddonYearly = Deno.env.get("STRIPE_PRICE_STORE_ADDON_YEARLY");
  // Stripeテストモード用の並行セット(2026-09追加、契約フロー実機検証)。system_adminの
  // 「新規契約フローをテスト」経由で作られた使い捨て会社(is_test_contract_run=true)だけ、
  // 本番のライブキー・ライブPrice IDを一切使わず、これらのテストモード専用の値だけを使う。
  // 本番顧客の契約(is_test_contract_run=false、大多数)は、このブロック自体を一切参照せず
  // 従来どおりライブモードのまま——このガードのおかげで、テストキー未設定でも本番顧客の
  // 契約フローには何の影響も出ない。
  const stripeTestSecretKey = Deno.env.get("STRIPE_TEST_SECRET_KEY");
  const priceTestBaseMonthly = Deno.env.get("STRIPE_TEST_PRICE_BASE_MONTHLY");
  const priceTestBaseYearly = Deno.env.get("STRIPE_TEST_PRICE_BASE_YEARLY");
  const priceTestAddonMonthly = Deno.env.get("STRIPE_TEST_PRICE_STORE_ADDON_MONTHLY");
  const priceTestAddonYearly = Deno.env.get("STRIPE_TEST_PRICE_STORE_ADDON_YEARLY");
  if (
    !supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey || !appUrl ||
    !priceBaseMonthly || !priceBaseYearly || !priceAddonMonthly || !priceAddonYearly
  ) {
    logStage("missing_server_config", {});
    return json({ error: "サーバー設定が不足しています(Stripe関連の環境変数が未設定です)" }, 500);
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
    // company_idはここで初めて、呼び出し元自身のprofileから解決する
    // (リクエストボディからは一切受け取らない——他社を指定した決済開始を構造的に防ぐ)。
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("id, role, is_active, company_id, email")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active || callerProfile.role !== "company_admin" || !callerProfile.company_id) {
      return json({ error: "契約の開始は会社管理者(company_admin)のみ実行できます" }, 403);
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, name, contract_status, stripe_customer_id, deleted_at, is_test_contract_run")
      .eq("id", callerProfile.company_id)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company || company.deleted_at) {
      return json({ error: "会社情報が見つかりません" }, 404);
    }
    if (company.contract_status === "active") {
      return json({ error: "既に契約中です。プラン変更はStripe Customer Portalから行ってください" }, 409);
    }

    // テスト契約フロー専用会社は、本番のライブキー・ライブPrice IDを絶対に使わない
    // (要件: 誤課金の可能性を構造的にゼロにする)。テストモード側の設定が1つでも
    // 欠けている場合は、ライブへフォールバックせずエラーで停止する——「設定漏れで
    // うっかりライブ決済になる」事故を防ぐため。
    const isTestContractRun = Boolean(company.is_test_contract_run);
    if (isTestContractRun && (!stripeTestSecretKey || !priceTestBaseMonthly || !priceTestBaseYearly || !priceTestAddonMonthly || !priceTestAddonYearly)) {
      logStage("missing_test_mode_config", { companyId: company.id });
      return json({ error: "テストモード用のStripe設定(STRIPE_TEST_SECRET_KEY等)が未設定です。system_adminへご確認ください" }, 500);
    }
    const effectiveSecretKey = isTestContractRun ? stripeTestSecretKey! : stripeSecretKey;
    const effectiveBaseMonthly = isTestContractRun ? priceTestBaseMonthly! : priceBaseMonthly;
    const effectiveBaseYearly = isTestContractRun ? priceTestBaseYearly! : priceBaseYearly;
    const effectiveAddonMonthly = isTestContractRun ? priceTestAddonMonthly! : priceAddonMonthly;
    const effectiveAddonYearly = isTestContractRun ? priceTestAddonYearly! : priceAddonYearly;

    const { count: storeCount, error: storeCountError } = await admin
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id)
      .eq("status", "active");
    if (storeCountError) throw storeCountError;
    const addonQuantity = Math.max((storeCount ?? 1) - 1, 0);

    // Stripe Customerを確保する(既存があれば再利用、無ければ新規作成してすぐに保存する
    // ——checkout session作成の途中で失敗しても、customer自体の紐付けは残るようにするため)。
    // ライブ/テストは同じStripeアカウントでも完全に別データ空間のため、以前ライブモードで
    // 作られたcustomer idをテストモードのキーで参照すると「No such customer」で拒否される
    // (逆も同様)。この場合は保存済みのidを諦めて新規作成し直す(要件8のトライアル運用開始
    // 前に見つかった、モード切替時に起こりうる不整合への自己修復)。
    let stripeCustomerId = company.stripe_customer_id || "";
    if (stripeCustomerId) {
      try {
        await stripeRequest("GET", `customers/${stripeCustomerId}`, effectiveSecretKey);
      } catch {
        stripeCustomerId = "";
      }
    }
    if (!stripeCustomerId) {
      const customer = await stripeRequest("POST", "customers", effectiveSecretKey, {
        name: company.name,
        email: callerProfile.email || undefined,
        metadata: { company_id: company.id },
      });
      stripeCustomerId = customer.id;
      const { error: saveCustomerError } = await admin
        .from("companies")
        .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() })
        .eq("id", company.id);
      if (saveCustomerError) throw saveCustomerError;
    }

    const basePriceId = billingInterval === "year" ? effectiveBaseYearly : effectiveBaseMonthly;
    const addonPriceId = billingInterval === "year" ? effectiveAddonYearly : effectiveAddonMonthly;
    const lineItems: Array<{ price: string; quantity: number }> = [{ price: basePriceId, quantity: 1 }];
    if (addonQuantity > 0) {
      lineItems.push({ price: addonPriceId, quantity: addonQuantity });
    }

    const successUrl = `${appUrl}/?checkout=success`;
    const cancelUrl = `${appUrl}/?checkout=cancelled`;

    const session = await stripeRequest("POST", "checkout/sessions", effectiveSecretKey, {
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { company_id: company.id },
      subscription_data: { metadata: { company_id: company.id } },
      allow_promotion_codes: true,
      // Stripeアカウント側でManaged Payments(税務コード必須)がデフォルト有効な場合があり、
      // その状態だとProductにtax_codeが無いと決済ページ作成自体が失敗する。サロンマネージャー
      // 側では税務処理をStripeに委任しない(通常のSubscription課金のみ)ため明示的に無効化する。
      managed_payments: { enabled: false },
    });

    logStage("checkout_session_created", { companyId: company.id, billingInterval, addonQuantity, isTestContractRun });
    return json({ ok: true, url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout Sessionの作成に失敗しました";
    logStage("unhandled_error", { message });
    // 一時的な調査用: supabase functions logsが使えない環境でも原因を追えるよう、
    // 機密情報を含まない範囲でclient_diagnostic_logs(既存テーブル)へも残す。
    try {
      await admin.from("client_diagnostic_logs").insert({
        screen: "create-checkout-session",
        action_type: "unhandled_error",
        message: String(message).slice(0, 500),
      });
    } catch {
      // ログ失敗は無視
    }
    return json({ error: message }, 500);
  }
});
