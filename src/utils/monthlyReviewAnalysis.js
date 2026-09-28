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
  // 2026-09追加(要因分析用)。広告費・広告費率は「変化が大きかった項目」に単独では出さず
  // (excludeFromConcernList)、他の指標の要因分析(FACTOR_RELATIONS)の「関連KPI」としてのみ
  // 使う。固定費率は2026-09再改訂で人件費率・材料費率と同格(構造指標、CONCERN_TIER=1)に
  // 昇格し、単独でも「変化が大きかった項目」に出せるようにした。
  fixedCost: { kind: "amount", direction: "higherIsBetter", label: "固定費", format: "yen", excludeFromConcernList: true },
  fixedCostRate: { kind: "rate", direction: "lowerIsBetter", label: "固定費率", format: "percent", concernTitle: "固定費率が上昇しています" },
  adCost: { kind: "amount", direction: "higherIsBetter", label: "広告費", format: "yen", excludeFromConcernList: true },
  adRate: { kind: "rate", direction: "lowerIsBetter", label: "広告費率", format: "percent", excludeFromConcernList: true },
  retailRatio: { kind: "rate", direction: "higherIsBetter", label: "店販比率", format: "percent", excludeFromConcernList: true },
};

// 費用の「率」とその根拠になる「金額」の対応表(2026-09再改訂の中心)。率が動いた理由を
// 判定する際、この対応表にある指標だけは「金額自体が増えたか(真の原因)」「金額は横ばい・
// 減少なのに売上の減少に追いつかず相対的に率が動いただけか(結果)」を区別する
// (buildCostRateClause/buildFactorAnalysis参照)。ここに無い関連KPI(客数・客単価等)は
// 従来通り、動いた向きだけでグルーピングする。
const RATE_TO_AMOUNT_KEY = {
  laborRate: "laborCost",
  materialRate: "materialCost",
  fixedCostRate: "fixedCost",
  adRate: "adCost",
};

// 要因分析(2026-09追加、要件5)。親指標が悪化/改善した時に、どの関連KPIの変化が最も
// 影響が大きいかを表示する。ここに無い指標は要因分析を出さない(推測で関係を作らない)。
// 各関連指標は既にbuildMetricComparisons側で比較済み(このマップは「どれとどれを並べて
// 見せるか」の対応表であって、新しい計算は一切行わない)。
const FACTOR_RELATIONS = {
  sales: ["customers", "averageSpend"],
  customers: ["newCustomers", "repeatCustomers"],
  operatingProfit: ["sales", "laborRate", "materialRate", "fixedCost", "adCost"],
  operatingMargin: ["laborRate", "materialRate", "fixedCostRate", "adRate"],
  averageSpend: ["technicalSales", "retailSales", "customers"],
  retailSales: ["retailRatio", "customers"],
};

