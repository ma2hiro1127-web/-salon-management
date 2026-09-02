// Stripe Webhook受信エンドポイント(2026-09-02、契約管理の拡張の一部)。
//
// このリポジトリには実際のStripeキーが無く、Stripe SDKのDeno/ESM上での動作をこの環境では
// 検証できないため、他のEdge Function群と同じく外部SDKに依存せず、Stripeが公開している
// 署名検証アルゴリズム(HMAC-SHA256、Stripe-Signatureヘッダーのt=/v1=)をWeb Crypto APIで
// 自前実装している。https://docs.stripe.com/webhooks#verify-manually 参照。
//
// 対応イベント: customer.subscription.created/updated/deleted, invoice.paid,
// invoice.payment_failed。companies.stripe_customer_id で対象会社を特定し、サービスロールで
// companies の契約関連カラムを更新する。
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

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }

  const eventType = event.type || "";
  const object = event.data?.object || {};
  logStage("event_received", { eventType });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // customer.subscription.* はobject.customer、invoice.* もobject.customerにStripe顧客IDが入る。
  const stripeCustomerId = typeof object.customer === "string" ? object.customer : "";
  if (!stripeCustomerId) {
    logStage("no_customer_id", { eventType });
    return json({ ok: true, skipped: "no_customer_id" });
  }

  try {
    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, contract_status")
      .eq("stripe_customer_id", stripeCustomerId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) {
      // 未知の顧客ID。この会社はまだstripe_customer_idが会社編集画面から紐付けられて
      // いない可能性が高い。エラーにするとStripeが再送し続けるため200で正常終了する。
      logStage("company_not_found", { stripeCustomerId, eventType });
      return json({ ok: true, skipped: "company_not_found" });
    }

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { updated_at: nowIso };

    if (eventType === "invoice.paid") {
      patch.payment_status = null;
      if (typeof object.next_payment_attempt === "number") {
        patch.next_billing_at = new Date(object.next_payment_attempt * 1000).toISOString();
      } else if (typeof object.period_end === "number") {
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
      const items = object.items as { data?: Array<{ price?: { id?: string; unit_amount?: number } }> } | undefined;
      const firstItem = items?.data?.[0];
      if (firstItem?.price?.id) {
        patch.current_price_id = firstItem.price.id;
      }
      if (typeof firstItem?.price?.unit_amount === "number") {
        patch.current_price_amount = firstItem.price.unit_amount;
      }
      if (typeof object.current_period_end === "number") {
        patch.next_billing_at = new Date(object.current_period_end * 1000).toISOString();
      }

      if (subscriptionStatus === "past_due") {
        // Stripeの再試行期間中(要件: 支払い確認中の補助表示)。まだ失効ではない。
        patch.payment_status = "processing";
      } else if (subscriptionStatus === "active") {
        patch.payment_status = null;
        // トライアル中の会社がStripe側で実際に課金開始(active)になったら、
        // 当社側のcontract_statusもtrial→activeへ同期する(要件: トライアル→契約中の移行)。
        if (company.contract_status === "trial") {
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
    // Stripeに再送してもらいたいので5xxを返す(署名検証済みの正規のイベントで、
    // こちら側の一時的な不具合の可能性があるため)。
    return json({ error: message }, 500);
  }
});
