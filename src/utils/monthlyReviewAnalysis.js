// 月次レビュー自動分析(2026-09追加、2026-09に6度改訂)。生成AI APIは一切使わず、既存の
// 月次損益計算(calculateMonthSummary/calculateAllStoresMonthSummary/getCompanyDashboardSummary)
// の戻り値を読むだけで、①総評 ②変化が大きかった項目 ③利益に影響した主な要因
// ④来月確認するポイント、の4ブロックをテンプレート+数値判定で自動生成する。
//
// 2026-09最終改訂(6回目)の経緯・要件: 「1〜2分で①今月どうだったか②何が大きく変わったか
// ③何が利益に影響したか④来月何を確認するべきか、が分かる経営判断用レビュー」を最終形とする。
//   - 「変化が大きかった項目」の優先順位を①総売上②営業利益・営業利益率③材料・仕入原価の
//     実額④人件費の実額⑤主要KPI⑥その他費用率、へ変更した(経営上意味のある「実額の変化」
//     を「率の変化」より優先する)。カードの内容は「数字の変化を示すだけ」に純化し
//     (原因の説明は一切含めない)、原因の説明は③のセクションに一本化した(重複表示の解消)。
//   - ③のセクション名は営業利益の方向で自動的に変わる(悪化→「利益低下の主な要因」、
//     改善→「利益改善の主な要因」、ほぼ横ばい→「営業利益に影響した主な要因」)。最大4件。
//     売上が大きく変化した月は、データがある範囲で客数・客単価・新規/再来客のどれが
//     主な要因かも補足する(良かった変化も悪かった変化も拾う)。
//   - 「来月確認するポイント」は指標ごとに「来月何を見るか」という視点(viewpoint)を
//     状況に応じて自動で変える(固定の文言を毎月出さない)。
//   - 総評は2〜3文に短縮し、必要な場合のみ売上目標の達成率にも触れる(達成率だけで
//     良し悪しを決めず、必ず営業利益と合わせて評価する)。
//
// 設計方針(変わらない部分):
//   1. compareMonthlyMetric()で当月値・前月値・差分(当月-前月)・前月比%・改善/悪化判定を
//      確定させる(この関数だけが計算を行う、他のどこにも同じ計算を重複実装しない)。
//   2. 確定した比較結果(MetricComparison)だけを文章テンプレートへ渡す。テンプレート側は
//      値を読んで日本語に整形するだけで、差分や改善/悪化を再計算・再判定しない。
//   3. 表示直前にvalidateMetricComparison()で「差分 = 当月 - 前月」等の整合性を再検証し、
//      異常があれば「前月比較なし」として扱う(NaN/Infinity/矛盾した符号を画面に出さない)。
//   4. 月締め(monthClosingStatus)には一切依存しない。今まさに損益表へ反映されている当月の
//      入力データをそのまま参照し、月途中でも表示する。
//   5. 人件費は「金額が増えたら悪化」と判定しない。美容室特有の売上連動歩合により、売上が
//      伸びれば人件費額が増えるのは正常。判定は常に率(pt差)だけで行い、金額は根拠説明・
//      候補選定の材料にのみ使う。
import {
  parseNumber,
  calculateMonthSummary,
  calculateAllStoresMonthSummary,
  getCompanyDashboardSummary,
  buildStoreCostOptions,
} from "./storage.js";

export const MONTHLY_INSIGHT_THRESHOLDS = {
  maxConcernPoints: 3,
};

// 指標カタログ。「率」(pt差、金額換算しない)と「金額・件数」(前月比%)で計算方法が違う。
// directionは「高いほど良い」か「低いほど良い」かで改善/悪化の符号を決める、この1箇所だけ。
const METRIC_DEFS = {
  sales: { kind: "amount", direction: "higherIsBetter", label: "総売上", format: "yen" },
  operatingProfit: { kind: "amount", direction: "higherIsBetter", label: "営業利益", format: "yen" },
  technicalSales: { kind: "amount", direction: "higherIsBetter", label: "技術売上", format: "yen" },
  retailSales: { kind: "amount", direction: "higherIsBetter", label: "店販売上", format: "yen" },
  customers: { kind: "amount", direction: "higherIsBetter", label: "客数", format: "people" },
  newCustomers: { kind: "amount", direction: "higherIsBetter", label: "新規客数", format: "people" },
  repeatCustomers: { kind: "amount", direction: "higherIsBetter", label: "再来客数", format: "people" },
  averageSpend: { kind: "amount", direction: "higherIsBetter", label: "客単価", format: "yen", verb: "rise" },
  reviewCount: { kind: "amount", direction: "higherIsBetter", label: "口コミ数", format: "count" },
  operatingMargin: { kind: "rate", direction: "higherIsBetter", label: "営業利益率", format: "percent" },
  laborRate: { kind: "rate", direction: "lowerIsBetter", label: "人件費率", format: "percent" },
  materialRate: { kind: "rate", direction: "lowerIsBetter", label: "材料・仕入原価率", format: "percent" },
  laborCost: { kind: "amount", direction: "higherIsBetter", label: "人件費", format: "yen" },
  materialCost: { kind: "amount", direction: "higherIsBetter", label: "材料・仕入原価", format: "yen" },
  fixedCost: { kind: "amount", direction: "higherIsBetter", label: "固定費", format: "yen" },
  fixedCostRate: { kind: "rate", direction: "lowerIsBetter", label: "固定費率", format: "percent" },
  adCost: { kind: "amount", direction: "higherIsBetter", label: "広告費", format: "yen" },
  adRate: { kind: "rate", direction: "lowerIsBetter", label: "広告費率", format: "percent" },
};

