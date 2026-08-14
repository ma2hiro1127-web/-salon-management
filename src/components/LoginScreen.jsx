import { useState } from "react";

const modeLabels = {
  login: { title: "ログイン", button: "ログイン", helper: "登録済みのアカウントでサインインできます。" },
  signup: { title: "新規登録", button: "アカウント作成", helper: "メールアドレスとパスワードで新規アカウントを作成します。" },
  reset: { title: "パスワード再設定", button: "再設定メールを送る", helper: "登録済みメールアドレスへ再設定用のリンクを送ります。" },
  recover: { title: "新しいパスワードを設定", button: "パスワードを設定", helper: "アカウントの新しいパスワードを設定してください。" },
};

const LoginScreen = ({ mode, onModeChange, onSubmit, onSignUp, onResetPassword, onSetNewPassword, loading, error, success, inviteEmail = "" }) => {
  const [emailInput, setEmailInput] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [formError, setFormError] = useState("");

  const currentMode = modeLabels[mode] || modeLabels.login;
  const isInviteSignup = mode === "signup" && Boolean(inviteEmail);
  // 招待リンク経由の場合はinviteEmail(get_invite_infoで判明したメールアドレス)を優先する。
  // 招待されたメールアドレスと違うメールアドレスを手入力してしまい、後段の「招待メール
  // アドレスと一致するメールアドレスで登録してください」で詰まる事故を防ぐため、この場合は
  // 編集不可にする(useEffectでstateへ同期する代わりに、表示値として直接優先するだけ)。
  const email = isInviteSignup ? inviteEmail : emailInput;
  // パスワード再設定リンクを開いた直後の専用画面。ログイン/新規登録などへの切り替えは
  // 意味を持たない(セッションは既に再設定用に確立済み)ため、モード切替自体を出さない。
  const isRecoverMode = mode === "recover";

  const handleSubmit = (event) => {
    event.preventDefault();
    setFormError("");

    if (mode === "recover") {
      if (password.length < 8) {
        setFormError("パスワードは8文字以上で設定してください。");
        return;
      }
      if (password !== passwordConfirm) {
        setFormError("パスワード（確認）が一致しません。");
        return;
      }
      onSetNewPassword({ password });
      return;
    }

    if (mode === "signup") {
      if (password.length < 8) {
        setFormError("パスワードは8文字以上で設定してください。");
        return;
      }
      if (password !== passwordConfirm) {
        setFormError("パスワード（確認）が一致しません。");
        return;
      }
      onSignUp({ email, password });
      return;
    }

    if (mode === "reset") {
      onResetPassword({ email });
      return;
    }

    onSubmit({ email, password });
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-title-block">
          <p className="eyebrow">SALON MANAGEMENT</p>
          <h2>{currentMode.title}</h2>
          <p>{currentMode.helper}</p>
        </div>

        {isRecoverMode ? null : (
          <div className="button-row" style={{ marginBottom: 4 }}>
            <button className={mode === "login" ? "primary-button" : "secondary-button"} type="button" onClick={() => onModeChange("login")}>ログイン</button>
            <button className={mode === "signup" ? "primary-button" : "secondary-button"} type="button" onClick={() => onModeChange("signup")}>新規登録</button>
            <button className={mode === "reset" ? "primary-button" : "secondary-button"} type="button" onClick={() => onModeChange("reset")}>パスワード再設定</button>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          {isRecoverMode ? null : (
            <label className="field">
              <span>メールアドレス</span>
              <input type="email" value={email} onChange={(event) => setEmailInput(event.target.value)} readOnly={isInviteSignup} required />
              {isInviteSignup ? <small className="helper-text" style={{ marginBottom: 0 }}>招待されたメールアドレスです</small> : null}
            </label>
          )}
          {mode !== "reset" ? (
            <label className="field">
              <span>{isRecoverMode ? "新しいパスワード" : "パスワード"}</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
            </label>
          ) : null}
          {mode === "signup" || isRecoverMode ? (
            <label className="field">
              <span>{isRecoverMode ? "新しいパスワード（確認）" : "パスワード（確認）"}</span>
              <input type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} minLength={8} required />
            </label>
          ) : null}
          {formError || error ? <div className="notice-box">{formError || error}</div> : null}
          {success ? <div className="notice-box" style={{ background: "rgba(46, 163, 97, 0.12)", color: "#2ea361" }}>{success}</div> : null}
          <button className="primary-button" type="submit" disabled={loading}>{loading ? "処理中..." : currentMode.button}</button>
        </form>
      </div>
    </div>
  );
};

export default LoginScreen;
