// AI経営アシスタントに送信する「今どの店舗・どの月の話をしているか」のコンテキストを
// 組み立てる。新しい集計ロジックは持たず、ダッシュボードが既に計算済みの
// summary / target / businessDaySummary (App.jsx側で selectedStoreId / selectedMonth を
// もとに calculateMonthSummary または全店舗選択時は calculateAllStoresMonthSummary から
// 算出済み) を AI向けの形へ整形するだけ — ダッシュボード表示値とのズレを避けるため。
//
// company_id / store_id の紐付けは呼び出し元(App.jsx)が既に解決済みの値をそのまま使う:
// - 個別店舗選択時: summary/target/businessDaySummary は selectedStoreId・selectedMonth に
//   紐づく値(calculateMonthSummary(appState, selectedStoreId, selectedMonth, ...))
// - 全店舗選択時: summary/target/businessDaySummary は currentCompany 配下の全店舗を
//   集計した値(calculateAllStoresMonthSummary(appState, currentCompany, selectedMonth))で、
//   特定の1店舗のデータと混在しない。calculateAllStoresMonthSummary は費用・損益(P&L)を
//   意図的に含まない設計のため、全店舗選択時は costs セクションを送らない(下記参照)。

function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// 目標値専用: 「目標0」は実運用上ほぼ常に「その項目は目標を設定していない」ことを意味する
// (新規客数の目標を意図的に0人にする店舗は無い)。売上・客数などの実績値は0が現実にあり得る
// 値なので numOrNull をそのまま使うが、目標系フィールドだけはここで0もnull扱いにすることで
// 「目標未設定」と「目標0」をAIが取り違えないようにする(DB側に別途フラグを追加せずに済む)。
function targetNumOrNull(value) {
  const num = numOrNull(value);
  return num === 0 ? null : num;
}

// 「入力されているが0円」と「まだ入力されていない」をAIが混同しないよう、対象カテゴリの
// 数値が1つも正の値を持たない場合はセクションごとnullとして送る。
function hasAnyPositive(values) {
  return values.some((value) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0;
  });
}

export function buildAiContext({
  role = "",
  storeName = "",
  storeId = null,
  monthValue = "",
  isAllStoresView = false,
  summary = {},
  target = {},
  businessDaySummary = {},
} = {}) {
  const hasSalesTarget = Number(target.targetSales) > 0;
  const hasCustomerTarget = Number(target.targetCustomers) > 0;
  const hasReviewTarget = Number(target.targetReviewCount) > 0;
  const hasAnyTarget = hasSalesTarget || hasCustomerTarget || hasReviewTarget;

  // 営業日数・営業完了日数・残り営業日はカレンダー(店休日設定)から決まる値で、月間目標の
  // 登録有無とは無関係に常に存在する事実 — 目標未登録でもnullにせず常に送る。
  const businessDaysSection = {
    businessDayCount: numOrNull(businessDaySummary.businessDayCount),
    completedBusinessDays: numOrNull(businessDaySummary.completedDays ?? summary.completedDays),
    remainingBusinessDays: numOrNull(businessDaySummary.remainingBusinessDays ?? summary.remainingBusinessDays),
  };

  const targetSection = hasAnyTarget ? {
    targetSales: targetNumOrNull(target.targetSales),
    targetTechnicalSales: targetNumOrNull(target.targetTechnicalSales),
    targetRetailSales: targetNumOrNull(target.targetRetailSales),
    targetCustomers: targetNumOrNull(target.targetCustomers),
    targetAverageSpend: targetNumOrNull(target.targetAverageSpend),
    targetNewCustomers: targetNumOrNull(target.targetNewCustomers),
    targetRepeatCustomers: targetNumOrNull(target.targetRepeatCustomers),
    targetReviewCount: targetNumOrNull(target.targetReviewCount),
  } : null;

  const salesSection = {
    totalSales: numOrNull(summary.sales),
    technicalSales: numOrNull(summary.technicalSales),
    retailSales: numOrNull(summary.retailSales),
    otherSales: numOrNull(summary.otherSales),
    averageDailySales: numOrNull(summary.averageDailySales),
    targetAchievementRate: hasSalesTarget ? numOrNull(summary.targetAchievement) : null,
    remainingSalesTarget: hasSalesTarget ? numOrNull(summary.remainingSalesTarget) : null,
    // 目標ペース(1日あたり目標達成に必要な売上)とペース差額。目標が無ければ意味を持たない値
    // なので、他の目標由来フィールドと同じく target 未登録時は null にする。
    targetDailyPace: hasSalesTarget ? numOrNull(summary.targetPerDay) : null,
    paceDifference: hasSalesTarget ? numOrNull(Number(summary.averageDailySales || 0) - Number(summary.targetPerDay || 0)) : null,
    monthEndForecast: numOrNull(summary.forecast),
  };

  const customersSection = {
    totalCustomers: numOrNull(summary.customers),
    newCustomers: numOrNull(summary.newCustomers),
    repeatCustomers: numOrNull(summary.repeatCustomers),
    averageSpend: numOrNull(summary.averageSpend),
    targetCustomers: targetNumOrNull(target.targetCustomers),
    customerAchievementRate: hasCustomerTarget ? numOrNull(summary.customerAchievement) : null,
  };

  const reviewsSection = {
    totalReviewCount: numOrNull(summary.reviewCount),
    targetReviewCount: targetNumOrNull(target.targetReviewCount),
    reviewCountAchievementRate: hasReviewTarget ? numOrNull(summary.reviewCountAchievement) : null,
  };

  // calculateAllStoresMonthSummary(全店舗ビュー)は売上系KPIのみを集計し費用・損益は
  // 意図的に含まない設計のため、全店舗選択時はcostsを送らない(存在しないデータを
  // 0円と誤解させないため、また特定店舗の費用データが全店舗ビューに混在しないようにする)。
  const hasCostData = !isAllStoresView && hasAnyPositive([
    summary.laborCost, summary.fixedCost, summary.variableCost, summary.adCost, summary.costOfGoodsSold,
  ]);
  const costsSection = (!isAllStoresView && hasCostData) ? {
    laborCost: numOrNull(summary.laborCost),
    costOfGoodsSold: numOrNull(summary.costOfGoodsSold),
    adCost: numOrNull(summary.adCost),
    fixedCost: numOrNull(summary.fixedCost),
    variableCost: numOrNull(summary.variableCost),
    otherCost: numOrNull(summary.otherCost),
    totalExpenses: numOrNull(summary.expenseTotal),
    grossProfit: numOrNull(summary.grossProfit),
    operatingProfit: numOrNull(summary.operatingProfit),
    operatingMargin: numOrNull(summary.operatingMargin),
    laborCostRate: numOrNull(summary.laborRate),
    costOfGoodsSoldRate: numOrNull(summary.costOfGoodsSoldRate),
  } : null;

  return {
    scope: {
      storeName: isAllStoresView ? "全店舗" : (storeName || ""),
      storeId: isAllStoresView ? null : (storeId || null),
      monthValue,
      isAllStoresView: Boolean(isAllStoresView),
      role,
    },
    businessDays: businessDaysSection,
    target: targetSection,
    sales: salesSection,
    customers: customersSection,
    reviews: reviewsSection,
    costs: costsSection,
    dataAvailability: {
      hasTarget: Boolean(targetSection),
      hasCostData: Boolean(costsSection),
      hasReviewTarget,
      isAllStoresView: Boolean(isAllStoresView),
    },
  };
}
