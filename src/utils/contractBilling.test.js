import { test } from "node:test";
import assert from "node:assert/strict";
import {
  previewBillingStartDateFromChange,
  previewTrialEndDate,
  previewBillingStart,
  formatUsageDuration,
  formatRemainingLabel,
  formatDateLabel,
  formatYenOrEmpty,
  deriveContractDisplayStatus,
  isActiveLikeContractStatusKey,
} from "./contractBilling.js";

// previewBillingStartDateFromChange: 「変更した月の翌月1日」(JST基準)。
// supabase側のcompute_billing_start_date()と同じルールであることをコメントで明記している
// (実際の保存値はDB関数側が計算するため、ここではプレビュー計算の正しさだけを確認する)。
test("previewBillingStartDateFromChange: 月の途中で変更 → 翌月1日", () => {
  // 2026-09-15 12:00 JST(=03:00 UTC)に変更 → 2026-10-01
  const changeAt = new Date("2026-09-15T03:00:00.000Z");
  const result = previewBillingStartDateFromChange(changeAt);
  assert.equal(formatDateLabel(result), "2026/10/1");
});

test("previewBillingStartDateFromChange: 月初(1日)ちょうどに変更しても、その月ではなく翌月の1日になる", () => {
  // 2026-10-01 00:30 JST(=2026-09-30 15:30 UTC)。変更が起きた月は10月なので、
  // 「変更した月の翌月1日」は11/1になる(10/1にはならない——同月内には戻さないルール)。
  const changeAt = new Date("2026-09-30T15:30:00.000Z");
  const result = previewBillingStartDateFromChange(changeAt);
  assert.equal(formatDateLabel(result), "2026/11/1");
});

test("previewBillingStartDateFromChange: 月末(12/31)に変更 → 翌年1月1日(年またぎ)", () => {
  // 2026-12-31 20:00 JST(=11:00 UTC)
  const changeAt = new Date("2026-12-31T11:00:00.000Z");
  const result = previewBillingStartDateFromChange(changeAt);
  assert.equal(formatDateLabel(result), "2027/1/1");
});

// previewTrialEndDate: 開始日の1か月後(JST基準)。日またぎ・月末クランプの境界値を確認。
test("previewTrialEndDate: 通常の1か月後", () => {
  const start = new Date("2026-09-02T03:00:00.000Z"); // 2026-09-02 12:00 JST
  const result = previewTrialEndDate(start);
  assert.equal(formatDateLabel(result), "2026/10/2");
});

test("previewTrialEndDate: 1/31開始 → 2月は31日が無いので月末(28日)にクランプ", () => {
  const start = new Date("2026-01-31T03:00:00.000Z"); // 2026-01-31 12:00 JST(2026年は平年)
  const result = previewTrialEndDate(start);
  assert.equal(formatDateLabel(result), "2026/2/28");
});

// previewBillingStart: トライアルからの変更は「トライアル終了日の翌日」、
// それ以外(無料利用・停止中から)は「翌月1日」になることを確認。
test("previewBillingStart: トライアル中でtrialEndsAtが未来 → トライアル終了日の翌日", () => {
  const now = new Date("2026-09-15T03:00:00.000Z");
  const trialEndsAt = "2026-09-20T00:00:00.000Z";
  const { date, source } = previewBillingStart("trial", trialEndsAt, now);
  assert.equal(source, "trial");
  assert.equal(formatDateLabel(date), formatDateLabel(new Date("2026-09-21T00:00:00.000Z")));
});

test("previewBillingStart: トライアル中でもtrialEndsAtが既に過去なら翌月1日ルールにフォールバック", () => {
  const now = new Date("2026-09-15T03:00:00.000Z");
  const trialEndsAt = "2026-09-01T00:00:00.000Z"; // 既に過ぎている
  const { date, source } = previewBillingStart("trial", trialEndsAt, now);
  assert.equal(source, "next-month");
  assert.equal(formatDateLabel(date), "2026/10/1");
});

test("previewBillingStart: 無料利用からの変更 → 翌月1日ルール", () => {
  const now = new Date("2026-09-15T03:00:00.000Z");
  const { date, source } = previewBillingStart("free", null, now);
  assert.equal(source, "next-month");
  assert.equal(formatDateLabel(date), "2026/10/1");
});

test("previewBillingStart: 停止中からの再契約 → 翌月1日ルール", () => {
  const now = new Date("2026-09-15T03:00:00.000Z");
  const { date, source } = previewBillingStart("suspended", null, now);
  assert.equal(source, "next-month");
  assert.equal(formatDateLabel(date), "2026/10/1");
});

// formatUsageDuration: 「利用期間」表示。契約状態が変わっても常に開始日からの通算になる
// (要件: 無料利用6か月+契約中10か月 → 1年4か月、のように状態変更でリセットされない)。
test("formatUsageDuration: 0日", () => {
  const now = new Date("2026-09-02T00:00:00.000Z");
  assert.equal(formatUsageDuration("2026-09-02T00:00:00.000Z", now), "0日");
});

