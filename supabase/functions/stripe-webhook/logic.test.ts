// stripe-webhook/logic.tsの純粋関数のテスト。`npx -y deno test supabase/functions/stripe-webhook/logic.test.ts`
// で実行する(このリポジトリのnpm testはNode.js側のsrc/utils/*.test.jsのみを対象とする
// 既存規約のため、Edge Function側はdeno checkと同じくDenoで別途検証する)。
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveNextBillingAtSeconds,
  shouldApplyInvoicePeriodToBilling,
  shouldSyncContractStatusToTrial,
  summarizeSubscriptionItems,
} from "./logic.ts";

// --- resolveNextBillingAtSeconds -------------------------------------------------

Deno.test("トライアル中: current_period_endが正常な値ならそれを採用する", () => {
  const result = resolveNextBillingAtSeconds({
    subscriptionStatus: "trialing",
    periodStartSeconds: 1000,
    periodEndSeconds: 5000, // trial_endと一致する想定の正常値
    trialEndSeconds: 5000,
  });
  assertEquals(result, 5000);
});

Deno.test("トライアル中: current_period_endがcurrent_period_startと同一(ゼロ長・不正値)ならtrial_endを使う(今回の不具合の再現テスト)", () => {
  const result = resolveNextBillingAtSeconds({
    subscriptionStatus: "trialing",
    periodStartSeconds: 1000,
    periodEndSeconds: 1000, // trial_started_atと同一になっていた実際の不具合を再現
    trialEndSeconds: 9999,
  });
  assertEquals(result, 9999);
  // trial_started_at(period_start)がnext_billing_atへ保存されないことを明示的に確認する
  assertEquals(result === 1000, false);
});

Deno.test("トライアル中: current_period_endが取得できない場合はtrial_endを使う", () => {
  const result = resolveNextBillingAtSeconds({
    subscriptionStatus: "trialing",
    periodStartSeconds: 1000,
    periodEndSeconds: null,
    trialEndSeconds: 9999,
  });
  assertEquals(result, 9999);
});

Deno.test("トライアル中: next_billing_atがtrial_end以前の不正な日時にならない(period_endが不正でtrial_endも無ければnull=変更しない)", () => {
  const result = resolveNextBillingAtSeconds({
    subscriptionStatus: "trialing",
    periodStartSeconds: 1000,
    periodEndSeconds: 1000,
    trialEndSeconds: null,
  });
  assertEquals(result, null);
});

Deno.test("契約中(トライアルでない): current_period_endをそのまま採用する", () => {
  const result = resolveNextBillingAtSeconds({
    subscriptionStatus: "active",
    periodStartSeconds: 1000,
    periodEndSeconds: 1000, // 契約中はperiod_start===period_endでも(理論上あり得なくても)無条件でそのまま使う
    trialEndSeconds: null,
  });
  assertEquals(result, 1000);
});

// --- shouldApplyInvoicePeriodToBilling --------------------------------------------

Deno.test("invoice.paid: billing_reason=subscription_createの$0初期インボイスはnext_billing_atを更新しない", () => {
  assertEquals(shouldApplyInvoicePeriodToBilling("subscription_create"), false);
});

Deno.test("invoice.paid: billing_reason=subscription_cycle(実際の請求サイクル)は更新する", () => {
  assertEquals(shouldApplyInvoicePeriodToBilling("subscription_cycle"), true);
});

Deno.test("invoice.paid: billing_reasonが取得できない場合はfail-openで更新する", () => {
  assertEquals(shouldApplyInvoicePeriodToBilling(null), true);
});

// --- shouldSyncContractStatusToTrial ----------------------------------------------

Deno.test("Stripeがtrialingの場合、DBと表示が矛盾しない: contract_status='active'(過去のcontract_started_atなし)でも'trial'へ同期する(根本原因の再現テスト)", () => {
  const result = shouldSyncContractStatusToTrial({
    subscriptionStatus: "trialing",
    contractStatus: "active",
    contractStartedAt: null,
  });
  assertEquals(result, true);
});

Deno.test("無料期間終了後の決済成功でcontract_status='active'になるべきケースでは、その後trialingが来ても再度trialへ戻さない(解約後の再登録で無料期間を再取得できない)", () => {
  const result = shouldSyncContractStatusToTrial({
    subscriptionStatus: "trialing",
    contractStatus: "active",
    contractStartedAt: "2026-01-01T00:00:00.000Z", // 過去に一度課金開始した実績がある
  });
  assertEquals(result, false);
});

Deno.test("free状態の会社がtrialingになったら同期する", () => {
  const result = shouldSyncContractStatusToTrial({
    subscriptionStatus: "trialing",
    contractStatus: "free",
    contractStartedAt: null,
  });
  assertEquals(result, true);
});

Deno.test("suspended状態の会社が(一度も課金開始せず)trialingになったら同期する", () => {
  const result = shouldSyncContractStatusToTrial({
    subscriptionStatus: "trialing",
    contractStatus: "suspended",
    contractStartedAt: null,
  });
  assertEquals(result, true);
});

Deno.test("既にtrialの場合は冪等性のため書き込み不要(false)", () => {
  const result = shouldSyncContractStatusToTrial({
    subscriptionStatus: "trialing",
    contractStatus: "trial",
    contractStartedAt: null,
  });
  assertEquals(result, false);
});

Deno.test("subscriptionStatusがactiveの場合は対象外(false)", () => {
  const result = shouldSyncContractStatusToTrial({
    subscriptionStatus: "active",
    contractStatus: "free",
    contractStartedAt: null,
  });
  assertEquals(result, false);
});

// --- summarizeSubscriptionItems(既存ロジック、切り出しに伴う回帰確認) -------------

Deno.test("summarizeSubscriptionItems: 基本プラン+追加店舗の2アイテムを正しく集計する", () => {
  const result = summarizeSubscriptionItems([
    { quantity: 1, price: { id: "price_base", unit_amount: 148000, recurring: { interval: "month" } }, current_period_start: 100, current_period_end: 200 },
    { quantity: 1, price: { id: "price_addon", unit_amount: 48000, recurring: { interval: "month" } } },
  ]);
  assertEquals(result.totalAmount, 196000);
  assertEquals(result.interval, "month");
  assertEquals(result.basePriceId, "price_base");
  assertEquals(result.currentPeriodStart, 100);
  assertEquals(result.currentPeriodEnd, 200);
});

Deno.test("summarizeSubscriptionItems: itemsが空の場合はすべてnull", () => {
  const result = summarizeSubscriptionItems([]);
  assertEquals(result.totalAmount, null);
  assertEquals(result.currentPeriodEnd, null);
});
