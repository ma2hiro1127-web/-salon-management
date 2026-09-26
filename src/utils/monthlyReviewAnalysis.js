// 月次レビュー自動分析(2026-09追加、2026-09に3度再修正)。生成AI APIは一切使わず、既存の
// 月次損益計算(calculateMonthSummary/calculateAllStoresMonthSummary/getCompanyDashboardSummary)
// の戻り値を読むだけで、①総評 ②変化が大きかった項目、の2ブロックをテンプレート+数値判定で
// 自動生成する。
//
// 2026-09再修正(4回目)の経緯・要件: 目的を「注意喚起」ではなく「数字から今月何が起きたかを
// 一瞬で理解できること」に変更した。
//   - 「〜が悪化しています」という評価語を先に出すタイトルを廃止し、指標ごとに中立な
//     事実表現(「〜が減少しています」「〜が前月を下回っています」等)へ統一した
//     (CONCERN_TITLE参照)。
//   - 「来月の注目項目」ブロックは削除した(抽象的な助言で新しい情報が無いため)。
//   - 変化が大きい項目を最大3件に絞り、同じ原因から派生する重複表示を避ける
//     (例: 総売上減少の主要因が客数・客単価で説明できる場合は総売上を出さない、
//     REDUNDANT_WITH参照)。加えて、営業利益率・人件費率・材料費率のような構造指標を
//     結果指標(総売上・営業利益)より優先して選ぶ(CONCERN_TIER参照)。
//   - 総評は売上だけで良し悪しを判断せず、売上と営業利益が逆方向に動いた場合は
//     「売上は減少しましたが、〜により営業利益は増加しました」のように両方を対比して
//     述べる。
//
// 2026-09再修正(3回目)の経緯・要件:
//   1. 月締め(monthClosingStatus)には一切依存しない。今まさに損益表へ反映されている
//      当月の入力データをそのまま参照し、月途中でも表示する(要件1・2)。月締めボタン自体は
//      別の重要な役割(売上連動費用の金額スナップショット、過去月の変更確認)を持つため
//      残すが、この分析関数の実行条件には一切使わない——呼び出し元(App.jsx)からisClosedを
//      渡さなくなったこと自体が構造的な保証になっている。
//   2. 人件費は「金額が増えたら悪化」と判定しない(要件5)。美容室特有の売上連動歩合により、
//      売上が伸びれば人件費額が増えるのは正常なため、判定は常にlaborRate(人件費率、
//      pt差)だけで行う——金額(laborCost)は判定に使わず、文章の根拠説明にのみ使う。
//   3. 営業利益/営業利益率の悪化・改善は、数字から直接言える範囲で主要因(人件費率・
//      材料費率のどちらが動いたか)まで触れる(要件6)。生産性等、データの無い原因は
//      絶対に推測して書かない。
//
// 設計方針(変わらない部分):
//   1. compareMonthlyMetric()で当月値・前月値・差分(当月-前月)・前月比%・改善/悪化判定を
//      確定させる(この関数だけが計算を行う、他のどこにも同じ計算を重複実装しない)。
//   2. 確定した比較結果(MetricComparison)だけを文章テンプレートへ渡す。テンプレート側は
//      値を読んで日本語に整形するだけで、差分や改善/悪化を再計算・再判定しない。
//   3. 表示直前にvalidateMetricComparison()で「差分 = 当月 - 前月」等の整合性を再検証し、
//      異常があれば「前月比較なし」として扱う(NaN/Infinity/矛盾した符号を画面に出さない)。
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
// excludeFromConcernList: trueの指標(人件費額・材料費額)は、この値の増減だけで改善/悪化
// 一覧には出さない(要件5: 金額増加=悪化、と誤判定させないための構造的なガード)。
// 文章の根拠説明(成長率の比較)にだけ使う。
// concernTitle: 「変化が大きかった項目」の見出し(この指標がworsened=前月より悪い方向へ
// 動いた時の表現)。「悪化」「問題」等の評価語を避け、まず数値の変化そのものを事実として
// 表す中立表現に統一する(要件1)。
const METRIC_DEFS = {
  sales: { kind: "amount", direction: "higherIsBetter", label: "総売上", format: "yen", concernTitle: "総売上が前月を下回っています" },
  operatingProfit: { kind: "amount", direction: "higherIsBetter", label: "営業利益", format: "yen", concernTitle: "営業利益が前月を下回っています" },
  technicalSales: { kind: "amount", direction: "higherIsBetter", label: "技術売上", format: "yen", concernTitle: "技術売上が前月を下回っています" },
  retailSales: { kind: "amount", direction: "higherIsBetter", label: "店販売上", format: "yen", concernTitle: "店販売上が前月を下回っています" },
  customers: { kind: "amount", direction: "higherIsBetter", label: "客数", format: "people", concernTitle: "客数が減少しています" },
  newCustomers: { kind: "amount", direction: "higherIsBetter", label: "新規客数", format: "people", concernTitle: "新規客数が減少しています" },
  repeatCustomers: { kind: "amount", direction: "higherIsBetter", label: "再来客数", format: "people", concernTitle: "再来客数が減少しています" },
  averageSpend: { kind: "amount", direction: "higherIsBetter", label: "客単価", format: "yen", verb: "rise", concernTitle: "客単価が低下しています" },
  reviewCount: { kind: "amount", direction: "higherIsBetter", label: "口コミ数", format: "count", concernTitle: "口コミ数が減少しています" },
  operatingMargin: { kind: "rate", direction: "higherIsBetter", label: "営業利益率", format: "percent", concernTitle: "営業利益率が低下しています" },
  laborRate: { kind: "rate", direction: "lowerIsBetter", label: "人件費率", format: "percent", concernTitle: "人件費率が上昇しています" },
  materialRate: { kind: "rate", direction: "lowerIsBetter", label: "材料・仕入原価率", format: "percent", concernTitle: "材料・仕入原価率が上昇しています" },
  laborCost: { kind: "amount", direction: "higherIsBetter", label: "人件費", format: "yen", excludeFromConcernList: true },
  materialCost: { kind: "amount", direction: "higherIsBetter", label: "材料・仕入原価", format: "yen", excludeFromConcernList: true },
  // 2026-09追加(要因分析用)。この4指標は「変化が大きかった項目」に単独では出さず
  // (excludeFromConcernList、固定費・広告費は売上連動ではないため金額増減だけで良し悪しを
  // 語らない/店販比率は既に店販売上そのものが候補になるため二重に出さない)、他の指標の
  // 要因分析(FACTOR_RELATIONS)の「関連KPI」としてのみ使う。
  fixedCost: { kind: "amount", direction: "higherIsBetter", label: "固定費", format: "yen", excludeFromConcernList: true },
  fixedCostRate: { kind: "rate", direction: "lowerIsBetter", label: "固定費率", format: "percent", excludeFromConcernList: true },
  adCost: { kind: "amount", direction: "higherIsBetter", label: "広告費", format: "yen", excludeFromConcernList: true },
  adRate: { kind: "rate", direction: "lowerIsBetter", label: "広告費率", format: "percent", excludeFromConcernList: true },
  retailRatio: { kind: "rate", direction: "higherIsBetter", label: "店販比率", format: "percent", excludeFromConcernList: true },
};

