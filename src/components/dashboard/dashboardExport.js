// 月次経営ダッシュボードのCSV出力(React非依存の純関数)。新しい依存ライブラリは追加せず、
// 手書きのCSV文字列組み立て+Blobダウンロードのみで実装する。
import { diffPercent } from "../../utils/storage.js";

const escapeCsvCell = (value) => {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const toCsvRow = (cells) => cells.map(escapeCsvCell).join(",");

// hasDataがfalseなら画面表示と同じ「－」をセルに入れる。数値は四捨五入した生の数値のまま
// (¥や%の文字を付けない)にして、CSVを開いたスプレッドシート側で集計・計算しやすくする。
const cellOrDash = (value, hasData = true, digits = 0) => {
  if (!hasData || !Number.isFinite(Number(value))) return "－";
  const num = Number(value);
  return digits > 0 ? Number(num.toFixed(digits)) : Math.round(num);
};

const COMPANY_HEADER = [
  "店舗名", "売上", "前月比", "客数", "客単価", "新規客数", "新規率", "店販売上", "店販率",
  "人件費", "人件費率", "発注費", "発注費率", "固定費", "固定費率", "営業利益", "営業利益率",
  "スタッフ換算人数", "スタッフ生産性",
];

export const buildCompanyCsv = (storeRows = []) => {
  const rows = [COMPANY_HEADER];
  storeRows.forEach((row) => {
    const salesDiff = diffPercent(row.sales, row.previous.sales, row.previous.hasPrevious);
    rows.push([
      row.storeName,
      cellOrDash(row.sales),
      cellOrDash(salesDiff, salesDiff !== null, 1),
      cellOrDash(row.customers),
      cellOrDash(row.averageSpend, row.hasCustomerData),
      cellOrDash(row.newCustomers),
      cellOrDash(row.newCustomerRate, row.hasCustomerData, 1),
      cellOrDash(row.retailSales),
      cellOrDash(row.retailRatio, row.hasRetailData, 1),
      cellOrDash(row.laborCost, row.hasLaborData),
      cellOrDash(row.laborRate, row.hasLaborData, 1),
      cellOrDash(row.purchaseCost, row.hasPurchaseData),
      cellOrDash(row.purchaseCostRate, row.hasPurchaseData, 1),
      cellOrDash(row.fixedCost),
      cellOrDash(row.fixedCostRate, true, 1),
      cellOrDash(row.operatingProfit),
      cellOrDash(row.operatingMargin, true, 1),
      cellOrDash(row.effectiveStaffCount, row.productivity.hasStaffCount, 1),
      cellOrDash(row.productivity.current, row.productivity.hasStaffCount),
    ]);
  });
  return rows.map(toCsvRow).join("\n");
};

// 店舗単体モードは「1店舗の月次KPI・費用・損益」を項目,値の縦持ちで出力する(比較表と違い
// 行方向の比較軸を持たないデータのため)。
export const buildStoreCsv = ({ storeName, monthValue, summary, previousSummary, productivity }) => {
  const hasPrevious = Boolean(previousSummary?.entries?.length);
  const salesDiff = diffPercent(summary.sales, previousSummary?.sales, hasPrevious);
  const rows = [["項目", "値"]];
  const push = (label, value) => rows.push([label, value]);

  push("店舗名", storeName);
  push("対象年月", monthValue);
  push("総売上", cellOrDash(summary.sales));
  push("前月比(売上)", cellOrDash(salesDiff, salesDiff !== null, 1));
  push("技術売上", cellOrDash(summary.technicalSales));
  push("店販売上", cellOrDash(summary.retailSales));
  push("店販率", cellOrDash(summary.retailRatio, summary.sales > 0, 1));
  push("総客数", cellOrDash(summary.customers));
  push("客単価", cellOrDash(summary.averageSpend, summary.customers > 0));
  push("新規客数", cellOrDash(summary.newCustomers));
  push("新規率", cellOrDash(summary.customers > 0 ? (summary.newCustomers / summary.customers) * 100 : 0, summary.customers > 0, 1));
  push("再来客数", cellOrDash(summary.repeatCustomers));
  push("再来率", cellOrDash(summary.repeatRate, summary.customers > 0, 1));
  push("口コミ数", cellOrDash(summary.reviewCount));
  push("目標達成率", cellOrDash(summary.targetAchievement, Boolean(summary.target?.targetSales), 1));

  // 画面(StoreDashboardView)のコスト構成表と同じ内訳(固定費は6カテゴリの内部合計を1行)で
  // 出力する — CSVは「今表示している内容」の書き出しなので、画面と定義がずれないようにする。
  const fixedCostSubKeys = ["rent", "utilities", "communication", "cleaning", "system", "tax_insurance"];
  const hasFixedCostEntry = fixedCostSubKeys.some((key) => summary.categoryHasEntry?.[key]);
  push("人件費(金額)", cellOrDash(summary.laborCost, Boolean(summary.categoryHasEntry?.labor)));
  push("人件費(売上比率)", cellOrDash(summary.laborRate, Boolean(summary.categoryHasEntry?.labor), 1));
  push("発注費/材料原価(金額)", cellOrDash(summary.costOfGoodsSold, Boolean(summary.categoryHasEntry?.materials)));
  push("発注費/材料原価(売上比率)", cellOrDash(summary.costOfGoodsSoldRate, Boolean(summary.categoryHasEntry?.materials), 1));
  push("固定費(金額)", cellOrDash(summary.fixedCost, hasFixedCostEntry));
  push("固定費(売上比率)", cellOrDash(summary.sales > 0 ? (summary.fixedCost / summary.sales) * 100 : 0, hasFixedCostEntry && summary.sales > 0, 1));
  push("広告費(金額)", cellOrDash(summary.adCost, Boolean(summary.categoryHasEntry?.advertising)));
  push("広告費(売上比率)", cellOrDash(summary.adRate, Boolean(summary.categoryHasEntry?.advertising), 1));
  push("その他費用(金額)", cellOrDash(summary.otherCost, Boolean(summary.categoryHasEntry?.other)));
  push("その他費用(売上比率)", cellOrDash(summary.sales > 0 ? (summary.otherCost / summary.sales) * 100 : 0, Boolean(summary.categoryHasEntry?.other) && summary.sales > 0, 1));
  if (summary.categoryHasEntry?.uncategorized) {
    const uncategorizedAmount = summary.costsByCategory?.uncategorized ?? 0;
    push("未分類(金額)", cellOrDash(uncategorizedAmount));
    push("未分類(売上比率)", cellOrDash(summary.sales > 0 ? (uncategorizedAmount / summary.sales) * 100 : 0, summary.sales > 0, 1));
  }

  push("営業利益", cellOrDash(summary.operatingProfit, !summary.isProvisionalProfit));
  push("営業利益率", cellOrDash(summary.operatingMargin, !summary.isProvisionalProfit, 1));
  push("スタッフ換算人数/生産性", productivity?.hasStaffCount ? cellOrDash(productivity.current) : "－");

  return rows.map(toCsvRow).join("\n");
};

export const downloadCsv = (filename, csv) => {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
