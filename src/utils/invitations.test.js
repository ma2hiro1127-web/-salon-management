import test from "node:test";
import assert from "node:assert/strict";
import { getUserStatusMeta, isInviteExpired, createInviteToken, buildInviteLink, classifyEmailDuplicateForInvite } from "./invitations.js";

test("invites expire based on expiration timestamp", () => {
  const expiredAt = new Date(Date.now() - 1000).toISOString();
  const futureAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();
  assert.equal(isInviteExpired(expiredAt), true);
  assert.equal(isInviteExpired(futureAt), false);
});

test("invite tokens are generated as non-empty strings", () => {
  assert.equal(typeof createInviteToken(), "string");
  assert.ok(createInviteToken().length > 0);
});

test("buildInviteLink appends a per-invite token, never a fixed role-based URL", () => {
  assert.equal(buildInviteLink("https://example.com", "abc123"), "https://example.com/signup?invite=abc123");
  assert.equal(buildInviteLink("https://example.com/", "abc 123"), "https://example.com/signup?invite=abc%20123");
});

test("getUserStatusMeta: 停止中はisActive:falseが最優先(authUserIdの有無に関わらず)", () => {
  assert.equal(getUserStatusMeta({ isActive: false, authUserId: "auth-1" }).key, "suspended");
  assert.equal(getUserStatusMeta({ isActive: false, authUserId: "" }).key, "suspended");
});

test("getUserStatusMeta: 未登録(authUserIdなし)は期限切れ→メール未送信(pending)→招待中の順で判定する", () => {
  const expiredAt = new Date(Date.now() - 1000).toISOString();
  const futureAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();

  assert.equal(getUserStatusMeta({ authUserId: "", inviteExpiresAt: expiredAt }).key, "invite_expired");
  // 期限切れが最優先: メール送信に失敗していても期限が切れていれば「期限切れ」を出す
  assert.equal(getUserStatusMeta({ authUserId: "", inviteExpiresAt: expiredAt, invitationStatus: "pending" }).key, "invite_expired");
  assert.equal(getUserStatusMeta({ authUserId: "", inviteExpiresAt: futureAt, invitationStatus: "pending" }).key, "invite_send_failed");
  assert.equal(getUserStatusMeta({ authUserId: "", inviteExpiresAt: futureAt, invitationStatus: "invited" }).key, "invited");
});

test("getUserStatusMeta: 登録済み(authUserIdあり)はログイン履歴の有無で未ログイン/利用中を判定する", () => {
  assert.equal(getUserStatusMeta({ authUserId: "auth-1", loginCount: 0 }).key, "not_logged_in");
  assert.equal(getUserStatusMeta({ authUserId: "auth-1", loginCount: 3, lastLoginAt: "2026-08-01T00:00:00.000Z" }).key, "active");
});

// 「誤った店舗への招待削除後に再招待できない不具合」の回帰テスト(要件9のケース群)。
// classifyEmailDuplicateForInviteは、appState.users(ログイン時にしか再取得しないローカル
// キャッシュ)ではなく、送信直前にSupabaseへ問い合わせて取得したprofiles行(existingRows)を
// 対象にする——このテストでは「実際にDBへ何が残っているか」を模したexistingRowsを直接与える。

test("ケース1・4: A店舗(会社1)へ招待→承認前に削除→B店舗(同じ会社)から同じメールで再招待できる(招待取消/削除後は行が無くなるためnull=許可)", () => {
  // 削除後、profilesにはその会社の行が1件も残らない(delete-userが実際にDELETEするため)。
  const result = classifyEmailDuplicateForInvite({ existingRows: [], currentCompanyId: "company-1" });
  assert.equal(result, null);
});

test("ケース2: INTROへ誤招待→削除→フィーネから再招待できる(別会社の行だけが残っていても、削除済みなら空配列になり許可される)", () => {
  // INTRO(company-intro)の行は削除済みで既に存在しない、という状態を再現。
  const result = classifyEmailDuplicateForInvite({ existingRows: [], currentCompanyId: "company-fine" });
  assert.equal(result, null);
});

test("同じ会社ですでに利用中(auth_user_idあり) → ブロックし『登録済み』と案内する", () => {
  const result = classifyEmailDuplicateForInvite({
    existingRows: [{ company_id: "company-1", is_active: true, auth_user_id: "auth-1" }],
    currentCompanyId: "company-1",
  });
  assert.equal(result.reason, "same_company_active");
});

test("同じ会社で停止中 → isActive最優先でブロックする", () => {
  const result = classifyEmailDuplicateForInvite({
    existingRows: [{ company_id: "company-1", is_active: false, auth_user_id: "auth-1" }],
    currentCompanyId: "company-1",
  });
  assert.equal(result.reason, "same_company_suspended");
});

test("ケース3・5・6: 同じ会社で有効な招待待ち(auth_user_idなし、期限切れ含む) → 『再招待』を案内してブロックする(新規の重複行は作らせない)", () => {
  const result = classifyEmailDuplicateForInvite({
    existingRows: [{ company_id: "company-1", is_active: true, auth_user_id: null }],
    currentCompanyId: "company-1",
  });
  assert.equal(result.reason, "same_company_invited");
  assert.match(result.message, /再招待/);
});

test("ケース7: 別会社ですでに正式登録済み(auth_user_idあり) → 新規会社からの登録は構造的に不可能なので明確に案内してブロックする", () => {
  const result = classifyEmailDuplicateForInvite({
    existingRows: [{ company_id: "company-intro", is_active: true, auth_user_id: "auth-1" }],
    currentCompanyId: "company-fine",
  });
  assert.equal(result.reason, "other_company_active");
});

test("不具合の直接の再現: 別会社の古い招待待ち(削除し忘れ)が残っている場合、『このメールアドレスへの招待はすでに作成されています』という自社ユーザー一覧を指す紛らわしい文言は出さず、別会社側での削除を案内する", () => {
  const result = classifyEmailDuplicateForInvite({
    existingRows: [{ company_id: "company-intro", is_active: true, auth_user_id: null }],
    currentCompanyId: "company-fine",
  });
  assert.equal(result.reason, "other_company_invited");
  assert.doesNotMatch(result.message, /ユーザー一覧から「再招待」/);
  assert.match(result.message, /別の会社/);
});

test("同じ会社・別会社の両方に行がある場合は同じ会社の判定を優先する(同じ会社の状態がそのユーザーにとって最も直接的に関係するため)", () => {
  const result = classifyEmailDuplicateForInvite({
    existingRows: [
      { company_id: "company-intro", is_active: true, auth_user_id: null },
      { company_id: "company-fine", is_active: true, auth_user_id: "auth-1" },
    ],
    currentCompanyId: "company-fine",
  });
  assert.equal(result.reason, "same_company_active");
});
