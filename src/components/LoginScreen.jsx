import { useState } from "react";
import { validateOwnerSignUpInput } from "../utils/selfSignup.js";

// 新規登録(selfSignup.js)・招待受諾(accept-invite Edge Function)と同じ最低文字数。
// パスワード再設定画面もこの1箇所を参照し、画面ごとに条件が食い違わないようにする。
const PASSWORD_MIN_LENGTH = 8;

const modeLabels = {
  login: { title: "ログイン", button: "ログイン", helper: "登録済みのアカウントでサインインできます。" },
  signup: { title: "新規登録", button: "アカウント作成", helper: "メールアドレスとパスワードで新規アカウントを作成します。" },
  reset: { title: "パスワードを再設定", button: "再設定メールを送信", helper: "登録しているメールアドレスを入力してください。パスワード再設定用のメールをお送りします。" },
  recover: { title: "新しいパスワードを設定", button: "パスワードを変更", helper: "アカウントの新しいパスワードを設定してください。" },
  // メールのリンクが無効・期限切れ・使用済みだった場合(またはRecoveryセッションを取得できない
  // 状態でこの画面へ直接アクセスされた場合)専用の、フォームを一切出さない案内画面。
  recoverInvalid: { title: "パスワード再設定", button: "", helper: "" },
  // 招待受諾(signup)とは別導線 — 新規オーナーが自分でcompany_adminとして登録する専用モード。
  ownerSignup: { title: "サロンマネージャーを無料で始める", button: "無料で始める", helper: "美容室経営の数字管理を、もっとシンプルに。" },
};

// パスワード入力欄の表示・非表示切り替え付きラッパー。新規登録・パスワード再設定の
// どちらの画面でも同じ見た目・同じ挙動になるよう、1箇所にまとめて共有する。
const PasswordField = ({ label, value, onChange, autoComplete }) => {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="password-field-wrapper">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="password-visibility-toggle"
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? "パスワードを非表示にする" : "パスワードを表示する"}
        >
          {visible ? "非表示" : "表示"}
        </button>
      </div>
    </label>
  );
};

