// Stripe Customer Portal Sessionの作成(2026-09-02、Stripe決済導入)。company_admin限定。
//
// 契約者本人がカード変更・支払い方法変更・契約状況確認・解約予約を行えるように、
// Stripeがホストする管理画面(Customer Portal)への一時セッションURLを発行するだけの関数。
// カード変更・解約等の決済管理画面をサロンマネージャー側で自作しない、という要件のとおり、
// この関数自体は「company_idを解決してStripeにセッションを発行してもらう」以上のことはしない。
//
// 重要な設計方針(要件どおり):
//   - company_idはリクエストボディで受け取らない。呼び出し元のJWTから解決したprofileの
//     company_idだけを使う。
//   - リクエストボディでcustomer_id/subscription_idを受け取れる項目自体を作らない
//     ——他社のCustomer/Subscriptionを指定して操作することが構造的に不可能な設計。
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
  console.error(`[create-portal-session] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

function toFormPairs(params: Record<string, unknown>, prefix = ""): string[] {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object" && !Array.isArray(value)) {
      pairs.push(...toFormPairs(value as Record<string, unknown>, fullKey));
    } else {
      pairs.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs;
}

async function stripeRequest(path: string, secretKey: string, params: Record<string, unknown>) {
  const body = toFormPairs(params).join("&");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const appUrl = Deno.env.get("APP_URL");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey || !appUrl) {
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
    if (!callerProfile || !callerProfile.is_active || callerProfile.role !== "company_admin" || !callerProfile.company_id) {
      return json({ error: "支払い管理は会社管理者(company_admin)のみ実行できます" }, 403);
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, stripe_customer_id")
      .eq("id", callerProfile.company_id)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company?.stripe_customer_id) {
      return json({ error: "この会社はまだStripeでの契約が開始されていません" }, 409);
    }

    const session = await stripeRequest("billing_portal/sessions", stripeSecretKey, {
      customer: company.stripe_customer_id,
      return_url: `${appUrl}/`,
    });

    logStage("portal_session_created", { companyId: company.id });
    return json({ ok: true, url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Customer Portal Sessionの作成に失敗しました";
    logStage("unhandled_error", { message });
    return json({ error: message }, 500);
  }
});
