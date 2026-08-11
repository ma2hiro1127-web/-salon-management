import { useEffect, useRef, useState } from "react";
import { formatMonthLabel } from "../../utils/storage.js";
import { buildAiContext } from "../../utils/aiContext.js";
import { sendAiMessage } from "../../utils/aiClient.js";

const INITIAL_QUESTIONS = [
  "今月の経営状況を分析",
  "目標達成できそう？",
  "売上を上げるなら何を改善する？",
  "客数が少ない原因を調べたい",
  "利益を改善したい",
  "Salon Managerの使い方を聞く",
];

// AI相談のフルスクリーンチャット画面。店舗選択・目標・売上・費用などのビジネスロジックは
// 一切持たず、(1) props で受け取った既計算値を aiContext.js で整形し、(2) aiClient.js 経由で
// サーバーへ送るだけ。権限チェックはサーバー側(Supabase Edge Function)が行う。
// 店舗/月はダッシュボードの topbar からしか変更できず、このオーバーレイは topbar を覆う
// フルスクリーン表示のため、開いている間は対象スコープが変わらない(=会話をライブで
// 再スコープする必要がない)。閉じて再度開くたびに新しい会話として開始する。
export default function AiChatScreen({
  role,
  storeName,
  storeId,
  monthValue,
  isAllStoresView,
  summary,
  target,
  businessDaySummary,
  initialQuestion = "",
  onClose,
}) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState("");
  const messagesEndRef = useRef(null);
  const initialQuestionSentRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  const scopeLabel = isAllStoresView ? "全店舗" : (storeName || "店舗未選択");
  const monthLabel = monthValue ? formatMonthLabel(monthValue) : "";

  const sendMessage = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setErrorText("");
    const history = messages;
    const nextMessages = [...history, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInputValue("");
    setSending(true);
    try {
      const context = buildAiContext({
        role, storeName, storeId, monthValue, isAllStoresView, summary, target, businessDaySummary,
      });
      const reply = await sendAiMessage({ context, history, message: trimmed });
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "AI機能は現在準備中です。しばらくお待ちください。");
      // 送信できなかったユーザーメッセージは会話に残したまま、エラーだけ表示する
      // (再入力の手間を避けるため取り消さない)
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (initialQuestion && !initialQuestionSentRef.current) {
      initialQuestionSentRef.current = true;
      sendMessage(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();
    sendMessage(inputValue);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage(inputValue);
    }
  };

  return (
    <div className="ai-chat-overlay">
      <div className="ai-chat-screen">
        <header className="ai-chat-header">
          <button type="button" className="ai-chat-back" onClick={onClose} aria-label="閉じる">←</button>
          <div className="ai-chat-header-text">
            <strong>AI経営アシスタント</strong>
            <span>{scopeLabel}{monthLabel ? ` / ${monthLabel}を分析中` : ""}</span>
          </div>
        </header>

        <div className="ai-chat-messages">
          {messages.length === 0 && !sending ? (
            <div className="ai-chat-empty">
              <p className="helper-text">気になることを選ぶか、下から自由に質問できます。</p>
              <div className="ai-chip-row">
                {INITIAL_QUESTIONS.map((question) => (
                  <button key={question} type="button" className="ai-chip" onClick={() => sendMessage(question)}>
                    {question}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((entry, index) => (
            <div key={index} className={`ai-chat-message ${entry.role}`}>
              {entry.content}
            </div>
          ))}
          {sending ? <div className="ai-chat-message assistant ai-chat-typing">考えています…</div> : null}
          {errorText ? <div className="notice-box ai-chat-error">{errorText}</div> : null}
          <div ref={messagesEndRef} />
        </div>

        <form className="ai-chat-input-row" onSubmit={handleSubmit}>
          <textarea
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="経営について質問する(例: 客数が少ない原因は？)"
            rows={1}
            disabled={sending}
          />
          <button type="submit" className="primary-button" disabled={sending || !inputValue.trim()}>送信</button>
        </form>
      </div>
    </div>
  );
}