// 要因分析(2026-09追加、要件5)。親指標が悪化/改善した時に、どの関連KPIの変化が最も
// 影響が大きいかを表示する。ここに無い指標は要因分析を出さない(推測で関係を作らない)。
// 各関連指標は既にbuildMetricComparisons側で比較済み(このマップは「どれとどれを並べて
// 見せるか」の対応表であって、新しい計算は一切行わない)。
const FACTOR_RELATIONS = {
  sales: ["customers", "averageSpend"],
  customers: ["newCustomers", "repeatCustomers"],
  operatingProfit: ["sales", "laborRate", "materialRate", "fixedCost", "adCost"],
  operatingMargin: ["laborRate", "materialRate", "fixedCostRate"],
  averageSpend: ["technicalSales", "retailSales", "customers"],
  retailSales: ["retailRatio", "customers"],
};

// 変化が大きい項目を最大3件に絞る際の優先順位(要件2)。営業利益率・人件費率・材料費率の
// ような「構造指標」は、総売上・営業利益のような「結果指標」より優先して選ぶ——利益率が
// 動いた原因(人件費率・材料費率)の方が、単なる結果の羅列より情報量が大きいため。
const CONCERN_TIER = {
  operatingMargin: 1, laborRate: 1, materialRate: 1,
  sales: 2, operatingProfit: 2, technicalSales: 2, retailSales: 2,
  customers: 3, newCustomers: 3, repeatCustomers: 3, averageSpend: 3, reviewCount: 3,
};