// 費用の「率」とその根拠になる「金額」の対応表(2026-09改訂の中心)。率が動いた理由を
// 判定する際、この対応表にある指標だけは「金額自体が動いたか(真の原因)」「金額は横ばい・
// 減少なのに売上の増減に追いつかず相対的に率が動いただけか(結果)」を区別する
// (classifyCostDriver参照)。
const RATE_TO_AMOUNT_KEY = {
  laborRate: "laborCost",
  materialRate: "materialCost",
  fixedCostRate: "fixedCost",
  adRate: "adCost",
};

// 「変化が大きかった項目」の候補になる主要KPI(⑤、優先度は費用の実額より後)。
const KPI_KEYS = ["customers", "newCustomers", "repeatCustomers", "averageSpend", "reviewCount", "technicalSales", "retailSales"];

// 「来月確認するポイント」の視点(viewpoint)テンプレート(要件14・15)。今月の数値を
// 再掲示するのではなく、指標ごとに「来月何を見るか」を状況に応じて自動で変える。
const KPI_NEXT_FOCUS_VIEWPOINT = {
  customers: { worsened: "客数が回復しているか", improved: "引き続き客数を維持できているか" },
  newCustomers: { worsened: "新規客数が回復しているか", improved: "引き続き新規客数を維持できているか" },
  repeatCustomers: { worsened: "再来客数が改善しているか", improved: "引き続き再来客数を維持できているか" },
  averageSpend: { worsened: "客単価が回復しているか", improved: "引き続き客単価を維持できているか" },
  reviewCount: { worsened: "口コミ数が回復しているか", improved: "引き続き口コミ数を維持できているか" },
  technicalSales: { worsened: "技術売上が回復しているか", improved: "引き続き技術売上を維持できているか" },
  retailSales: { worsened: "店販売上が回復しているか", improved: "引き続き店販売上を維持できているか" },
};
const COST_NEXT_FOCUS_VIEWPOINT = {
  materialCost: { worsened: "実額と原価率の両方が適正化しているか", improved: "実額と原価率の改善が続いているか" },
  laborCost: { worsened: "売上に対して人件費が適正化しているか", improved: "人件費の適正な水準が続いているか" },
  fixedCost: { worsened: "売上に対して固定費の負担割合が適正化しているか", improved: "固定費の負担割合が適正な水準を維持できているか" },
  adCost: { worsened: "売上に対して広告費が適正化しているか", improved: "広告費の適正な水準が続いているか" },
};

// 同じ変化から派生する項目を重複して並べない(要件: 総売上の内訳としての客数・客単価、
// 客数の内訳としての新規・再来を、合計側が候補に挙がった時だけ吸収する)。
const AGGREGATE_WITH_BREAKDOWN = {
  sales: ["customers", "averageSpend"],
  customers: ["newCustomers", "repeatCustomers"],
};

const formatValue = (value, format) => {
  if (format === "yen") return `${Math.round(parseNumber(value)).toLocaleString("ja-JP")}円`;
  if (format === "people") return `${Math.round(parseNumber(value)).toLocaleString("ja-JP")}人`;
  if (format === "count") return `${Math.round(parseNumber(value)).toLocaleString("ja-JP")}件`;
  if (format === "percent") return `${parseNumber(value).toFixed(1)}%`;
  return String(value);
};
// ユーザー向け画面では割合の変化量を必ず「%」で表示する(pt/ポイント/percentage pointは
// 一切使わない)。amount指標の前月比%もrate指標のpt差も、この1つの共通formatterだけを
// 経由させる——内部の計算(差分=当月-前月)自体は変更していない、表示の単位表記だけを揃える。
export const formatRateChange = (value) => `${Math.abs(parseNumber(value)).toFixed(1)}%`;

// ここが唯一の「計算」箇所(要件: AIに計算自体をさせない/共通関数に集約する)。
// kind:"rate" → 差分は必ず「当月率 - 前月率」(pt)。前月値が0でも計算できる(除算しない)ため
// 判定可能。kind:"amount" → 前月比%は (当月-前月)/前月*100。前月値が0だと0除算になり
// 前月比%の意味自体が壊れるため、その場合は判定自体を「前月比較なし」にする。
export function compareMonthlyMetric({ current, previous, hasPreviousData, kind, direction }) {
  const currentValue = Number.isFinite(current) ? current : null;
  const previousValue = Number.isFinite(previous) ? previous : null;
  const base = { current: currentValue, previous: null, diff: null, percentChange: null, judgment: "no_comparison" };
  if (!hasPreviousData || currentValue === null || previousValue === null) return base;
  if (kind === "amount" && previousValue === 0) return { ...base, current: currentValue };

  const diff = currentValue - previousValue; // 常に「当月 - 前月」。これ以外の式を使わない。
  if (!Number.isFinite(diff)) return { ...base, current: currentValue };

  let percentChange = null;
  if (kind === "amount") {
    percentChange = (diff / previousValue) * 100;
    if (!Number.isFinite(percentChange)) percentChange = null;
  }

  let judgment = "unchanged";
  if (diff !== 0) {
    const increased = diff > 0;
    const isGood = direction === "higherIsBetter" ? increased : !increased;
    judgment = isGood ? "improved" : "worsened";
  }
  return { current: currentValue, previous: previousValue, diff, percentChange, judgment };
}

// 表示直前の整合性チェック。ここを通らない比較結果は画面に一切出さない
// (呼び出し側はこの関数の戻り値がfalseなら「前月比較なし」として扱う)。
export function validateMetricComparison(comparison) {
  if (!comparison) return false;
  if (comparison.judgment === "no_comparison") return true; // 「比較なし」自体は正常な状態
  const { current, previous, diff } = comparison;
  if (!Number.isFinite(current) || !Number.isFinite(previous) || !Number.isFinite(diff)) return false;
  // 差分 = 当月 - 前月、になっているかを直接再検証する。
  if (Math.abs(diff - (current - previous)) > 1e-6) return false;
  if (comparison.percentChange !== null && !Number.isFinite(comparison.percentChange)) return false;
  return true;
}

