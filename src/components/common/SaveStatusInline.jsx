import { useEffect, useRef, useState } from "react";

// 保存状態の表示: 未変更時は何も出さない、変更中は「未保存の変更があります」、保存成功時は
// 「保存しました」等を数秒でフェードアウトさせる。エラーは自動で消さない(保存失敗時に
// 成功したように見せないため)。status は { status: "idle"|"saving"|"saved"|"error", message }。
export default function SaveStatusInline({ dirty, status }) {
  const [savedFlash, setSavedFlash] = useState(false);
  const timerRef = useRef(null);
  const prevStatusRef = useRef(status?.status);

  useEffect(() => {
    if (status?.status === "saved" && prevStatusRef.current !== "saved") {
      setSavedFlash(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setSavedFlash(false), 2500);
    }
    prevStatusRef.current = status?.status;
  }, [status?.status]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (status?.status === "error" && status?.message) {
    return <span className="save-status-inline error">{status.message}</span>;
  }
  if (savedFlash && status?.message) {
    return <span className="save-status-inline saved">{status.message}</span>;
  }
  if (dirty) {
    return <span className="save-status-inline dirty">未保存の変更があります</span>;
  }
  return null;
}