const LoginScreen = ({ mode, onModeChange, onSubmit, onSignUp, onOwnerSignUp, onResetPassword, onSetNewPassword, loading, error, success, inviteEmail = "", hasInviteToken = false, ownerSignupVisible = false, initialOwnerSignupEmail = "", initialOwnerSignupCompanyName = "" }) => {
  // system_adminが発行したテスト契約フローのリンク(?owner-signup=1&testKey=...)経由で
  // 開いた場合だけ、使い捨てのテスト用メールアドレス・会社名を初期値として入れておく
  // (要件: 実際の新規顧客と同じ登録フォームを、その場でそのまま使えるようにする)。
  // 通常の新規オーナー登録では両方とも空文字のまま、既存の挙動を変えない。
  const [emailInput, setEmailInput] = useState(initialOwnerSignupEmail);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [companyName, setCompanyName] = useState(initialOwnerSignupCompanyName);
  const [formError, setFormError] = useState("");

  const currentMode = modeLabels[mode] || modeLabels.login;
  const isInviteSignup = mode === "signup" && Boolean(inviteEmail);
  const isOwnerSignup = mode === "ownerSignup";
  // 招待リンク経由の場合はinviteEmail(get_invite_infoで判明したメールアドレス)を優先する。
  // 招待されたメールアドレスと違うメールアドレスを手入力してしまい、後段の「招待メール
  // アドレスと一致するメールアドレスで登録してください」で詰まる事故を防ぐため、この場合は
  // 編集不可にする(useEffectでstateへ同期する代わりに、表示値として直接優先するだけ)。
  const email = isInviteSignup ? inviteEmail : emailInput;
  // パスワード再設定リンクを開いた直後の専用画面。ログイン/新規登録などへの切り替えは
  // 意味を持たない(セッションは既に再設定用に確立済み)ため、モード切替自体を出さない。
  const isRecoverMode = mode === "recover";
  const isRecoverInvalid = mode === "recoverInvalid";

  const handleSubmit = (event) => {
    event.preventDefault();
    setFormError("");

    if (mode === "recover") {
      if (password.length < PASSWORD_MIN_LENGTH) {
        setFormError(`パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください。`);
        return;
      }
      if (password !== passwordConfirm) {
        setFormError("入力したパスワードが一致しません。");
        return;
      }
      onSetNewPassword({ password });
      return;
    }

    if (mode === "signup") {
      if (password.length < PASSWORD_MIN_LENGTH) {
        setFormError(`パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください。`);
        return;
      }
      if (password !== passwordConfirm) {
        setFormError("入力したパスワードが一致しません。");
        return;
      }
      onSignUp({ email, password });
      return;
    }

    if (mode === "reset") {
      onResetPassword({ email });
      return;
    }

    if (mode === "ownerSignup") {
      const validationError = validateOwnerSignUpInput({ ownerName, companyName, email, password, passwordConfirm });
      if (validationError) {
        setFormError(validationError);
        return;
      }
      onOwnerSignUp({ ownerName, companyName, email, password });
      return;
    }

    onSubmit({ email, password });
  };

  // 無効・期限切れ・使用済みのリンク、またはRecoveryセッションを取得できない状態で
  // この画面が直接開かれた場合(要件9)。updateUserを一切呼べない専用の案内画面にする——
  // フォーム自体を出さないので、誤ってパスワード変更を試みることも構造的にできない。
  if (isRecoverInvalid) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-title-block">
            <p className="eyebrow">SALON MANAGEMENT</p>
            <h2>{currentMode.title}</h2>
            <p>この再設定リンクは無効、または有効期限が切れています。もう一度、再設定メールを送信してください。</p>
          </div>
          <button className="primary-button" type="button" onClick={() => onModeChange("reset")}>再設定メールをもう一度送る</button>
        </div>
      </div>
    );
  }

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
            {/* 招待受諾専用モード — 招待リンク経由(inviteTokenあり)の時だけ表示する。
                招待の無い状態でこのボタンを常時表示すると、下の新規オーナー登録と紛らわしく
                なるうえ、招待トークンの無いこのモードは現状メール確認の壁で実質完了しない。 */}
            {hasInviteToken ? (
              <button className={mode === "signup" ? "primary-button" : "secondary-button"} type="button" onClick={() => onModeChange("signup")}>新規登録</button>
            ) : null}
          </div>
        )}
        {/* 新規オーナー・セルフサインアップ導線。招待受諾(signup)とは別ボタン・別モード。
            ownerSignupVisible はfeature flag(is_self_signup_enabled)がON、またはテスト専用
            URLパラメータ経由の時だけtrueになる(App.jsx側で判定)。 */}
        {!isRecoverMode && ownerSignupVisible && mode !== "ownerSignup" ? (
          <div className="button-row" style={{ marginBottom: 4 }}>
            <button className="secondary-button" type="button" onClick={() => onModeChange("ownerSignup")}>サロンマネージャーを無料で始める</button>
          </div>
        ) : null}

        <form className="auth-form" onSubmit={handleSubmit}>
          {isOwnerSignup ? (
            <>
              <label className="field">
                <span>オーナー名</span>
                <input type="text" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} required />
              </label>
              <label className="field">
                <span>サロン名（会社名）</span>
                <input type="text" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required />
              </label>
            </>
          ) : null}
          {isRecoverMode ? null : (
            <label className="field">
              <span>メールアドレス</span>
              <input type="email" value={email} onChange={(event) => setEmailInput(event.target.value)} readOnly={isInviteSignup} required />
              {isInviteSignup ? <small className="helper-text" style={{ marginBottom: 0 }}>招待されたメールアドレスです</small> : null}
            </label>
          )}
          {mode !== "reset" ? (
            <PasswordField
              label={isRecoverMode ? "新しいパスワード" : "パスワード"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isRecoverMode || mode === "signup" || mode === "ownerSignup" ? "new-password" : "current-password"}
            />
          ) : null}
          {mode === "signup" || mode === "ownerSignup" || isRecoverMode ? (
            <>
              <PasswordField
                label={isRecoverMode ? "新しいパスワード（確認）" : "パスワード（確認）"}
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                autoComplete="new-password"
              />
              {/* パスワード条件は入力欄の近くに常時表示する(要件)。新規登録・パスワード
                  再設定のどちらも同じ最低文字数(PASSWORD_MIN_LENGTH)を参照する。 */}
              <p className="field-hint">パスワードは{PASSWORD_MIN_LENGTH}文字以上で入力してください。</p>
            </>
          ) : null}
          {formError || error ? <div className="notice-box">{formError || error}</div> : null}
          {success ? <div className="notice-box" style={{ background: "rgba(46, 163, 97, 0.12)", color: "#2ea361" }}>{success}</div> : null}
          <button className="primary-button" type="submit" disabled={loading}>{loading ? (mode === "reset" ? "送信中…" : "処理中...") : currentMode.button}</button>
          {mode === "login" ? (
            <button type="button" className="text-button" onClick={() => onModeChange("reset")}>パスワードを忘れた方</button>
          ) : null}
          {mode === "reset" ? (
            <button type="button" className="text-button" onClick={() => onModeChange("login")}>ログイン画面に戻る</button>
          ) : null}
          {isOwnerSignup ? (
            <button type="button" className="text-button" onClick={() => onModeChange("login")}>すでにアカウントをお持ちの方はこちら</button>
          ) : null}
        </form>
      </div>
    </div>
  );
};

export default LoginScreen;
