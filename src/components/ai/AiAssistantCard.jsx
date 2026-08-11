const QUICK_QUESTIONS = [
  "今月の経営状況を分析",
  "売上が伸びない原因を分析",
  "新規客が少ない原因を分析",
  "利益を増やす方法を相談",
  "このアプリの使い方を質問",
];

// ダッシュボードのAI相談カード。数字の表示は一切持たず、AIチャット画面(AiChatScreen)への
// 入り口(クイック質問チップ / 「AIに相談する」ボタン)を提供するだけ。
export default function AiAssistantCard({ onOpen, onQuickQuestion }) {
  return (
    <div className="ai-assistant-card">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">AI ASSISTANT</p>
          <h3>AI経営アシスタント</h3>
        </div>
      </div>
      <p className="helper-text">
        売上・客数・目標・経費などの数字をもとに、経営分析や改善方法をAIに相談できます。アプリの使い方についても質問できます。
      </p>
      <div className="ai-chip-row">
        {QUICK_QUESTIONS.map((question) => (
          <button key={question} type="button" className="ai-chip" onClick={() => onQuickQuestion(question)}>
            {question}
          </button>
        ))}
      </div>
      <div className="button-row">
        <button type="button" className="primary-button" onClick={onOpen}>AIに相談する ＞</button>
      </div>
    </div>
  );
}
