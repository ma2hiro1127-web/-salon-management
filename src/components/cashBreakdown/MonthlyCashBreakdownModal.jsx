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

// "2026-08-01" + 曜日ラベル → "8/1（土）"。PC版テーブルはYYYY-MM-DDのまま(要件10:
// PC版の表示を変えない)、iPhone版カードだけ要件どおりの短い月/日表記にする。
function formatDailyCardDateLabel(row) {
  const segments = row.date.split("-");
  const month = Number(segments[1]);
  const day = Number(segments[2]);
  return `${month}/${day}（${row.weekday}）`;
}

// iPhone版カードの差額状態。ここはPC版のCashBreakdownStatusCellとは異なり、要件で
// 明示的に「差額があれば赤系で分かるように」と指定されているため、一致=緑/差額あり=赤で
// はっきり区別する(PC版の配色方針は変えず、カードだけ新しい配色を使う)。
function CashBreakdownDayCardStatus({ row }) {
  if (row.status === "matched") {
    return (
      <span className="cash-breakdown-day-card-status is-match">
        差額 {money(0)}{"　"}✓ 一致
      </span>
    );
  }
  if (row.status === "mismatch") {
    return (
      <span className="cash-breakdown-day-card-status is-mismatch">
        差額 {money(Math.abs(row.diff))}{"　"}差額あり
      </span>
    );
  }
  if (row.status === "holiday") {
    return <span className="cash-breakdown-day-card-status is-muted">店休日</span>;
  }
  return <span className="cash-breakdown-day-card-status is-muted">－</span>;
}

// iPhone版専用の日別カード。PC版テーブルと全く同じrow(getMonthlyCashBreakdownRowsの
// 結果)をそのまま描画するだけで、スマホ専用の別データは一切作らない(要件)。
function CashBreakdownDayCard({ row }) {
  return (
    <div className={`cash-breakdown-day-card${row.isHoliday ? " is-holiday" : ""}`}>
      <div className="cash-breakdown-day-card-header">
        <span className="cash-breakdown-day-card-date">{formatDailyCardDateLabel(row)}</span>
        {row.isHoliday ? <span className="cash-breakdown-day-card-holiday-tag">店休日</span> : null}
      </div>
      <div className="cash-breakdown-day-card-hero">
        <div className="cash-breakdown-day-card-hero-item">
          <span>総売上</span>
          <strong>{formatMoneyOrDash(row.totalSales, row.hasTotalSales)}</strong>
        </div>
        <div className="cash-breakdown-day-card-hero-item">
          <span>日計</span>
          <strong>{formatMoneyOrDash(row.cashBreakdownTotal, row.hasCashBreakdown)}</strong>
        </div>
      </div>
      <div className="cash-breakdown-day-card-sub">
        <div>
          <span>現金</span>
          <span>{formatMoneyOrDash(row.cashAmount, row.hasCashBreakdown)}</span>
        </div>
        <div>
          <span>キャッシュレス</span>
          <span>{formatMoneyOrDash(row.cashlessAmount, row.hasCashBreakdown)}</span>
        </div>
        <div>
          <span>ポイント利用</span>
          <span>{formatMoneyOrDash(row.pointAmount, row.hasCashBreakdown)}</span>
        </div>
      </div>
      <div className="cash-breakdown-day-card-footer">
        <CashBreakdownDayCardStatus row={row} />
      </div>
    </div>
  );
}

// 月別日計一覧+CSV出力。日次入力画面(App.jsx)の日計カードから「月別日計を見る」で開く
// モーダル。選択中の店舗・月を初期値として受け取るが、ここでの前月/翌月切替は完全に
// ローカルなstateで完結させ、日次入力側のselectedMonth/dailyFormには一切書き込まない
// (この一覧を閉じても今編集中の日付が変わらないようにするため)。表示専用(読み取りのみ)
// で、Supabaseへの書き込みは一切行わない。
//
// PC版は横長テーブル(.cash-breakdown-desktop-table)、iPhone版はカード型の日別一覧
// (.cash-breakdown-daily-cards)——どちらもrows/summaryという同じ計算結果を描画するだけで、
// CSS(@media (max-width: 900px))の表示切替のみでレイアウトを分けている(要件:
// スマホ専用の別データを作らない/月切替時に両方が同時に正しく更新される)。
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

        <p className="helper-text cash-breakdown-modal-helper-text">
          {storeName}の月別日計です。既存の総売上・損益・月次集計には一切加算されない、支払方法の内訳確認専用の一覧です。
        </p>

        <div className="kpi-grid compact-grid cash-breakdown-summary-grid">
          <MonthlyTotalCard label="現金合計" value={money(summary.cashTotal)} />
          <MonthlyTotalCard label="キャッシュレス合計" value={money(summary.cashlessTotal)} />
          <MonthlyTotalCard label="ポイント利用合計" value={money(summary.pointTotal)} />
          <MonthlyTotalCard label="日計総額" value={money(summary.cashBreakdownGrandTotal)} />
          <MonthlyTotalCard label="月間総売上" value={money(summary.salesTotal)} />
          <MonthlyTotalCard label="月間差額" value={money(summary.diffTotal)} />
        </div>

        {/* PC版: 横長テーブル(900px以下では非表示、代わりに下のカード一覧を表示) */}
        <div className="table-wrap cash-breakdown-desktop-table">
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

        {/* iPhone版: カード型の日別一覧(900px超では非表示、上のテーブルを表示) */}
        <h3 className="cash-breakdown-daily-heading">日別明細</h3>
        <div className="cash-breakdown-daily-cards">
          {rows.map((row) => (
            <CashBreakdownDayCard key={row.date} row={row} />
          ))}
        </div>
      </div>
    </div>
  );
}
