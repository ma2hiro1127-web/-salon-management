import test from "node:test";
import assert from "node:assert/strict";
import { isAuthTimingErrorMessage, AUTH_SESSION_EXPIRED_MESSAGE, getSupabaseErrorMessage, normalizeDailyFieldSettings, normalizeMonthlyTargetFieldSettings } from "./supabase.js";

test("isAuthTimingErrorMessage: JWT/セッションのタイミング起因エラー文言を検知する", () => {
  assert.equal(isAuthTimingErrorMessage("JWT issued at future"), true);
  assert.equal(isAuthTimingErrorMessage("invalid JWT"), true);
  assert.equal(isAuthTimingErrorMessage("token expired"), true);
  assert.equal(isAuthTimingErrorMessage("Invalid Refresh Token: Already Used"), true);
  assert.equal(isAuthTimingErrorMessage("PGRST301"), true);
  assert.equal(isAuthTimingErrorMessage(""), false);
  assert.equal(isAuthTimingErrorMessage(undefined), false);
  assert.equal(isAuthTimingErrorMessage("duplicate key value violates unique constraint"), false);
});

test("getSupabaseErrorMessage: JWT/セッション起因エラーは生のメッセージを返さず、再ログイン案内に差し替える", () => {
  assert.equal(getSupabaseErrorMessage({ message: "JWT issued at future" }), AUTH_SESSION_EXPIRED_MESSAGE);
  assert.equal(getSupabaseErrorMessage(new Error("invalid JWT")), AUTH_SESSION_EXPIRED_MESSAGE);
});

test("getSupabaseErrorMessage: JWT以外の通常のSupabaseエラーはこれまで通りそのまま返す", () => {
  assert.equal(getSupabaseErrorMessage({ message: "店舗情報を確認できませんでした" }), "店舗情報を確認できませんでした");
  assert.equal(getSupabaseErrorMessage({}), "Supabase エラーが発生しました");
  assert.equal(getSupabaseErrorMessage(null), "Supabase エラーが発生しました");
});

test("getSupabaseErrorMessage: 日本語を含まない生のPostgres/PostgRESTエラー文は一般利用者へそのまま出さず、一般的な文言に差し替える(販売前総合チェックで発見)", () => {
  assert.equal(
    getSupabaseErrorMessage({ message: 'duplicate key value violates unique constraint "stores_company_id_normalized_name_unique"' }),
    "Supabase エラーが発生しました"
  );
  assert.equal(
    getSupabaseErrorMessage({ message: "new row violates row-level security policy for table \"stores\"" }),
    "Supabase エラーが発生しました"
  );
  assert.equal(getSupabaseErrorMessage({ message: "Failed to fetch" }), "Supabase エラーが発生しました");
});

test("normalizeDailyFieldSettings: 保存済みのfields内で明示的にtrueにした項目(口コミ数等)はデフォルトで上書きされず、そのまま残る", () => {
  const saved = { mode: "custom", fields: { technicalSales: true, retailSales: true, customers: true, newCustomers: true, repeatCustomers: true, memo: false, reviewCount: true } };
  const normalized = normalizeDailyFieldSettings(saved);
  assert.equal(normalized.mode, "custom");
  assert.equal(normalized.fields.reviewCount, true);
  assert.equal(normalized.fields.memo, false);
});

test("normalizeDailyFieldSettings: 口コミ数キーが無い古い保存データはfalse(デフォルトOFF)にフォールバックする(既存店舗に勝手に表示させない)", () => {
  const legacy = { mode: "detailed", fields: { technicalSales: true, retailSales: true, customers: true, newCustomers: true, repeatCustomers: true, memo: true } };
  const normalized = normalizeDailyFieldSettings(legacy);
  assert.equal(normalized.fields.reviewCount, false);
});

test("normalizeDailyFieldSettings: 値が無い(null/未設定)場合はデフォルト設定を返す", () => {
  assert.equal(normalizeDailyFieldSettings(null).fields.reviewCount, false);
  assert.equal(normalizeDailyFieldSettings(undefined).fields.reviewCount, false);
});

test("normalizeMonthlyTargetFieldSettings: 目標口コミ数のON/OFFは日次入力側のnormalizeDailyFieldSettingsと完全に別のオブジェクト・別のデフォルトを持つ(依存させない)", () => {
  const dailyOn = normalizeDailyFieldSettings({ mode: "custom", fields: { reviewCount: true } });
  const targetOff = normalizeMonthlyTargetFieldSettings(null);
  assert.equal(dailyOn.fields.reviewCount, true);
  assert.equal(targetOff.fields.targetReviewCount, false);
});