// 変化が大きい項目を最大3件に絞る際の優先順位(要件2)。営業利益率・人件費率・材料費率・
// 固定費率のような「構造指標」は、総売上・営業利益のような「結果指標」より優先して選ぶ
// ——利益率が動いた原因(人件費率・材料費率・固定費率)の方が、単なる結果の羅列より
// 情報量が大きいため。
const CONCERN_TIER = {
  operatingMargin: 1, laborRate: 1, materialRate: 1, fixedCostRate: 1,
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
// ユーザー向け画面では割合の変化量を必ず「%」で表示する(pt/ポイント/percentage pointは
// 一切使わない、2026-09統一)。amount指標の前月比%(例: 売上+12.3%)もrate指標のpt差
// (例: 営業利益率5.6pt低下→5.6%低下と表示)も、この1つの共通formatterだけを経由させる
// ——内部の計算(差分=当月-前月)自体は変更していない、表示の単位表記だけを揃えている。
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

// 変化の向きを表す動詞(2026-09全面改訂の中心ルール、要件9・10)。率・比率(kind:"rate")と
// 客単価(verb:"rise"、単価という性質上、量ではなく率と同じ扱いにする既存の判断を維持)は
// 「上昇/低下」、それ以外の量(売上・客数・件数等)は「増加/減少」。「悪化/改善」等の
// 評価語は一切使わない(要件10)。
function verbFor(def, diff) {
  if (def.kind === "rate" || def.verb === "rise") return diff > 0 ? "上昇" : "低下";
  return diff > 0 ? "増加" : "減少";
}

// 「前月値 → 今月値」の値推移テキスト(要件1・3・4)。差分(pt/%)ではなく実数値を並べ、
// 必ず前月→今月の順にする。formatValueが符号をそのまま出すため「--0.4%」のような
// 二重マイナスは発生しない(要件14)。
function rangeText(def, comparison) {
  return `${formatValue(comparison.previous, def.format)} → ${formatValue(comparison.current, def.format)}`;
}

// 指標1件分の変化を説明する1文(2026-09全面改訂、要件1・2・3・4・7・8・9・10・14・15)。
//   - 同値(diff===0): 「{label}は前月と同じ{value}です。」(要件15、上昇/低下も増加/減少も使わない)
//   - 率・比率(kind:"rate"、または客単価): 「{label}は {前月}% → {今月}% に{上昇/低下}しました。」
//     (要件1・3・9。差分の「○pt」「○%上昇」は本文に出さない — 要件2・4)
//   - それ以外の量: 「{label}は前月より{変化率}%{増加/減少}しました。」(要件8)。ただし営業利益の
//     ように黒字⇔赤字を跨ぐ変化は前月比%が意味を持たない(例: +95万円→-1.7万円は「-101.8%」
//     のような読み取りにくい数字になる)ため、この場合だけ率・比率と同じ「値→値」形式にする
//     (要件4の例: 営業利益)。
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

// 比較可能な変化の大きさ(要件5: どの関連KPIの影響が大きいかを数値で判定する、推測しない)。
// amount系は前月比%、rate系はpt差の絶対値をそのまま比較の基準にする。
function factorMagnitude(comparison) {
  return comparison.percentChange !== null ? Math.abs(comparison.percentChange) : Math.abs(comparison.diff ?? 0);
}

// 親指標(例: 営業利益率)が悪化/改善した時、FACTOR_RELATIONSで対応付けられた関連KPI
// (例: 人件費率・材料費率)のうち、親と同じ方向(悪化なら悪化、改善なら改善)へ動いた
// ものだけを「主な要因」として1文にまとめる(2026-09全面改訂、要件6・7・11)。
//   - 「よりも」で1件だけを名指しする比較表現、「〜の変化は、主に〜による影響です」という
//     回りくどい言い回しは廃止した(旧・禁止表現)。
//   - 親と逆方向に動いた関連KPI(例: 材料費率は上昇したが人件費率は低下した場合の人件費率)は
//     要因として挙げない——データから読み取れる範囲だけを述べる(要件11)。
//   - 該当する関連KPIが無い場合は説明文を作らない(根拠の無い断定を避ける)。
// ここは表示用の文言生成のみで、新しい計算は一切行わない(buildMetricComparisonsで
// 確定済みの値を読むだけ)。
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

  // 親と同じ方向(judgmentが一致)へ動いた関連KPIだけを要因候補にする。変化が大きい順に
  // 並べ、文中で先に挙げる(要件6の例: 材料費率の方が人件費率より大きく動いた場合、
  // 材料費率を先に述べる)。
  const contributing = validRelations
    .filter(({ comparison }) => comparison.judgment === parent.judgment)
    .sort((a, b) => factorMagnitude(b.comparison) - factorMagnitude(a.comparison));
  if (contributing.length === 0) return { relatedMetrics, factorNote: "" };

  // 2026-09再改訂の中心ルール: 「率が動いた」という事実だけを根本原因として扱わない。
  // RATE_TO_AMOUNT_KEYに対応表がある指標(人件費率・材料費率・固定費率・広告費率)は、
  // 対応する金額自体が増えているか(真の原因)、金額は横ばい・減少なのに売上の増減に
  // 追いつかず相対的に率が動いただけか(結果)を分けて文言を作る。対応表に無い関連KPI
  // (客数・客単価等)は従来通り、動いた向きだけでグルーピングする。
  // 真の増加/相対的上昇の区別が意味を持つのはparentが悪化した時だけ(要件の核心は
  // 「悪化の原因を早合点しない」ことであり、改善時に同じ区別を強いる必要はない)。
  // 売上が実質的に変化していない(unchanged)場合も、「売上の増減に対して」という
  // 説明は事実に反するため、通常のグルーピングにフォールバックする。
  const sales = comparisons.sales;
  const canClassifyBySales =
    parent.judgment === "worsened" && sales && sales.judgment !== "no_comparison" && sales.judgment !== "unchanged";

  const genuineAmountLabels = [];
  const relativeAmountLabels = [];
  const plainGroups = new Map();
  for (const { key, comparison } of contributing) {
    const amountKey = RATE_TO_AMOUNT_KEY[key];
    const amountComparison = amountKey ? comparisons[amountKey] : null;
    if (canClassifyBySales && amountKey && amountComparison && amountComparison.judgment !== "no_comparison") {
      const amountLabel = METRIC_DEFS[amountKey].label;
      if (amountComparison.diff > 0) {
        genuineAmountLabels.push(amountLabel);
      } else {
        relativeAmountLabels.push(amountLabel);
      }
      continue;
    }
    const def = METRIC_DEFS[key];
    const verb = verbFor(def, comparison.diff);
    if (!plainGroups.has(verb)) plainGroups.set(verb, []);
    plainGroups.get(verb).push(def.label);
  }

  const clauses = [];
  if (relativeAmountLabels.length > 0) {
    // 根本原因は費用側ではなく売上側の変化——費用額は追いついていないだけ、という
    // 結果であることを明示する(要件: 率上昇=根本原因、と短絡させない)。向き(増加/
    // 減少)はparentの改善/悪化ではなく、売上そのものの実際の増減符号で決める。
    const salesVerb = sales.diff < 0 ? "減少" : "増加";
    const amountVerb = sales.diff < 0 ? "減少幅が小さかった" : "増加幅が大きかった";
    clauses.push(`売上の${salesVerb}幅に対して${relativeAmountLabels.join("や")}の${amountVerb}こと`);
  }
  if (genuineAmountLabels.length > 0) {
    clauses.push(`${genuineAmountLabels.join("や")}の増加`);
  }
  if (plainGroups.size > 0) {
    const plainClause = [...plainGroups.entries()].map(([verb, labels]) => `${labels.join("や")}の${verb}`).join("・");
    clauses.push(plainClause);
  }
  if (clauses.length === 0) return { relatedMetrics, factorNote: "" };

  return { relatedMetrics, factorNote: `主に、${clauses.join("、")}が影響しています。` };
}

