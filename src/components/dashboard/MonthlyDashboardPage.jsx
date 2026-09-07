import { useMemo, useState } from "react";
import {
  buildMonthKey, calculateMonthSummary, formatMonthLabel, getMonthOffset,
  getCompanyDashboardSummary, getStaffProductivitySummary, buildStoreCostOptions,
} from "../../utils/storage.js";
import CompanyDashboardView from "./CompanyDashboardView.jsx";
import StoreDashboardView from "./StoreDashboardView.jsx";
import { buildCompanyCsv, buildStoreCsv, downloadCsv } from "./dashboardExport.js";

// 月次経営ダッシュボード本体。既存のトップバー店舗・年月セレクター(App.jsx)が更新する
// selectedStore/selectedMonth/isAllStoresViewをそのままpropsで受け取り、専用のセレクターは
// 新設しない。ここに追加する新規UIは前月/翌月ボタンと「レポート出力」「CSV出力」ボタンのみ。
export default function MonthlyDashboardPage({
  appState, currentCompany, isAllStoresView, selectedStoreId, selectedStoreEntity, selectedMonth, onMonthChange,
}) {
  const companySummary = useMemo(
    () => (isAllStoresView && currentCompany ? getCompanyDashboardSummary(appState, currentCompany, selectedMonth) : null),
    [appState, currentCompany, isAllStoresView, selectedMonth]
  );

  const previousMonth = getMonthOffset(selectedMonth, -1);
  // 不具合修正(LP用スクリーンショット作成中に発見、2026-09に再発): このページ専用の
  // calculateMonthSummary呼び出しに店舗の人件費/発注費の計算方法・率が渡っておらず、
  // 「売上連動(自動計算)で人件費・発注費を設定している店舗」で営業利益/営業利益率/
  // 発注費率が実際より過大(または「－」)に出てしまう不具合が2箇所で再発した。損益表
  // (App.jsx)・店舗比較(getStoreDashboardRows)・月次レビューと全く同じ共通関数
  // buildStoreCostOptionsを使うことで、この4項目を個々の画面で手動で揃える必要自体を
  // 無くす(単一のオプション組み立て関数に統一)。
  const costOptions = useMemo(() => buildStoreCostOptions(selectedStoreEntity), [selectedStoreEntity]);
  const storeSummary = useMemo(
    () => (!isAllStoresView && selectedStoreEntity
      ? calculateMonthSummary(appState, selectedStoreId, selectedMonth, costOptions)
      : null),
    [appState, isAllStoresView, selectedStoreEntity, selectedStoreId, selectedMonth, costOptions]
  );
  const previousStoreSummary = useMemo(
    () => (!isAllStoresView && selectedStoreEntity
      ? calculateMonthSummary(appState, selectedStoreId, previousMonth, costOptions)
      : null),
    [appState, isAllStoresView, selectedStoreEntity, selectedStoreId, previousMonth, costOptions]
  );
  const productivity = useMemo(
    () => (storeSummary ? getStaffProductivitySummary({
      sales: storeSummary.sales, forecast: storeSummary.displayForecast,
      staffCount: selectedStoreEntity?.staffCount, productivityStaffCount: selectedStoreEntity?.productivityStaffCount,
    }) : null),
    [storeSummary, selectedStoreEntity]
  );
  const previousProductivity = useMemo(
    () => (previousStoreSummary ? getStaffProductivitySummary({
      sales: previousStoreSummary.sales, forecast: previousStoreSummary.displayForecast,
      staffCount: selectedStoreEntity?.staffCount, productivityStaffCount: selectedStoreEntity?.productivityStaffCount,
    }) : null),
    [previousStoreSummary, selectedStoreEntity]
  );

  const isClosed = isAllStoresView
    ? Boolean(companySummary?.isFullyClosed)
    : Boolean(appState.monthClosingStatus?.[buildMonthKey(selectedStoreId, selectedMonth)]?.closed);

  const handleExportCsv = () => {
    const monthLabel = selectedMonth;
    if (isAllStoresView && companySummary) {
      downloadCsv(`月次ダッシュボード_全店舗_${monthLabel}.csv`, buildCompanyCsv(companySummary.storeRows));
    } else if (storeSummary) {
      const csv = buildStoreCsv({ storeName: selectedStoreEntity?.name || "", monthValue: selectedMonth, summary: storeSummary, previousSummary: previousStoreSummary, productivity });
      downloadCsv(`月次ダッシュボード_${selectedStoreEntity?.name || "店舗"}_${monthLabel}.csv`, csv);
    }
  };

  const canExport = isAllStoresView ? Boolean(companySummary?.storeRows?.length) : Boolean(storeSummary);

  const [showPrintConfirm, setShowPrintConfirm] = useState(false);
  const handleOpenPrintDialog = () => {
    setShowPrintConfirm(false);
    window.print();
  };

  return (
    <div className="stack">
      <section className="panel dashboard-print-hide">
        <div className="dashboard-toolbar">
          <div className="dashboard-month-nav">
            <button type="button" className="secondary-button" onClick={() => onMonthChange(getMonthOffset(selectedMonth, -1))}>‹ 前月</button>
            <strong>{formatMonthLabel(selectedMonth)}</strong>
            <button type="button" className="secondary-button" onClick={() => onMonthChange(getMonthOffset(selectedMonth, 1))}>翌月 ›</button>
            <span className={`status-chip ${isClosed ? "good" : "warning"}`}>{isClosed ? "月締め済み" : "暫定値"}</span>
          </div>
          <div className="dashboard-actions">
            <button type="button" className="secondary-button" onClick={handleExportCsv} disabled={!canExport}>CSV出力</button>
            <button type="button" className="secondary-button" onClick={() => setShowPrintConfirm(true)} disabled={!canExport}>レポート印刷</button>
          </div>
        </div>
      </section>

      <div className="dashboard-print-area">
        {/* 画面上は非表示、印刷時のみ表示(要件4: 店舗名・対象月は印刷結果に表示する)。
            通常の月ナビ(上のdashboard-toolbar)は印刷対象外(dashboard-print-hide)のため、
            印刷結果だけを見た時にどの店舗・どの月のレポートか分からなくならないようにする。 */}
        <div className="dashboard-print-header">
          <strong>{isAllStoresView ? "全店舗" : (selectedStoreEntity?.name || "")}</strong>
          <span>{formatMonthLabel(selectedMonth)}</span>
        </div>
        {isAllStoresView ? (
          companySummary ? <CompanyDashboardView companySummary={companySummary} /> : <div className="empty-card">店舗を追加してください。</div>
        ) : storeSummary ? (
          <StoreDashboardView
            storeName={selectedStoreEntity?.name || ""}
            summary={storeSummary}
            previousSummary={previousStoreSummary}
            productivity={productivity}
            previousProductivity={previousProductivity}
          />
        ) : (
          <div className="empty-card">店舗を選択してください。</div>
        )}
      </div>

      {showPrintConfirm ? (
        <div className="modal-overlay" onClick={() => setShowPrintConfirm(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">PRINT REPORT</p>
                <h3>月次レポートを印刷</h3>
              </div>
            </div>
            <p className="helper-text">この端末に設定されているプリンタから印刷します。</p>
            <ul className="print-confirm-list">
              <li>A4サイズ</li>
              <li>縦向き</li>
              <li>月次レポート全体を印刷</li>
            </ul>
            <p className="helper-text">プリンタが表示されない場合は、Macの「システム設定 → プリンタとスキャナ」からプリンタを追加してください。</p>
            <div className="row-actions" style={{ marginTop: 12 }}>
              <button className="secondary-button" type="button" onClick={() => setShowPrintConfirm(false)}>キャンセル</button>
              <button className="primary-button" type="button" onClick={handleOpenPrintDialog}>印刷画面を開く</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
