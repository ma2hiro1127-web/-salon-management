// モバイルではAI相談機能の主要な入口となる、右下固定のフローティングボタン。
// 既存UIに position:fixed の要素が無いため、他の固定UIとの重なりは発生しない
// (z-indexはサイドバー sticky(20) とモーダル(100) の間に設定)。
export default function AiFloatingButton({ onClick }) {
  return (
    <button type="button" className="ai-floating-button" onClick={onClick} aria-label="AIに相談する">
      <span aria-hidden="true">✨</span>
      <span>AI</span>
    </button>
  );
}
