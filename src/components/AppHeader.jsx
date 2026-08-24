import { canViewAllStores } from "../utils/permissions.js";
import { ALL_STORES_VALUE } from "../data/defaults.js";
import MonthPicker from "./MonthPicker.jsx";

const PAGE_TITLES = {
  dashboard: "売上",
  monthlyDashboard: "月次ダッシュボード",
  monthlyReview: "月次レビュー",
  daily: "日次入力",
  monthly: "管理画面",
  companies: "会社管理",
  stores: "店舗管理",
  users: "ユーザー管理",
  franchise: "加盟店連携",
  faq: "使い方・FAQ",
};

// スマホ版全画面共通ヘッダー(要件7: 共通コンポーネント化)。以前は売上・日次入力の2画面だけ
// App.jsx内に個別のJSXとして書かれていたものを、ロジックを一切変えずに全ページ共通の
// コンポーネントへ切り出した——ヘッダー自体はもともとApp.jsxの中で1箇所だけ描画され全ページが
// 共有する構造だった(ページごとに複製されたコードは無かった)ため、今回の切り出しはJSXを
// そのまま1ファイルへ移動しただけで、条件分岐や状態管理・onClick/onChangeの中身は変更して
// いない。スマホ幅(≤900px、App.css .topbar-compact-mobile)では店舗・対象月をタイトル右側の
// 2段表示にする——以前は「売上」「日次入力」の2画面限定だったこのクラスを、全ページで無条件に
// 付与するよう変更した(要件2: 対象画面を全画面へ拡大)。PC/タブレット幅ではこのクラスが
// あってもメディアクエリの外なので見た目は変わらない(要件8: PC版は無変更)。
export default function AppHeader({
  activePage,
  mobileNavOpen,
  onToggleMobileNav,
  currentUser,
  currentRole,
  isViewingFranchise,
  currentCompanyId,
  franchiseSelectedStoreId,
  selectedStore,
  onStoreChange,
  franchiseViewBusy,
  homeStoresForDropdown,
  viewableFranchisePartnerStores,
  selectedMonth,
  onMonthChange,
  onLogout,
}) {
  const title = PAGE_TITLES[activePage] || "設定";

  return (
    <header className="topbar topbar-compact-mobile">
      <div className="topbar-heading">
        <button
          type="button"
          className="secondary-button mobile-nav-toggle"
          aria-expanded={mobileNavOpen}
          aria-controls="primary-nav"
          aria-label={mobileNavOpen ? "メニューを閉じる" : "メニューを開く"}
          onClick={onToggleMobileNav}
        >
          <span aria-hidden="true">{mobileNavOpen ? "✕" : "☰"}</span>
        </button>
        <div>
          <p className="eyebrow">SALON MANAGEMENT</p>
          <h1>{title}</h1>
          {currentUser ? (
            <div className="user-role-badge" style={{ marginTop: 6 }}>
              {currentUser?.role || currentRole === "system_admin" ? "管理者" : currentRole}
            </div>
          ) : null}
        </div>
      </div>

      <div className="filters">
        {/* 店舗切替一覧: 自社店舗と加盟店(承認済みのみ)を同じ<select>から選べるように
            する(別々のセレクタに分けない)。加盟店を閲覧中でも、自社の「全店舗」・
            自社の各店舗は常にこの一覧の上部に表示され続けるため、追加のバナーや
            「本社に戻る」ボタンを設けなくても、この<select>だけで本社・加盟店を
            行き来できる。自社欄はhomeStoresForDropdown(閲覧状態に左右されない、
            常に本社を指す参照)から描画するため、加盟店を開いた後も消えない。
            加盟店側は"──── 加盟店 ────"という視覚的な区切り(optgroup)の下に、
            店舗単位で列挙する(自社店舗と同じ「1店舗を選ぶ」扱いにするため — 会社単位で
            1行にして全店舗ビューを開く仕様だと、損益表・月締め・費用入力等の単一店舗
            前提ページが軒並み弾かれてしまっていた)。ラベルは自社店舗の並びと揃えて
            店舗名だけを表示する(会社名は付けない) — 会社名と店舗名を連結すると、
            会社名と店舗名が同じ加盟店(例: 会社「INTRO」の店舗「INTRO」)で
            「INTRO INTRO」のように二重表示になってしまうため。valueには
            `__franchise__:companyId:storeId`を使うので、会社名を表示に含めなくても
            どの会社のどの店舗かは内部的に正しく特定できる。承認済み(status='approved')
            の連携だけが対象のため、pending/rejected/disconnectedの加盟店はここに
            一切出てこない。 */}
        <label>
          {/* スマホ2段ヘッダーでは、ラベル文言(店舗/対象月)は非表示にして選択中の値だけを
              見せる仕様。テキストノードのままだとCSSで個別に隠せないため<span>で囲む——
              PC/タブレット幅(topbar-compact-mobileのメディアクエリ外)ではこのspanにも
              何もスタイルが当たらないため、見え方は今まで通り「店舗」という文字が普通に
              表示される。 */}
          <span className="filters-label-text">店舗</span>
          <select
            value={isViewingFranchise ? `__franchise__:${currentCompanyId}:${franchiseSelectedStoreId || ""}` : selectedStore}
            onChange={(event) => onStoreChange(event.target.value)}
            disabled={franchiseViewBusy}
          >
            {canViewAllStores(currentRole) ? <option value={ALL_STORES_VALUE}>全店舗</option> : null}
            {homeStoresForDropdown.length ? homeStoresForDropdown.map((store) => <option key={store.id} value={store.name}>{store.name}</option>) : <option value="">未登録</option>}
            {viewableFranchisePartnerStores.length > 0 ? (
              <optgroup label="──── 加盟店 ────">
                {viewableFranchisePartnerStores.map((item) => (
                  <option key={`${item.companyId}:${item.storeId}`} value={`__franchise__:${item.companyId}:${item.storeId}`}>{item.storeName}</option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        {/* 業務操作(店舗切替・対象月切替)とアカウント操作(ログアウト)は目的が異なるため、
            JSXの並び順を業務操作→アカウント操作に揃え、ログアウトには視覚的に一段弱い
            クラス(topbar-account-action)を付ける——.filtersのflex/グリッド構造(子要素3つ)
            自体は変更していないため、レスポンシブ挙動への影響は無い。 */}
        <MonthPicker value={selectedMonth} onChange={onMonthChange} />
        <button className="secondary-button topbar-account-action" type="button" onClick={onLogout}>ログアウト</button>
      </div>
    </header>
  );
}