// 全指標の比較結果を一括で作る。fieldsEnabledでOFFの指標(新規/再来/店販/口コミ)は
// 比較対象から除外する(入力設定でOFFの項目を勝手に分析しないという既存要件を踏襲)。
// 検証に落ちた比較は"no_comparison"へフォールバックし、絶対に画面へ異常値を出さない。
export function buildMetricComparisons(current, previous, fieldsEnabled = {}) {
  const hasPreviousData = Boolean(previous?.hasData);
  const comparisons = {};
  for (const [key, def] of Object.entries(METRIC_DEFS)) {
    if (key === "newCustomers" && fieldsEnabled.newCustomers === false) continue;
    if (key === "repeatCustomers" && fieldsEnabled.repeatCustomers === false) continue;
    if (key === "retailSales" && fieldsEnabled.retailSales === false) continue;
    if (key === "reviewCount" && fieldsEnabled.reviewCount === false) continue;
    if ((key === "laborRate" || key === "laborCost") && !(current?.hasLaborData && previous?.hasLaborData)) continue;
    if ((key === "materialRate" || key === "materialCost") && !(current?.hasMaterialData && previous?.hasMaterialData)) continue;
    if ((key === "operatingMargin" || key === "operatingProfit") && (current?.isProvisionalProfit || previous?.isProvisionalProfit)) continue;
    if ((key === "fixedCost" || key === "fixedCostRate") && !(current?.hasFixedCostData && previous?.hasFixedCostData)) continue;
    if ((key === "adCost" || key === "adRate") && !(current?.hasAdData && previous?.hasAdData)) continue;
    const comparison = compareMonthlyMetric({
      current: current?.[key],
      previous: previous?.[key],
      hasPreviousData,
      kind: def.kind,
      direction: def.direction,
    });
    comparisons[key] = validateMetricComparison(comparison) ? comparison : { ...comparison, judgment: "no_comparison" };
  }
  return comparisons;
}

// 変化の向きを表す動詞。率・比率(kind:"rate")と客単価(verb:"rise"、単価という性質上、量では
// なく率と同じ扱いにする)は「上昇/低下」、それ以外の量(売上・客数・件数等)は「増加/減少」。
// 「悪化/改善」等の評価語は一切使わない。
function verbFor(def, diff) {
  if (def.kind === "rate" || def.verb === "rise") return diff > 0 ? "上昇" : "低下";
  return diff > 0 ? "増加" : "減少";
}

// 「前月値 → 今月値」の値推移テキスト。差分(pt/%)ではなく実数値を並べ、必ず前月→今月の順に
// する。formatValueが符号をそのまま出すため「--0.4%」のような二重マイナスは発生しない。
function rangeText(def, comparison) {
  return `${formatValue(comparison.previous, def.format)} → ${formatValue(comparison.current, def.format)}`;
}

// 指標1件分の変化を説明する1文。
//   - 同値(diff===0): 「{label}は前月と同じ{value}です。」(上昇/低下も増加/減少も使わない)
//   - 率・比率(kind:"rate"、または客単価): 「{label}は {前月}% → {今月}% に{上昇/低下}しました。」
//     (差分の「○pt」「○%上昇」は本文に出さない)
//   - それ以外の量: 「{label}は前月より{変化率}%{増加/減少}しました。」。ただし営業利益の
//     ように黒字⇔赤字を跨ぐ変化は前月比%が意味を持たない(例: +95万円→-1.7万円は「-101.8%」
//     のような読み取りにくい数字になる)ため、この場合だけ率・比率と同じ「値→値」形式にする。
export function describeComparison(key, comparison) {
  const def = METRIC_DEFS[key];
  if (comparison.diff === 0) {
    return `${def.label}は前月と同じ${formatValue(comparison.current, def.format)}です。`;
  }
  const verb = verbFor(def, comparison.diff);
  if (def.kind === "rate") {
    return `${def.label}は ${rangeText(def, comparison)} に${verb}しました。`;
  }
  const crossesZero = comparison.percentChange === null || (comparison.current >= 0) !== (comparison.previous >= 0);
  if (crossesZero) {
    return `${def.label}は ${rangeText(def, comparison)} に${verb}しました。`;
  }
  return `${def.label}は前月より${formatRateChange(comparison.percentChange)}${verb}しました。`;
}

// 比較可能な変化の大きさ。amount系は前月比%、rate系はpt差の絶対値をそのまま比較の基準にする。
function factorMagnitude(comparison) {
  return comparison.percentChange !== null ? Math.abs(comparison.percentChange) : Math.abs(comparison.diff ?? 0);
}

