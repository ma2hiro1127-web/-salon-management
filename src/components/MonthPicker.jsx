import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatMonthLabel } from "../utils/storage.js";

const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

const parseYear = (monthValue) => {
  const year = Number(String(monthValue || "").slice(0, 4));
  return Number.isFinite(year) && year ? year : new Date().getFullYear();
};

// 対象月選択UI。これまで3回、トリガーボタンの位置を基準にした浮遊パネル(getBoundingClientRect
// で計算したposition:fixedの座標をトリガー直下に置き、はみ出す場合だけ反転させる方式)で
// 「画面端でのはみ出し」「背景コンテンツとの重なり」の修正を試みたが、直らなかった。今回は
// その方式自体をやめ、画面中央に固定表示する完全に独立したモーダルへ作り直した。
//
// 中央固定にした理由: トリガー相対の位置計算は、ヘッダーのレイアウト・スクロール位置・
// ボタンの実際の描画位置など複数の外部要因に依存し続けるため、CSSの微調整だけでは
// 「絶対にviewport内に収まる」ことを保証できない。画面中央固定(position:fixed +
// top/left:50% + transform:translate(-50%,-50%))は、パネル自身の幅・高さをviewport基準の
// 相対単位(min(320px, calc(100vw - 24px))等)で決めておけば、トリガーの位置やページの
// スクロール位置に一切関係なく、幾何学的に必ずviewport内に収まる — 位置計算用のJS
// (getBoundingClientRect・resize/scrollリスナー等)を完全に削除でき、その分のバグの余地も
// 無くなる。年月グリッドは3列×4行のCSS Gridで固定し、個別の月をabsolute配置しない。
export default function MonthPicker({ value, onChange, label = "対象月" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [browsingYear, setBrowsingYear] = useState(() => parseYear(value));

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

  // オーバーレイ(背後のページ内容へのクリックを物理的に遮る)+パネル、両方をdocument.body
  // 直下へportalで描画する。App.jsx側の親要素(ヘッダー等)のoverflow/transform/filter/
  // opacity/stacking contextを一切経由しないため、それらの影響を受けない。
  const portalContent = isOpen ? (
    <>
      <div className="month-picker-overlay" onClick={() => setIsOpen(false)} />
      <div className="month-picker-panel" role="dialog" aria-modal="true" aria-label="対象月を選択">
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
