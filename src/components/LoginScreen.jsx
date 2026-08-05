import { useState } from "react";

const modeLabels = {
  login: { title: "ログイン", button: "ログイン", helper: "登録済みのアカウントでサインインできます。" },
  signup: { title: "新規登録", button: "アカウント作成", helper: "メールアドレスとパスワードで新規アカウントを作成します。" },
  reset: { title: "パスワード再設定", button: "再設定メールを送る", helper: "登録済みメールアドレスへ再設定用のリンクを送ります。" },
};

const LoginScreen = ({ mode, onModeChange, onSubmit, onSignUp, onResetPassword, loading, error, success }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const currentMode = modeLabels[mode] || modeLabels.login;

  const handleSubmit = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const emailValue = form.querySelector('input[type="email"]')?.value || email;
    const passwordValue = form.querySelector('input[type="password"]')?.value || password;

    if (mode === "signup") {
      onSignUp({ email: emailValue, password: passwordValue });
      return;
    }

    if (mode === "reset") {
      onResetPassword({ email: emailValue });
      return;
    }

    onSubmit({ email: emailValue, password: passwordValue });
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-title-block">
          <p className="eyebrow">SALON MANAGEMENT</p>
          <h2>{currentMode.title}</h2>
          <p>{currentMode.helper}</p>
        </div>

        <div className="button-row" style={{ marginBottom: 4 }}>
          <button className={mode === "login" ? "primary-button" : "secondary-button"} type="button" onClick={() => onModeChange("login")}>ログイン</button>
          <button className={mode === "signup" ? "primary-button" : "secondary-button"} type="button" onClick={() => onModeChange("signup")}>新規登録</button>
          <button className={mode === "reset" ? "primary-button" : "secondary-button"} type="button" onClick={() => onModeChange("reset")}>パスワード再設定</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>メールアドレス</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          {mode !== "reset" ? (
            <label className="field">
              <span>パスワード</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
          ) : null}
          {error ? <div className="notice-box">{error}</div> : null}
          {success ? <div className="notice-box" style={{ background: "rgba(46, 163, 97, 0.12)", color: "#2ea361" }}>{success}</div> : null}
          <button className="primary-button" type="submit" disabled={loading}>{loading ? "処理中..." : currentMode.button}</button>
        </form>
      </div>
    </div>
  );
};

export default LoginScreen;