// 費用率(人件費率・材料費率・固定費率・広告費率)が動いた理由を判定する中心ロジック
// (2026-09改訂)。「率が上昇した」という事実だけでは根本原因を語らず、必ず
// ①売上の増減 ②費用額自体の増減 ③(結果としての)費用率の変化 の順で判定する:
//   - type: "genuine" — 費用額自体が動いている(diff>0で悪化方向、diff<0で改善方向) →
//     費用側の増減自体が要因(真の原因)。「変化が大きかった項目」の候補になり得る。
//   - type: "relative" — 費用額は横ばい・逆方向なのに率だけ動いている → 売上の増減に費用の
//     増減が追いついていないだけ(根本原因は売上、率の変化は結果)。候補にはせず、
//     「利益低下・改善の主な要因」でのみ言及する。
//   - null — 判定に必要なデータが無い、または売上が実質変化していないのに率だけ動くという
//     算数的に矛盾した組み合わせ(rate=amount/salesである以上あり得ない)。何も述べない。
// 人件費率 = 人件費 ÷ 売上 という関係から、この分岐は推測ではなく算数的に確定した事実だけを
// 述べる。laborRate/materialRate/fixedCostRate/adRateのどれでも同じロジックで動く。
function classifyCostDriver(rateKey, comparisons) {
  const amountKey = RATE_TO_AMOUNT_KEY[rateKey];
  if (!amountKey) return null;
  const rate = comparisons[rateKey];
  const amount = comparisons[amountKey];
  const sales = comparisons.sales;
  if (!rate || rate.judgment === "no_comparison" || rate.judgment === "unchanged") return null;
  if (!amount || amount.judgment === "no_comparison") return null;
  if (!sales || sales.judgment === "no_comparison") return null;

  if (rate.judgment === "worsened") {
    if (amount.diff > 0) return { type: "genuine" };
    if (sales.judgment === "unchanged") return null; // 算数的に矛盾するため何も述べない
    return { type: "relative" };
  }
  // rate.judgment === "improved"(率は低下方向、lowerIsBetterなので良い方向)
  if (amount.diff < 0) return { type: "genuine" };
  if (sales.judgment === "unchanged") return null;
  return { type: "relative" };
}

// 「変化が大きかった項目」「来月確認するポイント」共通の候補生成。優先順位(2026-09
// 最終改訂): ①総売上の大きな変化 ②営業利益・営業利益率の変化 ③材料・仕入原価の実額変化
// (真の原因のみ) ④人件費の実額変化(真の原因のみ) ⑤客数・客単価等の主要KPI ⑥その他の
// 費用率の変化(固定費・広告費、真の原因のみ、最後の候補)。単純な「率の変化」よりも経営上
// 意味のある「実額の変化」を優先するため、費用側は必ずclassifyCostDriverで金額自体が
// 動いた("genuine")と判定されたものだけを候補にする——金額は横ばい・減少なのに売上の
// 増減に追いつかず相対的に率が動いただけの費用は、候補には出さず「利益に影響した主な要因」
// でのみ言及する。同じ変化から派生する重複表示は、合計側が候補に挙がった時だけ内訳を
// 吸収して防ぐ(AGGREGATE_WITH_BREAKDOWN)。
function buildConcernCandidateList(comparisons) {
  const candidates = [];

  const sales = comparisons.sales;
  if (sales && sales.judgment !== "no_comparison" && sales.judgment !== "unchanged") {
    candidates.push({ id: "sales", tier: 1, magnitude: factorMagnitude(sales) });
  }

  const profit = comparisons.operatingProfit;
  const margin = comparisons.operatingMargin;
  const profitValid = profit && profit.judgment !== "no_comparison" && profit.judgment !== "unchanged";
  const marginValid = margin && margin.judgment !== "no_comparison" && margin.judgment !== "unchanged";
  if (profitValid || marginValid) {
    candidates.push({
      id: "operatingProfit",
      tier: 2,
      magnitude: Math.max(profitValid ? factorMagnitude(profit) : 0, marginValid ? factorMagnitude(margin) : 0),
    });
  }

  const materialClassification = classifyCostDriver("materialRate", comparisons);
  if (materialClassification?.type === "genuine") {
    candidates.push({ id: "materialRate", tier: 3, magnitude: factorMagnitude(comparisons.materialCost) });
  }

  const laborClassification = classifyCostDriver("laborRate", comparisons);
  if (laborClassification?.type === "genuine") {
    candidates.push({ id: "laborRate", tier: 4, magnitude: factorMagnitude(comparisons.laborCost) });
  }

  for (const key of KPI_KEYS) {
    const c = comparisons[key];
    if (!c || c.judgment === "no_comparison" || c.judgment === "unchanged") continue;
    candidates.push({ id: key, tier: 5, magnitude: factorMagnitude(c) });
  }

  for (const rateKey of ["fixedCostRate", "adRate"]) {
    const classification = classifyCostDriver(rateKey, comparisons);
    if (classification?.type === "genuine") {
      const amountKey = RATE_TO_AMOUNT_KEY[rateKey];
      candidates.push({ id: rateKey, tier: 6, magnitude: factorMagnitude(comparisons[amountKey]) });
    }
  }

  return candidates.sort((a, b) => (a.tier - b.tier) || (b.magnitude - a.magnitude));
}

function rankConcernIds(comparisons) {
  const ordered = buildConcernCandidateList(comparisons);
  const claimed = new Set();
  const result = [];
  for (const { id } of ordered) {
    if (claimed.has(id)) continue;
    result.push(id);
    const childKeys = AGGREGATE_WITH_BREAKDOWN[id];
    if (!childKeys) continue;
    const validChildCount = childKeys.filter((childKey) => comparisons[childKey] && comparisons[childKey].judgment !== "no_comparison").length;
    if (validChildCount >= 2) childKeys.forEach((childKey) => claimed.add(childKey));
  }
  return result;
}