// 費用率(人件費率・材料費率・固定費率・広告費率)が動いた時の根拠説明を1つの共通関数に
// 統一する(2026-09再改訂の中心)。「率が上昇した」という事実だけでは根本原因を語らず、
// 必ず ①売上の増減 ②費用額自体の増減 ③(結果としての)費用率の変化 の順で判定する:
//   - 費用額自体が増えている(diff>0) → 費用側の増加自体が要因(真の原因として明言する)
//   - 費用額は横ばい・減少なのに率が上がっている → 売上の減少に費用の減少が追いついて
//     いないだけ(根本原因は売上の減少、率上昇はその結果)
// 人件費率 = 人件費 ÷ 売上 という関係から、上記の分岐は推測ではなく算数的に確定した事実
// だけを述べる。laborRate/materialRate/fixedCostRate/adRateのどれでも同じロジックで動く
// ため、今後この対応表(RATE_TO_AMOUNT_KEY)に指標を追加するだけで同じルールが適用される。
function buildCostRateClause(rateKey, comparisons) {
  const amountKey = RATE_TO_AMOUNT_KEY[rateKey];
  if (!amountKey) return "";
  const rate = comparisons[rateKey];
  const sales = comparisons.sales;
  const amount = comparisons[amountKey];
  if (!rate || rate.judgment === "no_comparison" || rate.judgment === "unchanged") return "";
  if (!sales || sales.judgment === "no_comparison") return "";
  if (!amount || amount.judgment === "no_comparison") return "";

  const rateLabel = METRIC_DEFS[rateKey].label;
  const amountLabel = METRIC_DEFS[amountKey].label;
  // 固定費は人件費・材料費と違い、売上に応じて自然に増減する性質の費用ではない
  // (要件: 固定費率について)。そのため「費用側の減少幅が売上に追いついていない」という
  // 変動費向けの説明ではなく、「売上が減ったことで、動かない固定費の負担割合が
  // 相対的に重くなった」という固定費特有の表現にする。
  const isFixedCost = rateKey === "fixedCostRate";

  if (rate.judgment === "worsened") {
    if (amount.diff > 0) {
      // 費用額自体が増えている → 真の原因(要件: 費用側を原因として扱ってよいケース)。
      if (isFixedCost) {
        return `${amountLabel}の増加も営業利益低下に影響しています。`;
      }
      if (sales.diff < 0) {
        // 売上が減っているのに費用額まで増えている、というより強いケースも同じ枝で扱う
        // (要件: 売上減少率以上に費用額が増加している場合)。
        return `売上が減少する中で${amountLabel}が増加しているため、${rateLabel}が上昇しています。`;
      }
      return `売上の増加より${amountLabel}の増加が大きいため、${rateLabel}が上昇しています。`;
    }
    // 費用額は横ばい・減少なのに率が上昇 → 売上の変化に費用の減少が追いついていないだけ
    // (根本原因は売上の減少、率上昇は結果)。ただし売上が実質的に変化していない
    // (unchanged)場合、この組み合わせは算数的に矛盾する(rate=amount/salesである以上、
    // 売上不変・費用額が非増加なら率は悪化し得ない)ため、事実と異なる説明を作らないよう
    // 何も述べない。
    if (sales.judgment === "unchanged") return "";
    if (isFixedCost) {
      return `売上減少により、${amountLabel}の売上に対する負担割合が上昇しています。`;
    }
    return `売上の減少幅に対して${amountLabel}の減少幅が小さかったため、${rateLabel}が上昇しています。`;
  }
  // improved = 率(lowerIsBetter)が低下方向。金額自体は増えているのに率は下がっている
  // (=売上の伸びが費用の伸びより大きい)ケースだけ、誤解されやすいため補足する。
  if (amount.diff > 0) {
    return `${amountLabel}は ${rangeText(METRIC_DEFS[amountKey], amount)} に増加していますが、売上の増加が大きいため${rateLabel}は低下しています。`;
  }
  return "";
}

