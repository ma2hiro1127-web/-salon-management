const INVITATION_STATUS_META = {
  invited: { label: "招待済み", tone: "info" },
  registered: { label: "登録完了", tone: "success" },
  expired: { label: "期限切れ", tone: "warning" },
  suspended: { label: "停止中", tone: "danger" },
};

export function getInvitationStatusMeta(status) {
  return INVITATION_STATUS_META[status] || { label: status || "不明", tone: "info" };
}

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
