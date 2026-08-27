import { useState } from "react";
import { computeStoreSummary } from "../../utils/storeManagement.js";
import { canManageStores, canChangeStoreLifecycle, canHardDeleteStore } from "../../utils/permissions.js";

// 店舗管理ページ。役割は「店舗を追加する/店舗一覧を見る/店舗を選ぶ」までに限定し、
// 選択した店舗の設定(基本設定/入力設定/目標設定など)は全て「管理画面」ページへ統合した
// (店舗設定の個別画面は廃止)。既存の状態・保存処理(App.jsx側)は一切変更せず、propsとして
// そのまま受け取って表示するだけ。

const STATUS_META = {
  active: { label: "運営中", className: "store-status-badge active" },
  suspended: { label: "停止中", className: "store-status-badge suspended" },
  archived: { label: "アーカイブ", className: "store-status-badge archived" },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.active;
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
  selectedStoreEntity,
  onManageStore,
  showArchivedStores,
  setShowArchivedStores,
  stores,
  handleStoreLifecycleAction,
  handleDuplicateStore,
  requestHardDeleteStore,
}) {
  const [openActionMenuStoreId, setOpenActionMenuStoreId] = useState("");

  const canManageAllStores = canManageStores(currentRole);
  const canOperate = canChangeStoreLifecycle(currentRole) && !franchiseReadOnly;
  const canHardDelete = canHardDeleteStore(currentRole);

  const openStore = (store) => {
    setOpenActionMenuStoreId("");
    onManageStore(store);
  };

  const activeStores = stores.filter((store) => store.status !== "archived");
  const archivedStores = stores.filter((store) => store.status === "archived");
  const visibleStores = showArchivedStores ? archivedStores : activeStores;

  return (
    <section className="panel store-management-page">
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
    </section>
  );
}
