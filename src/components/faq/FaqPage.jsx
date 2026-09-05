import { useEffect, useMemo, useRef, useState } from "react";
import { FAQ_CATEGORIES, FAQ_ITEMS, searchFaqItems } from "../../data/faq.js";
import {
  submitBetaFeedback,
  submitSupportInquiry,
  uploadSupportInquiryAttachment,
  SUPPORT_ATTACHMENT_MAX_COUNT,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_ALLOWED_TYPES,
} from "../../utils/supabase.js";

// ヘルプ・お問い合わせ画面(2026-09全面刷新)。目的は「使い方に関する問い合わせを極力減らし、
// 基本操作は自己解決できるようにする」こと——このためトップ画面をFAQ検索へ直接ではなく、
// 「使い方を確認する」/「不具合・お問い合わせ」の2択から始める(要件2)。使い方の質問を
// 直接メール送信する導線は作らない(要件2・5): 問い合わせフォームの種類選択に「使い方が
// わからない」は含めず、まずFAQを確認してもらう設計にする。
//
// 3つの内部ビュー(home/faq/inquiry)はすべてこの1ファイル内で完結させる——App.jsx側の
// ルーティング(activePage)は従来通り"faq"1つのままで、画面遷移はこのコンポーネント内の
// ローカルstateだけで行う(要件1: 既存のナビゲーション構造を変更しない)。
// AI機能とは完全に独立した通常機能で、外部AI APIは一切呼び出さない。

const CATEGORY_OPTIONS = [
  { value: "bug", label: "不具合・エラー" },
  { value: "display_issue", label: "数字・表示がおかしい" },
  { value: "billing", label: "契約・料金について" },
  { value: "other", label: "その他" },
];

function HomeView({ onSelectFaq, onSelectInquiry }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">HELP</p>
          <h2>ヘルプ・お問い合わせ</h2>
        </div>
      </div>
      <div className="help-home-grid">
        <button type="button" className="help-home-card" onClick={onSelectFaq}>
          <strong>使い方を確認する</strong>
          <span>基本的な操作方法はこちらから確認できます</span>
        </button>
        <button type="button" className="help-home-card" onClick={onSelectInquiry}>
          <strong>不具合・お問い合わせ</strong>
          <span>エラー・表示の不具合・解決できない問題はこちら</span>
        </button>
      </div>
    </section>
  );
}

// βテスト用「不具合・改善要望」送信モーダル(既存機能・変更なし)。上の正式な問い合わせ
// フォーム(InquiryView、支援チームのメールへ届く)とは目的が異なる別経路——こちらは
// Supabase(beta_feedbackテーブル、system_admin限定で閲覧)へ直接保存するだけの、
// βテスト運営向けの継続的なフィードバック窓口としてそのまま残す。
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

