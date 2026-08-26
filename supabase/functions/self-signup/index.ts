// 新規オーナーのセルフサインアップ(招待制とは別の、非公開のfeature flag付き新導線)。
// company/store作成はcompanies_insert_system_only等のRLSでservice-role以外には許可されて
// いないため(既存のensureInitialCompanyAndStoreがクライアント側から直接companies.insertを
// 行っているのは、companiesが1件も無い最初期のブートストラップだけが実質の想定ケース——
// 本番のように既にcompanyが複数存在する状態では、新規ユーザーの目にはRLS越しに0件に見え、
// INSERTしようとしてcompanies_insert_system_onlyに拒否される)、accept-inviteと同じく
// service-role keyを使うこのEdge Function内でのみ会社・店舗・プロフィールを作成する。
//
// 冪等性・途中離脱からの復旧(要件4・5): profiles.emailのUNIQUE制約を「claim行」として使う。
// company_id無しのprofiles行を先に(無ければ)作り、以後のAuth user作成・company作成・
// store作成・user_stores作成は「まだ無ければ作る」形にして、同じメールアドレスに対して
// 何度呼ばれてもcompany/storeが複数生成されないようにする。
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

// password/token/service role key等の機密情報は一切含めない、安全な要約だけを記録する
// (要件23)。ベストエフォート——失敗してもサインアップ処理自体は止めない。
async function logDiagnostic(admin: ReturnType<typeof createClient>, { companyId, storeId, actionType }: { companyId?: string | null; storeId?: string | null; actionType: string }) {
  try {
    await admin.from("client_diagnostic_logs").insert({
      company_id: companyId || null,
      store_id: storeId || null,
      screen: "owner_signup",
      action_type: actionType,
      message: "self-signup edge function",
    });
  } catch {
    // ログ失敗はサインアップ自体を失敗させない
  }
}

