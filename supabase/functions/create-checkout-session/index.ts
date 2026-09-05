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
      .select("id, name, contract_status, stripe_customer_id, deleted_at")
      .eq("id", callerProfile.company_id)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company || company.deleted_at) {
      return json({ error: "会社情報が見つかりません" }, 404);
    }
    if (company.contract_status === "active") {
      return json({ error: "既に契約中です。プラン変更はStripe Customer Portalから行ってください" }, 409);
    }

    const { count: storeCount, error: storeCountError } = await admin
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id)
      .eq("status", "active");
    if (storeCountError) throw storeCountError;
    const addonQuantity = Math.max((storeCount ?? 1) - 1, 0);

    // Stripe Customerを確保する(既存があれば再利用、無ければ新規作成してすぐに保存する
    // ——checkout session作成の途中で失敗しても、customer自体の紐付けは残るようにするため)。
    let stripeCustomerId = company.stripe_customer_id || "";
    if (!stripeCustomerId) {
      const customer = await stripeRequest("POST", "customers", stripeSecretKey, {
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

    const basePriceId = billingInterval === "year" ? priceBaseYearly : priceBaseMonthly;
    const addonPriceId = billingInterval === "year" ? priceAddonYearly : priceAddonMonthly;
    const lineItems: Array<{ price: string; quantity: number }> = [{ price: basePriceId, quantity: 1 }];
    if (addonQuantity > 0) {
      lineItems.push({ price: addonPriceId, quantity: addonQuantity });
    }

    const successUrl = `${appUrl}/?checkout=success`;
    const cancelUrl = `${appUrl}/?checkout=cancelled`;

    const session = await stripeRequest("POST", "checkout/sessions", stripeSecretKey, {
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

    logStage("checkout_session_created", { companyId: company.id, billingInterval, addonQuantity });
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