test("formatUsageDuration: 29日(1か月未満)", () => {
  const start = new Date("2026-08-01T00:00:00.000Z");
  const now = new Date("2026-08-30T00:00:00.000Z");
  assert.equal(formatUsageDuration(start, now), "29日");
});

test("formatUsageDuration: 月+日(4か月12日)", () => {
  const start = new Date("2026-05-01T00:00:00.000Z");
  const now = new Date("2026-09-13T00:00:00.000Z");
  assert.equal(formatUsageDuration(start, now), "4か月12日");
});

test("formatUsageDuration: ちょうど12か月は「1年」(要件どおり年単位へ繰り上がり、日は表示しない)", () => {
  const start = new Date("2025-09-02T00:00:00.000Z");
  const now = new Date("2026-09-02T00:00:00.000Z");
  assert.equal(formatUsageDuration(start, now), "1年");
});

test("formatUsageDuration: 1年4か月(状態変更をまたいでも通算——無料6か月+契約中10か月の例)", () => {
  const start = new Date("2025-05-02T00:00:00.000Z");
  const now = new Date("2026-09-02T00:00:00.000Z");
  assert.equal(formatUsageDuration(start, now), "1年4か月");
});

test("formatUsageDuration: 未設定(null)は空文字", () => {
  assert.equal(formatUsageDuration(null), "");
  assert.equal(formatUsageDuration(undefined), "");
});

// formatRemainingLabel: 「残り」表示(トライアルは日数、無料期限は月の粗さ)。
test("formatRemainingLabel: 残り18日", () => {
  const now = new Date("2026-09-02T00:00:00.000Z");
  const end = new Date("2026-09-20T00:00:00.000Z");
  assert.equal(formatRemainingLabel(end, now), "18日");
});

test("formatRemainingLabel: 残り2か月(粗い月単位)", () => {
  const now = new Date("2026-09-02T00:00:00.000Z");
  const end = new Date("2026-11-02T00:00:00.000Z");
  assert.equal(formatRemainingLabel(end, now), "2か月");
});

test("formatRemainingLabel: 期限切れ(過去日)", () => {
  const now = new Date("2026-09-02T00:00:00.000Z");
  const end = new Date("2026-08-01T00:00:00.000Z");
  assert.equal(formatRemainingLabel(end, now), "期限切れ");
});

test("formatRemainingLabel: 未設定(null)は空文字", () => {
  assert.equal(formatRemainingLabel(null), "");
});

// formatYenOrEmpty
test("formatYenOrEmpty: 金額を¥区切り表記にする", () => {
  assert.equal(formatYenOrEmpty(1480), "¥1,480");
  assert.equal(formatYenOrEmpty(0), "¥0");
});

test("formatYenOrEmpty: null/undefinedは空文字(未設定を¥0と誤表示しない)", () => {
  assert.equal(formatYenOrEmpty(null), "");
  assert.equal(formatYenOrEmpty(undefined), "");
});

// deriveContractDisplayStatus: 契約状態の一元判定(2026-09、本番公開前の総点検・要件8)。
// contract_status/subscription_status/payment_status/cancel_at_period_endの組み合わせから
// 単一の表示状態を導出する対応表そのものをテストする。
test("deriveContractDisplayStatus: 無料利用・トライアル・契約中はcontract_statusのまま", () => {
  assert.equal(deriveContractDisplayStatus({ contractStatus: "free" }).key, "free");
  assert.equal(deriveContractDisplayStatus({ contractStatus: "trial" }).key, "trial");
  assert.equal(deriveContractDisplayStatus({ contractStatus: "active" }).key, "active");
});

test("deriveContractDisplayStatus: 未設定・null companyはfree扱い", () => {
  assert.equal(deriveContractDisplayStatus(null).key, "free");
  assert.equal(deriveContractDisplayStatus(undefined).key, "free");
});

test("deriveContractDisplayStatus: 契約中で支払いエラー(past_due)ならpastDue", () => {
  const result = deriveContractDisplayStatus({ contractStatus: "active", paymentStatus: "past_due" });
  assert.equal(result.key, "pastDue");
  assert.equal(result.label, "支払いエラー");
});

test("deriveContractDisplayStatus: 契約中で解約予約中(cancel_at_period_end)ならcancelPending", () => {
  const result = deriveContractDisplayStatus({ contractStatus: "active", cancelAtPeriodEnd: true });
  assert.equal(result.key, "cancelPending");
});

test("deriveContractDisplayStatus: 解約予約中と支払いエラーが同時に立っていても解約予約中を優先する", () => {
  // 解約予約(いつ終わるか確定している)の方が、一時的な支払いエラーより重要な情報のため。
  const result = deriveContractDisplayStatus({ contractStatus: "active", cancelAtPeriodEnd: true, paymentStatus: "past_due" });
  assert.equal(result.key, "cancelPending");
});

