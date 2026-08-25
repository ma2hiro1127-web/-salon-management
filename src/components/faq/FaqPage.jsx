import { useMemo, useState } from "react";
import { FAQ_CATEGORIES, FAQ_ITEMS, searchFaqItems } from "../../data/faq.js";
import { submitBetaFeedback } from "../../utils/supabase.js";

// 使い方・FAQ画面。AI機能とは完全に独立した通常機能 — このファイルはFAQ_ITEMS/
// FAQ_CATEGORIES(src/data/faq.js、静的データ)を読んで表示・キーワード検索するだけで、
// 外部AI API(Claude/OpenAI等)は一切呼び出さない。検索自体(searchFaqItems)もfaq.js側の
// 純粋関数として切り出してあり、単純な部分一致であり、AI要約や意味検索ではない。現時点では
// AI相談への導線・リンクは意図的に設置しない。

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

// βテスト用「不具合・改善要望」送信モーダル(要件8)。上のContactModal(コピー専用・即時の
// 個別サポート向け)とは目的が異なる別モーダル——こちらはSupabase(beta_feedbackテーブル、
// system_admin限定で閲覧)へ直接保存し、β運営側が後からまとめて確認・分析できるようにする
// ためのもの。大規模な新規システムは不要という要件のため、既存のContactModalと同じ最小限の
// フィールド構成(対象画面・何をしようとしたか・何が起きたか・自由記述)にとどめる。
// スクリーンショット添付は今回未対応(別途Storageバケット・アップロードUIが必要になり、
// 「大規模な新規システムは不要」という方針とバランスを取り、テキストのみに絞った)。
function BetaFeedbackModal({ onClose, companyId, storeId, userId }) {
  const [screen, setScreen] = useState("");
  const [situation, setSituation] = useState("");
  const [whatHappened, setWhatHappened] = useState("");
  const [freeText, setFreeText] = useState("");
  const [status, setStatus] = useState({ state: "idle", message: "" });

  const handleSubmit = async () => {
    if (status.state === "saving") return;
    setStatus({ state: "saving", message: "送信中…" });
    const result = await submitBetaFeedback({
      companyId,
      storeId,
      userId,
      screen,
      situation,
      whatHappened,
      freeText,
      appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
    });
    if (result.ok) {
      setStatus({ state: "sent", message: "送信しました。ご協力ありがとうございます。" });
      return;
    }
    // 通信失敗時に入力内容を消さない(要件3と同じ方針) — フォームの値はstateのまま維持し、
    // エラー表示だけを出す。ユーザーは内容を直さずそのまま再送を試せる。
    setStatus({ state: "error", message: "送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。" });
  };

  const isSent = status.state === "sent";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">BETA FEEDBACK</p>
            <h3>不具合・改善要望を送る</h3>
          </div>
        </div>
        <p className="helper-text">
          βテスト期間中の不具合報告・改善要望はこちらからお送りください。運営チームが内容を確認します(個別の返信は行わない場合があります)。
        </p>
        <label className="field">
          <span>対象画面</span>
          <input value={screen} onChange={(event) => { setScreen(event.target.value); setStatus({ state: "idle", message: "" }); }} placeholder="例：日次入力" disabled={isSent} />
        </label>
        <label className="field">
          <span>何をしようとしたか</span>
          <textarea value={situation} onChange={(event) => { setSituation(event.target.value); setStatus({ state: "idle", message: "" }); }} rows={2} placeholder="例：口コミ数を入力しようとした" disabled={isSent} />
        </label>
        <label className="field">
          <span>何が起きたか</span>
          <textarea value={whatHappened} onChange={(event) => { setWhatHappened(event.target.value); setStatus({ state: "idle", message: "" }); }} rows={2} placeholder="例：入力欄が表示されなかった" disabled={isSent} />
        </label>
        <label className="field">
          <span>自由記述（任意）</span>
          <textarea value={freeText} onChange={(event) => { setFreeText(event.target.value); setStatus({ state: "idle", message: "" }); }} rows={3} placeholder="その他、気づいた点があればご記入ください" disabled={isSent} />
        </label>
        {status.message ? <div className={`notice-box${status.state === "error" ? " error" : ""}`}>{status.message}</div> : null}
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={onClose}>{isSent ? "閉じる" : "キャンセル"}</button>
          {!isSent ? (
            <button type="button" className="primary-button" onClick={handleSubmit} disabled={status.state === "saving"}>
              {status.state === "saving" ? "送信中…" : "送信する"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function FaqPage({ companyId = "", storeId = "", userId = "" }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showContactModal, setShowContactModal] = useState(false);
  const [showBetaFeedbackModal, setShowBetaFeedbackModal] = useState(false);

  const itemsByCategory = useMemo(() => {
    const matched = searchFaqItems(FAQ_ITEMS, searchQuery);
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
                  <summary className="faq-question"><span className="faq-question-text">{item.question}</span></summary>
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
        {/* βテスト用の不具合・改善要望導線(要件8)。「管理者に問い合わせる」ほど目立たせず、
            text-button(控えめな見た目、既存の共通クラス)で並べるだけにとどめる。 */}
        <p className="faq-beta-feedback-row">
          <button type="button" className="text-button" onClick={() => setShowBetaFeedbackModal(true)}>不具合・改善要望を送る（β）</button>
        </p>
      </section>

      {/* アプリバージョン表示(要件5): 不具合報告時に、古いキャッシュ/古いビルドを使って
          いないかを判断する材料。__APP_VERSION__はvite.config.jsのdefineで注入される
          ビルド時定数(デプロイのたびに自動で変わる、Vercelのgitコミット短縮SHA)。 */}
      <p className="faq-version-footer">Version {typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"}</p>

      {showContactModal ? <ContactModal onClose={() => setShowContactModal(false)} /> : null}
      {showBetaFeedbackModal ? <BetaFeedbackModal onClose={() => setShowBetaFeedbackModal(false)} companyId={companyId} storeId={storeId} userId={userId} /> : null}
    </div>
  );
}
