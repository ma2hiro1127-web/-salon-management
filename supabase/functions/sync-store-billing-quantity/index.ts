// 店舗数に応じた追加店舗Price(quantity)をStripeサブスクリプションへ同期する
// (2026-09-02、Stripe決済導入)。店舗の新規追加・アーカイブ・復元の直後にフロントから
// 呼ぶことを想定した小さな関数。
//
// 対象は stripe_subscription_id が設定済みで、かつStripe側の実サブスクリプション状態
// (subscription_status)が active/trialing/past_due のいずれかの会社のみ(無料利用・
// 停止中・解約済みの会社には実際のStripeサブスクリプションが無い/課金対象外のため
// 何もしない)。trialingを含めているのは、無料期間中の店舗追加でもStripeの数量は
// リアルタイムで正しく保つ必要があるため(要件5: 「無料期間だから追加店舗数を
// 記録しない」という実装は禁止)——trialing中はStripe側の請求額こそ0円だが、
// 数量そのものは常に最新の契約店舗数と一致させておく。
// 店舗数は毎回このDBから直接数え、company_id側に「現在の店舗数」を別途保持する列は
// 作らない(数え違い・ズレのリスクを避けるため常にライブ計算)。
//
// 日割り計算はStripe標準のproration機能にそのまま任せる(自前実装しない)。ただし
// 増量(店舗追加)と減量(店舗削減)でproration_behaviorを使い分ける(要件7/9):
// 増量は即座に日割り請求(create_prorations)、減量は返金・クレジットを一切発生させず
// 次回更新時に反映するだけ(none)。
//
// テスト契約会社(is_test_contract_run)はSTRIPE_TEST_*のキー・Price IDのみを使う
// (create-checkout-session/create-portal-sessionと同じTEST/LIVE分離方針)。
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
  params?: Record<string, unknown>,
  idempotencyKey?: string
) {
  const body = params ? toFormPairs(params).join("&") : undefined;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // Stripeは同一Idempotency-Keyに対する応答を24時間キャッシュする。店舗追加連打や
  // ネットワーク再試行で同じ「目的の数量への更新」が複数回送られても、Stripe側の
  // 数量が二重に増減しないようにするため(要件24「店舗追加を連打するとStripe数量だけ
  // 増える」「Webhook再送で追加店舗数量が増える」の防止)。呼び出し側で
  // 「会社+操作+最終的な目的の状態」から決まる安定したキーを渡す(ランダム生成しない)。
  if (method === "POST" && idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers,
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
  const stripeTestSecretKey = Deno.env.get("STRIPE_TEST_SECRET_KEY");
  const priceAddonMonthlyTest = Deno.env.get("STRIPE_TEST_PRICE_STORE_ADDON_MONTHLY");
  const priceAddonYearlyTest = Deno.env.get("STRIPE_TEST_PRICE_STORE_ADDON_YEARLY");
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

  // catch節(失敗時のbilling_sync_error記録)からも参照できるよう、tryブロックの
  // 外側で宣言する(let companyIdをtryの中で宣言すると、catch節のスコープからは
  // 見えなくなってしまうため)。
  let companyId = "";
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
      .select("id, contract_status, subscription_status, stripe_subscription_id, billing_interval, is_test_contract_run")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) return json({ error: "対象の会社が見つかりません" }, 404);

    // 実際にStripe上で数量同期が意味を持つのは、Stripeサブスクリプションが存在し、
    // かつその状態がactive/trialing/past_dueのいずれかの場合だけ(要件17: 判定は
    // Stripeの実状態=subscription_statusを正とする。contract_statusは「free」でも
    // 実はtrialing中、ということがあり得るため、ここではcontract_statusではなく
    // subscription_statusを見る)。canceled/unpaid/未契約の会社には何もしない。
    const syncableStatuses = new Set(["active", "trialing", "past_due"]);
    if (!company.stripe_subscription_id || !syncableStatuses.has(company.subscription_status || "")) {
      logStage("skip_not_syncable_subscription", {
        companyId,
        contractStatus: company.contract_status,
        subscriptionStatus: company.subscription_status,
      });
      return json({ ok: true, skipped: "not_syncable_subscription" });
    }

    const isTestContractRun = Boolean(company.is_test_contract_run);
    const effectiveSecretKey = isTestContractRun ? stripeTestSecretKey : stripeSecretKey;
    const effectivePriceAddonMonthly = isTestContractRun ? priceAddonMonthlyTest : priceAddonMonthly;
    const effectivePriceAddonYearly = isTestContractRun ? priceAddonYearlyTest : priceAddonYearly;
    if (!effectiveSecretKey || !effectivePriceAddonMonthly || !effectivePriceAddonYearly) {
      // テスト契約会社なのにSTRIPE_TEST_*が未設定 = 本番Priceへ誤って同期する事故を
      // 防ぐため、ここでは絶対にLIVE設定へフォールバックせず失敗させる。
      logStage("missing_test_mode_config", { companyId, isTestContractRun });
      return json({ error: "テストモード用のStripe設定が不足しています" }, 500);
    }

    const { count: storeCount, error: storeCountError } = await admin
      .from("stores")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "active");
    if (storeCountError) throw storeCountError;
    const addonQuantity = Math.max((storeCount ?? 1) - 1, 0);

    const addonPriceId = company.billing_interval === "year" ? effectivePriceAddonYearly : effectivePriceAddonMonthly;

    const subscription = await stripeRequest(
      "GET",
      `subscriptions/${company.stripe_subscription_id}`,
      effectiveSecretKey
    );
    const items = (subscription.items?.data || []) as Array<{ id: string; quantity?: number; price?: { id?: string } }>;
    const existingAddonItem = items.find(
      (item) => item.price?.id === effectivePriceAddonYearly || item.price?.id === effectivePriceAddonMonthly
    );
    const previousQuantity = existingAddonItem?.quantity ?? 0;
    // 増量(店舗追加)は即座に日割り請求、減量(店舗削減)は返金・クレジットを一切
    // 発生させず次回更新時に反映するだけ(要件7/9、要件24「店舗削減で意図しない
    // 返金が発生する」の防止)。数量が変わらない場合はどちらでも実質無風だが、
    // 安全側のnoneにしておく。
    const prorationBehavior = addonQuantity > previousQuantity ? "create_prorations" : "none";
    // 同一の「会社+この目的の数量」への更新はStripeのIdempotency-Keyで重複排除する
    // (要件24「店舗追加を連打するとStripe数量だけ増える」「Webhook再送で追加店舗
    // 数量が増える」対策)。数量が変われば別の正当な操作としてキーも変わる。
    const idempotencyKey = `sync-store-billing-${companyId}-${addonQuantity}`;

    if (addonQuantity === 0) {
      if (existingAddonItem) {
        await stripeRequest(
          "POST",
          `subscriptions/${company.stripe_subscription_id}`,
          effectiveSecretKey,
          {
            items: [{ id: existingAddonItem.id, deleted: true }],
            proration_behavior: "none",
          },
          idempotencyKey
        );
        logStage("addon_item_removed", { companyId });
      }
      // 成功した実際の店舗数を保存する(要件: トースト等の一時表示だけに頼らず、保存済みの
      // 状態から不一致を判定できるようにする)。失敗時の値は上書きしない(catch節参照)。
      await admin.from("companies").update({
        billing_synced_store_count: storeCount ?? 1,
        billing_sync_error: null,
        billing_sync_error_at: null,
      }).eq("id", companyId);
      return json({ ok: true, addonQuantity: 0 });
    }

    if (existingAddonItem) {
      if (existingAddonItem.price?.id !== addonPriceId || previousQuantity !== addonQuantity) {
        await stripeRequest(
          "POST",
          `subscriptions/${company.stripe_subscription_id}`,
          effectiveSecretKey,
          {
            items: [{ id: existingAddonItem.id, price: addonPriceId, quantity: addonQuantity }],
            proration_behavior: prorationBehavior,
          },
          idempotencyKey
        );
      }
    } else {
      await stripeRequest(
        "POST",
        `subscriptions/${company.stripe_subscription_id}`,
        effectiveSecretKey,
        {
          items: [{ price: addonPriceId, quantity: addonQuantity }],
          proration_behavior: "create_prorations",
        },
        idempotencyKey
      );
    }

    // 成功した実際の店舗数を保存する(上と同じ理由)。billing_synced_store_countは
    // 「最後にStripeへ実際に反映した課金対象店舗数」——これと現在の実店舗数
    // (billableStoreCount、フロント側で常にDBから即時計算)を比較するだけで、
    // 画面を開いた瞬間の状態に関わらず不一致を検知できる(要件17と同じ「Stripeを正として
    // 同期する」考え方を、今度はフロント表示側の判定にも適用する)。
    const { error: updateSyncStateError } = await admin.from("companies").update({
      billing_synced_store_count: storeCount ?? 1,
      billing_sync_error: null,
      billing_sync_error_at: null,
    }).eq("id", companyId);
    if (updateSyncStateError) throw updateSyncStateError;

    logStage("addon_quantity_synced", { companyId, addonQuantity, prorationBehavior });
    return json({ ok: true, addonQuantity });
  } catch (error) {
    const message = error instanceof Error ? error.message : "店舗数の同期に失敗しました";
    logStage("unhandled_error", { message });
    // 失敗時はbilling_synced_store_countを更新しない——現在の実店舗数との不一致が
    // そのまま残り、フロント側の永続的な警告表示(トーストではない)がずっと出続ける
    // ようにする(要件: 同期が直るまで警告が消えない/再ログイン・画面更新後も残る)。
    // companyIdが特定できている場合だけ記録する(認証・権限チェック前に失敗した場合は
    // 対象会社が不明なため記録しない)。
    if (typeof companyId === "string" && companyId) {
      await admin.from("companies").update({
        billing_sync_error: message.slice(0, 500),
        billing_sync_error_at: new Date().toISOString(),
      }).eq("id", companyId).then(() => {}, () => {});
    }
    return json({ error: message }, 500);
  }
});