function FaqView({ onBackHome, onGoToInquiry, onOpenBetaFeedback }) {
  const [searchQuery, setSearchQuery] = useState("");

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
        <button type="button" className="text-button" onClick={onBackHome}>← ヘルプのトップに戻る</button>
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
        <button type="button" className="primary-button" onClick={onGoToInquiry}>お問い合わせする</button>
        {/* βテスト用の不具合・改善要望導線。「お問い合わせする」ほど目立たせず、text-button
            (控えめな見た目、既存の共通クラス)で並べるだけにとどめる(既存の位置づけを維持)。 */}
        <p className="faq-beta-feedback-row">
          <button type="button" className="text-button" onClick={onOpenBetaFeedback}>不具合・改善要望を送る（β）</button>
        </p>
      </section>

      {/* アプリバージョン表示: 不具合報告時に、古いキャッシュ/古いビルドを使っていないかを
          判断する材料。__APP_VERSION__はvite.config.jsのdefineで注入されるビルド時定数。 */}
      <p className="faq-version-footer">Version {typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"}</p>
    </div>
  );
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function InquiryView({ onBackHome, onBackFaq, companyId, storeId, companyName, storeName, userName, targetMonth, originScreenLabel }) {
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");
  // { file, previewUrl }の配列。実際のStorageアップロードは送信ボタンを押した時点まで
  // 行わない(要件8: 送信前に自由に追加・削除できる、Storageへ何も触れないままキャンセルできる)。
  const [attachments, setAttachments] = useState([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const fileInputRef = useRef(null);
  // 同じ問い合わせは同じidを使い回す(通信失敗後の再送でも二重送信にならないよう、
  // Edge Function側のidempotencyの鍵として機能させる、要件18)。
  const inquiryIdRef = useRef(null);

  useEffect(() => {
    return () => {
      attachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilesSelected = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = ""; // 同じファイルを続けて選び直せるようにする
    if (files.length === 0) return;
    setAttachmentError("");

    let nextAttachments = attachments;
    for (const file of files) {
      if (nextAttachments.length >= SUPPORT_ATTACHMENT_MAX_COUNT) {
        setAttachmentError(`画像は最大${SUPPORT_ATTACHMENT_MAX_COUNT}枚までです。`);
        break;
      }
      if (!SUPPORT_ATTACHMENT_ALLOWED_TYPES.includes(file.type)) {
        setAttachmentError("対応していない画像形式です。JPEG・PNG・WEBP等の画像を選択してください。");
        continue;
      }
      if (file.size > SUPPORT_ATTACHMENT_MAX_BYTES) {
        setAttachmentError("画像サイズが大きすぎます。5MB以下の画像を選択してください。");
        continue;
      }
      nextAttachments = [...nextAttachments, { file, previewUrl: URL.createObjectURL(file) }];
    }
    setAttachments(nextAttachments);
  };

  const removeAttachment = (index) => {
    setAttachments((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
    setAttachmentError("");
  };

  const isMessageEmpty = !message.trim();
  const canSubmit = category && !isMessageEmpty && status.state !== "saving";

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!inquiryIdRef.current) inquiryIdRef.current = crypto.randomUUID();
    const inquiryId = inquiryIdRef.current;

    setStatus({ state: "saving", message: "送信しています…" });

    const attachmentPaths = [];
    for (const attachment of attachments) {
      // eslint-disable-next-line no-await-in-loop
      const uploadResult = await uploadSupportInquiryAttachment({ companyId, inquiryId, file: attachment.file });
      if (!uploadResult.ok) {
        setStatus({ state: "error", message: "お問い合わせを送信できませんでした。時間をおいてもう一度お試しください。" });
        return;
      }
      attachmentPaths.push(uploadResult.path);
    }

    const result = await submitSupportInquiry({
      inquiryId,
      category,
      message: message.trim(),
      storeId,
      currentPage: originScreenLabel,
      targetMonth,
      currentUrl: typeof window !== "undefined" ? window.location.href : "",
      attachmentPaths,
    });

    if (!result.ok) {
      setStatus({ state: "error", message: "お問い合わせを送信できませんでした。時間をおいてもう一度お試しください。" });
      return;
    }
    setStatus({ state: "sent", message: "" });
  };

  if (status.state === "sent") {
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">INQUIRY</p>
            <h2>お問い合わせ</h2>
          </div>
        </div>
        <div className="notice-box success">
          お問い合わせを受け付けました。<br />
          内容を確認のうえ、必要に応じてご連絡いたします。
        </div>
        <button type="button" className="secondary-button" onClick={onBackHome}>ヘルプのトップに戻る</button>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">INQUIRY</p>
          <h2>お問い合わせ</h2>
        </div>
      </div>
      <p className="helper-text">
        {companyName || "会社"} / {storeName || "店舗未指定"} / {userName || ""} としてのお問い合わせとして送信されます。
      </p>

      <div className="field">
        <span>問い合わせ種類</span>
        <div className="segmented-control support-category-select" role="group" aria-label="問い合わせ種類">
          {CATEGORY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={category === option.value ? "segmented-button active" : "segmented-button"}
              onClick={() => setCategory(option.value)}
              disabled={status.state === "saving"}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>お問い合わせ内容</span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
          placeholder="どのような問題が起きているか、できるだけ具体的にご記入ください"
          disabled={status.state === "saving"}
        />
      </label>

      <div className="field">
        <span>スクリーンショットを添付</span>
        <p className="helper-text">問題が起きている画面の画像を添付すると、より早く確認できます（任意、最大{SUPPORT_ATTACHMENT_MAX_COUNT}枚）。</p>
        {attachments.length < SUPPORT_ATTACHMENT_MAX_COUNT ? (
          <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()} disabled={status.state === "saving"}>
            画像を選択
          </button>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORT_ATTACHMENT_ALLOWED_TYPES.join(",")}
          multiple
          onChange={handleFilesSelected}
          style={{ display: "none" }}
        />
        {attachmentError ? <div className="notice-box error">{attachmentError}</div> : null}
        {attachments.length > 0 ? (
          <div className="support-attachment-preview-grid">
            {attachments.map((attachment, index) => (
              <div key={attachment.previewUrl} className="support-attachment-preview-item">
                <img src={attachment.previewUrl} alt={`添付画像${index + 1}`} />
                <button type="button" className="support-attachment-remove" onClick={() => removeAttachment(index)} disabled={status.state === "saving"} aria-label="削除">×</button>
                <small>{formatFileSize(attachment.file.size)}</small>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {status.state === "error" ? <div className="notice-box error">{status.message}</div> : null}

      <div className="button-row">
        <button type="button" className="secondary-button" onClick={onBackFaq} disabled={status.state === "saving"}>FAQに戻る</button>
        <button type="button" className="primary-button" onClick={handleSubmit} disabled={!canSubmit}>
          {status.state === "saving" ? "送信しています…" : "送信する"}
        </button>
      </div>
    </section>
  );
}

export default function FaqPage({
  companyId = "",
  storeId = "",
  userId = "",
  companyName = "",
  storeName = "",
  userName = "",
  targetMonth = "",
  originScreenLabel = "",
}) {
  const [view, setView] = useState("home");
  const [showBetaFeedbackModal, setShowBetaFeedbackModal] = useState(false);

  return (
    <div className="stack">
      {view === "home" && <HomeView onSelectFaq={() => setView("faq")} onSelectInquiry={() => setView("inquiry")} />}
      {view === "faq" && (
        <FaqView
          onBackHome={() => setView("home")}
          onGoToInquiry={() => setView("inquiry")}
          onOpenBetaFeedback={() => setShowBetaFeedbackModal(true)}
        />
      )}
      {view === "inquiry" && (
        <InquiryView
          onBackHome={() => setView("home")}
          onBackFaq={() => setView("faq")}
          companyId={companyId}
          storeId={storeId}
          companyName={companyName}
          storeName={storeName}
          userName={userName}
          targetMonth={targetMonth}
          originScreenLabel={originScreenLabel}
        />
      )}

      {showBetaFeedbackModal ? <BetaFeedbackModal onClose={() => setShowBetaFeedbackModal(false)} companyId={companyId} storeId={storeId} userId={userId} /> : null}
    </div>
  );
}
