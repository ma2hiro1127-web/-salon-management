import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatMonthLabel } from "../utils/storage.js";

const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 6;

const parseYear = (monthValue) => {
  const year = Number(String(monthValue || "").slice(0, 4));
  return Number.isFinite(year) && year ? year : new Date().getFullYear();
};

// 対象月選択UI。ネイティブの<input type="month">は、年/月どちらかのセグメントを編集中に
// onChangeが空文字や未確定値で発火することがあり(特にiOSのホイールUIで顕著)、その中間値を
// そのままselectedMonthへ書き込むと表示が一瞬「今日の月」へフォールバックして見える不具合の
// 原因になっていた。ここでは日付選択は一切扱わず、「年を選んでから月ボタンを押す」という
// 2ステップの単純な操作にすることで、必ず完全な年月の組み合わせでしかonChangeを呼ばない
// (中間状態が存在しない)。呼び出し側の状態管理(App.jsxのselectedMonth/handleMonthSwitch)
// は変更していない — 完全な年月が確定した瞬間にonChangeを1回呼ぶだけの、既存の
// value/onChange契約に沿ったプレーンな置き換え。
//
// パネルはdocument.body直下へportalで描画する(親要素のoverflow/position/z-indexの影響を
// 一切受けない)。開いた直後にトリガーボタン・パネル自身のgetBoundingClientRect()を測って、
// viewportの右端・下端をはみ出す場合は左方向・上方向へ自動的に位置を反転させる — ボタンが
// 画面右側にあっても、パネルの右端を基準に左側へ収まる。
export default function MonthPicker({ value, onChange, label = "対象月" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [browsingYear, setBrowsingYear] = useState(() => parseYear(value));
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  useLayoutEffect(() => {
    // isOpenがfalseの間はpanelが描画されないため(下のpanel算出を参照)、positionを明示的に
    // リセットする必要は無い — 次に開いた時にrecomputePositionが必ず最新値へ上書きする。
    if (!isOpen) return undefined;

    const recomputePosition = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (!triggerRect || !panelRect) return;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - panelRect.width);
      // 基本はボタンの左端に揃えるが、それだとパネルが右端をはみ出す場合はボタンの右端に
      // パネルの右端を揃える(=右方向へは絶対に伸ばさない)。最後にviewport内へ必ずクランプする。
      const preferredLeft = triggerRect.left + panelRect.width > viewportWidth - VIEWPORT_MARGIN
        ? triggerRect.right - panelRect.width
        : triggerRect.left;
      const left = Math.min(Math.max(preferredLeft, VIEWPORT_MARGIN), maxLeft);

      const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - VIEWPORT_MARGIN - panelRect.height);
      const belowTop = triggerRect.bottom + TRIGGER_GAP;
      const fitsBelow = belowTop + panelRect.height <= viewportHeight - VIEWPORT_MARGIN;
      const preferredTop = fitsBelow ? belowTop : triggerRect.top - TRIGGER_GAP - panelRect.height;
      const top = Math.min(Math.max(preferredTop, VIEWPORT_MARGIN), maxTop);

      setPosition({ left, top });
    };

    recomputePosition();
    window.addEventListener("resize", recomputePosition);
    window.addEventListener("scroll", recomputePosition, true);
    const handlePointerDown = (event) => {
      const target = event.target;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", recomputePosition);
      window.removeEventListener("scroll", recomputePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
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

  const panel = isOpen ? (
    <div
      ref={panelRef}
      className="month-picker-panel"
      role="dialog"
      aria-label="対象月を選択"
      style={{
        position: "fixed",
        left: position ? `${position.left}px` : "-9999px",
        top: position ? `${position.top}px` : "-9999px",
        visibility: position ? "visible" : "hidden",
      }}
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
    </div>
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
      {panel && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </div>
  );
}
