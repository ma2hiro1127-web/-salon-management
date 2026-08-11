// AI経営アシスタント(ダッシュボードのAIチャット)からの相談メッセージを受け取り、Anthropic
// Claude APIへ問い合わせて回答を返す。APIキー(ANTHROPIC_API_KEY)はこのEdge Function内の
// シークレットとしてのみ保持し、ブラウザ・クライアントバンドルには一切露出しない。
//
// 権限まわりは既存の accept-invite / delete-user / send-invite-email と同じ考え方:
// クライアントが送ってきた role / storeId / isAllStores は一切信用せず、JWTから本人確認した
// うえで service_role キーで profiles / user_stores を再照会し、リクエストされたスコープ
// (個別店舗 or 全店舗)がその本人に許可されているかをサーバー側で検証する。検証に失敗したら
// Anthropic APIは一切呼び出さない(=権限を回避して他店舗データを取得する経路を作らない)。
//
// AIへ送るのはクライアントが計算済みの数値コンテキスト(そのユーザー自身のappStateから
// calculateMonthSummary等で算出した、本来見て良い値)であり、Supabaseの生データを
// このFunctionが独自に取得することはない。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk";

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

const ADMIN_ROLES = ["system_admin", "company_admin"];

// 実際のアプリの画面構成に基づいたFAQ。存在しない操作・画面を答えないよう、ここに書いた
// 内容のみを根拠に回答させる(将来的にマニュアル文書へ差し替え/拡張しやすいよう分離)。
const APP_FAQ = `
# Salon Manager 操作ガイド(この内容だけを根拠に答えること。ここに無い機能を断定しない)
- 日次入力: サイドバー「日次入力」ページから、日付を選んで売上・客数などを入力する。
- 日締めとは: 日次入力ページで、その日の売上入力を確定させる操作。「日締め」ボタンで確定し、確定後は一般スタッフは編集できなくなる(店長以上は編集可能)。店休日は日締めできない。
- 月締めとは: 「管理画面」ページ内のタブ「月締め」で、その月の人件費・材料費(仕入・発注額)などの月締め項目を入力し、月全体を確定させる操作。日締め(日単位)とは別の、月単位の締め処理。
- 月間目標の設定: 「管理画面」ページ内のタブ「目標設定」で、対象月ごとに目標売上・目標客数などを設定する。
- 固定費・変動費・広告費の入力: 「管理画面」ページ内のタブ「費用入力」で入力する(継続的な費用・期間限定の費用に対応)。
- 材料費(仕入・発注額)・人件費の入力: 「管理画面」ページ内のタブ「月締め」で、月締め項目として入力する。
- 損益表: 「管理画面」ページ内のタブ「損益表」で、売上・費用をもとにした利益を確認できる。
- 消費税引当額とは: 損益表に表示される、納税に備えて確保しておくべき概算金額。正式な納税額の自動計算ではない。「消費税を考慮する」設定をONにし、引当率(%)を指定すると表示される(会社の設定画面から変更)。
- 店舗を追加する方法: 「店舗管理」ページの「店舗を追加」ボタンから追加する(会社管理者・システム管理者のみ操作可能)。
- スタッフを追加する・ユーザーを招待する方法: 「ユーザー管理」ページから新しいユーザーを招待できる(招待可能な権限は自分の権限より低いロールのみ)。このアプリにスタッフを追加する唯一の方法は招待であり、招待した本人がメール経由でパスワードを設定して登録する。
- 店舗の切り替え・全店舗表示: 画面上部の店舗選択から切り替える。「全店舗」は会社管理者・システム管理者のみ選択でき、選択中の会社の全店舗を合算して表示する。
`.trim();

// contextのフィールド名(英語)とSalon Manager上の実際の用語の対応。AIが数字を取り違えない
// ようにするための補助情報。
const FIELD_GLOSSARY = `
# データ項目の対応表
- sales.totalSales = 現在の累計売上 / target.targetSales = 月間目標売上
- sales.technicalSales = 技術売上 / sales.retailSales = 店販売上 / sales.otherSales = その他売上
- sales.averageDailySales = 1日平均売上 / sales.targetDailyPace = 目標達成に必要な1日あたりのペース
- sales.paceDifference = 1日平均売上と目標ペースの差額(プラスならペース超過、マイナスならペース未達)
- sales.targetAchievementRate = 目標達成率(%) / sales.monthEndForecast = 月末着地予想
- businessDays.businessDayCount = 今月の営業日数 / businessDays.completedBusinessDays = 経過営業日数 / businessDays.remainingBusinessDays = 残り営業日数
- customers.totalCustomers = 客数 / customers.averageSpend = 客単価 / customers.newCustomers = 新規客数 / customers.repeatCustomers = 再来客数
- reviews.totalReviewCount = 口コミ数
- costs.laborCost / costs.laborCostRate = 人件費・人件費率
- costs.costOfGoodsSold / costs.costOfGoodsSoldRate = 材料費(仕入・発注額ベース)・材料費率
- costs.adCost = 広告費 / costs.fixedCost = 固定費 / costs.variableCost = 変動費(旧・販管費を含む)
- costs.operatingProfit / costs.operatingMargin = 営業利益・営業利益率
`.trim();