test("deriveContractDisplayStatus: suspendedかつsubscription_status=canceledはended(契約終了)", () => {
  const result = deriveContractDisplayStatus({ contractStatus: "suspended", subscriptionStatus: "canceled" });
  assert.equal(result.key, "ended");
  assert.equal(result.label, "契約終了");
});

test("deriveContractDisplayStatus: suspendedでsubscription_statusがunpaid/未設定はstopped(停止中)", () => {
  assert.equal(deriveContractDisplayStatus({ contractStatus: "suspended", subscriptionStatus: "unpaid" }).key, "stopped");
  assert.equal(deriveContractDisplayStatus({ contractStatus: "suspended", subscriptionStatus: "" }).key, "stopped");
  assert.equal(deriveContractDisplayStatus({ contractStatus: "suspended" }).key, "stopped");
});

test("deriveContractDisplayStatus: suspendedは他のどの条件よりも優先される(最も深刻な状態)", () => {
  // 停止中の会社に(理論上あり得ない組み合わせだが)cancelAtPeriodEndやpaymentStatusが
  // 残っていても、suspendedの判定が最優先されることを確認する。
  const result = deriveContractDisplayStatus({ contractStatus: "suspended", cancelAtPeriodEnd: true, paymentStatus: "past_due" });
  assert.equal(result.key, "stopped");
});

// 2026-09-11、本番のテストサロンで実際に発覚した不具合の再現テスト。Webhookは
// contract_statusを'trial'へ同期する条件を「直前がfree/suspendedの場合だけ」に
// 限定しているため(要件24の悪用防止)、それ以外の値(例: system_adminが検証用に
// 手動でactiveにしていた会社)からトライアルが始まると、contract_statusは'active'の
// まま取り残される。この場合でも表示はcontract_statusではなくStripeの実状態
// (subscription_status='trialing')を優先し、正しく'trial'を返さなければならない。
test("deriveContractDisplayStatus: contract_status='active'のままでもsubscription_status='trialing'ならtrial(根本原因の再現テスト)", () => {
  const result = deriveContractDisplayStatus({ contractStatus: "active", subscriptionStatus: "trialing", trialEndsAt: "2026-10-11" });
  assert.equal(result.key, "trial");
  assert.equal(result.label, "トライアル");
});

test("deriveContractDisplayStatus: subscription_statusが未同期でも、trial_ends_atが未来ならtrial", () => {
  const now = new Date("2026-09-11T00:00:00.000Z");
  const result = deriveContractDisplayStatus({ contractStatus: "active", subscriptionStatus: null, trialEndsAt: "2026-10-11" }, now);
  assert.equal(result.key, "trial");
});

test("deriveContractDisplayStatus: trial_ends_atが過去なら(subscription_statusがtrialingでない限り)trialにはならない", () => {
  const now = new Date("2026-09-11T00:00:00.000Z");
  const result = deriveContractDisplayStatus({ contractStatus: "active", subscriptionStatus: "active", trialEndsAt: "2026-08-01" }, now);
  assert.equal(result.key, "active");
});

test("deriveContractDisplayStatus: 本当に無料期間が終わって契約中になった会社は、古いtrial_ends_atが残っていてもtrialに誤判定しない", () => {
  // トライアル終了→初回決済成功のシナリオ。trial_ends_atは過去日のまま(webhookは
  // activeへ遷移した後trial_ends_atを更新しない)なので、以降ずっとactiveと判定され続ける。
  const now = new Date("2026-12-01T00:00:00.000Z");
  const result = deriveContractDisplayStatus({ contractStatus: "active", subscriptionStatus: "active", trialEndsAt: "2026-10-11", cancelAtPeriodEnd: false, paymentStatus: null }, now);
  assert.equal(result.key, "active");
});

test("deriveContractDisplayStatus: suspendedならtrial_ends_atが未来でも停止中を優先する", () => {
  const result = deriveContractDisplayStatus({ contractStatus: "suspended", subscriptionStatus: "canceled", trialEndsAt: "2099-01-01" });
  assert.equal(result.key, "ended");
});

// isActiveLikeContractStatusKey
test("isActiveLikeContractStatusKey: active/cancelPending/pastDueはtrue、それ以外はfalse", () => {
  assert.equal(isActiveLikeContractStatusKey("active"), true);
  assert.equal(isActiveLikeContractStatusKey("cancelPending"), true);
  assert.equal(isActiveLikeContractStatusKey("pastDue"), true);
  assert.equal(isActiveLikeContractStatusKey("trial"), false);
  assert.equal(isActiveLikeContractStatusKey("free"), false);
  assert.equal(isActiveLikeContractStatusKey("stopped"), false);
  assert.equal(isActiveLikeContractStatusKey("ended"), false);
});
