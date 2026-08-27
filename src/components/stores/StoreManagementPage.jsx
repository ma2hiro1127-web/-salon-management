import { useEffect, useRef, useState } from "react";
import NumericInput from "../common/NumericInput.jsx";
import { computeStoreSummary } from "../../utils/storeManagement.js";
import { canManageStores, canEditStoreName, canChangeStoreLifecycle, canHardDeleteStore } from "../../utils/permissions.js";
import { dailyFieldKeys, dailyFieldLabels, monthlyTargetFieldKeys, monthlyTargetFieldLabels } from "../../data/defaults.js";

// 店舗管理ページ 90点改修。既存の状態・保存処理(App.jsx側)は一切変更せず、propsとして
// そのまま受け取って表示するだけ——ロジックは無改修、情報設計とUIだけを再構成する。
//
// 「店舗一覧」(追加・一覧・選択)と「店舗設定」(基本設定/入力設定/目標設定/日計管理/その他)
// の2段階構成にする。新しい「選択中店舗」の概念は作らず、既存のappState.selectedStoreId
// (店舗切替ヘッダーと共通)をそのまま使う——このページ内のstoreView("list"|"settings")は
// あくまで「今どちらの画面を見せているか」という表示状態のみを持つ。

const STORE_SETTINGS_TABS = [
  { id: "basic", label: "基本設定" },
  { id: "daily", label: "入力設定" },
  { id: "target", label: "目標設定" },
  { id: "cash", label: "日計管理" },
  { id: "other", label: "その他" },
];

const STATUS_META = {
  active: { label: "運営中", className: "store-status-badge active" },
  suspended: { label: "停止中", className: "store-status-badge suspended" },
  archived: { label: "アーカイブ", className: "store-status-badge archived" },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.active;
}

