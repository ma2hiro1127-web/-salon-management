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
