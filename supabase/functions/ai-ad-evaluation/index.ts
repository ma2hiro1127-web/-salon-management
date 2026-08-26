// AI広告自動運用システム(V1)の広告評価。system_admin専用。ai-assistant/index.ts(既存の
// AI経営アシスタント)と同じ骨格(JWT本人確認→service-roleで再照会→権限検証→Anthropic
// Claude API呼び出し)を踏襲する。モデルは既存のai-assistantと同じくAI_MODEL環境変数
// (既定claude-haiku-4-5)で揃える——このアプリの既存AI機能が一貫してこのモデルを使っている
// ため、コスト特性を揃える目的で意図的にopus等へは変えていない。
//
// クライアントが送ってきたmetrics(CTR/CPA等、集計済みの数値)を信頼してAIへ渡す点も
// ai-assistantと同じ設計(このFunctionはSupabaseの生データを独自に取得しない)。ただし
// ai-assistantと異なりcompany_id境界のプライバシー懸念は無い(system_adminは元々全データ
// 閲覧可能)ため、検証するのはadIdが実在するad_campaigns行かどうかだけ。
//
// judgment(SCALE/KEEP/WATCH/STOP)・動画生成指示を含む構造化出力には、Anthropic SDKの
// `client.messages.parse()` + `output_config.format`(Zod)を使う——自由記述テキストから
// 判定文字列を都度パースする不安定な実装を避けるため。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk";
import { z } from "https://esm.sh/zod@3";
import { zodOutputFormat } from "https://esm.sh/@anthropic-ai/sdk/helpers/zod";

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

const AdEvaluationSchema = z.object({
  judgment: z.enum(["SCALE", "KEEP", "WATCH", "STOP"]),
  reasoning: z.string(),
  improvement_suggestion: z.string(),
  next_ad_concept: z.string(),
  // 要件15: 動画生成指示(0-3秒フック/3-6秒問題提示/6-10秒画面/10-13秒AIコンサル/
  // 13-15秒価格・CTA)とナレーション原稿を同時生成する。
  video_prompt: z.object({
    hook_0_3s: z.string(),
    problem_3_6s: z.string(),
    screen_6_10s: z.string(),
    ai_consult_10_13s: z.string(),
    price_cta_13_15s: z.string(),
    narration_script: z.string(),
  }),
});

