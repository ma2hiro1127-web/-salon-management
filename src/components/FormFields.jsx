export function NumberField({ label, value, onChange, suffix = "円" }) {
  return (
    <label className="field">
      {label}
      <div className="input-with-suffix">
        <input type="number" min="0" value={value} onChange={(event) => onChange(event.target.value)} />
        <span>{suffix}</span>
      </div>
    </label>
  );
}

export function TextField({ label, value, onChange, type = "text" }) {
  return (
    <label className="field">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
