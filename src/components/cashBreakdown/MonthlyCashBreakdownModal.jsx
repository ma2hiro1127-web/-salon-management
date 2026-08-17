import { useMemo, useState } from "react";
import {
  formatMonthLabel, getMonthOffset, getMonthlyCashBreakdownRows, summarizeMonthlyCashBreakdown, formatMoneyOrDash, money,
} from "../../utils/storage.js";
import { buildCashBreakdownCsv, downloadCsv, sanitizeFilenameSegment } from "./cashBreakdownExport.js";

function MonthlyTotalCard({ label, value }) {
  return (
    <div className="summary-card compact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// 差額状態セル。要件6と同じ理由(日計は照合用の補助情報であり、差額があってもエラーでは
// ない)で、不一致でも赤系のtext-dangerは使わない — 一致だけtext-successで目立たせ、
// それ以外(差額あり/店休/未入力/総売上未入力)は通常色のまま短いラベルで示す。
function CashBreakdownStatusCell({ row }) {
  if (row.status === "matched") return <span className="text-success">✓ 一致</span>;
  if (row.status === "mismatch") return <span>差額 {money(Math.abs(row.diff))}</span>;
  if (row.status === "holiday") return <span className="text-muted-cell">店休</span>;
  return <span className="text-muted-cell">－</span>;
}

// 月別日計一覧+CSV出力。日次入力画面(App.jsx)の日計カードから「月別日計を見る」で開く
// モーダル。選択中の店舗・月を初期値として受け取るが、ここでの前月/翌月切替は完全に
// ローカルなstateで完結させ、日次入力側のselectedMonth/dailyFormには一切書き込まない
// (この一覧を閉じても今編集中の日付が変わらないようにするため)。表示専用(読み取りのみ)
// で、Supabaseへの書き込みは一切行わない。
export default function MonthlyCashBreakdownModal({ appState, storeId, storeName, initialMonth, onClose }) {
  const [month, setMonth] = useState(initialMonth);

  const rows = useMemo(() => getMonthlyCashBreakdownRows(appState, storeId, month), [appState, storeId, month]);
  const summary = useMemo(() => summarizeMonthlyCashBreakdown(rows), [rows]);

  const handleExportCsv = () => {
    const csv = buildCashBreakdownCsv(rows, summary);
    downloadCsv(`${sanitizeFilenameSegment(storeName)}_日計_${month}.csv`, csv);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
        <div className="dashboard-toolbar">
          <div className="dashboard-month-nav">
            <button type="button" className="secondary-button" onClick={() => setMonth((current) => getMonthOffset(current, -1))}>‹ 前月</button>
            <strong>{formatMonthLabel(month)}</strong>
            <button type="button" className="secondary-button" onClick={() => setMonth((current) => getMonthOffset(current, 1))}>翌月 ›</button>
          </div>
          <div className="dashboard-actions">
            <button type="button" className="secondary-button" onClick={handleExportCsv}>CSV出力</button>
            <button type="button" className="text-button" onClick={onClose}>閉じる</button>
          </div>
        </div>

        <p className="helper-text">
          {storeName}の月別日計です。既存の総売上・損益・月次集計には一切加算されない、支払方法の内訳確認専用の一覧です。
        </p>

        <div className="kpi-grid compact-grid">
          <MonthlyTotalCard label="現金合計" value={money(summary.cashTotal)} />
          <MonthlyTotalCard label="キャッシュレス合計" value={money(summary.cashlessTotal)} />
          <MonthlyTotalCard label="ポイント利用合計" value={money(summary.pointTotal)} />
          <MonthlyTotalCard label="日計総額" value={money(summary.cashBreakdownGrandTotal)} />
          <MonthlyTotalCard label="月間総売上" value={money(summary.salesTotal)} />
          <MonthlyTotalCard label="月間差額" value={money(summary.diffTotal)} />
        </div>

        <div className="table-wrap">
          <table className="cash-breakdown-monthly-table">
            <thead>
              <tr>
                <th>日付</th>
                <th>曜日</th>
                <th>現金</th>
                <th>キャッシュレス</th>
                <th>ポイント利用</th>
                <th>日計合計</th>
                <th>総売上</th>
                <th>差額状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className={row.isHoliday ? "cash-breakdown-row-holiday" : ""}>
                  <td>{row.date}</td>
                  <td>{row.weekday}</td>
                  <td>{formatMoneyOrDash(row.cashAmount, row.hasCashBreakdown)}</td>
                  <td>{formatMoneyOrDash(row.cashlessAmount, row.hasCashBreakdown)}</td>
                  <td>{formatMoneyOrDash(row.pointAmount, row.hasCashBreakdown)}</td>
                  <td>{formatMoneyOrDash(row.cashBreakdownTotal, row.hasCashBreakdown)}</td>
                  <td>{formatMoneyOrDash(row.totalSales, row.hasTotalSales)}</td>
                  <td><CashBreakdownStatusCell row={row} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
