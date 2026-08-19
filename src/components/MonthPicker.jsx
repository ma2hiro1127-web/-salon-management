import { useEffect, useRef, useState } from "react";
import { formatMonthLabel } from "../utils/storage.js";

const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

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
export default function MonthPicker({ value, onChange, label = "対象月" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [browsingYear, setBrowsingYear] = useState(() => parseYear(value));
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
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

  return (
    <div className="month-picker" ref={containerRef}>
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
      {isOpen ? (
        <div className="month-picker-panel" role="dialog" aria-label="対象月を選択">
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
      ) : null}
    </div>
  );
}