// 「変化が大きかった項目」1件分。役割は「数字の変化を事実として示す」ことだけに限定し
// (要件9)、原因の説明は一切含めない——原因は別セクション(利益に影響した主な要因)に
// 一本化する。タイトルは実際の変化の向きから動的に生成する(「悪化」「問題」等の評価語は
// 使わない)。材料・仕入原価/人件費/固定費/広告費は、実額(何が実際に動いたか)と率(結果)の
// 両方を必ず示す(要件4・5・8: 金額と比率を別々に判定し、両方を確認できるようにする)。
// ③営業利益は営業利益・営業利益率の両方を1枚のカードにまとめ、旧構成にあった人件費率・
// 材料費率・固定費率の重複列挙をしない。
function buildConcernPoint(id, comparisons) {
  if (id === "operatingProfit") {
    const profit = comparisons.operatingProfit;
    const margin = comparisons.operatingMargin;
    const profitValid = profit && profit.judgment !== "no_comparison" && profit.judgment !== "unchanged";
    const marginValid = margin && margin.judgment !== "no_comparison" && margin.judgment !== "unchanged";
    const primary = profitValid ? { key: "operatingProfit", comparison: profit } : { key: "operatingMargin", comparison: margin };
    const verb = verbFor(METRIC_DEFS[primary.key], primary.comparison.diff);
    const detail = [
      profitValid ? describeComparison("operatingProfit", profit) : "",
      marginValid ? describeComparison("operatingMargin", margin) : "",
    ].join("");
    return { id, title: `営業利益が${verb}しています`, detail };
  }

  const amountKey = RATE_TO_AMOUNT_KEY[id];
  if (amountKey) {
    const amountLabel = METRIC_DEFS[amountKey].label;
    const amountComparison = comparisons[amountKey];
    const verb = verbFor(METRIC_DEFS[amountKey], amountComparison.diff);
    const detail = describeComparison(amountKey, amountComparison) + describeComparison(id, comparisons[id]);
    return { id, title: `${amountLabel}が${verb}しています`, detail };
  }

  const c = comparisons[id];
  const def = METRIC_DEFS[id];
  const verb = verbFor(def, c.diff);
  return { id, title: `${def.label}が${verb}しています`, detail: describeComparison(id, c) };
}

function buildConcernPoints(comparisons, thresholds) {
  return rankConcernIds(comparisons)
    .slice(0, thresholds.maxConcernPoints)
    .map((id) => buildConcernPoint(id, comparisons));
}

// 「来月確認するポイント」1件分(要件9)。今月の数値の再掲示ではなく、「来月何を確認す
// べきか」という視点だけを短く述べる。「変化が大きかった項目」と全く同じ候補・並び順から
// 選ぶ(要件: 同じ基準から自動選択する)。
function buildNextFocusPoint(id, comparisons) {
  if (id === "sales") {
    const sales = comparisons.sales;
    const viewpoint = sales.judgment === "worsened" ? "前月比で売上が回復しているか" : "引き続き前月を上回れているか";
    return { id, label: "総売上", viewpoint };
  }
  if (id === "operatingProfit") {
    const profit = comparisons.operatingProfit;
    const margin = comparisons.operatingMargin;
    const profitValid = profit && profit.judgment !== "no_comparison" && profit.judgment !== "unchanged";
    const primary = profitValid ? profit : margin;
    let viewpoint;
    if (primary.current < 0) viewpoint = "赤字から改善しているか";
    else viewpoint = primary.judgment === "worsened" ? "前月の水準まで回復しているか" : "改善が続いているか";
    return { id, label: "営業利益", viewpoint };
  }
  const amountKey = RATE_TO_AMOUNT_KEY[id];
  if (amountKey) {
    const amountLabel = METRIC_DEFS[amountKey].label;
    const rate = comparisons[id];
    const template = COST_NEXT_FOCUS_VIEWPOINT[amountKey];
    const viewpoint = rate.judgment === "worsened" ? template.worsened : template.improved;
    return { id, label: amountLabel, viewpoint };
  }
  const c = comparisons[id];
  const def = METRIC_DEFS[id];
  const template = KPI_NEXT_FOCUS_VIEWPOINT[id];
  const fallback = c.judgment === "worsened" ? "前月から回復しているか" : "引き続き前月を上回れているか";
  const viewpoint = template ? (c.judgment === "worsened" ? template.worsened : template.improved) : fallback;
  return { id, label: def.label, viewpoint };
}

function buildNextFocusPoints(comparisons, thresholds) {
  return rankConcernIds(comparisons)
    .slice(0, thresholds.maxConcernPoints)
    .map((id) => buildNextFocusPoint(id, comparisons));
}

// 営業利益率に寄与した費用率(人件費率・材料費率・固定費率・広告費率)のうち、営業利益率と
// 同じ方向(悪化なら悪化、改善なら改善)へ動いたものだけを要因候補にする。変化が大きい順に
// 並べる。「変化が大きかった項目」「総評」「利益低下・改善の主な要因」の3箇所が、この1つの
// 候補リストだけを共有する(判定ロジックを重複実装しない)。
function contributingCostFactors(comparisons, margin) {
  return Object.keys(RATE_TO_AMOUNT_KEY)
    .map((key) => ({ key, comparison: comparisons[key], classification: classifyCostDriver(key, comparisons) }))
    .filter(({ comparison }) => comparison && comparison.judgment === margin.judgment)
    .sort((a, b) => factorMagnitude(b.comparison) - factorMagnitude(a.comparison));
}

