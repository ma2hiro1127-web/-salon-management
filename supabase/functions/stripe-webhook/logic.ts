// stripe-webhook/index.tsから使う純粋関数(副作用なし)だけを切り出したモジュール。
// index.test.tsから直接importしてテストするためにファイルを分けている——index.ts自体は
// Deno.serve(...)をトップレベルで呼ぶため、テストファイルからそのままimportすると
// (Supabase Edge Runtime外の)ポート待受という副作用が発生してしまうのを避ける。
// このリポジトリの「Edge Functionは関数間でモジュールを共有しない」規約は維持したまま
// (このファイルはstripe-webhook関数の中だけで完結し、他の関数からはimportしない)。

export type SubscriptionItem = {
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
export function summarizeSubscriptionItems(items: SubscriptionItem[] | undefined) {
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

// 次回請求予定日(next_billing_at)の解決ロジック(2026-09-11、不具合の恒久対応)。
// トライアル中はcurrent_period_end(=通常trial_endと一致する)を正として使うが、
// current_period_endが取得できない、またはcurrent_period_startと同一値(ゼロ長期間、
// 実際に発生が確認された不正な値——トライアル開始時にStripeが送ってくる$0の初期インボイス
// 起因の値がここに紛れ込むケースがある)の場合は、trial_endを正として使う
// (trial_started_atが誤ってnext_billing_atへ保存される不具合の恒久対応)。
// トライアル中でなければcurrent_period_endをそのまま採用する(取得できなければnullを返す
// = 呼び出し側でpatchに含めない=既存値を変更しない)。
export function resolveNextBillingAtSeconds(params: {
  subscriptionStatus: string | null;
  periodStartSeconds: number | null;
  periodEndSeconds: number | null;
  trialEndSeconds: number | null;
}): number | null {
  const { subscriptionStatus, periodStartSeconds, periodEndSeconds, trialEndSeconds } = params;
  if (subscriptionStatus === "trialing") {
    const periodEndLooksInvalid =
      periodEndSeconds === null || (periodStartSeconds !== null && periodEndSeconds === periodStartSeconds);
    if (!periodEndLooksInvalid) return periodEndSeconds;
    return trialEndSeconds;
  }
  return periodEndSeconds;
}

// invoice.paidイベントのperiod_end/amount_paidをnext_billing_at/current_price_amountへ
// 反映して良いかどうか。billing_reason='subscription_create'(トライアル開始時などに
// 送られる、実際の請求サイクルを表さない$0の初期インボイス)は対象外にする。
// billing_reasonが取得できない(未知の値・欠落)場合は、従来どおり反映する
// (fail-open——不明な値のたびにnext_billing_atが永久に更新されなくなる方が実害が大きい)。
export function shouldApplyInvoicePeriodToBilling(billingReason: string | null): boolean {
  return billingReason !== "subscription_create";
}

// トライアル中(subscriptionStatus='trialing')のcustomer.subscription.*イベントを受けて、
// contract_statusを'trial'へ同期して良いかどうか。「解約・再登録での無料期間の再取得防止」は
// create-checkout-session側のtrial_end付与判定(isEligibleForFreeTrial、同じ
// contract_started_at/stripe_subscription_idを見る)でStripeにtrialingを一切返させない形で
// 一元化されているため、ここではcontractStartedAtだけを信頼する——一度でも設定されていれば
// (過去に実際の課金を開始したことがあれば)、Stripeが万一trialingを返してきても
// contract_statusを'trial'へは書き換えない(defense-in-depth)。既にcontract_status='trial'
// の場合は無駄な書き込みを避けるためfalseを返す(冪等性)。
export function shouldSyncContractStatusToTrial(params: {
  subscriptionStatus: string | null;
  contractStatus: string | null;
  contractStartedAt: string | null;
}): boolean {
  const { subscriptionStatus, contractStatus, contractStartedAt } = params;
  return subscriptionStatus === "trialing" && contractStatus !== "trial" && !contractStartedAt;
}
