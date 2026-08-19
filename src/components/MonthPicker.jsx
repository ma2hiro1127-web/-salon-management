import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatMonthLabel } from "../utils/storage.js";
import { computeAnchoredPopoverPosition } from "../utils/popoverPosition.js";

const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const MOBILE_BREAKPOINT = 640;
const VIEWPORT_MARGIN = 12;
const TRIGGER_GAP = 8;

const parseYear = (monthValue) => {
  const year = Number(String(monthValue || "").slice(0, 4));
  return Number.isFinite(year) && year ? year : new Date().getFullYear();
};

const isMobileViewport = () => (typeof window === "undefined" ? false : window.innerWidth <= MOBILE_BREAKPOINT);

// 対象月選択UI。これまでの経緯:
//  1) ネイティブ<input type="month"> — iOSで中間値のonChangeが発火し「一瞬現在月へ戻る」不具合。
//  2) トリガー直下に浮かせるposition:fixedの自前ポップオーバー(getBoundingClientRectで
//     位置計算) — 画面端でのはみ出し・背景コンテンツとの重なりが解消しなかった。
//  3) 画面中央固定モーダルへ変更 — はみ出しは解消したが、PCでは営業進捗カード等の主要
//     コンテンツの真上に大きく重なってしまい、ダッシュボードが隠れる問題が新たに発生した。
// 今回: PC/タブレットでは(2)と同じ「トリガー起点のポップオーバー」方式に戻すが、位置計算を
// computeAnchoredPopoverPosition(独立した純粋関数、popoverPosition.test.jsで1440/1280/1024/
// 768/430/390/375px相当を含む多数のケースを自動検証済み)へ切り出し、viewportのどの端にも
// はみ出さないことをコードレベルで担保する。スマートフォン幅(<=640px)では、狭い画面で
// トリガー起点のポップオーバーを出すと操作しづらいため、画面下部からのボトムシートに切り替える
// (要件4) — PC版まで中央モーダル化はしない。
export default function MonthPicker({ value, onChange, label = "対象月" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [browsingYear, setBrowsingYear] = useState(() => parseYear(value));
  const [isMobile, setIsMobile] = useState(isMobileViewport);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  // ウィンドウ幅の監視(要件9: resizeで再配置)。isOpenに関わらず常に監視し、開いている間に
  // PC幅⇔スマホ幅をまたいだ場合も表示方式が正しく切り替わるようにする。
  useEffect(() => {
    const handleResize = () => setIsMobile(isMobileViewport());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // PC/タブレット時のみ、トリガー・パネルの実測サイズから位置を計算する。開いた瞬間と、
  // 開いている間のresizeのたびに再計算する(要件9)。スマホ時はCSS側で完結する固定配置
  // (ボトムシート)を使うため、ここでは何もしない。
  useLayoutEffect(() => {
    // isOpenがfalseの間はpanelが描画されない(下のportalContent算出を参照)ため、positionを
    // 明示的にリセットする必要は無い — 次に開いた時にrecomputePositionが必ず最新値へ
    // 上書きする。isMobile時もCSS側(.mobile修飾子)で位置が完結するため何もしない。
    if (!isOpen || isMobile) return undefined;

    const recomputePosition = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (!triggerRect || !panelRect) return;
      setPosition(computeAnchoredPopoverPosition({
        triggerRect,
        panelWidth: panelRect.width,
        panelHeight: panelRect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        margin: VIEWPORT_MARGIN,
        gap: TRIGGER_GAP,
      }));
    };

    recomputePosition();
    window.addEventListener("resize", recomputePosition);
    // captureフェーズで拾うことで、ページ本体のどのスクロール可能領域が動いてもトリガーの
    // 実座標変化に追従する(トリガー自体がsticky/scroll対象の親を持つ場合の保険)。
    window.addEventListener("scroll", recomputePosition, true);
    return () => {
      window.removeEventListener("resize", recomputePosition);
      window.removeEventListener("scroll", recomputePosition, true);
    };
  }, [isOpen, isMobile]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const selectedYear = parseYear(value);
  const selectedMonthNumber = Number(String(value || "").slice(5, 7)) || 0;

  const commitMonth = (monthNumber) => {
    onChange(`${browsingYear}-${String(monthNumber).padStart(2, "0")}`);
    setIsOpen(false);
  };

  const openPicker = () => {
    setBrowsingYear(parseYear(value));
    setIsOpen(true);
  };

  const panelStyle = isMobile
    ? undefined
    : {
      position: "fixed",
      left: position ? `${position.left}px` : "-9999px",
      top: position ? `${position.top}px` : "-9999px",
      maxHeight: position ? `${position.maxHeight}px` : undefined,
      visibility: position ? "visible" : "hidden",
    };

  // オーバーレイ(背後のページ内容へのクリックを物理的に遮る)+パネル、両方をdocument.body
  // 直下へportalで描画する。App.jsx側の親要素(ヘッダー等)のoverflow/transform/filter/
  // opacity/stacking contextを一切経由しないため、それらの影響を受けない(要件6)。
  const portalContent = isOpen ? (
    <>
      <div className="month-picker-overlay" onClick={() => setIsOpen(false)} />
      <div
        ref={panelRef}
        className={isMobile ? "month-picker-panel mobile" : "month-picker-panel"}
        role="dialog"
        aria-modal="true"
        aria-label="対象月を選択"
        style={panelStyle}
      >
        <div className="month-picker-year-nav">
          <button type="button" className="month-picker-year-button" onClick={() => setBrowsingYear((year) => year - 1)} aria-label="前の年">‹</button>
          <strong className="month-picker-year-label">{browsingYear}年</strong>
          <button type="button" className="month-picker-year-button" onClick={() => setBrowsingYear((year) => year + 1)} aria-label="次の年">›</button>
        </div>
        <div className="month-picker-grid">
          {MONTH_LABELS.map((monthLabel, index) => {
            const monthNumber = index + 1;
            const isSelected = browsingYear === selectedYear && monthNumber === selectedMonthNumber;
            return (
              <button
                key={monthLabel}
                type="button"
                className={isSelected ? "month-picker-month-button selected" : "month-picker-month-button"}
                onClick={() => commitMonth(monthNumber)}
              >
                {monthLabel}
              </button>
            );
          })}
        </div>
        <button type="button" className="month-picker-close-button" onClick={() => setIsOpen(false)}>閉じる</button>
      </div>
    </>
  ) : null;

  return (
    <div className="month-picker">
      <span className="month-picker-label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="month-picker-trigger"
        onClick={() => (isOpen ? setIsOpen(false) : openPicker())}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {formatMonthLabel(value) || "月を選択"}
      </button>
      {portalContent && typeof document !== "undefined" ? createPortal(portalContent, document.body) : null}
    </div>
  );
}