// 売上が大きく変化した月は、可能な範囲で客数・客単価・新規/再来客のどれが主な要因かを
// 1文で補足する(要件11・12: 「売上が減った」で終わらせず、良かった変化も悪かった変化も
// 拾えるようにする)。データが無い/方向がはっきりしない指標については何も推測しない
// (要件20)。新規/再来が逆方向に動いている場合の対比を最優先し、次に客数・客単価のうち
// 売上と同じ方向へ動いた方(両方該当する場合は変化の大きい方)を1つだけ選ぶ。
function buildSalesDriverBullet(comparisons) {
  const sales = comparisons.sales;
  if (!sales || sales.judgment === "no_comparison" || sales.judgment === "unchanged") return null;
  const salesUp = sales.diff > 0;
  const isValid = (c) => c && c.judgment !== "no_comparison";

  const newC = comparisons.newCustomers;
  const repeatC = comparisons.repeatCustomers;
  if (isValid(newC) && isValid(repeatC) && newC.judgment !== repeatC.judgment) {
    if (!salesUp && repeatC.judgment === "worsened") {
      const newVerb = newC.judgment === "improved" ? "増加" : "減少";
      return `新規客は${newVerb}していますが、再来客減少が売上低下に影響しています。`;
    }
    if (salesUp && repeatC.judgment === "improved") {
      const newVerb = newC.judgment === "improved" ? "増加" : "減少";
      return `新規客は${newVerb}していますが、再来客増加が売上成長に貢献しています。`;
    }
  }

  const customers = comparisons.customers;
  const spend = comparisons.averageSpend;
  const customersMatch = isValid(customers) && customers.judgment === sales.judgment;
  const spendMatch = isValid(spend) && spend.judgment === sales.judgment;
  let winner = null;
  if (customersMatch && spendMatch) {
    winner = factorMagnitude(customers) >= factorMagnitude(spend) ? "customers" : "spend";
  } else if (customersMatch) {
    winner = "customers";
  } else if (spendMatch) {
    winner = "spend";
  }
  if (winner === "customers") return salesUp ? "客数増加が売上成長に貢献しています。" : "客数減少が売上低下に影響しています。";
  if (winner === "spend") return salesUp ? "客単価上昇が売上成長に貢献しています。" : "客単価低下が売上減少に影響しています。";
  return null;
}

// ⑥利益に影響した主な要因(2026-09最終改訂、要件10)。「率が上がった」ではなく「なぜ率が
// 上がったのか/利益に何が実際に影響したのか」を1指標1行の箇条書きで述べる。売上の変化
// (+可能ならその要因)を必ず先頭に置き、費用側は真の原因(genuine、「◯◯が増加/減少」)と
// 相対的な結果(relative、「◯◯は売上◯◯に対して◯◯幅が◯◯」)を区別して述べる(要件7・8)。
// タイトルは営業利益の方向で自動的に変える——悪化/改善のどちらでもない(ほぼ横ばい)場合は
// 中立タイトルにする(要件10)。最大4件(要件10)。
function buildProfitDriverSection(comparisons) {
  const margin = comparisons.operatingMargin;
  const profit = comparisons.operatingProfit;
  const marginValid = margin && margin.judgment !== "no_comparison";
  const profitValid = profit && profit.judgment !== "no_comparison";
  if (!marginValid && !profitValid) return null;

  const primaryJudgment = marginValid ? margin.judgment : profit.judgment;
  let title = "営業利益に影響した主な要因";
  if (primaryJudgment === "worsened") title = "利益低下の主な要因";
  else if (primaryJudgment === "improved") title = "利益改善の主な要因";

  const bullets = [];
  const sales = comparisons.sales;
  if (sales && sales.judgment !== "no_comparison" && sales.judgment !== "unchanged") {
    const verb = sales.diff > 0 ? "増加" : "減少";
    const pct = sales.percentChange !== null ? formatRateChange(sales.percentChange) : null;
    bullets.push(pct ? `売上が前月比${pct}${verb}` : `売上が${verb}`);
  }

  const salesDriverBullet = buildSalesDriverBullet(comparisons);
  if (salesDriverBullet) bullets.push(salesDriverBullet);

  if (marginValid && margin.judgment !== "unchanged") {
    for (const { key, classification } of contributingCostFactors(comparisons, margin)) {
      const amountKey = RATE_TO_AMOUNT_KEY[key];
      const amountLabel = METRIC_DEFS[amountKey].label;
      if (classification?.type === "genuine") {
        const verb = margin.judgment === "worsened" ? "増加" : "減少";
        bullets.push(`${amountLabel}が${verb}`);
      } else if (classification?.type === "relative" && sales) {
        const salesVerb = sales.diff < 0 ? "減少" : "増加";
        const amountVerb = margin.judgment === "worsened"
          ? (sales.diff < 0 ? "減少幅が小さい" : "増加幅が大きい")
          : (sales.diff < 0 ? "減少幅が大きい" : "増加幅が小さい");
        bullets.push(`${amountLabel}は売上${salesVerb}に対して${amountVerb}`);
      } else {
        const rateLabel = METRIC_DEFS[key].label;
        const verb = verbFor(METRIC_DEFS[key], comparisons[key].diff);
        bullets.push(`${rateLabel}が${verb}`);
      }
    }
  }

  if (bullets.length === 0) return null;
  return { title, bullets: bullets.slice(0, 4) };
}

// ①総評(2026-09改訂、要件3・12): 2〜3文に短縮し、「変化が大きかった項目」「利益低下・
// 改善の主な要因」との内容重複を避ける。①売上・営業利益の変化を1文で結果として述べ、
// ②その要因(contributingCostFactorsと同じ判定ロジック)を1文で簡潔に述べる。
// 「率が上がったから利益が下がった」という短絡表現は使わず、必ず「売上の変化」→
// 「費用の実額/相対的な変化」→「利益への影響」の順で組み立てる。
function buildSummaryText(comparisons, current) {
  const sales = comparisons.sales;
  if (!sales || sales.judgment === "no_comparison") {
    return `今月の総売上は${formatValue(current.sales, "yen")}でした。比較できる前月データが無いため、今月の実績のみを表示しています。`;
  }

  let firstSentence;
  if (sales.diff === 0) {
    firstSentence = `総売上は前月と同じ${formatValue(sales.current, "yen")}でした`;
  } else {
    const salesVerb = sales.diff > 0 ? "増加" : "減少";
    const salesPct = sales.percentChange !== null ? formatRateChange(sales.percentChange) : null;
    firstSentence = salesPct
      ? `総売上は前月比${salesPct}${salesVerb}し`
      : `総売上は${rangeText(METRIC_DEFS.sales, sales)}に${salesVerb}し`;
  }
  const profit = comparisons.operatingProfit;
  if (profit && profit.judgment !== "no_comparison" && profit.diff !== 0) {
    const profitVerb = profit.diff > 0 ? "増加" : "減少";
    firstSentence += `、営業利益は${formatValue(profit.previous, "yen")}から${formatValue(profit.current, "yen")}へ${profitVerb}しました。`;
  } else {
    firstSentence += "。";
  }

  const secondSentence = buildSummaryCauseSentence(comparisons, comparisons.operatingMargin);
  const thirdSentence = buildAchievementSentence(current, comparisons);
  return `${firstSentence}${secondSentence}${thirdSentence}`;
}

