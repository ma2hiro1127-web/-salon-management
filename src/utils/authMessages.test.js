import test from "node:test";
import assert from "node:assert/strict";
import { getLocalizedSupabaseErrorMessage } from "./authMessages.js";

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
