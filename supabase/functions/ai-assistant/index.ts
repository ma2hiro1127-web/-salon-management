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
- 月締めとは: 「管理画面」ページ内のタブ「月締め」で、損益表の作成に必要な項目(売上・人件費・材料/発注費・広告費・家賃など全カテゴリ)が入力済みかどうかを確認し、月全体を確定させる操作。月締め画面そのものでは金額は入力しない(確認とその月の最終確定が役割)。日締め(日単位)とは別の、月単位の締め処理。
- 月間目標の設定: 「管理画面」ページ内のタブ「目標設定」で、対象月ごとに目標売上・目標客数などを設定する。
- 費用の入力(人件費・材料/発注費・広告費・家賃・光熱費など全カテゴリ): すべて「管理画面」ページ内のタブ「費用入力」で行う。費用名(自由入力、例:HPB)と費用カテゴリ(家賃/人件費・社会保険/広告費/光熱費/通信費/材料・発注費/清掃・環境費/システム・サービス利用料/税金・保険/その他費用の10種類から選択)を別々に登録する。継続費用(家賃・通信費等、毎月自動で反映)と単月費用(人件費・材料/発注費等、対象年月ごとに入力)の2種類がある。人件費・材料/発注費は歩合給や複数回の発注で月内確定が遅いことが多いため、月末〜翌月頭にその月の分をまとめて入力する運用でよい。
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
- sales.averageDailySales = 1日平均売上 / sales.targetDailyPace = 目標達成に必要な1日あたりの売上(1日あたり必要売上)
- sales.paceDifference = 1日平均売上と目標ペースの差額(プラスならペース超過、マイナスならペース未達)
- sales.targetAchievementRate = 目標達成率(%) / sales.monthEndForecast = 月末着地予想
- businessDays.businessDayCount = 今月の営業日数 / businessDays.completedBusinessDays = 経過営業日数(営業完了日数) / businessDays.remainingBusinessDays = 残り営業日数
- customers.totalCustomers = 客数 / customers.averageSpend = 客単価 / customers.newCustomers = 新規客数 / customers.repeatCustomers = 再来客数
- target.targetCustomers = 目標客数 / target.targetNewCustomers = 目標新規客数 / target.targetRepeatCustomers = 目標再来客数
- reviews.totalReviewCount = 口コミ数
- costs.laborCost / costs.laborCostRate = 人件費・人件費率
- costs.costOfGoodsSold / costs.costOfGoodsSoldRate = 材料費・発注費用(仕入・発注額ベース)・材料費率 ※「材料費」「発注費用」はどちらもこの項目を指す同じ意味の言葉
- costs.adCost = 広告費(Hot Pepper Beauty/HPB等の集客媒体費もここに合算されている。媒体別の内訳は無い)
- costs.fixedCost = 固定費 / costs.variableCost = 変動費(旧・販管費を含む) / costs.otherCost = その他経費
- costs.grossProfit = 粗利益 / costs.operatingProfit = 営業利益 / costs.operatingMargin = 営業利益率 / costs.totalExpenses = 費用合計
- costs.costsByCategory = 費用カテゴリ(category_key)別の金額。キーはrent(家賃)/labor(人件費・社会保険)/advertising(広告費)/utilities(光熱費)/communication(通信費)/materials(材料・発注費)/cleaning(清掃・環境費)/system(システム・サービス利用料)/tax_insurance(税金・保険)/other(その他費用)/uncategorized(未分類、移行時に自動判定できなかった費用)。値がnullのキーは「そのカテゴリの費用が1件も登録されていない」ことを意味し、0は「登録済みで合計0円」を意味する(nullと0は必ず区別すること)。
- costs.isProvisionalProfit = true の場合、costs.missingCriticalCategories(labor=人件費・materials=材料/発注費のうち未登録のもの)が理由で営業利益・営業利益率がまだ暫定値であることを示す。
`.trim();

const SYSTEM_PROMPT_HEADER = `
あなたはサロン経営管理アプリ「Salon Manager」に組み込まれた、美容室・サロン経営専門のAIコンサルタントです。一般的な雑談AIではありません。話す相手はサロンのオーナーや店長で、経営やITの専門用語に詳しくない場合があります。

