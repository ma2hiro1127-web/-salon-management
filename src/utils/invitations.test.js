import test from "node:test";
import assert from "node:assert/strict";
import { getInvitationStatusMeta, isInviteExpired, createInviteToken } from "./invitations.js";

test("invite status meta resolves label and tone", () => {
  assert.equal(getInvitationStatusMeta("invited").label, "招待済み");
  assert.equal(getInvitationStatusMeta("registered").label, "登録完了");
  assert.equal(getInvitationStatusMeta("expired").label, "期限切れ");
  assert.equal(getInvitationStatusMeta("suspended").label, "停止中");
});

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
