import { Component } from "react";

// アプリ全体を包む最後の防御線。App.jsx(8000行超の単一コンポーネント)のどこかで
// レンダー中に想定外の例外が発生した場合、これが無いと画面全体が白画面のまま固まり、
// ユーザーには何が起きたか一切分からない(過去の白画面系不具合の根本原因の一つ)。
// 開発者向けのエラー詳細(スタックトレース等)は画面には出さず、consoleにのみ出力する
// (利用者画面に開発者向けエラー情報を表示しない、という既存のgetSupabaseErrorMessageの
// 方針と揃える)。再読み込みで復帰できる一時的な描画エラーがほとんどのため、ボタンは
// 「再読み込み」のみ。
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[error-boundary] unhandled render error", error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "sans-serif" }}>
        <div style={{ maxWidth: 420, textAlign: "center", background: "#fff", border: "1px solid #e2e2e2", borderRadius: 20, padding: "32px 24px", boxShadow: "0 10px 24px rgba(0,0,0,0.08)" }}>
          <p style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 8, color: "#1a1a1a" }}>エラーが発生しました</p>
          <p style={{ fontSize: "0.9rem", color: "#555", marginBottom: 20 }}>ページの読み込み中にエラーが発生しました。再読み込みしてください。改善しない場合は、しばらく時間をおいてからもう一度お試しください。</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ border: 0, borderRadius: 12, padding: "10px 20px", fontWeight: 700, fontSize: "0.86rem", background: "linear-gradient(135deg, #3b8cff, #2f7df6)", color: "#fff", cursor: "pointer" }}
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }
}