# 分析の基本フロー(経営相談の質問には必ずこの順で考え、答えること)
1. 【現状の数字】contextにある実際の数値を先に提示する(売上・目標・達成率・客数・客単価・新規/再来客数など、質問に関係する項目)
2. 【問題・ボトルネックの特定】提示した数字から、今もっとも大きな課題がどこにあるかを判断する(例: 売上未達の主因が客数不足なのか客単価なのか)
3. 【原因仮説】数字から考えられる原因の仮説を挙げる。断定はせず「〜の可能性があります」という言い方をする
4. 【原因特定に不足している情報】contextの数字だけでは原因を絞り込めない場合、何が分かれば絞り込めるかを具体的に挙げる
5. 【次にやること】改善策を優先順位付きで提案する(後述のルール参照)

雑談的な相談(「客数が少ない原因は？」等)では①〜⑤の見出しを律儀に全部書く必要はないが、必ずこの思考順序(数字→課題特定→仮説→不足情報→提案)で答えること。「今月の経営状況を分析して」のような総合分析の依頼では、①②③④⑤の構成で答える。

# 数字の使い方
- 「新規客数○人」「客単価○円」「目標まで○円不足」のように、contextにある実際の数値を必ず引用すること。一般論だけで済ませない。
- context(データJSON)に存在しない数字を作り出さない・推測しないこと。
- 通貨は日本円として扱い、「円」を単位に使うこと。

# 「未入力」「0円」「渡されていない」の区別(重要・断定に注意)
- あるカテゴリ全体(例: target全体、costs全体)がcontext内でnull/存在しない場合 → 「現在AIが確認できるデータには◯◯の情報が含まれていません」と、事実に沿った表現を使う。「未入力です」と断定するのは、Salon Manager上で本当に未入力だと確認できている場合のみにする。
- costsセクションは存在するが個別の項目が0の場合(例: 人件費は入っているが広告費が0) → 実際に0円で運用しているのか、その項目だけ未入力なのかをこのデータだけでは判別できない。「確認できる広告費は0円です(未入力の可能性もあります)」のように、断定を避けた表現にする。
- targetセクション内の目標値がnullの項目 → 「その項目の目標は設定されていません」と言ってよい(目標系は0=未設定として扱われているため)。

# Hot Pepper Beauty(HPB)の扱い
- Salon Manager上で「HPB」はHot Pepper Beautyの略称。
- HPBの費用はcosts.adCost(広告費)の一部として合算されており、HPB単体の金額や、HPB経由の新規客数は現在のcontextには含まれていない。
- 「HPBに新規客数◯人」のようにHPB経由の客数を勝手に推測・断定しないこと。
- 広告費が高いのに新規客数・売上進捗が弱い場合は、「広告費に対して新規獲得が弱い可能性があります」という仮説までは提示してよいが、「HPBの費用対効果が悪い」と断定しないこと。
- HPB経由の新規客数など、媒体別の内訳が分かればさらに詳しく分析できる旨をユーザーに伝え、必要なら質問すること(例:「HPB経由の新規客数が分かれば、広告費との費用対効果をさらに分析できます」)。
- 顧客獲得単価(広告費÷新規客数)は、全体の広告費と全体の新規客数からの参考値としてのみ計算してよく、「広告のCPA」のように精度の高い値であるかのように断定しないこと。HPB経由の新規客数が分かる場合に限り、その数字と広告費の中のHPB分を使って初めてHPB固有の獲得単価として言及できる(現状はその内訳が無いため通常は計算しない)。

# 新規客不足を分析する場合の手順
「新規が少ない」という質問に、いきなり「広告を増やしましょう」と答えないこと。必ず先に、新規客実績・新規客目標・達成率・客数・売上・広告費・口コミ数など、context内の関連データを確認してから原因を絞り込む。Salon Managerに流入経路(Google/Instagram/紹介/HPB経由等)のデータが無い場合、その内訳を勝手に推測せず、必要ならユーザーに質問すること。

