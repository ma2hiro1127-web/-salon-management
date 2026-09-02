// Stripe Webhook受信エンドポイント(2026-09-02新設、2026-09-02のStripe決済導入で拡張)。
//
// このリポジトリには実際のStripeキーが無く、Stripe SDKのDeno/ESM上での動作をこの環境では
// 検証できないため、他のEdge Function群と同じく外部SDKに依存せず、Stripeが公開している
// 署名検証アルゴリズム(HMAC-SHA256、Stripe-Signatureヘッダーのt=/v1=)をWeb Crypto APIで
// 自前実装している。https://docs.stripe.com/webhooks#verify-manually 参照。
//
// 対応イベント: checkout.session.completed, customer.subscription.created/updated/deleted,
// invoice.paid, invoice.payment_failed。companies.stripe_customer_id で対象会社を特定し、
// サービスロールで companies の契約関連カラムを更新する。
//
// 冪等性: 処理の最初にstripe_webhook_events(stripe_event_id primary key)へINSERTし、
// 競合(=既に処理済み)なら即200を返して終了する。同じイベントが複数回届いても
// 二重処理されないことをDBのUNIQUE制約そのもので保証する(アプリ側ロジックに頼らない)。
//
// 重要な設計方針(要件どおり):
//   - 1回の支払い失敗(invoice.payment_failed)だけではcontract_statusをsuspendedにしない。
//     payment_status='error' という補助表示だけを更新する。Stripeの再試行がすべて尽きて
//     サブスクリプション自体が失効した(customer.subscription.deleted、または
//     customer.subscription.updatedでstatusがcanceled/unpaidになった)場合にのみ
//     contract_status='suspended'へ変更する。
//   - 「無料利用」はStripeのSubscriptionを前提にしない当社独自の状態のため、このWebhookは
//     free状態の会社には一切影響しない(stripe_customer_idが無ければ対象会社を特定できず
//     何もしない)。
//   - metadata.company_idだけを唯一の認証根拠にはしない。対象会社はあくまで
//     stripe_customer_id(companiesテーブルに保存済みの値)で検索する。metadataの
//     company_idが付いているイベントについては、検索結果との一致を追加でチェックし、
//     食い違っていればエラーとして処理を中断する(Stripe側とDB側の食い違いを検知する保険)。
//
// 未知のstripe_customer_id(該当会社が見つからない)の場合はログのみ出して200を返す
// (Stripe側の再送ループを防ぐ——エラーで返すとStripeが同じイベントを延々再送してしまう)。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function logStage(stage: string, detail: Record<string, unknown>) {
  console.error(`[stripe-webhook] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

// Stripeの署名タイムスタンプがこの秒数より古い場合はリプレイ攻撃とみなして拒否する。
const TOLERANCE_SECONDS = 5 * 60;

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Stripe-Signatureヘッダー(例: "t=1690000000,v1=abcdef...,v1=fedcba...")を検証する。
// v1が複数あるのはWebhookシークレットのローテーション中に両方が有効なケースに対応するため
// (Stripeの仕様どおり、いずれか1つでも一致すればOK)。
async function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string): Promise<boolean> {
  const parts = signatureHeader.split(",").map((p) => p.trim());
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const v1Parts = parts.filter((p) => p.startsWith("v1="));
  if (!timestampPart || v1Parts.length === 0) return false;

  const timestamp = timestampPart.slice(2);
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > TOLERANCE_SECONDS) return false;

  const expectedSignature = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return v1Parts.some((p) => p.slice(3) === expectedSignature);
}

type SubscriptionItem = {
  quantity?: number;
  price?: { id?: string; unit_amount?: number; recurring?: { interval?: string } };
  // Stripe APIバージョン2026-08-26以降、current_period_start/endはSubscription
  // オブジェクト直下ではなく各Subscription Item側に付与される形に変わっている
  // (複数アイテムがそれぞれ異なる請求周期を持てるようにするための変更と見られる)。
  // 本アプリの構成では全アイテムが同じ周期のため、items[0]の値をそのまま採用する。
  current_period_start?: number;
  current_period_end?: number;
};

// サブスクリプションのitems配列(基本プラン+追加店舗の2アイテム構成を想定)から、
// 表示用の合計金額・請求周期・基本プランのPrice ID・現在の請求期間をまとめて取り出す。
function summarizeSubscriptionItems(items: SubscriptionItem[] | undefined) {
  if (!items || items.length === 0) {
    return { totalAmount: null, interval: null, basePriceId: null, currentPeriodStart: null, currentPeriodEnd: null };
  }
  let totalAmount = 0;
  let interval: string | null = null;
  let basePriceId: string | null = null;
  let currentPeriodStart: number | null = null;
  let currentPeriodEnd: number | null = null;
  for (const item of items) {
    const unitAmount = item.price?.unit_amount ?? 0;
    const quantity = item.quantity ?? 1;
    totalAmount += unitAmount * quantity;
    if (!interval && item.price?.recurring?.interval) interval = item.price.recurring.interval;
    // quantity=1のアイテムを「基本プラン」とみなす(追加店舗アイテムは通常quantityが
    // 店舗数-1で1以外になりうるため、この単純な判定で十分実用的)。
    if (!basePriceId && quantity === 1 && item.price?.id) basePriceId = item.price.id;
    if (currentPeriodStart === null && typeof item.current_period_start === "number") {
      currentPeriodStart = item.current_period_start;
    }
    if (currentPeriodEnd === null && typeof item.current_period_end === "number") {
      currentPeriodEnd = item.current_period_end;
    }
  }
  if (!basePriceId && items[0]?.price?.id) basePriceId = items[0].price.id;
  return { totalAmount, interval, basePriceId, currentPeriodStart, currentPeriodEnd };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    logStage("missing_server_config", {});
    return json({ error: "サーバー設定が不足しています" }, 500);
  }

  // 署名検証には生のリクエストボディ(JSON.parse前のテキスト)が必須
  // (1文字でも再シリアライズでずれると署名が一致しなくなるため)。
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("stripe-signature") || "";
  const isValid = await verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
  if (!isValid) {
    logStage("invalid_signature", { hasHeader: Boolean(signatureHeader) });
    return json({ error: "署名の検証に失敗しました" }, 400);
  }

  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }

  const eventId = event.id || "";
  const eventType = event.type || "";
  const object = event.data?.object || {};
  logStage("event_received", { eventId, eventType });

  if (!eventId) {
    return json({ error: "event.id がありません" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // customer.subscription.* / invoice.* / checkout.session.* いずれもobject.customerに
  // Stripe顧客IDが入る。
  const stripeCustomerId = typeof object.customer === "string" ? object.customer : "";

  try {
    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, contract_status")
      .eq("stripe_customer_id", stripeCustomerId || "__none__")
      .maybeSingle();
    if (companyError) throw companyError;

    // 冪等性チェック: 既に処理済みのevent.idならここで即終了する
    // (companyが見つからない場合の分岐より前に置くと、未知の顧客IDのイベントを
    // 毎回同じ理由で無駄にログし続けてしまうため、company特定の後に行う)。
    const { error: insertEventError } = await admin
      .from("stripe_webhook_events")
      .insert({ stripe_event_id: eventId, event_type: eventType, company_id: company?.id ?? null });
    if (insertEventError) {
      // unique制約違反(23505) = 既に処理済み。それ以外のエラーは本物の異常として投げる。
      if ((insertEventError as { code?: string }).code === "23505") {
        logStage("duplicate_event_skipped", { eventId, eventType });
        return json({ ok: true, skipped: "duplicate_event" });
      }
      throw insertEventError;
    }

    if (!stripeCustomerId) {
      logStage("no_customer_id", { eventType });
      return json({ ok: true, skipped: "no_customer_id" });
    }
    if (!company) {
      // 未知の顧客ID。この会社はまだstripe_customer_idが紐付けられていない可能性が高い。
      // エラーにするとStripeが再送し続けるため200で正常終了する。
      logStage("company_not_found", { stripeCustomerId, eventType });
      return json({ ok: true, skipped: "company_not_found" });
    }

    // metadata.company_idが付いているイベントは、DB側の検索結果と突合する
    // (metadataだけを唯一の認証根拠にしない、要件どおりの保険的チェック)。
    const metadata = (object.metadata as Record<string, unknown> | undefined) || {};
    const metadataCompanyId = typeof metadata.company_id === "string" ? metadata.company_id : "";
    if (metadataCompanyId && metadataCompanyId !== company.id) {
      logStage("metadata_company_mismatch", { eventId, eventType, metadataCompanyId, resolvedCompanyId: company.id });
      // 冪等性テーブルへは既に「処理済み」として記録してしまっているが、これは実際には
      // 処理できず拒否したイベントのため、その記録を取り消す。ここで記録を残したままだと、
      // Stripeがこのイベントを再送してきた際(4xx/5xxはStripeの再試行対象)、2回目以降は
      // 「重複だからスキップ」という扱いになり、本来検知したい整合性エラーが再送のたびに
      // 揉み消されてしまう(調査・アラートの機会を失う)ため。
      await admin.from("stripe_webhook_events").delete().eq("stripe_event_id", eventId);
      return json({ error: "会社IDの整合性チェックに失敗しました" }, 409);
    }

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { updated_at: nowIso };

    if (eventType === "checkout.session.completed") {
      // 決済完了の瞬間。実際の状態(status/期間/金額)はsubscription.created/updatedの方が
      // 正確なので、ここではsubscription_idの紐付けだけを確実にしておく
      // (subscription.createdが先に届いていた場合でも上書きで問題ない)。
      if (typeof object.subscription === "string") {
        patch.stripe_subscription_id = object.subscription;
      }
    } else if (eventType === "invoice.paid") {
      patch.payment_status = null;
      if (typeof object.period_end === "number") {
        patch.next_billing_at = new Date(object.period_end * 1000).toISOString();
      }
      const amountPaid = object.amount_paid;
      if (typeof amountPaid === "number") {
        patch.current_price_amount = amountPaid;
      }
    } else if (eventType === "invoice.payment_failed") {
      // 要件: 1回の失敗だけではcontract_statusを変更しない。補助表示のみ更新する。
      patch.payment_status = "error";
    } else if (eventType === "customer.subscription.created" || eventType === "customer.subscription.updated") {
      const subscriptionStatus = typeof object.status === "string" ? object.status : null;
      patch.subscription_status = subscriptionStatus;
      if (typeof object.id === "string") {
        patch.stripe_subscription_id = object.id;
      }
      const items = (object.items as { data?: SubscriptionItem[] } | undefined)?.data;
      const { totalAmount, interval, basePriceId, currentPeriodStart, currentPeriodEnd } =
        summarizeSubscriptionItems(items);
      if (totalAmount !== null) patch.current_price_amount = totalAmount;
      if (interval === "month" || interval === "year") patch.billing_interval = interval;
      if (basePriceId) patch.current_price_id = basePriceId;

      // current_period_start/endは、Stripe APIバージョン2026-08-26以降ではSubscription
      // 直下ではなく各Itemに付与される形に変わっている。Item側に無ければ(古いAPI
      // バージョンのアカウント向け)Subscription直下の値にフォールバックする。
      const resolvedPeriodStart =
        currentPeriodStart ?? (typeof object.current_period_start === "number" ? object.current_period_start : null);
      const resolvedPeriodEnd =
        currentPeriodEnd ?? (typeof object.current_period_end === "number" ? object.current_period_end : null);
      if (resolvedPeriodStart !== null) {
        patch.current_period_start = new Date(resolvedPeriodStart * 1000).toISOString();
      }
      if (resolvedPeriodEnd !== null) {
        // next_billing_atをcurrent_period_endとしてそのまま流用する(要件どおり、
        // current_period_end専用の新しい列は追加しない)。
        patch.next_billing_at = new Date(resolvedPeriodEnd * 1000).toISOString();
      }

      // Stripeの新しめのAPIバージョン(2026-08-26以降で確認)では、Customer Portalから
      // 「期間終了時に解約」を予約した場合、`cancel_at_period_end`は常にfalseのままで、
      // 代わりに`cancel_at`(タイムスタンプ)が現在の請求期間終了日時と同じ値に設定される
      // 形で表現される。旧仕様の`cancel_at_period_end: true`も引き続き来うるため、
      // どちらの表現でも解約予約中として検知できるようにする。
      if (typeof object.cancel_at_period_end === "boolean") {
        let cancelAtPeriodEnd = object.cancel_at_period_end;
        if (
          !cancelAtPeriodEnd &&
          typeof object.cancel_at === "number" &&
          resolvedPeriodEnd !== null &&
          object.cancel_at === resolvedPeriodEnd
        ) {
          cancelAtPeriodEnd = true;
        }
        patch.cancel_at_period_end = cancelAtPeriodEnd;
      }

      if (subscriptionStatus === "past_due") {
        // Stripeの再試行期間中(要件: 支払い確認中の補助表示)。まだ失効ではない。
        patch.payment_status = "processing";
      } else if (subscriptionStatus === "active" || subscriptionStatus === "trialing") {
        patch.payment_status = null;
        // free/trial中の会社がStripe側で実際に課金開始(active)になったら、
        // 当社側のcontract_statusもactiveへ同期する(要件: Checkout完了→契約中への移行)。
        if (subscriptionStatus === "active" && (company.contract_status === "trial" || company.contract_status === "free")) {
          patch.contract_status = "active";
          patch.contract_started_at = nowIso;
        }
      } else if (subscriptionStatus === "canceled" || subscriptionStatus === "unpaid") {
        // Stripeの再試行がすべて尽きて最終的に失効した状態。ここで初めて停止中にする。
        patch.contract_status = "suspended";
        patch.stopped_at = nowIso;
        patch.payment_status = "error";
      }
    } else if (eventType === "customer.subscription.deleted") {
      patch.subscription_status = "canceled";
      patch.contract_status = "suspended";
      patch.stopped_at = nowIso;
      patch.cancel_at_period_end = false;
    } else {
      logStage("unhandled_event_type", { eventType });
      return json({ ok: true, skipped: "unhandled_event_type" });
    }

    const { error: updateError } = await admin.from("companies").update(patch).eq("id", company.id);
    if (updateError) throw updateError;

    logStage("company_updated", { companyId: company.id, eventType, patchKeys: Object.keys(patch) });
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook処理に失敗しました";
    logStage("unhandled_error", { eventType, message });
    // 冪等性テーブルへの記録(あれば)を取り消す——一時的な不具合で処理に失敗したイベントを
    // 「処理済み」のままにしてしまうと、Stripeの再試行が来ても常に「重複だからスキップ」
    // されてしまい、実際には一度も正常に反映されないまま埋もれてしまうため。
    // (削除自体が失敗しても、本来のエラーの方を優先して返す——ここは握りつぶす。)
    if (eventId) {
      await admin.from("stripe_webhook_events").delete().eq("stripe_event_id", eventId).then(
        () => {},
        () => {}
      );
    }
    // Stripeに再送してもらいたいので5xxを返す(署名検証済みの正規のイベントで、
    // こちら側の一時的な不具合の可能性があるため)。
    return json({ error: message }, 500);
  }
});