// 保存状態の表示(要件3-4): 未変更時は何も出さない、変更中は「未保存の変更があります」、
// 保存成功時は「保存しました」を数秒でフェードアウトさせる。保存ロジック・状態変数
// (dailyFieldSaveStatus等)は無改修——このコンポーネントは受け取った値を表示するだけ。
function SaveStatusInline({ dirty, status }) {
  const [savedFlash, setSavedFlash] = useState(false);
  const timerRef = useRef(null);
  const prevStatusRef = useRef(status?.status);

  useEffect(() => {
    if (status?.status === "saved" && prevStatusRef.current !== "saved") {
      setSavedFlash(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setSavedFlash(false), 2500);
    }
    prevStatusRef.current = status?.status;
  }, [status?.status]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (status?.status === "error" && status?.message) {
    return <span className="save-status-inline error">{status.message}</span>;
  }
  if (savedFlash && status?.message) {
    return <span className="save-status-inline saved">{status.message}</span>;
  }
  if (dirty) {
    return <span className="save-status-inline dirty">未保存の変更があります</span>;
  }
  return null;
}

// 日次入力項目/月間目標項目の設定を、カード型トグルではなく縦リスト形式で表示する共通UI
// (要件2-3・2-4)。項目名を主役にし、スイッチは右側に小さく添える。
function FieldToggleList({ keys, labels, values, editable, onToggle }) {
  return (
    <div className="store-field-list">
      {keys.map((fieldKey) => (
        <label key={fieldKey} className="store-field-row">
          <span>{labels[fieldKey]}</span>
          <input
            type="checkbox"
            checked={Boolean(values[fieldKey])}
            disabled={!editable}
            onChange={editable ? (event) => onToggle(fieldKey, event.target.checked) : undefined}
          />
        </label>
      ))}
    </div>
  );
}

function StoreCard({ store, isSelected, canOperate, canHardDelete, onToggleMenu, menuOpen, onOpenStore, onLifecycleAction, onDuplicate, onRequestHardDelete }) {
  const summary = computeStoreSummary(store, { staffCount: store.staffIds?.length || store.staffCount || 0 });
  const meta = statusMeta(store.status);
  const hasMetricsData = Boolean(store?.metrics);
  const staffUnset = store.staffCount === undefined || store.staffCount === null;
  // 「⋯」メニューの中身(複製/停止・再開・復元/アーカイブ/完全削除)は全てcanOperate
  // (system_admin/company_admin限定)配下の操作のため、canOperateがfalseならメニュー自体を
  // 出さない——store_managerに「押しても何も入っていない⋯ボタン」を見せないため。
  const hasMenuItems = canOperate;

  return (
    <div className={`store-card${isSelected ? " selected" : ""}`}>
      <div className="store-card-head">
        <strong>{store.name}</strong>
        <span className={meta.className}>{meta.label}</span>
      </div>
      <div className="store-metrics">
        <div>
          <span>達成率</span>
          <strong>{hasMetricsData ? `${summary.achievementRate}%` : "—"}</strong>
        </div>
        <div>
          <span>前月比</span>
          <strong>{hasMetricsData ? `${summary.changeRate}%` : "—"}</strong>
        </div>
        <div>
          <span>スタッフ</span>
          <strong>{staffUnset ? "未設定" : `${summary.staffCount}人`}</strong>
        </div>
      </div>
      <div className="store-card-actions">
        <button className="primary-button store-card-cta" type="button" onClick={() => onOpenStore(store)}>
          この店舗を管理
        </button>
        {hasMenuItems ? (
          <div className="store-card-menu">
            <button className="text-button store-card-menu-trigger" type="button" aria-label="その他の操作" onClick={() => onToggleMenu(store.id)}>
              ⋯
            </button>
            {menuOpen ? (
              <div className="store-card-menu-popover" role="menu">
                {canOperate && store.status !== "archived" && (
                  <button className="text-button" type="button" role="menuitem" onClick={() => onDuplicate(store)}>複製</button>
                )}
                {canOperate && store.status === "archived" && (
                  <button className="text-button" type="button" role="menuitem" onClick={() => onLifecycleAction(store, "restore")}>復元</button>
                )}
                {canOperate && store.status === "active" && (
                  <button className="text-button" type="button" role="menuitem" onClick={() => onLifecycleAction(store, "suspend")}>停止</button>
                )}
                {canOperate && store.status === "suspended" && (
                  <button className="text-button" type="button" role="menuitem" onClick={() => onLifecycleAction(store, "resume")}>再開</button>
                )}
                {canOperate && store.status !== "archived" && (
                  <button className="text-button" type="button" role="menuitem" onClick={() => onLifecycleAction(store, "archive")}>アーカイブ</button>
                )}
                {canOperate && store.status === "archived" && canHardDelete && (
                  <button className="text-button danger" type="button" role="menuitem" onClick={() => onRequestHardDelete(store)}>完全削除</button>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function StoreManagementPage({
  currentRole,
  franchiseReadOnly,
  newStoreName,
  setNewStoreName,
  newStoreFormStatus,
  handleCreateNewStore,
  isAllStoresView,
  selectedStore,
  selectedStoreEntity,
  storeForm,
  setStoreForm,
  storeFieldChangeHandlers,
  storeFormStatus,
  handleSaveStore,
  storeFormNameInputRef,
  dailyFieldDraft,
  updateDailyFieldToggle,
  applyDailyFieldPreset,
  dailyFieldSaveStatus,
  dailyFieldDirty,
  handleSaveDailyFieldSettings,
  monthlyTargetFieldDraft,
  updateMonthlyTargetFieldToggle,
  monthlyTargetFieldSaveStatus,
  monthlyTargetFieldDirty,
  handleSaveMonthlyTargetFieldSettings,
  handleToggleInventoryTracking,
  handleToggleCashBreakdown,
  showArchivedStores,
  setShowArchivedStores,
  stores,
  handleStoreSwitch,
  handleStoreLifecycleAction,
  handleDuplicateStore,
  requestHardDeleteStore,
}) {
  const [storeView, setStoreView] = useState("list");
  const [storeSettingsTab, setStoreSettingsTab] = useState("basic");
  const [openActionMenuStoreId, setOpenActionMenuStoreId] = useState("");

  const canManageAllStores = canManageStores(currentRole);
  const canEditName = canEditStoreName(currentRole);
  const canOperate = canChangeStoreLifecycle(currentRole) && !franchiseReadOnly;
  const canHardDelete = canHardDeleteStore(currentRole);

  // 全店舗ビューへ切り替わった/選択中店舗が無くなった場合は、設定画面に留まらせず一覧へ戻す
  // (元の「店舗基本設定」カードが全店舗ビュー中は空状態を表示していたのと同じ考え方)。
  // レンダー中に導出するだけ(useEffect+setStateにしない——Reactの推奨パターン、
  // react-hooks/set-state-in-effectの警告対象になる書き方を避ける)。
  const effectiveStoreView = (storeView === "settings" && (isAllStoresView || !selectedStoreEntity)) ? "list" : storeView;

  const openStore = (store) => {
    handleStoreSwitch(store.name);
    setStoreSettingsTab("basic");
    setStoreView("settings");
    setOpenActionMenuStoreId("");
  };

  const showBasicTab = canEditName && !franchiseReadOnly;
  const visibleTabs = STORE_SETTINGS_TABS.filter((tab) => tab.id !== "basic" || showBasicTab);
  const activeTab = visibleTabs.some((tab) => tab.id === storeSettingsTab) ? storeSettingsTab : (visibleTabs[0]?.id || "daily");

  // 基本設定タブを開いたら店舗名欄へフォーカスする(元のfocusStoreFormが担っていた
  // 「操作したことが分かる」フィードバックを、画面遷移そのものが代わりに果たすため
  // スクロールは不要——フォーカスだけ引き継ぐ)。
  useEffect(() => {
    if (effectiveStoreView === "settings" && activeTab === "basic") {
      storeFormNameInputRef?.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveStoreView, activeTab]);

  const dailyEditable = Boolean(selectedStore) && canEditName && !franchiseReadOnly;
  const targetEditable = dailyEditable;
  const toggleEditable = canEditName && !franchiseReadOnly;

  const activeStores = stores.filter((store) => store.status !== "archived");
  const archivedStores = stores.filter((store) => store.status === "archived");
  const visibleStores = showArchivedStores ? archivedStores : activeStores;

  return (
    <section className="panel store-management-page">
      {effectiveStoreView === "list" ? (
        <>
          <div className="panel-heading">
            <div>
              <h2>店舗管理</h2>
              <p className="helper-text">店舗の追加・確認・基本設定を管理できます。</p>
            </div>
          </div>
          {franchiseReadOnly ? (
            <div className="empty-card">加盟店の店舗情報は閲覧専用です（登録・編集・各種設定の変更はできません）。</div>
          ) : null}

          {canManageAllStores && !franchiseReadOnly && (
            <div className="setup-card">
              <div className="panel-heading compact"><div><h3>新しい店舗を追加</h3></div></div>
              <p className="helper-text">店舗名を入力すると、新しい店舗を作成できます。詳細設定は作成後に行えます。</p>
              <div className="inline-form">
                <input value={newStoreName} onChange={(event) => setNewStoreName(event.target.value)} placeholder="新しい店舗名" />
                <button className="primary-button" type="button" onClick={handleCreateNewStore} disabled={newStoreFormStatus.status === "saving"}>
                  {newStoreFormStatus.status === "saving" ? "追加中…" : "店舗を追加"}
                </button>
              </div>
              {newStoreFormStatus.message ? <div className="notice-box">{newStoreFormStatus.message}</div> : null}
            </div>
          )}

          {visibleStores.length ? (
            <div className="card-grid store-card-grid">
              {visibleStores.map((store) => (
                <StoreCard
                  key={store.id}
                  store={store}
                  isSelected={selectedStoreEntity?.id === store.id}
                  canOperate={canOperate}
                  canHardDelete={canHardDelete}
                  menuOpen={openActionMenuStoreId === store.id}
                  onToggleMenu={(id) => setOpenActionMenuStoreId((prev) => (prev === id ? "" : id))}
                  onOpenStore={openStore}
                  onLifecycleAction={handleStoreLifecycleAction}
                  onDuplicate={handleDuplicateStore}
                  onRequestHardDelete={requestHardDeleteStore}
                />
              ))}
            </div>
          ) : (
            <div className="management-empty">
              {showArchivedStores ? "アーカイブ済みの店舗はありません。" : "まだ店舗が登録されていません。上のフォームから店舗を追加してください。"}
            </div>
          )}

          {canManageAllStores && archivedStores.length > 0 && (
            <button className="text-button store-archive-toggle" type="button" onClick={() => setShowArchivedStores((prev) => !prev)}>
              {showArchivedStores ? "運営中/停止中の店舗を表示" : `アーカイブ済み ${archivedStores.length}店舗を表示`}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="store-settings-header">
            <button className="secondary-button" type="button" onClick={() => setStoreView("list")}>← 店舗一覧へ戻る</button>
            <div className="store-settings-header-title">
              <h2>{selectedStoreEntity?.name}</h2>
              <span className={statusMeta(selectedStoreEntity?.status).className}>{statusMeta(selectedStoreEntity?.status).label}</span>
            </div>
          </div>

          <div className="subnav">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "subnav-button active" : "subnav-button"}
                onClick={() => setStoreSettingsTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "basic" && (
            <div className="setup-card">
              <div className="store-form-grid">
                <label className="field">
                  <span>店舗名</span>
                  <input ref={storeFormNameInputRef} value={storeForm.name} onChange={(event) => setStoreForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="店舗名" />
                </label>
                <label className="field">
                  <span>在籍スタッフ数</span>
                  <NumericInput value={storeForm.staffCount} onChange={storeFieldChangeHandlers.staffCount} placeholder="例: 6" />
                </label>
                <label className="field">
                  <span>生産性計算人数（任意）</span>
                  <NumericInput value={storeForm.productivityStaffCount} onChange={storeFieldChangeHandlers.productivityStaffCount} allowDecimal placeholder="例: 5.0" />
                  <small className="field-hint">未入力の場合は在籍スタッフ数で計算します。パート・アルバイト・時短スタッフがいる場合のみ、小数で調整できます(例: 5.0 / 5.5 / 5.6)。</small>
                </label>
              </div>
              <div className="toggle-panel">
                <SaveStatusInline dirty={false} status={storeFormStatus} />
                <button className="primary-button" type="button" onClick={handleSaveStore} disabled={storeFormStatus.status === "saving"}>
                  {storeFormStatus.status === "saving" ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "daily" && (
            <div className="setup-card">
              <p className="helper-text">日付・総売上・日締めは常に表示されます。それ以外の項目は店舗ごとに表示・非表示を選べます。</p>
              {dailyEditable ? (
                <div className="segmented-control" role="group" aria-label="入力設定のプリセット">
                  <button type="button" className="segmented-button" onClick={() => applyDailyFieldPreset("simple")}>かんたん入力</button>
                  <button type="button" className="segmented-button" onClick={() => applyDailyFieldPreset("detailed")}>詳細入力</button>
                </div>
              ) : null}
              <FieldToggleList
                keys={dailyFieldKeys}
                labels={dailyFieldLabels}
                values={dailyFieldDraft.fields}
                editable={dailyEditable}
                onToggle={updateDailyFieldToggle}
              />
              {dailyEditable ? (
                <div className="toggle-panel">
                  <SaveStatusInline dirty={dailyFieldDirty} status={dailyFieldSaveStatus} />
                  <button className="primary-button" type="button" onClick={handleSaveDailyFieldSettings} disabled={dailyFieldSaveStatus.status === "saving"}>
                    {dailyFieldSaveStatus.status === "saving" ? "保存中…" : "保存"}
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {activeTab === "target" && (
            <div className="setup-card">
              <p className="helper-text">対象店舗・対象年月は常に表示されます。それ以外の項目は店舗ごとに表示・非表示を選べます。</p>
              <FieldToggleList
                keys={monthlyTargetFieldKeys}
                labels={monthlyTargetFieldLabels}
                values={monthlyTargetFieldDraft.fields}
                editable={targetEditable}
                onToggle={updateMonthlyTargetFieldToggle}
              />
              {targetEditable ? (
                <div className="toggle-panel">
                  <SaveStatusInline dirty={monthlyTargetFieldDirty} status={monthlyTargetFieldSaveStatus} />
                  <button className="primary-button" type="button" onClick={handleSaveMonthlyTargetFieldSettings} disabled={monthlyTargetFieldSaveStatus.status === "saving"}>
                    {monthlyTargetFieldSaveStatus.status === "saving" ? "保存中…" : "保存"}
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {activeTab === "cash" && (
            <div className="setup-card">
              <div className="panel-heading compact"><div><h3>日計管理</h3></div></div>
              <p className="helper-text">
                日々の売上を、現金・キャッシュレス・ポイント利用など支払方法別に記録できます。
                <br />※ 総売上や損益には重複して加算されません。
              </p>
              <label className="store-toggle-row">
                <span>日計管理を使う</span>
                <input
                  type="checkbox"
                  checked={Boolean(selectedStoreEntity?.settings?.useCashBreakdown)}
                  disabled={!toggleEditable}
                  onChange={(event) => handleToggleCashBreakdown(event.target.checked)}
                />
              </label>
            </div>
          )}

          {activeTab === "other" && (
            <div className="setup-card">
              <div className="panel-heading compact"><div><h3>在庫管理</h3></div></div>
              <p className="helper-text">ONにすると月締め画面で期首在庫・当月末在庫を入力でき、材料・仕入原価が自動計算されます。OFFの店舗は仕入・発注額がそのまま原価になります(初期値OFF)。</p>
              <label className="store-toggle-row">
                <span>在庫管理を使う</span>
                <input
                  type="checkbox"
                  checked={Boolean(selectedStoreEntity?.settings?.useInventoryTracking)}
                  disabled={!toggleEditable}
                  onChange={(event) => handleToggleInventoryTracking(event.target.checked)}
                />
              </label>
            </div>
          )}
        </>
      )}
    </section>
  );
}