// AI広告自動運用システム(V1)向け: 広告経由の登録をcompany_id/profile_idと紐付けて記録する
// (要件6・7)。utm_sourceが空(=広告経由ではない通常のセルフ登録)の場合は記録しない——
// 広告と無関係な登録をコンバージョンとして水増ししないため。ベストエフォート(失敗しても
// サインアップ自体は止めない、logDiagnosticと同じ方針)。ad_idはutm3点の完全一致で
// ad_campaignsから解決する(log_ad_conversion_event RPCと同じロジック)。
async function logSignupCompletedConversion(
  admin: ReturnType<typeof createClient>,
  { companyId, profileId, utmSource, utmCampaign, utmContent }: { companyId: string; profileId: string; utmSource: string; utmCampaign: string; utmContent: string }
) {
  if (!utmSource) return;
  try {
    const { data: ad } = await admin
      .from("ad_campaigns")
      .select("id")
      .eq("utm_source", utmSource)
      .eq("utm_campaign", utmCampaign)
      .eq("utm_content", utmContent)
      .maybeSingle();
    await admin.from("ad_conversion_events").insert({
      event_type: "signup_completed",
      company_id: companyId,
      profile_id: profileId,
      ad_id: ad?.id || null,
      utm_source: utmSource,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
    });
  } catch (error) {
    console.error("self-signup: logSignupCompletedConversion failed (non-fatal)", error instanceof Error ? error.message : error);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let email = "";
  let password = "";
  let ownerName = "";
  let companyName = "";
  let testKey = "";
  let utmSource = "";
  let utmCampaign = "";
  let utmContent = "";
  try {
    const body = await req.json();
    email = String(body?.email || "").trim().toLowerCase();
    password = String(body?.password || "");
    ownerName = String(body?.ownerName || "").trim();
    companyName = String(body?.companyName || "").trim();
    testKey = String(body?.testKey || "");
    // AI広告自動運用システム(V1、要件6・7)。空でも許容する——広告経由ではない通常の
    // セルフ登録も引き続き成立させる(この登録方式はあくまで既存の一般セルフ登録の拡張)。
    utmSource = String(body?.utmSource || "").trim();
    utmCampaign = String(body?.utmCampaign || "").trim();
    utmContent = String(body?.utmContent || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }

  if (!email || !password || !ownerName || !companyName) {
    return json({ error: "オーナー名・サロン名・メールアドレス・パスワードは必須です" }, 400);
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
    // 要件11: フロントの表示制御だけに頼らず、ここが最終的な許可判定。テスト専用バイパス
    // (要件12)はSELF_SIGNUP_TEST_KEYがサーバー側に設定されている場合のみ機能する。
    const { data: flagRow, error: flagError } = await admin
      .from("app_feature_flags")
      .select("enabled")
      .eq("flag_key", "self_signup_enabled")
      .maybeSingle();
    if (flagError) throw flagError;

    const testSecret = Deno.env.get("SELF_SIGNUP_TEST_KEY") || "";
    const isTestBypass = Boolean(testSecret) && testKey === testSecret;
    if (!flagRow?.enabled && !isTestBypass) {
      return json({ error: "現在この登録方法はご利用いただけません" }, 403);
    }

    // ------------------------------------------------------------
    // 1. claim行(company_id無しのprofiles行)を確保する
    // ------------------------------------------------------------
    const profileSelect = "id, email, company_id, auth_user_id, invitation_status, invite_token, signup_source";
    const { data: existingProfile, error: existingProfileError } = await admin
      .from("profiles")
      .select(profileSelect)
      .eq("email", email)
      .maybeSingle();
    if (existingProfileError) throw existingProfileError;

    if (existingProfile?.company_id) {
      // 既に会社が紐づいている = 登録済み(自己サインアップ経由か招待経由かを問わない)。
      // 新しいcompanyは絶対に作らない(要件4・6)。
      return json({ error: "このメールアドレスは既に登録されています。ログイン画面からログインしてください。" }, 409);
    }
    if (existingProfile && !existingProfile.company_id && existingProfile.signup_source !== "self_signup") {
      // company_idが無いのに自己サインアップ由来でもない = 招待中(招待はcompany_idを
      // 指定した上で作られるため、この分岐に来るのは基本的に招待中プロフィールのみ)。
      // 意図しないcompany生成を防ぐため、ここでは絶対に処理を進めない(要件6)。
      return json({ error: "このメールアドレス宛に招待が届いています。招待メールのリンクからご登録ください。" }, 409);
    }

    let claimProfile = existingProfile;
    if (!claimProfile) {
      const { data: inserted, error: insertError } = await admin
        .from("profiles")
        .insert({
          email,
          name: ownerName,
          role: "company_admin",
          company_id: null,
          is_active: true,
          invitation_status: "active",
          signup_source: "self_signup",
        })
        .select(profileSelect)
        .single();
      if (insertError) {
        // 23505 = unique_violation(profiles_email_key)。並行送信で他方が先にclaimした
        // ケース——新しいcompanyを重複して作らず、あらためて該当行を取得して合流する。
        if (insertError.code === "23505") {
          const { data: retryProfile, error: retryError } = await admin
            .from("profiles")
            .select(profileSelect)
            .eq("email", email)
            .maybeSingle();
          if (retryError) throw retryError;
          if (retryProfile?.company_id) {
            return json({ error: "このメールアドレスは既に登録されています。ログイン画面からログインしてください。" }, 409);
          }
          claimProfile = retryProfile;
        } else {
          throw insertError;
        }
      } else {
        claimProfile = inserted;
      }
    }

    if (!claimProfile) {
      return json({ error: "登録処理に失敗しました。もう一度お試しください。" }, 500);
    }

    // ------------------------------------------------------------
    // 2. Supabase Authユーザーを確保する(まだ無ければ作成)
    // ------------------------------------------------------------
    let authUserId = claimProfile.auth_user_id || null;
    if (!authUserId) {
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
        // 途中離脱からの再開: 前回の呼び出しでAuth userだけ作られていたケース(要件5-ケースA)。
        const lookupResp = await fetch(
          `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
          { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } }
        );
        if (!lookupResp.ok) throw new Error("既存アカウントの確認に失敗しました");
        const lookupJson = await lookupResp.json();
        const candidates = Array.isArray(lookupJson?.users) ? lookupJson.users : Array.isArray(lookupJson) ? lookupJson : [];
        const existingAuthUser = candidates.find((u: { email?: string }) => String(u?.email || "").toLowerCase() === email);
        if (!existingAuthUser?.id) throw new Error("既存アカウントが見つかりませんでした");
        authUserId = existingAuthUser.id;
        // パスワードは初回登録時に選んだものを正として上書きしない——再開時に入力された
        // パスワードで確実にログインできるよう、確認済み状態だけ揃える。
        await admin.auth.admin.updateUserById(existingAuthUser.id, { email_confirm: true });
      } else {
        authUserId = created.user.id;
      }

      const { error: linkAuthError } = await admin.from("profiles").update({ auth_user_id: authUserId }).eq("id", claimProfile.id);
      if (linkAuthError) throw linkAuthError;
    }
    await logDiagnostic(admin, { actionType: "self_signup_auth_created" });

    // ------------------------------------------------------------
    // 3. company/store/user_storesを確保する(claim行にcompany_idが無い場合のみ)
    // ------------------------------------------------------------
    if (!claimProfile.company_id) {
      const { data: company, error: companyError } = await admin
        .from("companies")
        .insert({
          name: companyName,
          code: `salon-${Date.now().toString(36)}`,
          is_active: true,
          contract_status: "trial",
          plan: "trial",
          trial_started_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (companyError) throw companyError;
      await logDiagnostic(admin, { companyId: company.id, actionType: "self_signup_company_created" });

      const { data: store, error: storeError } = await admin
        .from("stores")
        .insert({
          company_id: company.id,
          name: "本店",
          code: "main",
          is_active: true,
        })
        .select()
        .single();
      if (storeError) throw storeError;
      await logDiagnostic(admin, { companyId: company.id, storeId: store.id, actionType: "self_signup_store_created" });

      const { error: linkCompanyError } = await admin
        .from("profiles")
        .update({ company_id: company.id })
        .eq("id", claimProfile.id);
      if (linkCompanyError) throw linkCompanyError;
      await logDiagnostic(admin, { companyId: company.id, storeId: store.id, actionType: "self_signup_role_assigned" });

      const { error: userStoreError } = await admin.from("user_stores").insert({
        user_id: claimProfile.id,
        company_id: company.id,
        store_id: store.id,
        is_primary: true,
      });
      if (userStoreError) throw userStoreError;

      await logSignupCompletedConversion(admin, { companyId: company.id, profileId: claimProfile.id, utmSource, utmCampaign, utmContent });
    }

    return json({ ok: true });
  } catch (error) {
    console.error("self-signup error", error);
    const message = error instanceof Error ? error.message : "登録処理に失敗しました";
    return json({ error: message }, 500);
  }
});
