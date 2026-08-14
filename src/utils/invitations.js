export function isInviteExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

export function createInviteToken() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildInviteLink(baseUrl, token) {
  const normalizedBase = (baseUrl || "").replace(/\/$/, "");
  return `${normalizedBase}/signup?invite=${encodeURIComponent(token)}`;
}

// ユーザー一覧の状態バッジ・行アクション(再招待/URLコピー/招待取消の出し分け)を決める、
// 唯一の判定ロジック。isActive/authUserId/inviteExpiresAt/invitationStatusの組み合わせから
// 導出する(invitationStatus単体では「未登録」を判定できないため、他のフィールドと合わせて
// 総合判定する)。
//
// - 停止中: isActive=false(役割やauth登録状況に関わらず最優先)
// - 招待期限切れ: 未登録 かつ inviteExpiresAtを過ぎている
// - メール未送信: 未登録 かつ 期限内 かつ invitationStatus="pending"
//   (プロフィール行の作成には成功したが、招待メールの送信自体が失敗した状態 — 「未入力」
//   ではなく「送信失敗」であることを区別して伝える。再招待で復旧できる)
// - 招待中: 未登録 かつ 期限内 かつ メール送信は成功している(通常の招待待ち)
// - 未ログイン: auth登録済みだが一度もログインしていない
// - 利用中: auth登録済み・ログイン履歴あり
export function getUserStatusMeta(user) {
  if (user?.isActive === false) {
    return { key: "suspended", label: "停止中", tone: "danger", expiresAt: null };
  }
  if (!user?.authUserId) {
    const expiresAt = user?.inviteExpiresAt ? new Date(user.inviteExpiresAt) : null;
    if (user?.inviteExpiresAt && isInviteExpired(user.inviteExpiresAt)) {
      return { key: "invite_expired", label: "招待期限切れ", tone: "warning", expiresAt };
    }
    if (user?.invitationStatus === "pending") {
      return { key: "invite_send_failed", label: "メール未送信", tone: "warning", expiresAt };
    }
    return { key: "invited", label: "招待中", tone: "info", expiresAt };
  }
  if (!user?.lastLoginAt || !user?.loginCount) {
    return { key: "not_logged_in", label: "未ログイン", tone: "info", expiresAt: null };
  }
  return { key: "active", label: "利用中", tone: "success", expiresAt: null };
}
