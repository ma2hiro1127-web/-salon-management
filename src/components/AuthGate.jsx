import { useEffect, useMemo, useState } from "react";

const AuthGate = ({ children, currentUser, loading }) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!loading) {
      const timer = window.setTimeout(() => setReady(true), 80);
      return () => window.clearTimeout(timer);
    }
  }, [loading]);

  const content = useMemo(() => {
    if (loading || !ready) {
      return <div className="empty-card">認証状態を確認しています…</div>;
    }
    if (!currentUser) {
      return <div className="empty-card">ログインしてください。</div>;
    }
    return children;
  }, [children, currentUser, loading, ready]);

  return content;
};

export default AuthGate;