const SYSTEM_PROMPT_HEADER = `
あなたはサロン経営管理アプリ「Salon Manager」に組み込まれた経営相談AIです。話す相手はサロンのオーナーや店長で、経営やITの専門用語に詳しくない場合があります。

回答の原則:
1. 経営相談には、必ず①現状 ②数字から考えられる原因 ③改善案 ④追加で確認したい情報(あれば) の順で、Salon Manager上の実際の数字を引用しながら答えること。一般論だけの回答はしない。
2. 与えられたデータJSON(context)に無い数字を作り出さない・推測しない。憶測で断定しないこと。
3. アプリのデータだけでは原因を特定できない質問(例: 新規客が減った理由)には、断定せず「現在のデータだけでは原因を特定できません」と明示したうえで、原因特定に必要な追加情報(集客チャネル別の内訳、広告費、Hot Pepper Beautyやグーグルビジネスプロフィールの掲載状況、クーポン利用状況など)を尋ねること。
4. 分析に必要なデータ(費用・広告費など)がcontext内でnullや未入力の場合は、それを補うと分析精度が上がる旨を伝え、どの画面から入力できるか(操作ガイド参照)を添えて入力を促すこと。
5. アプリの使い方に関する質問には、下記の操作ガイドに書かれている内容だけを根拠に答え、存在しない画面や機能を作り話しないこと。
6. 回答は簡潔にし、長文にしない。
7. 通貨は日本円として扱い、「円」を単位に使うこと。

回答例(このトーン・粒度を参考にすること):
「現在の売上は230万円で、月間目標500万円に対して達成率46%です。残り12営業日で270万円必要なため、1日あたり22.5万円が必要です。
現在の数字を見る限り、まず確認したいのは新規客数です。新規35名が通常月と比べて少ない場合、集客面が売上未達の原因になっている可能性があります。
新規客が少ない具体的な原因は現在のデータだけでは特定できません。広告費や主な集客媒体(Hot Pepper Beauty、Googleビジネスプロフィール等)の状況を教えていただければ、さらに詳しく分析できます。」

${FIELD_GLOSSARY}

${APP_FAQ}
`.trim();

async function isStoreAllowedForCaller(admin: ReturnType<typeof createClient>, callerProfile: { id: string; role: string; company_id: string }, storeId: string) {
  const { data: store, error } = await admin.from("stores").select("id, company_id").eq("id", storeId).maybeSingle();
  if (error) throw error;
  if (!store || store.company_id !== callerProfile.company_id) return false;
  if (ADMIN_ROLES.includes(callerProfile.role)) return true;
  const { data: assignment, error: assignmentError } = await admin
    .from("user_stores")
    .select("store_id")
    .eq("user_id", callerProfile.id)
    .eq("store_id", storeId)
    .maybeSingle();
  if (assignmentError) throw assignmentError;
  return Boolean(assignment);
}

