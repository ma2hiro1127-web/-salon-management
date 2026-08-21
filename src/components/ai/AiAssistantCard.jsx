// 売上画面UI/UX改善(要件7・23): 売上画面では、右下に既存のAiFloatingButton(常設のAI入口)
// が既にあるため、このカードは役割が重複しないよう最小限のコンパクト表示にする——「今月の
// 数字をAIで分析」の一文+「AIに相談する」ボタンのみ。視線の流れ(要件23: 進捗→KPI→
// ランキング/売上構成→AIの順)でも、AIは主KPIより後ろに来る想定のため、大きな面積を占め
// ないようにする。クイック質問チップ(旧デザイン)は撤去したが、AIチャット機能自体・
// onOpen/onQuickQuestionの入り口は変更しない(onOpenのボタンはそのまま残す)。
export default function AiAssistantCard({ onOpen }) {
  return (
    <div className="ai-assistant-card ai-assistant-card-compact">
      <div className="ai-assistant-compact-row">
        <span className="ai-assistant-compact-label">✨ 今月の数字をAIで分析</span>
        <button type="button" className="secondary-button ai-assistant-compact-button" onClick={onOpen}>AIに相談する ＞</button>
      </div>
    </div>
  );
}