const formatValue = (value, format) => {
  if (format === "yen") return `${Math.round(parseNumber(value)).toLocaleString("ja-JP")}円`;
  if (format === "people") return `${Math.round(parseNumber(value)).toLocaleString("ja-JP")}人`;
  if (format === "count") return `${Math.round(parseNumber(value)).toLocaleString("ja-JP")}件`;
  if (format === "percent") return `${parseNumber(value).toFixed(1)}%`;
  return String(value);
};
const pct1 = (value) => `${Math.abs(parseNumber(value)).toFixed(1)}%`;
const pt1 = (value) => `${Math.abs(parseNumber(value)).toFixed(1)}pt`;

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
    if ((key === "retailSales" || key === "retailRatio") && fieldsEnabled.retailSales === false) continue;
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

function describeComparison(key, comparison) {
  const def = METRIC_DEFS[key];
  const currentText = formatValue(comparison.current, def.format);
  const previousText = formatValue(comparison.previous, def.format);
  if (def.kind === "rate") {
    const verb = comparison.diff > 0 ? "上昇" : "低下";
    return `${def.label}が${previousText}から${currentText}へ${pt1(comparison.diff)}${verb}しました。`;
  }
  const verb = def.verb === "rise" ? (comparison.diff > 0 ? "上昇" : "低下") : (comparison.diff > 0 ? "増加" : "減少");
  const percentText = comparison.percentChange !== null ? `${pct1(comparison.percentChange)}` : null;
  return percentText
    ? `${def.label}が${previousText}から${currentText}へ${percentText}${verb}しました。`
    : `${def.label}が${previousText}から${currentText}へ${verb}しました。`;
}

// 変化の向きを表す短い動詞(要因分析の文中で使う。describeComparisonと同じ判定基準)。
function verbFor(key, comparison) {
  const def = METRIC_DEFS[key];
  if (def.kind === "rate") return comparison.diff > 0 ? "上昇" : "低下";
  if (def.verb === "rise") return comparison.diff > 0 ? "上昇" : "低下";
  return comparison.diff > 0 ? "増加" : "減少";
}

// 比較可能な変化の大きさ(要件5: どの関連KPIの影響が大きいかを数値で判定する、推測しない)。
// amount系は前月比%、rate系はpt差の絶対値をそのまま比較の基準にする。
function factorMagnitude(comparison) {
  return comparison.percentChange !== null ? Math.abs(comparison.percentChange) : Math.abs(comparison.diff ?? 0);
}

// 親指標(例: 売上)が悪化/改善した時、FACTOR_RELATIONSで対応付けられた関連KPI(例: 客数・
// 客単価)のうち、実際に比較可能なものだけを並べ、最も変化が大きいものを「主な影響」として
// 1〜2文の説明文にする(要件5)。関連KPIが1つ以下しか比較できない場合は説明文を作らない
// (根拠の無い断定を避ける)。ここは表示用の文言生成のみで、新しい計算は一切行わない
// (buildMetricComparisonsで確定済みの値を読むだけ)。
function buildFactorAnalysis(parentKey, comparisons) {
  const parent = comparisons[parentKey];
  const relationKeys = FACTOR_RELATIONS[parentKey];
  if (!parent || parent.judgment === "no_comparison" || !relationKeys) return { relatedMetrics: [], factorNote: "" };

  const validRelations = relationKeys
    .map((key) => ({ key, comparison: comparisons[key] }))
    .filter(({ comparison }) => comparison && comparison.judgment !== "no_comparison");

  const relatedMetrics = validRelations.map(({ key, comparison }) => ({
    key,
    label: METRIC_DEFS[key].label,
    format: METRIC_DEFS[key].format,
    current: comparison.current,
    previous: comparison.previous,
    diff: comparison.diff,
    percentChange: comparison.percentChange,
    // 表示側の色分け(improved/worsened)はこのjudgmentだけを見る(生のdiff符号では判定しない)。
    // 人件費率・材料費率・固定費率のようなlowerIsBetter指標は差分がプラス(上昇)でも
    // 「悪化」であり、judgmentは既にcompareMonthlyMetricでdirectionを踏まえて確定済み。
    judgment: comparison.judgment,
  }));

  if (validRelations.length < 2) return { relatedMetrics, factorNote: "" };

  const ranked = [...validRelations].sort((a, b) => factorMagnitude(b.comparison) - factorMagnitude(a.comparison));
  const dominant = ranked[0];
  const dominantLabel = METRIC_DEFS[dominant.key].label;
  const dominantVerb = verbFor(dominant.key, dominant.comparison);
  const parentLabel = METRIC_DEFS[parentKey].label;
  const parentVerb = verbFor(parentKey, parent);

  let factorNote;
  if (ranked.length === 2) {
    const other = ranked[1];
    const otherLabel = METRIC_DEFS[other.key].label;
    factorNote = `${parentLabel}${parentVerb}は${otherLabel}よりも、${dominantLabel}${dominantVerb}の影響が大きくなっています。`;
  } else {
    factorNote = `${parentLabel}の変化は、主に${dominantLabel}の${dominantVerb}による影響です。`;
  }
  return { relatedMetrics, factorNote };
}

