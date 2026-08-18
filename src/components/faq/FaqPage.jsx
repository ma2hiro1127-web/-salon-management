import { useMemo, useState } from "react";
import { FAQ_CATEGORIES, FAQ_ITEMS } from "../../data/faq.js";

// 使い方・FAQ画面。AI機能とは完全に独立した通常機能 — このファイルはFAQ_ITEMS/
// FAQ_CATEGORIES(src/data/faq.js、静的データ)を読んで表示・キーワード検索するだけで、
// 外部AI API(Claude/OpenAI等)は一切呼び出さない。検索も単純な部分一致であり、AI要約や
// 意味検索ではない。現時点ではAI相談への導線・リンクは意図的に設置しない。
const normalizeSearchText = (value) => String(value || "").toLowerCase();

export default function FaqPage() {
  const [searchQuery, setSearchQuery] = useState("");

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
        <p>お手数ですが、管理者へお問い合わせください。</p>
      </section>
    </div>
  );
}
