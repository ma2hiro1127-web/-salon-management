export const getLocalizedSupabaseErrorMessage = (error) => {
  const message = String(error?.message || "").trim();

  if (!message) {
    return "ログインに失敗しました。しばらくしてからもう一度お試しください。";
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