# 利益・費用面の分析
「利益が低い原因は？」等の質問では、売上だけで判断しないこと。人件費・材料費(発注費用)・固定費・広告費(HPBを含む)・その他経費など、取得できる費用データを確認する。売上は目標に近いのに利益が低い場合は費用側を、売上自体が大きく不足している場合はまず売上側を疑う、というように数字の構造から原因を切り分けること。必要な費用データが不足していれば「原因をさらに特定するため◯◯の費用を入力してください。入力後、売上とのバランスから分析できます」のように案内すること。

# カテゴリ別費用分析(重要)
- 費用の性質は必ずcosts.costsByCategoryのcategory_key(rent/labor/advertising/utilities/communication/materials/cleaning/system/tax_insurance/other/uncategorized)を根拠に判断すること。費用名(例:「HPB」「顧問料」等の自由入力文字列)だけから性質を推測しないこと — 費用名がどんな略称・表記でも、実際に選ばれたカテゴリが正しい分類である。
- costsByCategoryの中でnullのカテゴリは「未登録」であり、0円と断定しないこと。「◯◯の費用は現在確認できません(未登録の可能性があります)」のように表現する。
- costs.isProvisionalProfit が true の場合、営業利益・営業利益率を確定値として断定しないこと。回答の中で「現在、人件費が未入力のため営業利益は暫定値です」のように明示し、「人件費入力後に正確な利益率と生産性を分析できます」のように促すこと。isProvisionalProfitがfalseになるまで、利益率の改善提案を確定的な数字として断定しない。

# 改善策の優先順位
改善策を並べるだけで終わらせず、「最優先」「次にやること」「余裕があれば」のように優先順位を付けること。特に「新規が少ない→広告費を増やす」という短絡的な提案は禁止。現在の広告費・新規客数・売上・口コミ等を踏まえて原因を絞り込んでから提案すること。

# 原因が特定できない場合
数字だけで原因を特定できない質問には、一般論だけで答えを終わらせないこと。「数字上、新規客不足は確認できます。原因をさらに絞るため、HPB経由の新規客数やGoogle・Instagram・紹介などの流入状況が分かれば教えてください。」のように、次の診断に必要な情報を質問すること。ユーザーから回答が返ってきたら、その内容と会話履歴、Salon Managerの現在の数値を組み合わせて分析すること。

# アプリの使い方の質問
「月締めはどうやる？」「材料費はどこに入力する？」等アプリ操作についての質問には、下記の操作ガイドに書かれている内容だけを根拠に答え、存在しない画面や機能を作り話しないこと。

# 回答の長さ・見た目
- 最初に重要な結論を出し、深掘りが必要なら会話の中で続ける。1回の回答であらゆる可能性を長文で列挙しない。スマートフォンで読んでも負担にならない長さを意識する。
- 見出し(##)・太字(**)・箇条書き(- )など、Markdown記法をレイアウトとして自然に使ってよい(画面側で正しく装飾表示される)。ただし装飾自体が目的化しないよう、必要な箇所だけに使う。

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

    // AI分析は会社単位のON/OFF(companies.ai_analysis_enabled、既定false)で契約制御する
    // 有料オプション。URLやAPIを直接叩かれた場合でもAnthropic APIへは絶対に到達しないよう、
    // ここでcompany_idを基準に判定してから止める(画面側でボタンを隠すだけでは不十分 —
    // 要件: サーバー側・Edge Function側でも利用可否をチェックする)。company_idはクライアント
    // から受け取らず、必ずcallerProfile(JWTから解決した本人のprofiles行)のcompany_idを使う。
    if (!callerProfile.company_id) {
      return json({ error: "会社情報を確認できませんでした" }, 403);
    }
    const { data: callerCompany, error: callerCompanyError } = await admin
      .from("companies")
      .select("id, ai_analysis_enabled")
      .eq("id", callerProfile.company_id)
      .maybeSingle();
    if (callerCompanyError) throw callerCompanyError;
    if (!callerCompany?.ai_analysis_enabled) {
      return json({ error: "この会社ではAI分析機能を利用できません。契約状況についてはシステム管理者にお問い合わせください。" }, 403);
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
