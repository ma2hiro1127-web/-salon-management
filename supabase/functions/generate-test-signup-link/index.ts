// Stripe契約フローの実機検証(2026-09追加)。system_admin限定。
//
// 目的: 「テストサロンとして開く」(companyの状態を直接切り替えるだけの機能)では、実際の
// 新規顧客が通る「新規登録→プラン選択→Stripe Checkout→決済→Webhook→利用開始」という
// 導線そのものを検証できない。この導線は必ず本物のログアウト状態のブラウザから、本物の
// 登録フォーム(LoginScreen.jsx、self-signup Edge Function)を経由しないと再現できないため、
// このFunctionは「一度だけ使える、使い捨てのテスト会社名・テスト用メールアドレス」と、
// 既存のself-signup Edge Functionのテストバイパス(SELF_SIGNUP_TEST_KEY)を組み込んだ
// 登録画面URLを生成して返すだけの、ごく薄いヘルパーに徹する——登録・契約ロジック自体は
// 一切ここに複製しない(要件8)。
//
// SELF_SIGNUP_TEST_KEYの値自体はサーバー側だけで扱い、このFunctionのレスポンス(呼び出し元は
// system_admin自身)に含めたURLの一部としてのみ使う。フロントエンドのビルド成果物や
// 他の環境変数には一切埋め込まない。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // .trim()が肝心 — create-checkout-sessionと同じ理由(APP_URL末尾改行混入の障害対策)。
  // new URL(appUrl)自体はWHATWG URLパーサーが前後の空白・制御文字を自動除去するため
  // 改行があっても気づかれなかったが、念のため他の2関数と統一しておく。
  const appUrl = Deno.env.get("APP_URL")?.trim();
  const testSignupKey = Deno.env.get("SELF_SIGNUP_TEST_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !appUrl) {
    return json({ error: "サーバー設定が不足しています" }, 500);
  }
  if (!testSignupKey) {
    return json({ error: "SELF_SIGNUP_TEST_KEYが設定されていないため、テスト契約フローを利用できません" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: callerAuth, error: callerAuthError } = await callerClient.auth.getUser();
  if (callerAuthError || !callerAuth?.user) {
    return json({ error: "認証が必要です" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("role, is_active")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active || callerProfile.role !== "system_admin") {
      return json({ error: "テスト契約フローの発行はシステム管理者のみ実行できます" }, 403);
    }

    // 同じ秒に複数回発行しても衝突しないよう、日時にランダムな短いsuffixを付ける
    // (profiles.emailのUNIQUE制約が実質的な重複防止だが、見た目の一意性も確保する)。
    const now = new Date();
    const jstParts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(now);
    const get = (type: string) => jstParts.find((p) => p.type === type)?.value || "";
    const stamp = `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
    const suffix = Math.random().toString(36).slice(2, 6);

    const suggestedCompanyName = `テスト契約サロン ${stamp}`;
    // .invalid はRFC 2606で「絶対に実在しないドメイン」として予約されており、誤って
    // 実際のメール送信が飛ぶ心配がない(email_confirm:trueのためメール送信自体発生しないが、
    // 念のための二重の安全策)。
    const suggestedEmail = `test-contract-${stamp}-${suffix}@salonmanager-test.invalid`;

    const url = new URL(appUrl);
    url.searchParams.set("owner-signup", "1");
    url.searchParams.set("testKey", testSignupKey);
    url.searchParams.set("suggestedCompanyName", suggestedCompanyName);
    url.searchParams.set("suggestedEmail", suggestedEmail);

    return json({ ok: true, url: url.toString(), suggestedCompanyName, suggestedEmail });
  } catch (error) {
    console.error("generate-test-signup-link error", error);
    const message = error instanceof Error ? error.message : "リンクの生成に失敗しました";
    return json({ error: message }, 500);
  }
});