// 総評3文目(補足、任意、要件13)。売上目標の達成率も判断材料に使うが、達成率だけで
// 良し悪しを決めず必ず営業利益と合わせて評価する——目標達成でも営業利益が前月を下回って
// いれば、その旨を明示する。大幅未達の場合はここでは何も述べない(数値そのものは「今月の
// 結果」カードに既に出ており、未達幅は売上の増減として①文目に既に表れているため、総評を
// 2〜3文以内に保つことを優先する)。
function buildAchievementSentence(current, comparisons) {
  if (!current?.hasSalesTarget || !Number.isFinite(current?.targetAchievement)) return "";
  const achievement = current.targetAchievement;
  const profit = comparisons.operatingProfit;
  if (achievement >= 100) {
    if (profit && profit.judgment === "worsened") {
      return "売上目標は達成していますが、営業利益は前月を下回っています。";
    }
    return "売上目標を達成しました。";
  }
  if (achievement >= 90) {
    return "売上目標に近い水準でした。";
  }
  return "";
}

// 総評2文目(要因)。費用側は真の原因(genuine、ラベルを「・」で連結して1つの句にまとめる)と
// 相対的な結果(relative、「売上◯◯に対して◯◯・◯◯の◯◯幅が◯◯かったこと」)を分けて
// 述べる。文頭に売上の増減を必ず置く(要件: 優先順位①売上→②費用の実額→③率→④利益)。
function buildSummaryCauseSentence(comparisons, margin) {
  if (!margin || margin.judgment === "no_comparison" || margin.judgment === "unchanged") return "";
  const sales = comparisons.sales;
  const contributing = contributingCostFactors(comparisons, margin);
  if (contributing.length === 0) return "";

  const genuineLabels = [];
  const relativeLabels = [];
  const plainLabels = [];
  for (const { key, classification } of contributing) {
    const amountKey = RATE_TO_AMOUNT_KEY[key];
    const amountLabel = METRIC_DEFS[amountKey].label;
    if (classification?.type === "genuine") genuineLabels.push(amountLabel);
    else if (classification?.type === "relative") relativeLabels.push(amountLabel);
    else plainLabels.push(METRIC_DEFS[key].label);
  }

  const clauses = [];
  if (genuineLabels.length > 0) {
    const verb = margin.judgment === "worsened" ? "増加" : "減少";
    clauses.push(`${genuineLabels.join("・")}の${verb}`);
  }
  if (relativeLabels.length > 0 && sales) {
    const salesVerb = sales.diff < 0 ? "減少" : "増加";
    const amountVerb = margin.judgment === "worsened"
      ? (sales.diff < 0 ? "減少幅が小さかった" : "増加幅が大きかった")
      : (sales.diff < 0 ? "減少幅が大きかった" : "増加幅が小さかった");
    clauses.push(`売上${salesVerb}に対して${relativeLabels.join("・")}の${amountVerb}こと`);
  }
  if (plainLabels.length > 0) {
    const verb = margin.judgment === "worsened" ? "上昇" : "低下";
    clauses.push(`${plainLabels.join("・")}の${verb}`);
  }
  if (clauses.length === 0) return "";

  const salesPrefix = sales && sales.judgment !== "no_comparison" && sales.judgment !== "unchanged"
    ? `売上${sales.diff < 0 ? "減少" : "増加"}に加え、`
    : "";
  const resultVerb = margin.judgment === "worsened" ? "利益低下" : "利益改善";
  return `${salesPrefix}${clauses.join("と、")}が${resultVerb}に影響しています。`;
}

// hasData:false(当月にまだ何も入力が無い)の場合だけ、他の計算を一切行わず即座に返す。
// 月締め状態は一切参照しない——呼び出し元(App.jsx)もisClosedを渡さない。
export function analyzeMonthlyReview({
  current,
  previous,
  fieldsEnabled = { customers: true, newCustomers: true, repeatCustomers: true, retailSales: true, reviewCount: true },
  thresholds = MONTHLY_INSIGHT_THRESHOLDS,
} = {}) {
  if (!current?.hasData) {
    return { hasData: false, summaryText: "", concernPoints: [], profitDrivers: null, nextFocusPoints: [], comparisons: {} };
  }
  const comparisons = buildMetricComparisons(current, previous, fieldsEnabled);
  return {
    hasData: true,
    summaryText: buildSummaryText(comparisons, current),
    concernPoints: buildConcernPoints(comparisons, thresholds),
    profitDrivers: buildProfitDriverSection(comparisons),
    nextFocusPoints: buildNextFocusPoints(comparisons, thresholds),
    comparisons,
  };
}

