// 日計CSV出力(React非依存の純関数)。既存の月次ダッシュボードCSV(dashboardExport.js)とは
// 完全に別の項目・計算式を持つ独立したCSVとして実装する(既存CSVの内容・計算式には一切
// 触れない)。Blobダウンロード自体(BOM付きUTF-8、Excel/Mac/Windows/Googleスプレッドシート
// で文字化けしない実装)だけはdashboardExport.jsのdownloadCsvをそのまま再利用する — これは
// 生成済み文字列をファイルとして保存するだけの汎用処理で、CSVの中身の項目・計算式には
// 関与しないため、共有しても既存CSVの回帰リスクにはならない。

const escapeCsvCell = (value) => {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const toCsvRow = (cells) => cells.map(escapeCsvCell).join(",");

// 未入力(hasData:false)は空セルにする — 0円が入力された実データと、単に未入力なだけの日を
// CSV上で混同させない(要件13)。実際に入力された金額はそのまま生の数値で出す(¥等の記号は
// 付けない。Excel/スプレッドシート側で数値として扱えるようにするため)。
const amountCellOrBlank = (value, hasData) => (hasData ? Math.round(Number(value) || 0) : "");

const formatCsvDate = (iso) => (iso || "").replaceAll("-", "/");

const CASH_BREAKDOWN_HEADER = ["日付", "曜日", "現金", "キャッシュレス", "ポイント利用", "日計合計", "総売上", "差額"];

export const buildCashBreakdownCsv = (rows = [], summary = null) => {
  const csvRows = [CASH_BREAKDOWN_HEADER];

  rows.forEach((row) => {
    // 差額列: 現金・日計とも入力済みの日だけ数値を出す。店休・未入力日はその状態が
    // 分かる短いラベルにする(空セルだと「差額0」なのか「判定対象外」なのか区別できない
    // ため、この列だけは意図的にテキストも許容する)。
    const diffCell = row.hasComparison
      ? Math.round(row.diff)
      : row.status === "holiday"
        ? "店休"
        : row.status === "unfilled"
          ? "未入力"
          : "";
    csvRows.push([
      formatCsvDate(row.date),
      row.weekday,
      amountCellOrBlank(row.cashAmount, row.hasCashBreakdown),
      amountCellOrBlank(row.cashlessAmount, row.hasCashBreakdown),
      amountCellOrBlank(row.pointAmount, row.hasCashBreakdown),
      amountCellOrBlank(row.cashBreakdownTotal, row.hasCashBreakdown),
      amountCellOrBlank(row.totalSales, row.hasTotalSales),
      diffCell,
    ]);
  });

  if (summary) {
    csvRows.push([
      "合計", "",
      Math.round(summary.cashTotal),
      Math.round(summary.cashlessTotal),
      Math.round(summary.pointTotal),
      Math.round(summary.cashBreakdownGrandTotal),
      Math.round(summary.salesTotal),
      Math.round(summary.diffTotal),
    ]);
  }

  return csvRows.map(toCsvRow).join("\n");
};

// ファイル名に使えない文字(Windows/Mac双方の制約を合わせた安全な範囲)を"_"に置き換える。
export const sanitizeFilenameSegment = (value) => String(value || "").replace(/[\\/:*?"<>|\n\r\t]/g, "_").trim() || "店舗";

export { downloadCsv } from "../dashboard/dashboardExport.js";
