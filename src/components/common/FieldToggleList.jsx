// 項目のON/OFF設定を、カード型トグルではなく縦リスト形式で表示する共通UI。
// 項目名を主役にし、スイッチは右側に添える。行全体がlabelなのでクリック領域は行全体。
// showStateLabel: ON/OFFの文字も併記する(初めて使う人でも一目で状態が分かるように)。
export default function FieldToggleList({ keys, labels, values, editable, onToggle, showStateLabel = false }) {
  return (
    <div className="store-field-list">
      {keys.map((fieldKey) => {
        const checked = Boolean(values[fieldKey]);
        return (
          <label key={fieldKey} className="store-field-row">
            <span>{labels[fieldKey]}</span>
            <span className="store-field-row-control">
              {showStateLabel ? (
                <span className={`store-field-state${checked ? " on" : ""}`}>{checked ? "ON" : "OFF"}</span>
              ) : null}
              <input
                type="checkbox"
                checked={checked}
                disabled={!editable}
                onChange={editable ? (event) => onToggle(fieldKey, event.target.checked) : undefined}
              />
            </span>
          </label>
        );
      })}
    </div>
  );
}
