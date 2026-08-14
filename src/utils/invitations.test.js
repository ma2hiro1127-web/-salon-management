import test from "node:test";
import assert from "node:assert/strict";
import { getUserStatusMeta, isInviteExpired, createInviteToken, buildInviteLink } from "./invitations.js";

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
