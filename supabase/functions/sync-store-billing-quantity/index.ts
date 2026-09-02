// 店舗数に応じた追加店舗Price(quantity)をStripeサブスクリプションへ同期する
// (2026-09-02、Stripe決済導入)。店舗の新規追加・アーカイブ・復元の直後にフロントから
// 呼ぶことを想定した小さな関数。
//
// 対象は contract_status='active' かつ stripe_subscription_id が設定済みの会社のみ
// (無料利用・トライアル・停止中の会社には実際のStripeサブスクリプションが無いため何もしない)。
// 店舗数は毎回このDBから直接数え、company_id側に「現在の店舗数」を別途保持する列は
// 作らない(数え違い・ズレのリスクを避けるため常にライブ計算)。
//
// 日割り計算はStripe標準のproration機能にそのまま任せる(自前実装しない)。
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
  console.error(`[sync-store-billing-quantity] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

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

  let requestedCompanyId = "";
  try {
    const body = await req.json().catch(() => ({}));
    requestedCompanyId = String(body?.companyId || "").trim();
  } catch {
    // ボディ無し・空でも許容する(company_adminは常に自社が対象のため)。
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const priceAddonMonthly = Deno.env.get("STRIPE_PRICE_STORE_ADDON_MONTHLY");
  const priceAddonYearly = Deno.env.get("STRIPE_PRICE_STORE_ADDON_YEARLY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey || !priceAddonMonthly || !priceAddonYearly) {
    logStage("missing_server_config", {});
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
      .select("id, role, is_active, company_id")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active) {
      return json({ error: "権限がありません" }, 403);
    }

    // system_adminは任意の会社を指定できる。company_adminは常に自社固定
    // (クライアントから送られたcompanyIdは無視する——他社への操作を構造的に防ぐ)。
    let companyId = "";
    if (callerProfile.role === "system_admin") {
      companyId = requestedCompanyId;
      if (!companyId) return json({ error: "companyId は必須です" }, 400);
    } else if (callerProfile.role === "company_admin") {
      companyId = callerProfile.company_id || "";
    } else {
      return json({ error: "権限がありません" }, 403);
    }
    if (!companyId) return json({ error: "対象の会社が特定できません" }, 400);

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, contract_status, stripe_subscription_id, billing_interval")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) return json({ error: "対象の会社が見つかりません" }, 404);

    // 無料利用/トライアル/停止中の会社には実際のStripeサブスクリプションが無いため、
    // 何もせず正常終了する(要件: 無料利用中はStripe Subscriptionを必須にしない)。
    if (company.contract_status !== "active" || !company.stripe_subscription_id) {
      logStage("skip_not_active_subscription", { companyId, contractStatus: company.contract_status });
      return json({ ok: true, skipped: "not_active_subscription" });
    }

    const { count: storeCount, error: storeCountError } = await admin
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "active");
    if (storeCountError) throw storeCountError;
    const addonQuantity = Math.max((storeCount ?? 1) - 1, 0);

    const addonPriceId = company.billing_interval === "year" ? priceAddonYearly : priceAddonMonthly;

    const subscription = await stripeRequest(
      "GET",
      `subscriptions/${company.stripe_subscription_id}`,
      stripeSecretKey
    );
    const items = (subscription.items?.data || []) as Array<{ id: string; price?: { id?: string } }>;
    const existingAddonItem = items.find((item) => item.price?.id === priceAddonYearly || item.price?.id === priceAddonMonthly);

    if (addonQuantity === 0) {
      if (existingAddonItem) {
        await stripeRequest("POST", `subscriptions/${company.stripe_subscription_id}`, stripeSecretKey, {
          items: [{ id: existingAddonItem.id, deleted: true }],
          proration_behavior: "create_prorations",
        });
        logStage("addon_item_removed", { companyId });
      }
      return json({ ok: true, addonQuantity: 0 });
    }

    if (existingAddonItem) {
      await stripeRequest("POST", `subscriptions/${company.stripe_subscription_id}`, stripeSecretKey, {
        items: [{ id: existingAddonItem.id, price: addonPriceId, quantity: addonQuantity }],
        proration_behavior: "create_prorations",
      });
    } else {
      await stripeRequest("POST", `subscriptions/${company.stripe_subscription_id}`, stripeSecretKey, {
        items: [{ price: addonPriceId, quantity: addonQuantity }],
        proration_behavior: "create_prorations",
      });
    }

    logStage("addon_quantity_synced", { companyId, addonQuantity });
    return json({ ok: true, addonQuantity });
  } catch (error) {
    const message = error instanceof Error ? error.message : "店舗数の同期に失敗しました";
    logStage("unhandled_error", { message });
    return json({ error: message }, 500);
  }
});
