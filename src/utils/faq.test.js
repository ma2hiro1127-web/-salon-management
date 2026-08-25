import test from "node:test";
import assert from "node:assert/strict";
import { FAQ_CATEGORIES, FAQ_ITEMS, searchFaqItems } from "../data/faq.js";

// 使い方・FAQ全面ブラッシュアップ(要件)でカテゴリを13個(「まとめて入力」を独立カテゴリとして
// 新設、表示順も一般スタッフが最も使う画面が上位に来るよう並び替え)に再編した。
test("FAQ_CATEGORIES: 全カテゴリのidが一意で、要件通りの13カテゴリが揃っている", () => {
  const ids = FAQ_CATEGORIES.map((category) => category.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(FAQ_CATEGORIES.length, 13);
});

test("FAQ_CATEGORIES: 表示順(displayOrder)が要件通り、日次入力・日締めが売上より上位(一般スタッフが最も使う画面を優先する方針)", () => {
  const byId = Object.fromEntries(FAQ_CATEGORIES.map((category) => [category.id, category.displayOrder]));
  assert.ok(byId.intro < byId.daily, "「はじめに」は「日次入力・日締め」より前");
  assert.ok(byId.daily < byId.sales, "「日次入力・日締め」は「売上」より前(一般スタッフが最も使う画面を上位にする方針)");
  assert.ok(byId.sales < byId.monthlyTarget);
  assert.ok(byId.monthlyTarget < byId.monthlyDashboard);
  assert.ok(byId.monthlyDashboard < byId.batchEntry);
  assert.ok(byId.batchEntry < byId.monthClosing);
  assert.ok(byId.trouble === Math.max(...Object.values(byId)), "「よくあるトラブル」が最後");
});

test("FAQ_ITEMS: 全項目のidが一意で、必須フィールド(question/answer)が空でない", () => {
  const ids = FAQ_ITEMS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, "id must be unique across all FAQ items");
  FAQ_ITEMS.forEach((item) => {
    assert.ok(item.question && item.question.trim(), `${item.id} is missing a question`);
    assert.ok(item.answer && item.answer.trim(), `${item.id} is missing an answer`);
  });
});

test("FAQ_ITEMS: すべてのcategoryがFAQ_CATEGORIESに実在するidを指している(存在しないカテゴリのFAQが画面に表示されず消えることを防ぐ)", () => {
  const validCategoryIds = new Set(FAQ_CATEGORIES.map((category) => category.id));
  FAQ_ITEMS.forEach((item) => {
    assert.ok(validCategoryIds.has(item.category), `${item.id} references unknown category "${item.category}"`);
  });
});

test("FAQ_ITEMS: 各カテゴリに最低1件は有効なFAQがある(要件5の初期コンテンツが揃っていることの確認)", () => {
  const categoriesWithEnabledItems = new Set(FAQ_ITEMS.filter((item) => item.enabled !== false).map((item) => item.category));
  FAQ_CATEGORIES.forEach((category) => {
    assert.ok(categoriesWithEnabledItems.has(category.id), `category "${category.id}" has no enabled FAQ items`);
  });
});

// FAQ全面ブラッシュアップの要件: 「質問文だけでなく回答文もキーワード検索対象にする」の
// 直接的な回帰テスト。質問文・keywordsのどちらにも一切出てこず、回答本文にしか無い言葉を
// 意図的に用意し、それでも見つかることを確認する——これが回答本文検索が実際に効いている
// ことの証明(質問文だけを見ていたら絶対に見つからない)。
test("searchFaqItems: 質問文・keywordsのどちらにも無く、回答本文にしか無い言葉でも見つかる(回答本文も検索対象)", () => {
  const sample = [{ id: "sample-1", category: "trouble", enabled: true, question: "設定が反映されないときは？", answer: "むらさきいろのボタンを押してください。", keywords: ["設定", "反映"] }];
  const results = searchFaqItems(sample, "むらさきいろ");
  assert.equal(results.length, 1, "質問文・keywordsに無い、回答本文だけの言葉でもヒットするはず");
  assert.equal(results[0].id, "sample-1");
});

// 実データでも同じ経路(回答本文経由のヒット)が機能していることを確認する——「緑にならない」は
// FAQ本文中(daily-6の質問・回答)に登場する言葉で、日締め後にカレンダーが緑にならないという
// トラブルのFAQが見つかることを検証する。
test("searchFaqItems: 「緑にならない」で日締め後カレンダーのFAQが見つかる", () => {
  const results = searchFaqItems(FAQ_ITEMS, "緑にならない");
  assert.ok(results.some((item) => item.id === "daily-6"), "日締め後にカレンダーが緑にならないFAQがヒットするはず");
});

// ユーザーが実際に入力しそうな短いキーワードで、全カテゴリ横断的にそれぞれ1件以上
// 見つかることを確認する(要件に明示された検索語一覧)。
test("searchFaqItems: 実際に入力されそうな短いキーワードで、想定される全ての言葉が1件以上ヒットする", () => {
  const expectedHits = [
    "緑にならない", "日締め", "編集できない", "過去", "保存", "戻る", "数字が違う",
    "更新されない", "招待", "メール届かない", "パスワード", "権限", "メニューがない",
    "口コミ", "未入力", "固定費", "CSV", "まとめて入力", "店舗", "全店舗",
  ];
  expectedHits.forEach((keyword) => {
    const results = searchFaqItems(FAQ_ITEMS, keyword);
    assert.ok(results.length > 0, `"${keyword}" で1件もヒットしなかった`);
  });
});

test("searchFaqItems: 部分一致・大文字小文字を無視した検索が機能する(日本語・英字とも)", () => {
  assert.ok(searchFaqItems(FAQ_ITEMS, "招待").length > 0);
  assert.ok(searchFaqItems(FAQ_ITEMS, "csv").length > 0, "小文字csvでも大文字CSVを含むFAQがヒットする");
  assert.ok(searchFaqItems(FAQ_ITEMS, "CSV").length > 0);
});

test("searchFaqItems: 空文字・空白のみの検索語では全ての有効なFAQをそのまま返す(絞り込みしない)", () => {
  const enabledCount = FAQ_ITEMS.filter((item) => item.enabled !== false).length;
  assert.equal(searchFaqItems(FAQ_ITEMS, "").length, enabledCount);
  assert.equal(searchFaqItems(FAQ_ITEMS, "   ").length, enabledCount);
});

test("searchFaqItems: 一致するFAQが無いキーワードでは0件を返す(検索結果0件表示の前提)", () => {
  assert.equal(searchFaqItems(FAQ_ITEMS, "存在しないはずのキーワードxyz123").length, 0);
});

test("searchFaqItems: enabled:falseのFAQは検索キーワードに一致しても結果に含まれない", () => {
  const disabledSample = [{ id: "hidden-1", category: "trouble", enabled: false, question: "非表示テスト質問", answer: "非表示テスト回答", keywords: [] }];
  assert.equal(searchFaqItems(disabledSample, "非表示テスト").length, 0);
  assert.equal(searchFaqItems(disabledSample, "").length, 0);
});
