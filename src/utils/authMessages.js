import { isAuthTimingErrorMessage, AUTH_SESSION_EXPIRED_MESSAGE } from "./supabase.js";

export const getLocalizedSupabaseErrorMessage = (error) => {
  const message = String(error?.message || "").trim();

  if (!message) {
    return "ログインに失敗しました。しばらくしてからもう一度お試しください。";
  }

  // JWT/セッションのタイミング起因エラー(クロックスキュー等)は、ログイン画面でも生のまま
  // 出さない — セッション復元時にこのエラーへ落ちてきた場合、再ログインで解決することが
  // ほとんどのため、その旨を明確に案内する。
  if (isAuthTimingErrorMessage(message)) {
    return AUTH_SESSION_EXPIRED_MESSAGE;
  }

  if (message.includes("Invalid login credentials") || message.includes("invalid login credentials")) {
    return "メールアドレスまたはパスワードが正しくありません。";
  }

  if (message.includes("Email not confirmed") || message.includes("email not confirmed")) {
    return "メールアドレスの確認がまだです。確認メールをご確認ください。";
  }

  if (message.includes("signup") && message.includes("disabled")) {
    return "新規登録は現在停止されています。";
  }

  if (message.includes("User already registered") || message.includes("already registered")) {
    return "このメールアドレスはすでに登録されています。";
  }

  if (message.includes("Password should be at least")) {
    return "パスワードは最低8文字以上で設定してください。";
  }

  return "ログインに失敗しました。しばらくしてからもう一度お試しください。";
};

// パスワード再設定(メール送信・新パスワード設定)専用のエラー文言。getLocalizedSupabase
// ErrorMessageと分けている理由: そちらのフォールバック文言「ログインに失敗しました」は
// このコンテキスト(送信/変更の失敗)には意味が合わないため——技術的なエラー文をそのまま
// 出さない(要件)という方針は共通だが、フォールバック文言自体はこの画面専用にする。
export const getPasswordResetErrorMessage = (error) => {
  const message = String(error?.message || "").trim();

  if (isAuthTimingErrorMessage(message)) {
    return AUTH_SESSION_EXPIRED_MESSAGE;
  }

  // Supabaseのメール送信レート制限(「for security purposes, you can only request this after
  // N seconds」「email rate limit exceeded」等)。文言はバージョン・設定によって変わり得るため
  // 部分一致で広めに拾う。
  if (/rate limit|too many requests|after \d+ seconds/i.test(message)) {
    return "しばらく時間を空けてから、もう一度お試しください。";
  }

  if (message.includes("Password should be at least")) {
    return "パスワードは最低8文字以上で設定してください。";
  }

  // それ以外(ネットワークエラー・想定外のSupabaseエラー等)は、原因を問わず同じ一般的な
  // 文言にする——技術的な内容を利用者へそのまま出さない、かつメールアドレスの登録有無を
  // 画面から判別できないようにするため(要件)。
  return "しばらく時間を空けてから、もう一度お試しください。";
};
