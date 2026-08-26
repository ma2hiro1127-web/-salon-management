import test from "node:test";
import assert from "node:assert/strict";
import { calculateAdCpa, calculateAdRates, classifyWinningAd, validateBudgetProposal, resolveAdIdFromUtm } from "./adOps.js";

test("calculateAdCpa: 要件8の例(広告A) — 広告費10,000円・無料登録10件・有料3件 → 登録CPA1,000円/有料CPA3,333円(切り捨てない実数)", () => {
  const result = calculateAdCpa({ spend: 10000, registrations: 10, paidUsers: 3 });
  assert.equal(result.registrationCpa, 1000);
  assert.equal(Math.round(result.paidCpa), 3333);
});

test("calculateAdCpa: 要件8の例(広告B) — 広告費10,000円・無料登録20件・有料1件 → 登録CPA500円/有料CPA10,000円", () => {
  const result = calculateAdCpa({ spend: 10000, registrations: 20, paidUsers: 1 });
  assert.equal(result.registrationCpa, 500);
  assert.equal(result.paidCpa, 10000);
});

test("calculateAdCpa: 登録0件・有料0件は0円ではなくnull(未算出)を返す(未入力と0円獲得を混同しない)", () => {
  const result = calculateAdCpa({ spend: 10000, registrations: 0, paidUsers: 0 });
  assert.equal(result.registrationCpa, null);
  assert.equal(result.paidCpa, null);
});

test("classifyWinningAd(要件8): 登録数が多い広告Bではなく、有料CPAが低い広告Aを勝ち広告と判定する", () => {
  const adA = { id: "adA", ...calculateAdCpa({ spend: 10000, registrations: 10, paidUsers: 3 }) };
  const adB = { id: "adB", ...calculateAdCpa({ spend: 10000, registrations: 20, paidUsers: 1 }) };
  const winner = classifyWinningAd([adA, adB]);
  assert.equal(winner.id, "adA");
});

test("classifyWinningAd: 有料CPAが未算出(null)の広告は候補から除外する", () => {
  const adA = { id: "adA", paidCpa: null };
  const adB = { id: "adB", paidCpa: 5000 };
  const winner = classifyWinningAd([adA, adB]);
  assert.equal(winner.id, "adB");
});

test("classifyWinningAd: 候補が1件も無ければnullを返す", () => {
  assert.equal(classifyWinningAd([{ id: "adA", paidCpa: null }]), null);
  assert.equal(classifyWinningAd([]), null);
});

test("calculateAdRates: CTR/CPC/登録率/初期設定完了率/有料化率/ARPUを正しく算出する", () => {
  const rates = calculateAdRates({
    spend: 10000, impressions: 5000, clicks: 100, registrations: 10, onboardingCompleted: 8, paidUsers: 3, revenue: 15000,
  });
  assert.equal(rates.ctr, 2); // 100/5000*100
  assert.equal(rates.cpc, 100); // 10000/100
  assert.equal(rates.registrationRate, 10); // 10/100*100
  assert.equal(rates.onboardingCompletionRate, 80); // 8/10*100
  assert.equal(rates.paidConversionRate, 30); // 3/10*100
  assert.equal(rates.roas, 1.5); // 15000/10000
  assert.equal(Math.round(rates.arpu), 5000); // 15000/3
});

test("calculateAdRates: 分母が0の指標はnull(インプレッション0でCTR未算出、クリック0でCPC未算出)", () => {
  const rates = calculateAdRates({ spend: 0, impressions: 0, clicks: 0, registrations: 0, onboardingCompleted: 0, paidUsers: 0, revenue: 0 });
  assert.equal(rates.ctr, null);
  assert.equal(rates.cpc, null);
  assert.equal(rates.registrationRate, null);
  assert.equal(rates.onboardingCompletionRate, null);
  assert.equal(rates.paidConversionRate, null);
  assert.equal(rates.roas, null);
  assert.equal(rates.arpu, null);
});

test("validateBudgetProposal: 増額幅が上限(30%)以内なら承認可能", () => {
  const result = validateBudgetProposal({ current: 1000, proposed: 1300, maxIncreasePercent: 30, dailyMaxSpend: 2000 });
  assert.equal(result.ok, true);
});

test("validateBudgetProposal(要件13): 増額幅が上限(30%)を超えると拒否する", () => {
  const result = validateBudgetProposal({ current: 1000, proposed: 1500, maxIncreasePercent: 30, dailyMaxSpend: 2000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /増額幅/);
});

test("validateBudgetProposal(要件13): 1日の上限額を超える提案は増額率に関わらず拒否する", () => {
  const result = validateBudgetProposal({ current: 1000, proposed: 1100, maxIncreasePercent: 30, dailyMaxSpend: 1000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /1日の上限額/);
});

test("validateBudgetProposal: 提案額が0円以下は拒否する", () => {
  const result = validateBudgetProposal({ current: 1000, proposed: 0, maxIncreasePercent: 30, dailyMaxSpend: 2000 });
  assert.equal(result.ok, false);
});

test("validateBudgetProposal: 現在の予算が未設定(0円)の広告は、初回設定として増額率チェックをスキップする", () => {
  const result = validateBudgetProposal({ current: 0, proposed: 1000, maxIncreasePercent: 30, dailyMaxSpend: 2000 });
  assert.equal(result.ok, true);
});

test("resolveAdIdFromUtm: utm_source/campaign/contentの完全一致でad_idを解決する", () => {
  const ads = [
    { id: "ad1", utmSource: "instagram", utmCampaign: "profit_01", utmContent: "video_a" },
    { id: "ad2", utmSource: "tiktok", utmCampaign: "pos_01", utmContent: "video_b" },
  ];
  assert.equal(resolveAdIdFromUtm(ads, { utmSource: "instagram", utmCampaign: "profit_01", utmContent: "video_a" }), "ad1");
  assert.equal(resolveAdIdFromUtm(ads, { utmSource: "tiktok", utmCampaign: "pos_01", utmContent: "video_b" }), "ad2");
});

test("resolveAdIdFromUtm: 一致する広告が無い/utm_sourceが空の場合はnullを返す(通常の招待登録と区別)", () => {
  const ads = [{ id: "ad1", utmSource: "instagram", utmCampaign: "profit_01", utmContent: "video_a" }];
  assert.equal(resolveAdIdFromUtm(ads, { utmSource: "instagram", utmCampaign: "other", utmContent: "video_a" }), null);
  assert.equal(resolveAdIdFromUtm(ads, {}), null);
  assert.equal(resolveAdIdFromUtm(ads, { utmSource: "", utmCampaign: "profit_01", utmContent: "video_a" }), null);
});
