// Completes an invite: validates the token server-side (bypassing RLS via the service-role
// key, which never leaves this function), creates/links the invitee's real Supabase Auth
// account with the password THEY chose, pre-confirms it, and links it to the profile row the
// inviting admin already created. Runs with the service role key, which must never be shipped
// to the browser — this is the only place in the app that touches it.
//
// Why this exists instead of a plain client-side signUp: this project requires email
// confirmation, so a client-side supabase.auth.signUp() never returns a session — the invitee
// would be stuck. Using the admin API's email_confirm:true here sidesteps that without
// touching the project-wide confirmation setting (the invite link itself, sent privately by an
// admin, is the trust signal — a second email round-trip would just be broken friction, since
// the app has no confirmation-callback route).
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

  let token = "";
  let email = "";
  let password = "";
  try {
    const body = await req.json();
    token = String(body?.token || "").trim();
    email = String(body?.email || "").trim().toLowerCase();
    password = String(body?.password || "");
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }

  if (!token || !email || !password) {
    return json({ error: "token, email, password は必須です" }, 400);
  }
  if (password.length < 8) {
    return json({ error: "パスワードは8文字以上で設定してください" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "サーバー設定が不足しています" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, email, is_active, invitation_status, invite_expires_at, auth_user_id")
      .eq("invite_token", token)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      return json({ error: "招待リンクが無効です。管理者に再招待を依頼してください。" }, 404);
    }
    if (!profile.is_active || profile.invitation_status === "suspended" || profile.invitation_status === "disabled") {
      return json({ error: "この招待は無効化されています。管理者にお問い合わせください。" }, 403);
    }
    if (profile.invite_expires_at && new Date(profile.invite_expires_at).getTime() < Date.now()) {
      return json({ error: "この招待リンクは期限切れです。管理者に再招待を依頼してください。" }, 410);
    }
    if (profile.email && String(profile.email).trim().toLowerCase() !== email) {
      return json({ error: "招待されたメールアドレスと一致しません。" }, 400);
    }
    if (profile.auth_user_id) {
      return json({ error: "この招待はすでに登録済みです。ログイン画面からログインしてください。" }, 409);
    }

    let authUserId: string | null = null;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) {
      const message = String(createError.message || "");
      if (!/already.*registered|already.*exists/i.test(message)) {
        throw createError;
      }
      // Legacy path: an auth user already exists for this email (created by an earlier version
      // of the invite flow that set a fixed default password up front). Reset it to the
      // password the real invitee just chose, and confirm it, instead of failing here.
      const lookupResp = await fetch(
        `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
        { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
      );
      if (!lookupResp.ok) throw new Error("既存アカウントの確認に失敗しました");
      const lookupJson = await lookupResp.json();
      // The admin ?email= filter matches loosely (e.g. substring), not exact — it can return
      // multiple users, so pick the exact match explicitly. Using the wrong user here would
      // overwrite an unrelated account's password.
      const candidates = Array.isArray(lookupJson?.users) ? lookupJson.users : (Array.isArray(lookupJson) ? lookupJson : []);
      const existingAuthUser = candidates.find((u: { email?: string }) => String(u?.email || "").toLowerCase() === email.toLowerCase());
      if (!existingAuthUser?.id) throw new Error("既存アカウントが見つかりませんでした");

      const { error: updateAuthError } = await admin.auth.admin.updateUserById(existingAuthUser.id, {
        password,
        email_confirm: true,
      });
      if (updateAuthError) throw updateAuthError;
      authUserId = existingAuthUser.id;
    } else {
      authUserId = created.user.id;
    }

    const { error: linkError } = await admin
      .from("profiles")
      .update({
        auth_user_id: authUserId,
        invitation_status: "active",
        invite_token: null,
        invite_expires_at: null,
      })
      .eq("id", profile.id);

    if (linkError) throw linkError;

    return json({ ok: true });
  } catch (error) {
    console.error("accept-invite error", error);
    const message = error instanceof Error ? error.message : "招待の処理に失敗しました";
    return json({ error: message }, 500);
  }
});
