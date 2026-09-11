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
//     payment_status='past_due' という補助表示だけを更新する(2026-09-17、以前は
//     invoice.payment_failed/customer.subscription.updated(past_due)で異なる値'error'/
//     'processing'を使っており、どちらが後に届くかで意味の無い上書きが起きていたため統一)。
//     Stripeの再試行がすべて尽きてサブスクリプション自体が失効した
//     (customer.subscription.deleted、またはcustomer.subscription.updatedでstatusが
//     canceled/unpaidになった)場合にのみcontract_status='suspended'へ変更する。
//   - イベントの到着順が前後しても、古いイベントで最新状態を上書きしない(2026-09-17追加、
//     companies.last_billing_event_atとevent.createdを比較——詳細は下の該当コメント参照)。
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
import {
  type SubscriptionItem,
  summarizeSubscriptionItems,
  resolveNextBillingAtSeconds,
  shouldApplyInvoicePeriodToBilling,
  shouldSyncContractStatusToActive,
  shouldSyncContractStatusToTrial,
} from "./logic.ts";

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
  // テスト契約フロー(2026-09追加)からのイベントは、Stripeダッシュボードのテストモード側で
  // 別途登録したWebhookエンドポイント用の、ライブとは異なる署名シークレットで届く
  // (同じStripeアカウントでも、ライブ/テストのWebhook署名シークレットは常に別々)。
  // STRIPE_TEST_WEBHOOK_SECRETは任意——未設定でも本番のライブWebhook検証には一切影響しない。
  const webhookTestSecret = Deno.env.get("STRIPE_TEST_WEBHOOK_SECRET");
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
  // ライブ用シークレットで検証し、失敗した場合だけテスト用シークレット(設定されていれば)で
  // 再検証する——どちらのモードのイベントも同じエンドポイントURLで正しく受け付けられる
  // ようにするため(要件: WebhookもStripeテストモードのイベントを正しく受信できるようにする)。
  let isValid = await verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
  if (!isValid && webhookTestSecret) {
    isValid = await verifyStripeSignature(rawBody, signatureHeader, webhookTestSecret);
  }
  if (!isValid) {
    logStage("invalid_signature", { hasHeader: Boolean(signatureHeader) });
    return json({ error: "署名の検証に失敗しました" }, 400);
  }

  let event: { id?: string; type?: string; created?: number; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }

  const eventId = event.id || "";
  const eventType = event.type || "";
  const eventCreated = typeof event.created === "number" ? event.created : null;
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
      .select("id, contract_status, last_billing_event_at, contract_started_at")
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

    // イベントの到着順が前後しても、古いイベントで最新の契約状態を上書きしない(要件)。
    // Stripeは配信順を保証していない(再送・並列配信により、実際に発生した順序と違う順で
    // 届くことがあり得る)。contract_status/subscription_status/payment_statusという
    // 「状態機械」的なフィールドを書き込むイベント種別についてのみ、そのイベント自体が
    // Stripe側で発行された時刻(event.created)を、直近に反映した値(companies.
    // last_billing_event_at)と比較する——今回のイベントの方が古ければ適用せず、
    // 冪等性テーブルには既に記録済みのまま(=再送されても毎回この判定に来る)正常終了する。
    // checkout.session.completedはstripe_subscription_idの紐付けだけで状態を退行させ得ない
    // ため対象外。customer.subscription.trial_will_endはこの分岐へ来る前に既にreturn済み。
    const ORDER_SENSITIVE_EVENT_TYPES = new Set([
      "invoice.paid",
      "invoice.payment_failed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ]);
    if (
      ORDER_SENSITIVE_EVENT_TYPES.has(eventType) &&
      eventCreated !== null &&
      company.last_billing_event_at &&
      eventCreated * 1000 < new Date(company.last_billing_event_at).getTime()
    ) {
      logStage("stale_event_skipped", { eventId, eventType, eventCreated, lastBillingEventAt: company.last_billing_event_at });
      return json({ ok: true, skipped: "stale_event" });
    }

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { updated_at: nowIso };
    if (ORDER_SENSITIVE_EVENT_TYPES.has(eventType) && eventCreated !== null) {
      patch.last_billing_event_at = new Date(eventCreated * 1000).toISOString();
    }

    if (eventType === "checkout.session.completed") {
      // 決済完了の瞬間。実際の状態(status/期間/金額)はsubscription.created/updatedの方が
      // 正確なので、ここではsubscription_idの紐付けだけを確実にしておく
      // (subscription.createdが先に届いていた場合でも上書きで問題ない)。
      if (typeof object.subscription === "string") {
        patch.stripe_subscription_id = object.subscription;
      }
    } else if (eventType === "invoice.paid") {
      patch.payment_status = null;
      // 2026-09-11調査で発見した不具合の恒久対応: トライアル開始時、Stripeは実際の請求を
      // 伴わない$0の「初期インボイス」(billing_reason='subscription_create')を即座に
      // invoice.paidとして送ってくることがある。このインボイスのperiod_end/amount_paidは
      // 実際の請求サイクルを表さない(period_start=period_endのゼロ長期間になりうる)ため、
      // これでnext_billing_at/current_price_amountを上書きすると、次回請求予定日が
      // トライアル開始日時と同じ値になってしまう(実際に発生した不具合)。実際の請求サイクル
      // (トライアル終了後の初回請求以降)はStripeがbilling_reason='subscription_cycle'で
      // 送ってくるため、それ以外(subscription_create等)のインボイスではこの2列を
      // 更新しない——次回請求日は customer.subscription.created/updated 側の
      // current_period_end(トライアル中はtrial_end、下記参照)を正とする。
      const billingReason = typeof object.billing_reason === "string" ? object.billing_reason : null;
      if (shouldApplyInvoicePeriodToBilling(billingReason)) {
        if (typeof object.period_end === "number") {
          patch.next_billing_at = new Date(object.period_end * 1000).toISOString();
        }
        const amountPaid = object.amount_paid;
        if (typeof amountPaid === "number") {
          patch.current_price_amount = amountPaid;
        }
      }
    } else if (eventType === "invoice.payment_failed") {
      // 要件: 1回の失敗だけではcontract_statusを変更しない。補助表示のみ更新する。
      // 値はStripe自身の用語(past_due)に統一する(20260917000000参照——以前は'error'を
      // 使っており、ほぼ同時に届くcustomer.subscription.updated(status=past_due)側の
      // 'processing'と値が食い違い、どちらが後から届くかで意味の無い上書きが起きていた)。
      patch.payment_status = "past_due";
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
      // 次回請求予定日(2026-09-11調査で発見した不具合の恒久対応): トライアル中は
      // current_period_end(=通常trial_endと一致する)を正として使うが、current_period_end
      // が取得できない場合、またはcurrent_period_startと同一値(ゼロ長期間、実際に
      // 発生が確認された不正な値)の場合は、trial_start/trial_endのうちtrial_endを
      // 次回請求予定日として使う(要件: 取得できない場合はtrial_endを使用する)。
      // トライアル中でなければ従来通りcurrent_period_endをそのままnext_billing_atとして
      // 流用する(要件どおり、current_period_end専用の新しい列は追加しない)。
      const resolvedNextBillingAtSeconds = resolveNextBillingAtSeconds({
        subscriptionStatus,
        periodStartSeconds: resolvedPeriodStart,
        periodEndSeconds: resolvedPeriodEnd,
        trialEndSeconds: typeof object.trial_end === "number" ? object.trial_end : null,
      });
      if (resolvedNextBillingAtSeconds !== null) {
        patch.next_billing_at = new Date(resolvedNextBillingAtSeconds * 1000).toISOString();
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
        // invoice.payment_failedと同じ値('past_due')を使う(20260917000000参照)。
        patch.payment_status = "past_due";
      } else if (subscriptionStatus === "active" || subscriptionStatus === "trialing") {
        patch.payment_status = null;
        // free/trial/suspended中の会社がStripe側で実際に課金開始(active)になったら、
        // 当社側のcontract_statusもactiveへ同期する(要件: Checkout完了→契約中への移行、
        // および停止中会社の再契約——suspendedを含めないとTest 8「再契約」で実際に
        // 支払いが完了してもcontract_statusがsuspendedのまま取り残されてしまう)。
        if (shouldSyncContractStatusToActive({ subscriptionStatus, contractStatus: company.contract_status })) {
          patch.contract_status = "active";
          patch.contract_started_at = nowIso;
          patch.stopped_at = null;
          // トライアル/無料利用/停止中から実際に課金開始(Stripe側でactive)した時点で、
          // companies.planを実際の有料プラン名へ更新する(2026-09、契約フロー実機検証で
          // 発見: contract_statusはactiveへ正しく遷移するのに、planだけがself-signup時の
          // 'trial'のまま取り残されていた——現状はサロンマネージャー基本プランのみのため
          // 固定で'basic'とする。将来プランが複数になった場合はPrice IDから逆引きする形に
          // 拡張する)。
          patch.plan = "basic";
        } else if (
          shouldSyncContractStatusToTrial({
            subscriptionStatus,
            contractStatus: company.contract_status,
            contractStartedAt: company.contract_started_at,
          })
        ) {
          // 1か月無料トライアル開始(2026-09、要件4)。Checkout完了時点ではまだ課金
          // されていないため、contract_statusはactiveではなく「trial」に揃える
          // (アプリ側のアクセス制御はsuspended以外を等しく許可するため、trialのままで
          // 全機能が使える——要件どおり0円で全機能利用可能な状態になる)。
          //
          // 2026-09-11修正(恒久対応): 以前はこの分岐を「直前のcontract_statusがfree/
          // suspendedの場合だけ」に限定していたが、これだとcontract_status='active'が
          // 何らかの理由(system_admin側の手動設定等、実際の課金と無関係な過去のデータ)で
          // 既に入っている会社では、Stripe側が本物のtrialingでもcontract_statusが
          // 'active'のまま取り残され、DBの2つの状態列が矛盾する不具合があった(表示側は
          // deriveContractDisplayStatusがsubscription_status/trial_ends_atを優先して
          // 正しく表示していたが、保存状態そのものは矛盾したままだった)。
          //
          // 「解約・再登録での無料期間の再取得」を防ぐガードは、create-checkout-session側の
          // trial_end付与判定(company.contract_started_at===nullの会社にしかtrial_endを
          // 渡さない、かつstripe_subscription_idが既にある会社にも渡さない——後述)で
          // Stripeにtrialingを一切返させない形で既に一元化されているため、ここでは
          // 同じcontract_started_atだけを信頼する(1つの判定基準に統一、要件どおり
          // 新規フィールドは追加しない)。contract_started_atが一度でも設定されていれば
          // (=過去に実際の課金を開始したことがある会社であれば)、Stripeが万一trialingを
          // 返してきてもcontract_statusを'trial'へは書き換えない(defense-in-depth)。
          patch.contract_status = "trial";
          patch.stopped_at = null;
        }
        // Stripe側の実際のトライアル期間(trial_start/trial_end)をtrial_started_at/
        // trial_ends_atへ同期する(要件17: Stripeを正として同期する)。自己サインアップ時に
        // DB側だけで仮計算していた値(1か月・JST基準)を、実際にCheckoutで確定した
        // Stripeの値で上書きする——両者は同じ「1か月」ルールのため通常ほぼ一致するが、
        // Checkoutを開始したタイミングが会社作成日より後にずれる分だけStripeの値の方が
        // 正確になる。
        if (subscriptionStatus === "trialing") {
          if (typeof object.trial_end === "number") {
            patch.trial_ends_at = new Date(object.trial_end * 1000).toISOString();
          }
          if (typeof object.trial_start === "number") {
            patch.trial_started_at = new Date(object.trial_start * 1000).toISOString();
          }
        }
      } else if (subscriptionStatus === "canceled" || subscriptionStatus === "unpaid") {
        // Stripeの再試行がすべて尽きて最終的に失効した状態。ここで初めて停止中にする。
        // payment_statusは「まだ有効だが支払いに問題がある」ことを示す補助表示のため、
        // 完全に停止した後はnullへ戻す——停止中バナー(contract_status=suspended)が
        // 別途表示されるため、二重に古い警告を残さない。
        patch.contract_status = "suspended";
        patch.stopped_at = nowIso;
        patch.payment_status = null;
      }
    } else if (eventType === "customer.subscription.deleted") {
      patch.subscription_status = "canceled";
      patch.contract_status = "suspended";
      patch.stopped_at = nowIso;
      patch.cancel_at_period_end = false;
      patch.payment_status = null;
    } else if (eventType === "customer.subscription.trial_will_end") {
      // トライアル終了の3日前(Stripe既定)に届く通知イベント。現状サロンマネージャーには
      // メール送信基盤が無く、契約状態を書き換える必要も無いため(実際の状態遷移は
      // trial_end到達後にcustomer.subscription.updatedとして届く)、冪等性テーブルへの
      // 記録(=同一イベントの重複受信防止)だけを目的にここで正常受理する。DBは更新しない
      // ——companies.updateへ空のpatch(updated_atのみ)を送るのは無駄なため早期return。
      logStage("trial_will_end_received", { companyId: company.id });
      return json({ ok: true, acknowledged: "trial_will_end" });
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