// 人件費率が動いた時の根拠説明(要件5)。laborRateの改善/悪化は「人件費率(pt)」だけで
// 判定済み(金額の増減は一切判定に使っていない)。ここでは、その判定が正しいことを
// 「人件費の伸び率 vs 売上の伸び率」という、数字から直接言える比較で裏付ける——
// 人件費率 = 人件費 ÷ 売上 なので、人件費率が悪化した時は必ず人件費の伸び率 > 売上の
// 伸び率になっている(逆に改善した時は必ずその逆になっている)。これは推測ではなく
// 算数的に確定した関係であり、根拠のない文章にはならない。
function laborRateBasisClause(comparisons) {
  const rate = comparisons.laborRate;
  const sales = comparisons.sales;
  const laborAmount = comparisons.laborCost;
  if (!rate || rate.judgment === "no_comparison") return "";
  if (!sales || sales.judgment === "no_comparison" || sales.percentChange === null) return "";
  if (!laborAmount || laborAmount.judgment === "no_comparison" || laborAmount.percentChange === null) return "";
  if (rate.judgment === "worsened") {
    return sales.diff >= 0
      ? "売上増加率より人件費増加率が大きくなっています。"
      : "人件費は減少していますが、売上の減少ほど下がっていません。";
  }
  if (rate.judgment === "improved" && laborAmount.diff > 0) {
    // 要件5の例1: 人件費額は増えているが、売上増加に対して人件費率は改善しているケース。
    return `人件費額は${formatValue(laborAmount.previous, "yen")}から${formatValue(laborAmount.current, "yen")}へ増加していますが、売上増加に対して人件費率は${pt1(rate.diff)}改善しており、問題ありません。`;
  }
  return "";
}

// 営業利益率が動いた主要因(要件6)。人件費率・材料費率という、実際に確定済みの比較結果
// からだけ言えることを述べる——生産性等、データの無い原因は書かない。「〜により、」と
// 文中に埋め込める名詞句として返す(総評で「〜により営業利益は増加しました」のように
// 使うため)。特定できない場合は空文字を返す。
function profitDriverReason(comparisons) {
  const margin = comparisons.operatingMargin;
  if (!margin || margin.judgment === "no_comparison" || margin.judgment === "unchanged") return "";
  const laborState = comparisons.laborRate?.judgment;
  const materialState = comparisons.materialRate?.judgment;
  if (margin.judgment === "worsened") {
    if (laborState === "worsened" && materialState === "worsened") return "人件費率・材料費率の上昇";
    if (laborState === "worsened") return "人件費率の上昇";
    if (materialState === "worsened") return "材料・仕入原価率の上昇";
    return "";
  }
  if (laborState === "improved" && materialState === "improved") return "人件費率・材料費率の改善";
  if (laborState === "improved") return "人件費率の改善";
  if (materialState === "improved") return "材料・仕入原価率の改善";
  return "";
}

