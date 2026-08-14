// Sends the actual invitation email via Supabase Auth's admin.inviteUserByEmail — this is the
// piece that was previously entirely missing: the app only ever generated a link and left the
// admin to copy/paste it somewhere themselves ("再送"/"招待メール再発行" only refreshed the
// token in the database and always reported success, whether or not anything was ever sent).
// Runs with the service role key (never exposed to the browser) both to call the admin invite
// API and to verify the caller's own permission to invite this specific person, mirroring the
// profiles_insert_company_scoped RLS policy's scoping rules server-side.
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

// 開発側の追跡用ログ(招待フロー整理の要件11): 発生日時・対象・処理段階・エラー内容は残すが、
// パスワードやトークンそのものは残さない(先頭8文字だけ、相関確認用)。
function logStage(stage: string, detail: Record<string, unknown>) {
  console.error(`[send-invite-email] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

const maskToken = (token: string) => (token ? `${token.slice(0, 8)}…` : "");

// Supabase Auth標準のメール送信環境はレート制限が厳しく(本番運用には非推奨)、短時間に
// 複数回招待するとここに到達しやすい。生のエラー文言をユーザー画面に出さず、専用のcodeで
// クライアント側が適切な日本語文言に差し替えられるようにする(招待フロー整理の要件5)。
const RATE_LIMIT_PATTERN = /rate.?limit|too many requests|429/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let token = "";
  let redirectOrigin = "";
  try {
    const body = await req.json();
    token = String(body?.token || "").trim();
    redirectOrigin = String(body?.redirectOrigin || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!token || !redirectOrigin) {
    return json({ error: "token, redirectOrigin は必須です" }, 400);
  }
  if (!/^https:\/\//.test(redirectOrigin) && !/^http:\/\/localhost/.test(redirectOrigin)) {
    return json({ error: "不正なリダイレクト先です" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "サーバー設定が不足しています" }, 500);
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
      .select("id, role, company_id, is_active")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active || !["system_admin", "company_admin", "store_manager"].includes(callerProfile.role)) {
      return json({ error: "招待メールを送信する権限がありません" }, 403);
    }

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, email, role, company_id, auth_user_id, invitation_status, is_active")
      .eq("invite_token", token)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) {
      return json({ error: "招待情報が見つかりません。管理画面から招待を作り直してください。" }, 404);
    }
    if (target.auth_user_id) {
      return json({ error: "このユーザーは既に登録済みです。招待メールの送信は不要です。" }, 409);
    }
    if (!target.is_active || target.invitation_status === "suspended" || target.invitation_status === "disabled") {
      return json({ error: "このユーザーは停止中のため招待メールを送信できません。" }, 403);
    }

    // Same scoping as profiles_insert_company_scoped (see 20260809000000_invite_flow_hardening.sql):
    // company_admin only within their own company; store_manager only for staff assigned to a
    // store they themselves manage.
    if (callerProfile.role === "company_admin" && callerProfile.company_id !== target.company_id) {
      return json({ error: "他社のユーザーへは招待メールを送信できません" }, 403);
    }
    if (callerProfile.role === "store_manager") {
      if (target.role !== "staff") {
        return json({ error: "店長はスタッフ以外への招待メールを送信できません" }, 403);
      }
      const [{ data: managerStores }, { data: targetStores }] = await Promise.all([
        admin.from("user_stores").select("store_id").eq("user_id", callerProfile.id),
        admin.from("user_stores").select("store_id").eq("user_id", target.id),
      ]);
      const managedStoreIds = new Set((managerStores || []).map((row) => row.store_id));
      const sharesStore = (targetStores || []).some((row) => managedStoreIds.has(row.store_id));
      if (!sharesStore) {
        return json({ error: "自分の管理する店舗のスタッフにのみ招待メールを送信できます" }, 403);
      }
    }

    const redirectTo = `${redirectOrigin}/signup?invite=${encodeURIComponent(token)}`;

    // If a previous send already created an auth user for this email (first send, an earlier
    // resend, or an invitee who opened the link but never finished setting a password —
    // Supabase's own verify step confirms the email as soon as the link is opened, before our
    // app ever calls accept-invite), inviteUserByEmail will reject it as "already registered".
    // Delete that shell first so every resend reliably triggers a fresh email. Safe regardless
    // of its confirmed state: this profile's auth_user_id is still null (checked above), so no
    // profile references that auth row yet, and the invitee never got a working password on it.
    const lookupResp = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(target.email)}`, {
      headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
    });
    if (lookupResp.ok) {
      const lookupJson = await lookupResp.json();
      // The admin ?email= filter matches loosely (e.g. substring), not exact — it can return
      // multiple users, so pick the exact match explicitly rather than trusting array order.
      const candidates = Array.isArray(lookupJson?.users) ? lookupJson.users : (Array.isArray(lookupJson) ? lookupJson : []);
      const existing = candidates.find((u) => String(u?.email || "").toLowerCase() === target.email.toLowerCase());
      if (existing?.id) {
        await admin.auth.admin.deleteUser(existing.id).catch(() => {});
      }
    }

    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(target.email, { redirectTo });
    if (inviteError) {
      // ユーザー作成(またはshellの再利用)自体はここまでで完了している可能性が高い一方、
      // メール送信だけが失敗した状態 — profiles行を「invited」のまま放置せず「pending」
      // (メール未送信、要再送)に落とす。この更新自体が失敗しても、招待メール失敗という
      // 本来のエラーを優先して返す(ベストエフォート)。
      await admin.from("profiles").update({ invitation_status: "pending" }).eq("id", target.id).catch(() => {});
      const isRateLimited = RATE_LIMIT_PATTERN.test(inviteError.message || "");
      logStage("invite_send_failed", {
        token: maskToken(token),
        profileId: target.id,
        companyId: target.company_id,
        code: inviteError.code,
        status: inviteError.status,
        message: inviteError.message,
        rateLimited: isRateLimited,
      });
      return json({
        error: inviteError.message || "招待メールの送信に失敗しました",
        code: isRateLimited ? "rate_limited" : "invite_send_failed",
      }, isRateLimited ? 429 : 500);
    }

    const { error: statusUpdateError } = await admin.from("profiles").update({ invitation_status: "invited" }).eq("id", target.id);
    if (statusUpdateError) {
      // メール送信は成功しているので失敗扱いにはしないが、invitation_statusが更新されず
      // 画面上の表示が実態とずれる可能性があるため記録だけ残す。
      logStage("profile_status_update_failed_after_send", {
        token: maskToken(token),
        profileId: target.id,
        companyId: target.company_id,
        message: statusUpdateError.message,
      });
    }

    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "招待メールの送信に失敗しました";
    logStage("unhandled_error", { token: maskToken(token), message });
    return json({ error: message, code: "server_error" }, 500);
  }
});
