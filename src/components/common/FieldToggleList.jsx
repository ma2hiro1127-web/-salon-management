// 項目のON/OFF設定を、カード型トグルではなく縦リスト形式で表示する共通UI。
// 項目名を主役にし、スイッチは右側に添える。行全体がlabelなのでクリック領域は行全体。
export default function FieldToggleList({ keys, labels, values, editable, onToggle }) {
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
