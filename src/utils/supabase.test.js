import test from "node:test";
import assert from "node:assert/strict";
import { isAuthTimingErrorMessage, AUTH_SESSION_EXPIRED_MESSAGE, getSupabaseErrorMessage } from "./supabase.js";

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
