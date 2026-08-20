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
// メールアドレス重複チェックの分類ロジック(誤った店舗への招待削除後に再招待できない不具合の
// 修正)。純粋関数として切り出す理由: App.jsx側のhandleSaveUserは実際のSupabase問い合わせを
// 伴う非同期処理で単体テストしづらいが、「取得済みのprofiles行(existingRows)と現在の会社ID
// から、どう案内すべきか」という分岐そのものは入出力だけで完結する判定ロジックなので、ここへ
// 切り出してテスト可能にする(getUserStatusMetaと同じ考え方)。
//
// existingRows: profiles.email = 対象メールアドレスに一致する行(company_id, is_active,
// auth_user_id等を含む、複数会社にまたがっていてもよい生のDB行)の配列。
// 戻り値: 新規招待を作成してよければ null。ブロックする場合は理由(reason)とユーザー向け
// メッセージ(message)。
//
// 分類(要件6の5分類に対応):
//  - 同じ会社ですでに利用中(auth_user_idあり) → reason: "same_company_active"
//  - 同じ会社で停止中 → reason: "same_company_suspended"
//  - 同じ会社で有効な招待待ち(auth_user_idなし) → reason: "same_company_invited"
//  - 別会社ですでに正式登録済み(auth_user_idあり) → reason: "other_company_active"
//    (profiles.emailはDB側でUNIQUE制約——1メールアドレス1会社が前提のため、これは
//    実際に構造的な制約であり、単純化して「登録済み」と誤魔化さず正しく案内する)
//  - 別会社の招待待ちが残っているだけ → reason: "other_company_invited"
//    (今操作している会社からの新規招待を妨げてはいけない——「別会社の古い招待待ち」を
//    理由に「このメールアドレスへの招待はすでに作成されています」という、今の会社の
//    ユーザー一覧を指す紛らわしい案内を出さないことが、今回の不具合の直接の修正点)
//  - どの会社にも行が無い → null(新規招待可能)
export function classifyEmailDuplicateForInvite({ existingRows, currentCompanyId }) {
  const rows = Array.isArray(existingRows) ? existingRows : [];
  const existingSameCompany = rows.find((row) => row.company_id === currentCompanyId);
  const existingOtherCompany = rows.find((row) => row.company_id !== currentCompanyId);

  if (existingSameCompany) {
    if (!existingSameCompany.is_active) {
      return { reason: "same_company_suspended", message: "このメールアドレスは停止中のユーザーとして登録されています。ユーザー一覧から状態をご確認ください" };
    }
    if (existingSameCompany.auth_user_id) {
      return { reason: "same_company_active", message: "このメールアドレスはすでに登録済みです" };
    }
    return { reason: "same_company_invited", message: "このメールアドレスへの招待はすでに作成されています(招待待ち)。ユーザー一覧から「再招待」を押して送信し直してください" };
  }

  if (existingOtherCompany) {
    if (existingOtherCompany.auth_user_id) {
      return { reason: "other_company_active", message: "このメールアドレスは既に別の会社で登録済みです。1つのメールアドレスは1つの会社にのみ登録できます。" };
    }
    return { reason: "other_company_invited", message: "このメールアドレスは別の会社で招待待ちの状態です。先にその会社のユーザー管理画面から招待を削除してから、あらためてこちらで招待してください。" };
  }

  return null;
}

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