// ①総評。実データ→差分→経営上の意味、の順で2〜4文にまとめる。抽象論・励まし文は
// 一切含めない。前月データが無い場合は当月の実績だけを事実として述べる。売上だけで
// 良し悪しを判断せず(要件4)、売上と営業利益が逆方向に動いた場合は「売上は減少しました
// が、〜により営業利益は増加しました」のように1文で対比して述べる——売上の増減だけを
// 強調して不必要にネガティブな印象を与えないようにする。
function buildSummaryText(comparisons, current) {
  const sales = comparisons.sales;
  if (!sales || sales.judgment === "no_comparison") {
    return `今月の総売上は${formatValue(current.sales, "yen")}でした。比較できる前月データが無いため、今月の実績のみを表示しています。`;
  }
  const salesGood = sales.diff >= 0;
  const salesVerb = salesGood ? "増加" : "減少";
  const salesClause = `売上は前月比${pct1(sales.percentChange)}${salesVerb}しました`;

  const sentences = [];
  const profit = comparisons.operatingProfit;
  const margin = comparisons.operatingMargin;
  if (profit && margin && profit.judgment !== "no_comparison" && margin.judgment !== "no_comparison") {
    if (profit.diff === 0 && margin.diff === 0) {
      sentences.push(`${salesClause}。営業利益は${formatValue(profit.current, "yen")}、営業利益率は${margin.current.toFixed(1)}%で、前月から変化ありませんでした。`);
    } else {
      const profitGood = profit.diff > 0 ? true : profit.diff < 0 ? false : null;
      const profitVerb = profit.diff > 0 ? "増加" : "減少";
      const marginVerb = margin.diff > 0 ? "改善" : "低下";
      const reason = profitDriverReason(comparisons);
      const reasonClause = reason ? `${reason}により、` : "";
      const profitSentence = `${reasonClause}営業利益は${formatValue(profit.previous, "yen")}から${formatValue(profit.current, "yen")}へ${profitVerb}し、営業利益率も${margin.previous.toFixed(1)}%から${margin.current.toFixed(1)}%へ${pt1(margin.diff)}${marginVerb}しました。`;
      if (profitGood !== null && profitGood !== salesGood) {
        // 売上と営業利益が逆方向 → 「〜が、」で1文につなげ、売上だけの評価に見えないようにする。
        sentences.push(`${salesClause}が、${profitSentence}`);
      } else {
        sentences.push(`${salesClause}。`);
        sentences.push(profitSentence);
      }
    }
  } else {
    sentences.push(`${salesClause}。`);
  }

  // 要件5の例1(人件費額は増えているが人件費率は改善しているケース)だけ、金額と率が
  // 逆方向に見えて誤解されやすいため補足する。悪化時の詳細な根拠説明は②側で個別に述べる。
  if (comparisons.laborRate?.judgment === "improved") {
    const laborClause = laborRateBasisClause(comparisons);
    if (laborClause) sentences.push(laborClause);
  }

  return sentences.join("");
}

// ②変化が大きかった項目。実際に前月より悪い方向へ動いた指標だけを、数字から直接言える
// 根拠付きで表示する(要件2)。人件費(laborCost)・材料費(materialCost)の金額そのものは
// 対象外(要件5、excludeFromConcernList)——人件費率・材料費率(pt差)だけで判定する。
// 同じ変化から派生する重複表示を避け(REDUNDANT_WITH)、構造指標を優先して(CONCERN_TIER)
// 最大3件に絞る。
// 「変化が大きかった項目」候補の並び順(全件、絞り込み前)。buildConcernPoints・
// buildNextFocusPointsの両方がこの1つの並び順だけを参照する(要件7: 来月確認する
// ポイントは変化が大きかった項目と同じ基準から自動選択する、を構造的に保証する)。
// 同じ変化から派生する項目を重複して並べない(要件2)。総売上(sales)・客数(customers)は
// 「合計側を残し、要因分析(relatedMetrics)で内訳を添える」方針にする(要件5の例と同じ:
// 売上減少のカードの中に客数・客単価の内訳を表示する)——内訳側(customers/averageSpend、
// newCustomers/repeatCustomers)が2件とも比較可能な時だけ、合計側を残しトップレベル候補
// から外す。この2組だけに限定し、営業利益率⇄人件費率/材料費率のような「構造指標を独立の
// 懸念として優先表示する」既存の設計(CONCERN_TIER、Fi-Ne横浜回帰テスト)には一切適用しない
// ——営業利益率側にも要因分析(relatedMetrics)は付くが、人件費率・材料費率はこれまで通り
// 単独でも上位に来ることができる。
const AGGREGATE_WITH_BREAKDOWN = {
  sales: ["customers", "averageSpend"],
  customers: ["newCustomers", "repeatCustomers"],
};

