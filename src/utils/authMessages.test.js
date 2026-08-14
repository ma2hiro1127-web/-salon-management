import test from "node:test";
import assert from "node:assert/strict";
import { getLocalizedSupabaseErrorMessage } from "./authMessages.js";
import { AUTH_SESSION_EXPIRED_MESSAGE } from "./supabase.js";

test("maps known auth errors to Japanese", () => {
  assert.equal(getLocalizedSupabaseErrorMessage({ message: "Invalid login credentials" }), "メールアドレスまたはパスワードが正しくありません。" );
  assert.equal(getLocalizedSupabaseErrorMessage({ message: "Email not confirmed" }), "メールアドレスの確認がまだです。確認メールをご確認ください。" );
});

test("maps case-insensitive confirmation errors", () => {
  assert.equal(getLocalizedSupabaseErrorMessage({ message: "email not confirmed" }), "メールアドレスの確認がまだです。確認メールをご確認ください。" );
});

test("falls back to a friendly default", () => {
  assert.equal(getLocalizedSupabaseErrorMessage({ message: "boom" }), "ログインに失敗しました。しばらくしてからもう一度お試しください。" );
});

test("maps JWT/session timing errors (clock skew等) to a re-login prompt instead of the raw message", () => {
  assert.equal(getLocalizedSupabaseErrorMessage({ message: "JWT issued at future" }), AUTH_SESSION_EXPIRED_MESSAGE);
  assert.equal(getLocalizedSupabaseErrorMessage({ message: "invalid JWT" }), AUTH_SESSION_EXPIRED_MESSAGE);
});
