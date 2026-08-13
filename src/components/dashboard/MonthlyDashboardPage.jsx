import { useMemo } from "react";
import {
  buildMonthKey, calculateMonthSummary, formatMonthLabel, getMonthOffset,
  getCompanyDashboardSummary, getStaffProductivitySummary,
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

  const useInventoryTracking = Boolean(selectedStoreEntity?.settings?.useInventoryTracking);
  const hiddenCategories = useMemo(() => selectedStoreEntity?.settings?.hiddenClosingCategories || [], [selectedStoreEntity]);
  const previousMonth = getMonthOffset(selectedMonth, -1);
  const storeSummary = useMemo(
    () => (!isAllStoresView && selectedStoreEntity
      ? calculateMonthSummary(appState, selectedStoreId, selectedMonth, { useInventoryTracking, hiddenCategories })
      : null),
    [appState, isAllStoresView, selectedStoreEntity, selectedStoreId, selectedMonth, useInventoryTracking, hiddenCategories]
  );
  const previousStoreSummary = useMemo(
    () => (!isAllStoresView && selectedStoreEntity
      ? calculateMonthSummary(appState, selectedStoreId, previousMonth, { useInventoryTracking, hiddenCategories })
      : null),
    [appState, isAllStoresView, selectedStoreEntity, selectedStoreId, previousMonth, useInventoryTracking, hiddenCategories]
  );
  const productivity = useMemo(
    () => (storeSummary ? getStaffProductivitySummary({
      sales: storeSummary.sales, forecast: storeSummary.forecast,
      staffCount: selectedStoreEntity?.staffCount, productivityStaffCount: selectedStoreEntity?.productivityStaffCount,
    }) : null),
    [storeSummary, selectedStoreEntity]
  );
  const previousProductivity = useMemo(
    () => (previousStoreSummary ? getStaffProductivitySummary({
      sales: previousStoreSummary.sales, forecast: previousStoreSummary.forecast,
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
            <button type="button" className="secondary-button" onClick={() => window.print()} disabled={!canExport}>レポート出力</button>
          </div>
        </div>
      </section>

      <div className="dashboard-print-area">
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
    </div>
  );
}
