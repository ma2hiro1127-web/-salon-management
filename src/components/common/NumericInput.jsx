import { memo, useRef } from "react";
import { sanitizeNumericInputValue } from "../../utils/storage.js";

// sanitizeNumericInputValue で全角数字・￥・カンマ・スペース等を自動的に半角の数字へ正規化
// する、アプリ全体で共通の数値入力欄。IME変換中(composing)はサニタイズを一時停止し、変換
// 確定時にまとめて正規化する(日本語入力中に数字が壊れるのを防ぐため)。
function NumericInputImpl({ value, onChange, allowDecimal = false, onBlur, ...rest }) {
  const composingRef = useRef(false);
  return (
    <input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={value === undefined || value === null ? "" : value}
      onChange={(event) => {
        if (composingRef.current) {
          onChange(event.target.value);
          return;
        }
        onChange(sanitizeNumericInputValue(event.target.value, { allowDecimal }));
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        onChange(sanitizeNumericInputValue(event.target.value, { allowDecimal }));
      }}
      onBlur={(event) => {
        onChange(sanitizeNumericInputValue(event.target.value, { allowDecimal }));
        onBlur?.(event);
      }}
      {...rest}
    />
  );
}
// memo化: propsの参照が呼び出し元で安定していれば、この入力欄が今まさに操作対象で
// なくても不要な再レンダリングをスキップできる(挙動は無変更、純粋な最適化)。
const NumericInput = memo(NumericInputImpl);

export default NumericInput;
