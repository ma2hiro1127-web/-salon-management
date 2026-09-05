// 問い合わせメール内「スクリーンショットを確認する」の実体(2026-09追加)。
//
// なぜSupabase Storageの createSignedUrl をそのまま使わないか: iPhoneのGmailアプリ内
// ブラウザで開くと、Content-TypeやContent-Dispositionの解釈状況によって画像が
// インライン表示されず、白い画面+ファイルダウンロード表示になる不具合が報告されたため。
// このFunctionは、レスポンスヘッダーを自分で完全に制御できるプロキシとして動作させることで、
// どの環境でも確実に image/* + inline で返す(要件どおりの代替方式)。
//
// 認証方式: 通常のSupabase JWTではなく、自前でHMAC署名した短命トークンをURLに埋め込む
// (メールの受信者はアプリにログインしていないため)。署名鍵はSUPABASE_SERVICE_ROLE_KEY
// を流用する(新しいSecretをユーザーに追加設定してもらう必要をなくすため——HMACの鍵として
// 使うだけで、この鍵自体が外部へ漏れることはない)。有効期限は発行時に埋め込んだexpで
// 判定し、Supabase側のcreateSignedUrlと同じ7日間のまま維持する(呼び出し元のexp計算)。
//
// private bucket・RLSは一切変更しない——このFunction自体はservice roleでStorageから
// バイト列を取得するだけで、bucketをpublicにしたり新しいRLSを追加したりはしていない。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const BUCKET = "support-attachments";

function textResponse(body: string, status: number) {
  return new Response(body, { status, headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" } });
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 定数時間比較(タイミング攻撃対策、hex文字列同士の比較で十分な範囲)。
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const EXTENSION_MIME_FALLBACK: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return textResponse("Method not allowed", 405);
  }

  const url = new URL(req.url);
  const path = url.searchParams.get("path") || "";
  const expParam = url.searchParams.get("exp") || "";
  const sig = url.searchParams.get("sig") || "";
  const exp = Number(expParam);

  // パス形式は必ず {company_id}/{inquiry_id}/{ファイル名} の3階層(submit-support-inquiryの
  // 保存規約と同じ)——不正な形式は署名検証以前に弾く。
  if (!path || path.split("/").length !== 3 || !exp || !sig) {
    return textResponse("不正なリクエストです", 400);
  }
  if (Math.floor(Date.now() / 1000) > exp) {
    return textResponse("このリンクの有効期限が切れています", 410);
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceRoleKey || !supabaseUrl) {
    return textResponse("サーバー設定が不足しています", 500);
  }

  const expectedSig = await hmacSha256Hex(serviceRoleKey, `${path}.${exp}`);
  if (!timingSafeEqual(expectedSig, sig)) {
    return textResponse("リンクが無効です", 403);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: fileBlob, error: downloadError } = await admin.storage.from(BUCKET).download(path);
    if (downloadError || !fileBlob) {
      return textResponse("画像が見つかりませんでした", 404);
    }

    // Content-Typeは、送信時にDBへ保存済みのmime_type(アップロード時にStorageのメタ
    // データから再検証済み、submit-support-inquiry参照)を最優先で使う。見つからない
    // 場合だけ拡張子から推定する(要件: 画像形式ごとに正しいMIME typeを保存・返却する)。
    const fileName = path.split("/").pop() || "";
    const extension = fileName.split(".").pop()?.toLowerCase() || "";
    let mimeType = EXTENSION_MIME_FALLBACK[extension] || "application/octet-stream";
    const { data: attachmentRow } = await admin
      .from("support_inquiry_attachments")
      .select("mime_type")
      .eq("storage_path", path)
      .maybeSingle();
    if (attachmentRow?.mime_type) mimeType = attachmentRow.mime_type;

    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": mimeType,
        // iPhoneのGmail内ブラウザで画像がその場で表示されず「ダウンロード」扱いになる
        // 不具合の直接対策: inlineを明示し、ファイル名も付けておく(要件どおり)。
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[view-support-attachment] error", error instanceof Error ? error.message : error);
    return textResponse("画像の取得に失敗しました", 500);
  }
});