const SYSTEM_PROMPT = `
あなたはサロンマネージャー(美容室経営管理SaaS)のマーケティング担当者向けAIです。広告1件分の
実績データを分析し、SCALE(予算拡大)/KEEP(現状維持)/WATCH(様子見)/STOPのいずれかで判定してください。

# 評価の核心(最重要)
クリック率(CTR)や無料登録数だけで広告を評価しないこと。最重要指標は「有料CPA」(広告費÷有料化
件数)です。登録数が多くても有料化率が低く有料CPAが高い広告は、登録数が少なくても有料CPAが低い
広告に劣ると判定してください。

# 判定の目安
- SCALE: 有料CPAが十分低く、7日継続率・AI利用率も良好で、明確に効率が良い
- KEEP: 有料CPAは許容範囲内だが、SCALEというほどの強い優位性はない
- WATCH: データが少ない、またはCTRは良いが登録後の利用率が低い等、判断材料が不足/懸念がある
- STOP: 有料CPAが著しく高い、または有料化に至っていない、投資に見合わない

# 出力に関する注意
- reasoningは「◯◯は高いが◯◯が低いため」のように、渡された数値を具体的に引用すること。一般論だけで終わらせない。
- improvement_suggestionは今の広告クリエイティブへの改善案。next_ad_conceptは次に試す新しい広告案(コピー案)。
- video_promptは、next_ad_conceptを実際の15秒動画broadcast用に落とし込んだ台本(各パートの画面内容・セリフ)とナレーション原稿。
- 判断に足るデータが無い(登録数・有料数が極端に少ない等)場合は、断定を避けWATCHとし、reasoningでその旨を明示すること。
`.trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let adId = "";
  let metrics: Record<string, unknown> = {};
  try {
    const body = await req.json();
    adId = String(body?.adId || "").trim();
    metrics = (body?.metrics && typeof body.metrics === "object") ? body.metrics : {};
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!adId) {
    return json({ error: "adId は必須です" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicApiKeyRaw = Deno.env.get("ANTHROPIC_API_KEY");
  const anthropicApiKey = (anthropicApiKeyRaw ?? "").trim();

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "サーバー設定が不足しています" }, 500);
  }
  if (!anthropicApiKey) {
    console.error("ai-ad-evaluation: ANTHROPIC_API_KEY is not configured - refusing to call Anthropic API");
    return json({ error: "AI広告評価はまだ設定されていません。管理者にお問い合わせください。" }, 503);
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
      .select("id, role, is_active")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active || callerProfile.role !== "system_admin") {
      return json({ error: "AI広告評価はシステム管理者のみ利用できます" }, 403);
    }

    const { data: ad, error: adError } = await admin
      .from("ad_campaigns")
      .select("id, platform, theme, hook, main_message, target, status")
      .eq("id", adId)
      .maybeSingle();
    if (adError) throw adError;
    if (!ad) {
      return json({ error: "対象の広告が見つかりません" }, 404);
    }

    const model = Deno.env.get("AI_MODEL") || "claude-haiku-4-5";
    const maxTokens = Number(Deno.env.get("AI_AD_EVALUATION_MAX_TOKENS")) || 2048;
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    const userContent = `# 広告情報\n${JSON.stringify({ platform: ad.platform, theme: ad.theme, hook: ad.hook, mainMessage: ad.main_message, target: ad.target, status: ad.status })}\n\n# 実績データ\n${JSON.stringify(metrics)}\n\nこの広告を評価してください。`;

    let response;
    try {
      response = await anthropic.messages.parse({
        model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        output_config: { format: zodOutputFormat(AdEvaluationSchema) },
      });
    } catch (apiError) {
      const status = (apiError as { status?: number } | null)?.status;
      const errType = (apiError as { type?: string; error?: { type?: string } } | null)?.type
        ?? (apiError as { error?: { type?: string } } | null)?.error?.type;
      const errMessage = apiError instanceof Error ? apiError.message : String(apiError);
      console.error("ai-ad-evaluation: Anthropic API call failed", { status, type: errType, message: errMessage });

      if (status === 401) {
        return json({ error: "AI機能の認証に失敗しました(APIキーが無効です)。管理者にお問い合わせください。" }, 500);
      }
      if (status === 403 && errType === "billing_error") {
        return json({ error: "AI機能の利用上限(クレジット残高)に達しています。管理者にお問い合わせください。" }, 500);
      }
      if (status === 429) {
        return json({ error: "AI機能が現在混み合っています。しばらくしてから再度お試しください。" }, 503);
      }
      if (status === 404 || status === 400) {
        return json({ error: "AI機能の設定に誤りがあります(モデル名など)。管理者にお問い合わせください。" }, 500);
      }
      return json({ error: "AIサービスへの問い合わせに失敗しました。時間をおいて再度お試しください。" }, 502);
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      console.error("ai-ad-evaluation: structured output parsing failed", { stopReason: response.stop_reason });
      return json({ error: "AIから有効な評価結果が得られませんでした" }, 502);
    }

    const { data: saved, error: saveError } = await admin
      .from("ad_ai_evaluations")
      .insert({
        ad_id: adId,
        judgment: parsed.judgment,
        reasoning: parsed.reasoning,
        improvement_suggestion: parsed.improvement_suggestion,
        next_ad_concept: parsed.next_ad_concept,
        input_metrics_snapshot: metrics,
        video_prompt: parsed.video_prompt,
        created_by: callerProfile.id,
      })
      .select()
      .single();
    if (saveError) throw saveError;

    return json({ evaluation: saved });
  } catch (error) {
    console.error("ai-ad-evaluation error", error instanceof Error ? error.message : error);
    const message = error instanceof Error ? error.message : "AI広告評価の処理に失敗しました";
    return json({ error: message }, 500);
  }
});
