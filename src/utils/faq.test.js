import test from "node:test";
import assert from "node:assert/strict";
import { FAQ_CATEGORIES, FAQ_ITEMS } from "../data/faq.js";

test("FAQ_CATEGORIES: 全カテゴリのidが一意で、要件通りの12カテゴリが揃っている", () => {
  const ids = FAQ_CATEGORIES.map((category) => category.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(FAQ_CATEGORIES.length, 12);
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
