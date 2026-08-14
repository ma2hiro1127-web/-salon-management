// メール送信を経由せず、Supabase Authの正式な招待リンクをその場で生成して返す
// (admin.auth.admin.generateLink({ type: "invite" }))。「招待リンクをコピー」ボタン用 —
// Resend側でBounced/Suppressed等になっていて招待メールが届かない場合の代替経路として、
// LINE等で直接共有できるようにする(招待メール自体は send-invite-email 側に残したまま、
// これは追加の選択肢)。send-invite-email と同じ理由でサービスロールキーが必要なため
// サーバー側(Edge Function)でのみ実行する。生成したリンク自体はこの関数のレスポンスとして
// 都度返すだけで、DBへは保存しない(招待URLの安全性要件: 平文で永続保存しない)。
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

function logStage(stage: string, detail: Record<string, unknown>) {
  console.error(`[generate-invite-link] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

const maskToken = (token: string) => (token ? `${token.slice(0, 8)}…` : "");

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
    // 権限チェック・スコープ確認はsend-invite-emailと全く同じ規約(profiles_insert_company_
    // scopedのスコープをサーバー側で再現したもの)。一般スタッフはそもそもここへ到達できない
    // (system_admin/company_admin/store_managerのみ)。
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("id, role, company_id, is_active")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active || !["system_admin", "company_admin", "store_manager"].includes(callerProfile.role)) {
      return json({ error: "招待リンクを生成する権限がありません" }, 403);
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
      return json({ error: "このユーザーは既に登録済みです。招待リンクの生成は不要です。" }, 409);
    }
    if (!target.is_active || target.invitation_status === "suspended" || target.invitation_status === "disabled") {
      return json({ error: "このユーザーは停止中のため招待リンクを生成できません。" }, 403);
    }

    if (callerProfile.role === "company_admin" && callerProfile.company_id !== target.company_id) {
      return json({ error: "他社のユーザーへの招待リンクは生成できません" }, 403);
    }
    if (callerProfile.role === "store_manager") {
      if (target.role !== "staff") {
        return json({ error: "店長はスタッフ以外への招待リンクを生成できません" }, 403);
      }
      const [{ data: managerStores }, { data: targetStores }] = await Promise.all([
        admin.from("user_stores").select("store_id").eq("user_id", callerProfile.id),
        admin.from("user_stores").select("store_id").eq("user_id", target.id),
      ]);
      const managedStoreIds = new Set((managerStores || []).map((row) => row.store_id));
      const sharesStore = (targetStores || []).some((row) => managedStoreIds.has(row.store_id));
      if (!sharesStore) {
        return json({ error: "自分の管理する店舗のスタッフにのみ招待リンクを生成できます" }, 403);
      }
    }

    // 呼び出しのたびに自前トークンを新しく発行し直す(招待メール再送と同じ規約 — 「その都度
    // 生成する」という要件、かつ既に届いている古いリンクを無効化する)。
    const newToken = crypto.randomUUID();
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const redirectTo = `${redirectOrigin}/signup?invite=${encodeURIComponent(newToken)}`;

    // send-invite-emailと同じ理由: 以前の送信/生成でAuthユーザーのshellだけ残っている場合、
    // generateLinkも「既に登録済み」エラーになるため、事前に削除して確実に新しいリンクを
    // 発行できるようにする(target.auth_user_idがnullであることは上で確認済み)。
    const lookupResp = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(target.email)}`, {
      headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
    });
    if (lookupResp.ok) {
      const lookupJson = await lookupResp.json();
      const candidates = Array.isArray(lookupJson?.users) ? lookupJson.users : (Array.isArray(lookupJson) ? lookupJson : []);
      const existing = candidates.find((u: { id?: string; email?: string }) => String(u?.email || "").toLowerCase() === target.email.toLowerCase());
      if (existing?.id) {
        await admin.auth.admin.deleteUser(existing.id).catch(() => {});
      }
    }

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "invite",
      email: target.email,
      options: { redirectTo },
    });
    if (linkError) {
      logStage("generate_link_failed", {
        token: maskToken(token),
        profileId: target.id,
        companyId: target.company_id,
        code: linkError.code,
        status: linkError.status,
        message: linkError.message,
      });
      return json({ error: linkError.message || "招待リンクの生成に失敗しました", code: "generate_link_failed" }, 500);
    }
    const actionLink = linkData?.properties?.action_link || "";
    if (!actionLink) {
      logStage("generate_link_empty", { token: maskToken(token), profileId: target.id });
      return json({ error: "招待リンクの生成に失敗しました" }, 500);
    }

    const { error: updateError } = await admin
      .from("profiles")
      .update({ invite_token: newToken, invite_expires_at: newExpiresAt, invitation_status: "invited" })
      .eq("id", target.id);
    if (updateError) {
      // 発行したリンク自体は有効なので致命的ではないが、DB側のトークンが古いままだと
      // このリンクを開いた際にget_invite_info/accept-inviteが古いトークンで失敗するため、
      // ここは通常のエラーとして扱う(あいまいな「成功したが後で動かないリンク」を返さない)。
      logStage("token_update_failed", { token: maskToken(newToken), profileId: target.id, message: updateError.message });
      return json({ error: "招待リンクの生成に失敗しました" }, 500);
    }

    // 呼び出し側(App.jsx)がローカルのuser.inviteTokenをこの新しいトークンに更新できるよう、
    // レスポンスにも含めて返す。これを返さないと、次にこのユーザーへ「招待リンクをコピー」を
    // 再度押した際、ローカルはまだ古いトークンのままDBには新しいトークンしか無い状態になり、
    // .eq("invite_token", token)の照合に失敗して「招待情報が見つかりません」エラーになる
    // (2回目以降のコピーが必ず失敗するバグの原因だった)。
    return json({ ok: true, actionLink, inviteToken: newToken, inviteExpiresAt: newExpiresAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "招待リンクの生成に失敗しました";
    logStage("unhandled_error", { token: maskToken(token), message });
    return json({ error: message, code: "server_error" }, 500);
  }
});