// ①総評(2026-09全面改訂、要件5・12・17)。①売上等の主要KPI変化 ②営業利益の変化
// ③営業利益率の変化 ④主な要因、の順で**別々の短い文**に分ける——1文に複数のKPIを
// 詰め込まない(要件17、スマホでも読みやすい長さを優先)。各文はdescribeComparison
// (「変化が大きかった項目」と同じ共通関数)をそのまま使うため、率は「値→値」、量は
// 「前月より○%」という表記ルールが総評でも自動的に統一される。要因(④)は短い名詞句
// (例:「人件費率・材料費率の上昇」)だけに留め、詳細な根拠説明は「変化が大きかった
// 項目」側に譲ることで、総評と内容が丸ごと重複しないようにする(要件12)。
// 前月データが無い場合は当月の実績だけを事実として述べる。抽象論・励まし文は一切含めない。
function buildSummaryText(comparisons, current) {
  const sales = comparisons.sales;
  if (!sales || sales.judgment === "no_comparison") {
    return `今月の総売上は${formatValue(current.sales, "yen")}でした。比較できる前月データが無いため、今月の実績のみを表示しています。`;
  }

  const sentences = [describeComparison("sales", sales)];

  const profit = comparisons.operatingProfit;
  const margin = comparisons.operatingMargin;
  if (profit && margin && profit.judgment !== "no_comparison" && margin.judgment !== "no_comparison") {
    sentences.push(describeComparison("operatingProfit", profit));
    sentences.push(describeComparison("operatingMargin", margin));
    // 要因(④)は「変化が大きかった項目」と同じbuildFactorAnalysisを再利用する(要件:
    // 同じ判定ロジックを重複実装しない)。率が動いた事実だけでなく、費用額自体の増減で
    // 真の原因/結果を区別した文がそのまま使われる。
    const { factorNote } = buildFactorAnalysis("operatingMargin", comparisons);
    if (factorNote) sentences.push(factorNote);
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

// ②変化が大きかった項目、1件分の文章構造(2026-09全面改訂、要件6): タイトル→数値の変化
// (describeComparison、「前月値 → 今月値」形式)→要因、の順で1〜2文にまとめる。要因は
// まずFACTOR_RELATIONSベースの汎用的な要因分析(buildFactorAnalysis)を試し、対象外の
// 指標(laborRate/materialRate/fixedCostRateはFACTOR_RELATIONSの親ではないため対象外)は
// buildCostRateClause(費用額自体の増減で根本原因/結果を区別する)にフォールバックする。
function buildConcernPoints(comparisons, thresholds) {
  return rankConcernKeys(comparisons)
    .slice(0, thresholds.maxConcernPoints)
    .map((key) => {
      const c = comparisons[key];
      let detail = describeComparison(key, c);
      // 要因の説明は2段構えにする: ①この指標自身がFACTOR_RELATIONSの親であれば
      // (例: 営業利益率→人件費率・材料費率・固定費率)buildFactorAnalysisの結果を使う。
      // ②親では無いが費用率自身(人件費率・材料費率・固定費率・広告費率)であれば、
      // buildCostRateClauseで「費用額自体の増減」に基づく根本原因/結果の説明を付ける
      // (要件: 率が動いた事実だけで根本原因と断定しない)。
      const { relatedMetrics, factorNote } = buildFactorAnalysis(key, comparisons);
      if (factorNote) {
        detail += factorNote;
      } else {
        const costClause = buildCostRateClause(key, comparisons);
        if (costClause) detail += costClause;
      }
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