function sanitizeHistory(history: unknown): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry): entry is { role: string; content: string } =>
      entry && typeof entry === "object" && (entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string")
    .slice(-20)
    .map((entry) => ({ role: entry.role as "user" | "assistant", content: String(entry.content).slice(0, 4000) }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let context: Record<string, unknown> = {};
  let history: unknown = [];
  let message = "";
  try {
    const body = await req.json();
    context = (body?.context && typeof body.context === "object") ? body.context : {};
    history = body?.history;
    message = String(body?.message || "").trim().slice(0, 4000);
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!message) {
    return json({ error: "message は必須です" }, 400);
  }

  const scope = (context?.scope && typeof context.scope === "object") ? (context.scope as Record<string, unknown>) : {};
  const isAllStoresView = Boolean(scope.isAllStoresView);
  const storeId = String(scope.storeId || "").trim();
  if (!isAllStoresView && !storeId) {
    return json({ error: "storeId が指定されていません" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicApiKeyRaw = Deno.env.get("ANTHROPIC_API_KEY");
  const anthropicApiKey = (anthropicApiKeyRaw ?? "").trim();

  // 診断ログ: 値そのものは絶対に出さず、「設定されているか」「空でないか」だけを記録する。
  // Deno.env.get() は未設定なら undefined、空文字列で登録されていれば "" を返すため、
  // 単純な if (!anthropicApiKey) だけでは「未登録」と「登録済みだが値が空」を区別できない。
  // このログで即座に切り分けられるようにする(過去にSecretは登録済みなのに503になる、
  // という事象があり、原因は値が空文字列で登録されていたことだった)。
  console.log("ai-assistant: env check", {
    SUPABASE_URL: supabaseUrl ? "set" : "missing",
    SUPABASE_ANON_KEY: anonKey ? "set" : "missing",
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey ? "set" : "missing",
    ANTHROPIC_API_KEY: anthropicApiKeyRaw === undefined
      ? "missing"
      : (anthropicApiKey === "" ? "set-but-empty" : `set(length=${anthropicApiKey.length})`),
  });

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "サーバー設定が不足しています" }, 500);
  }
  if (!anthropicApiKey) {
    // まだAI機能を有効化していない状態(=API利用料が一切発生しない状態)。ここで止まる限り
    // Anthropic APIへは一度もリクエストされないため、シークレット未設定のままなら費用は0円。
    console.error("ai-assistant: ANTHROPIC_API_KEY is not configured (unset or empty) - refusing to call Anthropic API");
    return json({ error: "AIアシスタントはまだ設定されていません。管理者にお問い合わせください。" }, 503);
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
    if (!callerProfile || !callerProfile.is_active) {
      return json({ error: "利用権限がありません" }, 403);
    }

    if (isAllStoresView) {
      if (!ADMIN_ROLES.includes(callerProfile.role)) {
        return json({ error: "全店舗の分析は会社管理者・システム管理者のみ利用できます" }, 403);
      }
    } else {
      const allowed = await isStoreAllowedForCaller(admin, callerProfile, storeId);
      if (!allowed) {
        return json({ error: "この店舗のデータを分析する権限がありません" }, 403);
      }
    }

    const model = Deno.env.get("AI_MODEL") || "claude-haiku-4-5";
    const maxTokens = Number(Deno.env.get("AI_MAX_TOKENS")) || 1024;

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    const systemPrompt = `${SYSTEM_PROMPT_HEADER}\n\n# 現在の分析対象データ(このJSONの数字のみを事実として扱うこと)\n${JSON.stringify(context)}`;
    const safeHistory = sanitizeHistory(history);

    let response;
    try {
      response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [...safeHistory, { role: "user", content: message }],
      });
    } catch (apiError) {
      // Anthropic APIからのエラーを種別ごとに切り分ける。APIキー本体はログに出さない
      // (status/typeはエラー分類のためのメタ情報であり、キーの値そのものではない)。
      const status = (apiError as { status?: number } | null)?.status;
      const errType = (apiError as { type?: string; error?: { type?: string } } | null)?.type
        ?? (apiError as { error?: { type?: string } } | null)?.error?.type;
      const errMessage = apiError instanceof Error ? apiError.message : String(apiError);
      console.error("ai-assistant: Anthropic API call failed", { status, type: errType, message: errMessage });

      if (status === 401) {
        // APIキーが無効(存在するが値が間違っている/失効している)。空文字列ならここには
        // 到達せず上のANTHROPIC_API_KEY未設定チェックで止まる。
        return json({ error: "AI機能の認証に失敗しました(APIキーが無効です)。管理者にお問い合わせください。" }, 500);
      }
      if (status === 403 && errType === "billing_error") {
        return json({ error: "AI機能の利用上限(クレジット残高)に達しています。管理者にお問い合わせください。" }, 500);
      }
      if (status === 403) {
        return json({ error: "AI機能の利用権限がありません。管理者にお問い合わせください。" }, 500);
      }
      if (status === 429) {
        return json({ error: "AI機能が現在混み合っています。しばらくしてから再度お試しください。" }, 503);
      }
      if (status === 404 || status === 400) {
        // モデル名の誤り(AI_MODEL環境変数)やリクエスト形式の誤りなど。
        return json({ error: "AI機能の設定に誤りがあります(モデル名など)。管理者にお問い合わせください。" }, 500);
      }
      return json({ error: "AIサービスへの問い合わせに失敗しました。時間をおいて再度お試しください。" }, 502);
    }

    const textBlock = response.content.find((block: { type: string }) => block.type === "text") as { text?: string } | undefined;
    const reply = textBlock?.text || "";
    if (!reply) {
      console.error("ai-assistant: Anthropic response had no text block", { stopReason: response.stop_reason });
      return json({ error: "AIから有効な回答が得られませんでした" }, 502);
    }

    return json({ reply });
  } catch (error) {
    console.error("ai-assistant error", error instanceof Error ? error.message : error);
    const message = error instanceof Error ? error.message : "AIアシスタントへの問い合わせに失敗しました";
    return json({ error: message }, 500);
  }
});