// getMonthlyReviewMetrics: calculateMonthSummary(単一店舗)/calculateAllStoresMonthSummary+
// getCompanyDashboardSummary(全店舗)のどちらから来たかを問わず、この分析関数が必要とする
// 値だけをまとめた共通の形へ正規化する(画面表示値と同じ計算結果を共通参照する、AIレビュー
// 専用の別計算を作らない)。全店舗ビューの人件費率・材料費率・営業利益率は、既存の「各店舗
// ごとにcalculateMonthSummaryを呼んでから合算し、率は合算後に再計算する」規約
// (getCompanyDashboardSummary)をそのまま使う——店舗ごとの率を平均しない。
//
// 月締め状態(monthClosingStatus)はここでは一切参照しない——「今、損益表に表示されている
// 数字」をそのまま返すだけで、月締め済みかどうかで値も呼び出し可否も変えない。
export function getMonthlyReviewMetrics(state, { storeId, isAllStoresView, company, storeEntity, companyStores } = {}, monthValue) {
  if (isAllStoresView) {
    const salesSummary = calculateAllStoresMonthSummary(state, company, monthValue);
    const dashboardSummary = getCompanyDashboardSummary(state, company, monthValue);
    const stores = (Array.isArray(companyStores) ? companyStores : company?.stores || []).filter((store) => store?.id && store.status !== "archived");
    // 「入力データがあるか」の判定基準は既存のgetMonthlyReviewSummary(全店舗版)と同一。
    const hasData = stores.some((store) => {
      const storeSummary = calculateMonthSummary(state, store.id, monthValue);
      return storeSummary.entries.length > 0 || storeSummary.batchEntries.length > 0;
    });
    const targetSales = parseNumber(salesSummary.target?.targetSales);
    return {
      sales: salesSummary.sales,
      technicalSales: salesSummary.technicalSales,
      retailSales: salesSummary.retailSales,
      customers: salesSummary.customers,
      newCustomers: salesSummary.newCustomers,
      repeatCustomers: salesSummary.repeatCustomers,
      reviewCount: salesSummary.reviewCount,
      averageSpend: salesSummary.averageSpend,
      laborRate: dashboardSummary.laborRate,
      laborCost: dashboardSummary.totalLaborCost,
      materialRate: dashboardSummary.purchaseCostRate,
      materialCost: dashboardSummary.totalPurchaseCost,
      fixedCost: dashboardSummary.totalFixedCost,
      fixedCostRate: dashboardSummary.fixedCostRate,
      hasFixedCostData: dashboardSummary.hasFixedCostData,
      adCost: dashboardSummary.totalAdCost,
      adRate: dashboardSummary.adRate,
      hasAdData: dashboardSummary.hasAdData,
      retailRatio: salesSummary.sales > 0 ? (salesSummary.retailSales / salesSummary.sales) * 100 : 0,
      operatingMargin: dashboardSummary.operatingMargin,
      operatingProfit: dashboardSummary.totalOperatingProfit,
      isProvisionalProfit: dashboardSummary.isProvisionalProfit,
      hasLaborData: dashboardSummary.hasLaborData,
      hasMaterialData: dashboardSummary.hasPurchaseData,
      targetSales,
      hasSalesTarget: targetSales > 0,
      targetAchievement: targetSales > 0 ? salesSummary.targetAchievement : null,
      // 全店舗ビュー専用の目標(company_all_stores_targets)には営業利益率目標という概念が
      // 無い(店舗ごとのmonthly_targetsにしか無い項目のため)。
      targetOperatingMargin: null,
      hasData,
    };
  }

  // 損益表(App.jsx)・店舗比較(getStoreDashboardRows)と完全に同じcalculateMonthSummary
  // オプション(buildStoreCostOptions、人件費・原価の計算方法/率を含む)を使う——ここが
  // 独自に{useInventoryTracking, hiddenCategories}だけを渡していたため、laborCostMode/
  // laborCostRate/purchaseCostMode/purchaseCostRateが渡らず、売上連動モードの店舗
  // (実額の登録が無い店舗)で人件費・材料費が0円扱いになり、営業利益・営業利益率が
  // 損益表より大幅に過大表示される不具合があった(2026-09修正、フィーネ横浜の実例)。
  const summary = calculateMonthSummary(state, storeId, monthValue, buildStoreCostOptions(storeEntity));
  const targetSales = parseNumber(summary.target?.targetSales);
  const targetOperatingMargin = parseNumber(summary.target?.targetOperatingMargin);
  return {
    sales: summary.sales,
    technicalSales: summary.technicalSales,
    retailSales: summary.retailSales,
    customers: summary.customers,
    newCustomers: summary.newCustomers,
    repeatCustomers: summary.repeatCustomers,
    reviewCount: summary.reviewCount,
    averageSpend: summary.averageSpend,
    laborRate: summary.laborRate,
    laborCost: summary.laborCost,
    materialRate: summary.costOfGoodsSoldRate,
    materialCost: summary.costOfGoodsSold,
    fixedCost: summary.fixedCost,
    fixedCostRate: summary.sales > 0 ? (summary.fixedCost / summary.sales) * 100 : 0,
    hasFixedCostData: summary.hasFixedCostData,
    adCost: summary.adCost,
    adRate: summary.adRate,
    hasAdData: Boolean(summary.categoryHasEntry?.advertising),
    retailRatio: summary.retailRatio,
    operatingMargin: summary.operatingMargin,
    operatingProfit: summary.operatingProfit,
    isProvisionalProfit: summary.isProvisionalProfit,
    hasLaborData: Boolean(summary.categoryHasEntry?.labor),
    hasMaterialData: Boolean(summary.categoryHasEntry?.materials),
    targetSales,
    hasSalesTarget: targetSales > 0,
    targetAchievement: targetSales > 0 ? summary.targetAchievement : null,
    targetOperatingMargin: targetOperatingMargin > 0 ? targetOperatingMargin : null,
    hasData: summary.entries.length > 0 || summary.batchEntries.length > 0,
  };
}
