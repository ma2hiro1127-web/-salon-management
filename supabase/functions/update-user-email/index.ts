// メールアドレスを間違えて招待してしまった場合に、安全に修正できるようにするためのEdge
// Function。プロフィール編集画面から呼ばれる — profiles.emailだけを書き換える従来のクライア
// ント直更新(updateProfileDetails)は、既に登録済みのユーザーに対して行うとSupabase Auth側
// (auth.users.email)が古いメールアドレスのまま残ってしまい、「アプリ上は新しいメールなのに
// ログインは古いメールでしかできない」不整合を起こす。これを避けるため、メールアドレスが
// 実際に変わる場合は必ずこの関数を経由させ、Auth側とprofiles側を同じトランザクション的な
// 流れの中で更新する。
//
// - 既に登録済み(auth_user_id あり): admin.auth.admin.updateUserById でAuth側のemailを
//   書き換えてからprofilesを更新する(Auth側が失敗したらprofilesも更新しない)。
// - 未登録(招待中、auth_user_id なし): profilesのemailを更新し、古いメールアドレス宛の
//   招待リンクを安全に無効化するため invite_token/invite_expires_at を新しく発行し直す
//   (招待メール自体の再送信・招待リンクの再生成は別操作として管理者が行う)。
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
  console.error(`[update-user-email] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let profileId = "";
  let newEmail = "";
  try {
    const body = await req.json();
    profileId = String(body?.profileId || "").trim();
    newEmail = String(body?.email || "").trim().toLowerCase();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!profileId || !newEmail) {
    return json({ error: "profileId, email は必須です" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return json({ error: "メールアドレスの形式が正しくありません" }, 400);
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
      return json({ error: "メールアドレスを変更する権限がありません" }, 403);
    }

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, email, role, company_id, auth_user_id, is_active")
      .eq("id", profileId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) {
      return json({ error: "対象のユーザーが見つかりません" }, 404);
    }

    // 権限スコープはdelete-user/send-invite-emailと同じ規約(profiles_update/delete_company_
    // scoped RLSのサーバー側での再現): company_adminは自社かつsystem_admin以外のみ、
    // store_managerは自分の管理する店舗のstaffのみ。
    if (target.role === "system_admin" && callerProfile.role !== "system_admin") {
      return json({ error: "システム管理者のメールアドレスは変更できません" }, 403);
    }
    if (callerProfile.role === "company_admin" && callerProfile.company_id !== target.company_id) {
      return json({ error: "他社のユーザーのメールアドレスは変更できません" }, 403);
    }
    if (callerProfile.role === "store_manager") {
      if (target.role !== "staff") {
        return json({ error: "店長はスタッフ以外のメールアドレスを変更できません" }, 403);
      }
      const [{ data: managerStores }, { data: targetStores }] = await Promise.all([
        admin.from("user_stores").select("store_id").eq("user_id", callerProfile.id),
        admin.from("user_stores").select("store_id").eq("user_id", target.id),
      ]);
      const managedStoreIds = new Set((managerStores || []).map((row) => row.store_id));
      const sharesStore = (targetStores || []).some((row) => managedStoreIds.has(row.store_id));
      if (!sharesStore) {
        return json({ error: "自分の管理する店舗のスタッフのみメールアドレスを変更できます" }, 403);
      }
    }

    if (target.email && target.email.toLowerCase() === newEmail) {
      return json({ ok: true, unchanged: true });
    }

    // 変更先のメールアドレスが既に別のユーザーで使われていないか確認する(DBのunique制約
    // だけに頼るとエラーメッセージが分かりにくいため、事前に分かりやすく弾く)。
    const { data: duplicate, error: duplicateError } = await admin
      .from("profiles")
      .select("id")
      .eq("email", newEmail)
      .neq("id", target.id)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) {
      return json({ error: "このメールアドレスは既に別のユーザーで使用されています" }, 409);
    }

    if (target.auth_user_id) {
      // 既に登録済み — Auth側のemailを先に書き換える。ここが失敗した場合はprofiles側も
      // 更新しない(Auth/profilesがズレた状態を作らない)。
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(target.auth_user_id, {
        email: newEmail,
        email_confirm: true,
      });
      if (authUpdateError) {
        logStage("auth_email_update_failed", { profileId, message: authUpdateError.message, code: authUpdateError.code });
        return json({ error: authUpdateError.message || "メールアドレスの変更に失敗しました" }, 500);
      }

      const { error: profileUpdateError } = await admin.from("profiles").update({ email: newEmail }).eq("id", target.id);
      if (profileUpdateError) {
        // Auth側は既に新しいメールになっているが、profiles側の更新に失敗した状態 —
        // ログには残すが、ここで再度Authを元のメールへ戻すロールバックは行わない(Auth側の
        // emailが正であり、次回のensureProfileForAuthUser(email一致で検索)等で自然に追従
        // できるようにするため。致命的な不整合ではないが記録は残す)。
        logStage("profile_email_update_failed_after_auth", { profileId, message: profileUpdateError.message });
        return json({ error: "Auth側は更新されましたが、プロフィールの更新に失敗しました。もう一度お試しください。" }, 500);
      }

      return json({ ok: true });
    }

    // 未登録(招待中) — profilesのemailを更新し、古いメールアドレス宛のリンクを無効化する
    // ため招待トークンを新しく発行し直す(要件: 古い招待状態を安全に無効化する)。
    const newToken = crypto.randomUUID();
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: profileUpdateError } = await admin
      .from("profiles")
      .update({ email: newEmail, invite_token: newToken, invite_expires_at: newExpiresAt, invitation_status: "invited" })
      .eq("id", target.id);
    if (profileUpdateError) throw profileUpdateError;

    return json({ ok: true, inviteToken: newToken, inviteExpiresAt: newExpiresAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "メールアドレスの変更に失敗しました";
    logStage("unhandled_error", { profileId, message });
    return json({ error: message }, 500);
  }
});
