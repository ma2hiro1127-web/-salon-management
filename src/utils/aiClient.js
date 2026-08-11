import { supabase } from "./supabase.js";

// AI経営アシスタントAPI(Supabase Edge Function "ai-assistant")への薄いラッパー。
// ビジネスロジック・権限判定は一切ここに持たない — 店舗/全店舗へのアクセス権限は
// サーバー側(supabase/functions/ai-assistant)がJWTから再検証してから応答する。
export async function sendAiMessage({ context, history = [], message }) {
  const { data, error } = await supabase.functions.invoke("ai-assistant", {
    body: { context, history, message },
  });
  if (error) {
    let serverMessage = "";
    try {
      const body = await error.context?.json();
      serverMessage = body?.error || "";
    } catch {
      // Edge Function自体が未デプロイ/未到達の場合はJSON本文が無く、ここに落ちる。
      // 開発中はこれが「準備中」であることを示すサインなので、下の案内メッセージにフォールバック。
    }
    throw new Error(serverMessage || "AI機能は現在準備中です。しばらくお待ちください。");
  }
  return String(data?.reply || "");
}
