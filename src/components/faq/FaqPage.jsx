import { useMemo, useState } from "react";
import { FAQ_CATEGORIES, FAQ_ITEMS } from "../../data/faq.js";

// 使い方・FAQ画面。AI機能とは完全に独立した通常機能 — このファイルはFAQ_ITEMS/
// FAQ_CATEGORIES(src/data/faq.js、静的データ)を読んで表示・キーワード検索するだけで、
// 外部AI API(Claude/OpenAI等)は一切呼び出さない。検索も単純な部分一致であり、AI要約や
// 意味検索ではない。現時点ではAI相談への導線・リンクは意図的に設置しない。
const normalizeSearchText = (value) => String(value || "").toLowerCase();

// このFAQ画面から開いた場合に「発生している画面」欄へ自動入力する値。将来他の画面にも
// 問い合わせ導線を追加する場合は、その画面から同じ形の値を渡せばよい(今回はFAQ画面のみ)。
const CURRENT_SCREEN_LABEL = "使い方・FAQ";

function buildInquiryText({ screen, situation, content }) {
  return [
    "サロンマネージャーについて問い合わせです。",
    "",
    "【発生している画面】",
    screen || "未入力",
    "",
    "【状況】",
    situation || "未入力",
    "",
    "【問い合わせ内容】",
    content || "未入力",
  ].join("\n");
}

// 問い合わせ内容モーダル。送信システム・メール送信は実装しない — 入力内容を定型文として
// クリップボードへコピーし、利用者が普段使っている連絡手段(LINE・メール・チャット等)で
// そのままサロン管理者/導入担当者へ送れるようにするだけの、閲覧・コピー専用の機能。
function ContactModal({ onClose }) {
  const [situation, setSituation] = useState("");
  const [content, setContent] = useState("");
  const [copyStatus, setCopyStatus] = useState("idle");

  const handleCopy = async () => {
    const text = buildInquiryText({ screen: CURRENT_SCREEN_LABEL, situation, content });
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        window.prompt("問い合わせ内容", text);
      }
      setCopyStatus("copied");
    } catch (error) {
      console.warn("Clipboard write failed", error);
      window.prompt("問い合わせ内容", text);
      setCopyStatus("copied");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">CONTACT</p>
            <h3>管理者に問い合わせる</h3>
          </div>
        </div>
        <p className="helper-text">
          入力内容を定型文としてコピーできます。送信機能はありません。コピーした内容を、普段お使いの連絡手段（LINE・メール・チャット等）でサロン管理者または導入担当者へお送りください。
        </p>
        <label className="field">
          <span>発生している画面</span>
          <input value={CURRENT_SCREEN_LABEL} disabled />
        </label>
        <label className="field">
          <span>発生状況</span>
          <textarea value={situation} onChange={(event) => { setSituation(event.target.value); setCopyStatus("idle"); }} rows={3} placeholder="例：本日の日次入力画面で口コミ数の入力欄が表示されない" />
        </label>
        <label className="field">
          <span>問い合わせ内容</span>
          <textarea value={content} onChange={(event) => { setContent(event.target.value); setCopyStatus("idle"); }} rows={3} placeholder="例：口コミ数をONにしましたが表示されません。確認をお願いします。" />
        </label>
        {copyStatus === "copied" ? <div className="notice-box">問い合わせ内容をコピーしました。上記の連絡手段でお送りください。</div> : null}
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={onClose}>閉じる</button>
          <button type="button" className="primary-button" onClick={handleCopy}>問い合わせ内容をコピー</button>
        </div>
      </div>
    </div>
  );
}

export default function FaqPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showContactModal, setShowContactModal] = useState(false);

  const itemsByCategory = useMemo(() => {
    const query = normalizeSearchText(searchQuery).trim();
    const enabledItems = FAQ_ITEMS.filter((item) => item.enabled !== false);
    const matched = query
      ? enabledItems.filter((item) => {
          const haystack = normalizeSearchText([item.question, item.answer, ...(item.keywords || [])].join(" "));
          return haystack.includes(query);
        })
      : enabledItems;
    const byCategory = new Map();
    matched.forEach((item) => {
      const list = byCategory.get(item.category) || [];
      list.push(item);
      byCategory.set(item.category, list);
    });
    byCategory.forEach((list) => list.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)));
    return byCategory;
  }, [searchQuery]);

  const visibleCategories = useMemo(
    () => [...FAQ_CATEGORIES].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)).filter((category) => (itemsByCategory.get(category.id) || []).length > 0),
    [itemsByCategory]
  );

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">HELP</p>
            <h2>使い方・FAQ</h2>
          </div>
        </div>
        <p className="helper-text">サロンマネージャーの操作方法や、よくある質問を確認できます。</p>
        <label className="field">
          <span>キーワード検索</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="例：日締め、招待、CSV、店舗追加、月締め、口コミ、パスワード"
          />
        </label>
      </section>

      {visibleCategories.length ? (
        visibleCategories.map((category) => (
          <section key={category.id} className="panel">
            <div className="panel-heading compact">
              <div>
                <h3>{category.label}</h3>
              </div>
            </div>
            <div className="faq-list">
              {(itemsByCategory.get(category.id) || []).map((item) => (
                <details key={item.id} className="faq-item">
                  <summary className="faq-question">{item.question}</summary>
                  <div className="faq-answer">{item.answer}</div>
                </details>
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="empty-card">「{searchQuery}」に一致するFAQが見つかりませんでした。キーワードを変えてお試しください。</div>
      )}

      <section className="panel">
        <p className="helper-text">解決しませんでしたか？</p>
        <button type="button" className="secondary-button" onClick={() => setShowContactModal(true)}>管理者に問い合わせる</button>
      </section>

      {showContactModal ? <ContactModal onClose={() => setShowContactModal(false)} /> : null}
    </div>
  );
}
