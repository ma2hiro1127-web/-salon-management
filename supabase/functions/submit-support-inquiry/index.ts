// ヘルプ・お問い合わせ(2026-09追加)。「不具合・エラー」「数字・表示がおかしい」
// 「契約・料金について」「その他」の問い合わせを受け付け、support_inquiries /
// support_inquiry_attachmentsへ保存したうえで運営メール(salonmanager.jp@gmail.com)へ送信する。
//
// 重要な設計方針(create-checkout-session等の既存パターンを踏襲):
//   - company_id/store_id/user_id/氏名/メールアドレス/権限は、リクエストボディからは一切
//     信用しない。呼び出し元のJWTから解決したprofileだけを唯一の根拠にする(他社になりすました
//     問い合わせを構造的に防ぐ)。storeIdだけはクライアントから「今どの店舗を見ていたか」の
//     ヒントとして受け取るが、resolveしたcompany_idに属する店舗かどうかを必ず検証する。
//   - 添付画像はクライアントが先にsupport-attachments private bucketへ直接アップロード
//     済み(anonキー+Storage RLS)であることを前提とし、このFunctionはservice roleで
//     「実在するか・自社のパスか」を再検証してからDBへ記録する——クライアント申告の
//     mime_type/file_sizeをそのまま信用せず、Storage側のメタデータを正として使う。
//   - idはクライアント生成のUUIDをそのまま主キーにする(support_inquiries.id)。同じidで
//     複数回呼ばれても2回目以降はinsertが起きず(on conflict do nothing)、それ以前に
//     成功していた場合はメールを再送しない(要件18: 二重送信防止)。
//   - メール送信はRESEND_API_KEY未設定でも問い合わせ自体の保存は必ず成功させる
//     (要件17: メール送信だけ失敗してもDB上の問い合わせは失わない)。
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
  console.error(`[submit-support-inquiry] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

const CATEGORY_LABELS: Record<string, string> = {
  bug: "不具合・エラー",
  display_issue: "数字・表示がおかしい",
  billing: "契約・料金について",
  other: "その他",
};

const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_EXPIRES_IN = 7 * 24 * 60 * 60; // 7日間(要件15: 永久公開URLは禁止・妥当な有効期限)
const BUCKET = "support-attachments";

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

// Deno標準ライブラリへの依存を増やさず、バイト列→base64をチャンク分割で行う
// (巨大な配列をそのままString.fromCharCode.apply(null, ...)へ渡すとスタック超過の
// リスクがあるため、8KBずつ処理する)。
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let inquiryId = "";
  let category = "";
  let message = "";
  let storeIdInput = "";
  let currentPage = "";
  let targetMonth = "";
  let currentUrl = "";
  let attachmentPaths: string[] = [];
  try {
    const body = await req.json();
    inquiryId = String(body?.inquiryId || "").trim();
    category = String(body?.category || "").trim();
    message = String(body?.message || "").trim();
    storeIdInput = String(body?.storeId || "").trim();
    currentPage = String(body?.currentPage || "").trim().slice(0, 200);
    targetMonth = String(body?.targetMonth || "").trim().slice(0, 20);
    currentUrl = String(body?.currentUrl || "").trim().slice(0, 500);
    attachmentPaths = Array.isArray(body?.attachmentPaths) ? body.attachmentPaths.map((p: unknown) => String(p || "")) : [];
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }

  if (!isUuid(inquiryId)) {
    return json({ error: "inquiryId が不正です" }, 400);
  }
  if (!CATEGORY_LABELS[category]) {
    return json({ error: "問い合わせ種類を選択してください" }, 400);
  }
  if (!message) {
    return json({ error: "お問い合わせ内容を入力してください" }, 400);
  }
  if (attachmentPaths.length > MAX_ATTACHMENTS) {
    return json({ error: `画像は最大${MAX_ATTACHMENTS}枚までです` }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    logStage("missing_server_config", {});
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
    // company_id/氏名/メールアドレス/権限は、ここで解決したprofile以外を一切信用しない。
    const { data: callerProfile, error: profileError } = await admin
      .from("profiles")
      .select("id, name, email, role, company_id, is_active")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!callerProfile || !callerProfile.is_active) {
      return json({ error: "お問い合わせを送信する権限がありません" }, 403);
    }

    const companyId: string | null = callerProfile.company_id || null;
    let companyName = "";
    if (companyId) {
      const { data: company } = await admin.from("companies").select("id, name").eq("id", companyId).maybeSingle();
      companyName = company?.name || "";
    }

    // storeIdはクライアントからの「今見ていた店舗」のヒントに過ぎない——resolveした
    // companyIdに属する店舗であることを必ず検証し、一致しなければ黙って無視する
    // (問い合わせ自体は継続させる、他社の店舗IDを誤ってタグ付けしないための安全策)。
    let storeId: string | null = null;
    let storeName = "";
    if (storeIdInput && isUuid(storeIdInput) && companyId) {
      const { data: store } = await admin
        .from("stores")
        .select("id, name, company_id")
        .eq("id", storeIdInput)
        .maybeSingle();
      if (store && store.company_id === companyId) {
        storeId = store.id;
        storeName = store.name || "";
      }
    }

    // 添付画像: クライアントが直接アップロード済みのパスを、service roleで再検証する。
    // パスの先頭が自社のcompany_idと一致しない場合はエラーで拒否する(なりすまし防止)。
    const validatedAttachments: Array<{ path: string; mimeType: string | null; fileSize: number | null }> = [];
    for (const path of attachmentPaths) {
      const segments = path.split("/");
      if (segments.length < 3 || !isUuid(segments[0])) {
        return json({ error: "添付ファイルの形式が不正です" }, 400);
      }
      if (!companyId || segments[0] !== companyId) {
        return json({ error: "添付ファイルが自社のものと一致しません" }, 403);
      }
      const dirPath = segments.slice(0, -1).join("/");
      const fileName = segments[segments.length - 1];
      const { data: listing, error: listError } = await admin.storage.from(BUCKET).list(dirPath, { search: fileName });
      if (listError) throw listError;
      const found = (listing || []).find((entry) => entry.name === fileName);
      if (!found) {
        return json({ error: "添付ファイルが見つかりません。もう一度添付し直してください。" }, 400);
      }
      const fileSize = Number(found.metadata?.size ?? 0);
      if (fileSize > MAX_ATTACHMENT_BYTES) {
        return json({ error: "画像サイズが大きすぎます。5MB以下の画像を選択してください。" }, 400);
      }
      validatedAttachments.push({ path, mimeType: found.metadata?.mimetype || null, fileSize: fileSize || null });
    }

    const nowIso = new Date().toISOString();
    const userAgent = req.headers.get("user-agent") || "";

    // idempotency(要件18): 同じidで既に成功済みなら再insertせず、既存行をそのまま返す
    // (連打・通信再送で同じ問い合わせメールが複数届くことを防ぐ)。
    const { data: existing } = await admin.from("support_inquiries").select("id, email_status").eq("id", inquiryId).maybeSingle();
    if (existing) {
      logStage("duplicate_submit_ignored", { inquiryId });
      return json({ ok: true, inquiryId, alreadySubmitted: true });
    }

    const { error: insertError } = await admin.from("support_inquiries").insert({
      id: inquiryId,
      company_id: companyId,
      store_id: storeId,
      user_id: callerProfile.id,
      category,
      message,
      status: "open",
      email_status: "pending",
      current_page: currentPage || null,
      target_month: targetMonth || null,
      user_agent: userAgent || null,
      current_url: currentUrl || null,
      company_name: companyName || null,
      store_name: storeName || null,
      user_name: callerProfile.name || null,
      user_email: callerProfile.email || null,
      user_role: callerProfile.role || null,
      created_at: nowIso,
    });
    if (insertError) {
      // 稀に同時多重送信が競合してユニーク制約(主キー)違反になった場合は、後勝ちを
      // 諦めて「既に受け付け済み」として扱う(要件18と同じ理由)。
      if (insertError.code === "23505") {
        return json({ ok: true, inquiryId, alreadySubmitted: true });
      }
      throw insertError;
    }

    if (validatedAttachments.length > 0) {
      const { error: attachmentInsertError } = await admin.from("support_inquiry_attachments").insert(
        validatedAttachments.map((attachment) => ({
          inquiry_id: inquiryId,
          company_id: companyId,
          storage_path: attachment.path,
          mime_type: attachment.mimeType,
          file_size: attachment.fileSize,
        }))
      );
      if (attachmentInsertError) {
        // 添付情報の保存に失敗しても、問い合わせ本体(support_inquiries)は既に保存済み
        // なので失われない(要件17)。ログに残し、処理は続行してメール送信を試みる。
        logStage("attachment_insert_failed", { inquiryId, message: attachmentInsertError.message });
      }
    }

    // メール送信(要件13-15)。RESEND_API_KEY未設定の環境では送信をスキップし、
    // email_status='failed'のまま問い合わせ自体は保存済みとして扱う(要件17)。
    const emailStatus = await sendInquiryEmail({
      admin,
      inquiryId,
      category,
      message,
      companyName,
      storeName,
      userName: callerProfile.name || "",
      userRole: callerProfile.role || "",
      targetMonth,
      currentPage,
      currentUrl,
      userAgent,
      createdAt: nowIso,
      attachments: validatedAttachments,
    });

    await admin.from("support_inquiries").update({ email_status: emailStatus }).eq("id", inquiryId);

    logStage("inquiry_submitted", { inquiryId, category, companyId, emailStatus });
    return json({ ok: true, inquiryId });
  } catch (error) {
    const message2 = error instanceof Error ? error.message : "送信に失敗しました";
    logStage("unhandled_error", { message: message2 });
    return json({ error: "お問い合わせを送信できませんでした。時間をおいてもう一度お試しください。" }, 500);
  }
});

async function sendInquiryEmail(params: {
  admin: ReturnType<typeof createClient>;
  inquiryId: string;
  category: string;
  message: string;
  companyName: string;
  storeName: string;
  userName: string;
  userRole: string;
  targetMonth: string;
  currentPage: string;
  currentUrl: string;
  userAgent: string;
  createdAt: string;
  attachments: Array<{ path: string; mimeType: string | null; fileSize: number | null }>;
}): Promise<"sent" | "failed"> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromAddress = Deno.env.get("SUPPORT_FROM_EMAIL") || "onboarding@resend.dev";
  const toAddress = "salonmanager.jp@gmail.com";
  if (!resendApiKey) {
    logStage("email_skipped_no_api_key", { inquiryId: params.inquiryId });
    return "failed";
  }

  const categoryLabel = CATEGORY_LABELS[params.category] || params.category;
  const subject = `【Salon Manager問い合わせ】${categoryLabel}｜${params.companyName || "不明な会社"}｜${params.storeName || "店舗未指定"}`;

  // 添付画像はSigned URL(7日間有効)を本文に必ず載せる(要件15: 永久公開URL禁止・妥当な
  // 有効期限)。加えて、実バイトの取得・base64化に成功した分だけメール本体にも直接添付する
  // (要件15: 「可能であればスクリーンショットをメールにも添付」)——1件でも失敗しても
  // メール送信自体は継続する。
  const signedUrlLines: string[] = [];
  const emailAttachments: Array<{ filename: string; content: string }> = [];
  for (const attachment of params.attachments) {
    try {
      const { data: signed, error: signError } = await params.admin.storage
        .from(BUCKET)
        .createSignedUrl(attachment.path, SIGNED_URL_EXPIRES_IN);
      if (signError) throw signError;
      if (signed?.signedUrl) signedUrlLines.push(signed.signedUrl);
    } catch (error) {
      logStage("signed_url_failed", { inquiryId: params.inquiryId, path: attachment.path, message: (error as Error)?.message });
    }
    try {
      const { data: fileBlob, error: downloadError } = await params.admin.storage.from(BUCKET).download(attachment.path);
      if (downloadError) throw downloadError;
      if (fileBlob) {
        const bytes = new Uint8Array(await fileBlob.arrayBuffer());
        const filename = attachment.path.split("/").pop() || "attachment";
        emailAttachments.push({ filename, content: bytesToBase64(bytes) });
      }
    } catch (error) {
      logStage("attachment_download_failed", { inquiryId: params.inquiryId, path: attachment.path, message: (error as Error)?.message });
    }
  }

  const bodyLines = [
    `問い合わせ種別: ${categoryLabel}`,
    `会社名: ${params.companyName || "不明"}`,
    `店舗名: ${params.storeName || "未指定"}`,
    `ユーザー名: ${params.userName || "不明"}`,
    `ユーザー権限: ${params.userRole || "不明"}`,
    `対象月: ${params.targetMonth || "不明"}`,
    `表示中画面: ${params.currentPage || "不明"}`,
    `問い合わせ日時: ${params.createdAt}`,
    "",
    "お問い合わせ内容：",
    "ーーーーーーーー",
    params.message,
    "ーーーーーーーー",
    "",
    `端末・ブラウザ情報: ${params.userAgent || "不明"}`,
    `URL: ${params.currentUrl || "不明"}`,
    "",
    `問い合わせID: ${params.inquiryId}`,
    "",
    `スクリーンショット: ${params.attachments.length > 0 ? "添付あり" : "なし"}`,
    ...(signedUrlLines.length > 0 ? ["", "スクリーンショット確認用リンク(7日間有効):", ...signedUrlLines] : []),
  ];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Salon Manager <${fromAddress}>`,
        to: [toAddress],
        subject,
        text: bodyLines.join("\n"),
        attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
      }),
    });
    if (!res.ok) {
      const errorBody = await res.text();
      const detail = { inquiryId: params.inquiryId, status: res.status, errorBody: errorBody.slice(0, 500) };
      logStage("resend_api_error", detail);
      // 一時的な調査用: supabase functions logsが使えない環境でも原因を追えるよう、
      // 機密情報を含まない範囲でclient_diagnostic_logs(既存テーブル)へも残す。
      await params.admin.from("client_diagnostic_logs").insert({
        screen: "submit-support-inquiry",
        action_type: "resend_api_error",
        error_type: String(res.status),
        message: errorBody.slice(0, 500),
      }).then(() => {}, () => {});
      return "failed";
    }
    return "sent";
  } catch (error) {
    const message = (error as Error)?.message || "";
    logStage("resend_request_failed", { inquiryId: params.inquiryId, message });
    await params.admin.from("client_diagnostic_logs").insert({
      screen: "submit-support-inquiry",
      action_type: "resend_request_failed",
      message: String(message).slice(0, 500),
    }).then(() => {}, () => {});
    return "failed";
  }
}