function rankConcernKeys(comparisons) {
  const keys = Object.keys(comparisons).filter((key) => comparisons[key].judgment === "worsened" && !METRIC_DEFS[key]?.excludeFromConcernList);

  const magnitude = (key) => factorMagnitude(comparisons[key]);
  const tierOf = (key) => CONCERN_TIER[key] ?? 4;
  const ordered = keys.sort((a, b) => (tierOf(a) - tierOf(b)) || (magnitude(b) - magnitude(a)));

  const claimed = new Set();
  const result = [];
  for (const key of ordered) {
    if (claimed.has(key)) continue;
    result.push(key);
    const childKeys = AGGREGATE_WITH_BREAKDOWN[key];
    if (!childKeys) continue;
    const validChildCount = childKeys.filter((childKey) => comparisons[childKey] && comparisons[childKey].judgment !== "no_comparison").length;
    if (validChildCount >= 2) {
      childKeys.forEach((childKey) => claimed.add(childKey));
    }
  }
  return result;
}

function buildConcernPoints(comparisons, thresholds) {
  return rankConcernKeys(comparisons)
    .slice(0, thresholds.maxConcernPoints)
    .map((key) => {
      const c = comparisons[key];
      let detail = describeComparison(key, c);
      if (key === "laborRate") {
        const basis = laborRateBasisClause(comparisons);
        if (basis) detail += basis;
      } else if (key === "materialRate" && comparisons.operatingMargin?.judgment === "worsened") {
        detail += "原価負担の上昇も営業利益率低下の一因です。";
      }
      // 要因分析(要件5): 関連KPIの実測値+どちらの影響が大きいかの説明文を1つ付ける。
      // 関連が定義されていない指標(FACTOR_RELATIONSに無い)は付かない。
      const { relatedMetrics, factorNote } = buildFactorAnalysis(key, comparisons);
      if (factorNote) detail += factorNote;
      return { id: key, title: METRIC_DEFS[key].concernTitle, detail, relatedMetrics };
    });
}

// 来月確認するポイント(要件7)。「変化が大きかった項目」と全く同じ候補・並び順から、
// まだ②に表示していない次点も含めて最大3件を選ぶ(②が3件に満たない月は同じ項目が
// そのまま出ることもあるが、これは「変化が大きい/利益影響が大きい項目」という同一の
// 基準から選んでいる結果であり仕様通り)。施策は書かず、現状値・前月値のみ添える。
function buildNextFocusPoints(comparisons, thresholds) {
  return rankConcernKeys(comparisons)
    .slice(0, thresholds.maxConcernPoints)
    .map((key) => {
      const c = comparisons[key];
      const def = METRIC_DEFS[key];
      return {
        id: key,
        label: def.label,
        current: formatValue(c.current, def.format),
        previous: c.previous !== null ? formatValue(c.previous, def.format) : null,
      };
    });
}

// hasData:false(当月にまだ何も入力が無い)の場合だけ、他の計算を一切行わず即座に返す。
// 月締め状態は一切参照しない(要件1・2・3の核心)——呼び出し元(App.jsx)もisClosedを
// もう渡さない。
export function analyzeMonthlyReview({
  current,
  previous,
  fieldsEnabled = { customers: true, newCustomers: true, repeatCustomers: true, retailSales: true, reviewCount: true },
  thresholds = MONTHLY_INSIGHT_THRESHOLDS,
} = {}) {
  if (!current?.hasData) {
    return { hasData: false, summaryText: "", concernPoints: [], nextFocusPoints: [], comparisons: {} };
  }
  const comparisons = buildMetricComparisons(current, previous, fieldsEnabled);
  return {
    hasData: true,
    summaryText: buildSummaryText(comparisons, current),
    concernPoints: buildConcernPoints(comparisons, thresholds),
    nextFocusPoints: buildNextFocusPoints(comparisons, thresholds),
    comparisons,
  };
}

// getMonthlyReviewMetrics: calculateMonthSummary(単一店舗)/calculateAllStoresMonthSummary+
// getCompanyDashboardSummary(全店舗)のどちらから来たかを問わず、この分析関数が必要とする
// 値だけをまとめた共通の形へ正規化する(要件11: 画面表示値と同じ計算結果を共通参照する、
// AIレビュー専用の別計算を作らない)。全店舗ビューの人件費率・材料費率・営業利益率は、
// 既存の「各店舗ごとにcalculateMonthSummaryを呼んでから合算し、率は合算後に再計算する」
// 規約(getCompanyDashboardSummary)をそのまま使う——店舗ごとの率を平均しない。
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
