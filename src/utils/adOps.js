// AI広告自動運用システム(V1)の純粋計算ロジック。UIコンポーネント・Edge Functionのどちらへも
// 計算式を直接ベタ書きしない(損益機能のcalculateLaborCost等と同じ方針)。company_id/store_id
// に紐づかない社内マーケティングデータのみを扱う、既存のstorage.js/permissions.jsとは独立した
// モジュール(要件23)。
//
// CPA(spend ÷ 件数)は分母が0の場合、0円や無限大ではなくnullを返す——「まだ計算できない」
// (登録0件・有料0件)と「0円で獲得できた」を混同しないため(既存のisProvisionalProfit/
// categoryHasEntryと同じ、null=未算出/0=実際に0、という区別の考え方)。

export const calculateAdCpa = ({ spend, registrations, paidUsers }) => {
  const spendValue = Number(spend) || 0;
  const registrationCount = Number(registrations) || 0;
  const paidCount = Number(paidUsers) || 0;
  return {
    registrationCpa: registrationCount > 0 ? spendValue / registrationCount : null,
    paidCpa: paidCount > 0 ? spendValue / paidCount : null,
  };
};

export const calculateAdRates = ({ spend, impressions, clicks, registrations, onboardingCompleted, paidUsers, revenue }) => {
  const spendValue = Number(spend) || 0;
  const impressionCount = Number(impressions) || 0;
  const clickCount = Number(clicks) || 0;
  const registrationCount = Number(registrations) || 0;
  const onboardingCompletedCount = Number(onboardingCompleted) || 0;
  const paidCount = Number(paidUsers) || 0;
  const revenueValue = Number(revenue) || 0;
  return {
    ctr: impressionCount > 0 ? (clickCount / impressionCount) * 100 : null,
    cpc: clickCount > 0 ? spendValue / clickCount : null,
    registrationRate: clickCount > 0 ? (registrationCount / clickCount) * 100 : null,
    onboardingCompletionRate: registrationCount > 0 ? (onboardingCompletedCount / registrationCount) * 100 : null,
    paidConversionRate: registrationCount > 0 ? (paidCount / registrationCount) * 100 : null,
    // ROAS = 売上 ÷ 広告費。広告費0円は計算不能(null)、売上0円は0を返す(実際に0円という
    // 意味のある値のため、nullにはしない)。
    roas: spendValue > 0 ? revenueValue / spendValue : null,
    arpu: paidCount > 0 ? revenueValue / paidCount : null,
  };
};

// 有料CPAが最も低い広告を「勝ち広告」とする(要件8: 登録数が多い広告ではなく、有料CPAが
// 低い広告を勝ちと判定する)。有料CPAが算出できない広告(paidCpaがnull)は対象外。
export const classifyWinningAd = (adsWithCpa) => {
  const candidates = (Array.isArray(adsWithCpa) ? adsWithCpa : []).filter(
    (ad) => typeof ad?.paidCpa === "number" && Number.isFinite(ad.paidCpa)
  );
  if (!candidates.length) return null;
  return candidates.reduce((best, ad) => (ad.paidCpa < best.paidCpa ? ad : best));
};

// 予算変更提案の安全装置チェック(要件13)。Edge Function/RLS側の最終防御とは別に、UI側でも
// 早期に理由を伝えるための関数。提案額が0円以下、1日上限超過、増額幅が上限を超えている場合は
// 拒否する。current(現在の日予算)が0円/未設定の場合は増額率チェックをスキップする(初めて
// 予算を設定する広告に対して、存在しない「増加率」を計算しようとしないため)。
export const validateBudgetProposal = ({ current, proposed, maxIncreasePercent, dailyMaxSpend }) => {
  const currentValue = Number(current) || 0;
  const proposedValue = Number(proposed) || 0;
  if (!(proposedValue > 0)) {
    return { ok: false, reason: "提案額は0円より大きい金額にしてください" };
  }
  if (dailyMaxSpend !== undefined && dailyMaxSpend !== null && proposedValue > Number(dailyMaxSpend)) {
    return { ok: false, reason: `1日の上限額(${Number(dailyMaxSpend).toLocaleString("ja-JP")}円)を超えています` };
  }
  if (currentValue > 0) {
    const increasePercent = ((proposedValue - currentValue) / currentValue) * 100;
    const limit = Number(maxIncreasePercent) || 0;
    if (increasePercent > limit) {
      return { ok: false, reason: `増額幅が上限(${limit}%)を超えています(今回の増額率: ${increasePercent.toFixed(1)}%)` };
    }
  }
  return { ok: true, reason: "" };
};

// utm_source/utm_campaign/utm_contentの完全一致からad_idを解決する(log_ad_conversion_event
// RPCと同じロジック、クライアント側で候補広告を絞り込む際に使う)。3つとも空文字の場合や
// utm_sourceが空の場合は解決しない(通常の招待・非広告経由の登録と区別するため)。
export const resolveAdIdFromUtm = (ads, { utmSource, utmCampaign, utmContent } = {}) => {
  const source = utmSource || "";
  if (!source) return null;
  const campaign = utmCampaign || "";
  const content = utmContent || "";
  const match = (Array.isArray(ads) ? ads : []).find(
    (ad) => (ad.utmSource || "") === source && (ad.utmCampaign || "") === campaign && (ad.utmContent || "") === content
  );
  return match?.id || null;
};
