// 会社の契約状態(無料利用/トライアル/契約中/停止中)、および無料利用理由(free_reason)を
// 変更する。system_admin限定 — companiesのUPDATE自体はcompanies_update_system_only RLSで
// 既にsystem_admin以外は拒否されるが、他のEdge Function群(update-store-status等)と同じ
// 規約でサーバー側でも明示的に再検証する。
//
// targetStatusを指定した場合は状態遷移(下のALLOWED_TRANSITIONS参照)。freeReasonは
// targetStatusが"free"の時だけ一緒に保存され、"free"以外へ遷移する際は自動的にクリアする
// (無料利用でなくなった会社に古い理由が残り続けるのを防ぐ)。targetStatusを省略しfreeReason
// だけ渡した場合は、現在既に"free"の会社の理由だけを更新する(状態遷移は起こさない)。
//
// 2026-09-02追記(契約管理の拡張): 状態遷移のたびに、その状態に入った日時を該当カラムへ
// 記録する(free_started_at/trial_started_at/contract_started_at/stopped_at)。
// "active"(契約中)へ遷移する際は、課金開始予定日(billing_starts_at)を合わせて計算する:
//   - トライアルから契約中への遷移かつtrial_ends_atが未来の場合
//     → トライアル終了日の翌日(Stripe自体のtrial_end満了に合わせた自然な日付、
//        DB関数は使わずここでシンプルに計算する)
//   - それ以外(無料利用・停止中からの遷移) → compute_billing_start_date()
//     (「変更した月の翌月1日」、DB関数として1箇所にルールを持たせている。将来ルールを
//     変えるときはこのDB関数(migration側)を直すだけでよい設計)
// "free"へ遷移する際は、任意のfreeEndsAt(無料利用終了日、未設定でも良い)を受け付ける。
//
// 権限: 通常はsystem_adminのみ全会社・全遷移を許可。例外として、company_adminは
// 「自社を停止中→契約中(再契約)」のときだけ自分で実行できる(停止中ゲート画面の
// 「契約を再開する」ボタン用)。それ以外のcompany_adminからの呼び出しは従来通り403。
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
  console.error(`[update-company-status] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

const VALID_STATUSES = ["free", "trial", "active", "suspended"];
const VALID_FREE_REASONS = ["self", "monitor", "friend", "campaign", "other"];

// 現在の状態 -> 遷移可能な状態の一覧。要件で明示された組み合わせのみを許可する
// (例: 契約中からトライアルへ戻す遷移は要件に含まれていないため許可しない)。
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  free: ["active", "suspended"],
  trial: ["active", "free", "suspended"],
  active: ["suspended", "free"],
  suspended: ["active", "free", "trial"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let companyId = "";
  let targetStatus = "";
  let freeReason: string | null | undefined;
  let freeEndsAt: string | null | undefined;
  try {
    const body = await req.json();
    companyId = String(body?.companyId || "").trim();
    targetStatus = String(body?.targetStatus || "").trim();
    // freeReasonが未指定(undefined)なら「今回は理由を変更しない」、nullまたは空文字なら
    // 「理由を消す」、それ以外は候補一覧のいずれかである必要がある。
    if (body?.freeReason !== undefined) {
      const raw = body.freeReason === null ? "" : String(body.freeReason).trim();
      freeReason = raw || null;
    }
    // freeEndsAtも同様: 未指定なら変更しない、null/空文字なら「終了日なし」に設定する。
    if (body?.freeEndsAt !== undefined) {
      const raw = body.freeEndsAt === null ? "" : String(body.freeEndsAt).trim();
      freeEndsAt = raw || null;
    }
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!companyId) {
    return json({ error: "companyId は必須です" }, 400);
  }
  if (!targetStatus && freeReason === undefined) {
    return json({ error: "targetStatus または freeReason のいずれかが必要です" }, 400);
  }
  if (targetStatus && !VALID_STATUSES.includes(targetStatus)) {
    return json({ error: "不正な契約状態です" }, 400);
  }
  if (freeReason && !VALID_FREE_REASONS.includes(freeReason)) {
    return json({ error: "不正な無料利用理由です" }, 400);
  }
  if (freeEndsAt && Number.isNaN(new Date(freeEndsAt).getTime())) {
    return json({ error: "無料利用終了日の形式が不正です" }, 400);
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
      .select("id, role, is_active, company_id")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active) {
      return json({ error: "会社の契約状態を変更する権限がありません" }, 403);
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, name, contract_status, trial_ends_at, deleted_at")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) {
      return json({ error: "対象の会社が見つかりません" }, 404);
    }
    if (company.deleted_at) {
      return json({ error: "削除済みの会社の契約状態は変更できません。先に復元してください" }, 409);
    }

    const currentStatus = company.contract_status || "trial";

    // 権限判定: system_adminのみ。
    // 以前は「company_adminが自社を停止中→契約中へセルフサービスで再開できる」例外
    // (停止中ゲート画面の旧「契約を再開する」ボタン用)を設けていたが、これは実際の
    // 支払いを一切伴わずに"active"へ変更できてしまう抜け道だったため、Stripe決済導入時
    // (2026-09-02)に廃止した。再契約はStripe Checkout(create-checkout-session Edge
    // Function、実際の決済とWebhookでの状態同期を伴う)経由に一本化している。
    const isSystemAdmin = callerProfile.role === "system_admin";
    if (!isSystemAdmin) {
      return json({ error: "会社の契約状態を変更する権限がありません" }, 403);
    }

    // targetStatus省略時: 現在すでに"free"の会社の理由だけを更新する(状態遷移なし)。
    // (この経路はsystem_admin限定のまま — isSelfServiceReactivationはtargetStatus必須のため
    // ここへは到達しない。)
    if (!targetStatus) {
      if (!isSystemAdmin) {
        return json({ error: "会社の契約状態を変更する権限がありません" }, 403);
      }
      if (currentStatus !== "free") {
        return json({ error: "無料利用理由は「無料利用」状態の会社にのみ設定できます" }, 409);
      }
      const { data: reasonOnlyRow, error: reasonOnlyError } = await admin
        .from("companies")
        .update({ free_reason: freeReason ?? null, updated_at: new Date().toISOString() })
        .eq("id", companyId)
        .select(
          "contract_status, free_reason, free_started_at, free_ends_at, trial_started_at, trial_ends_at, contract_started_at, stopped_at, billing_starts_at"
        )
        .single();
      if (reasonOnlyError) throw reasonOnlyError;
      // targetStatus指定時のレスポンス(下)と同じ形(snake_caseのままDB行をそのまま返す)に
      // 揃えている——呼び出し元(src/utils/supabase.jsのupdateCompanyContractStatus)が
      // どちらの経路でも同じキーで読めるようにするため。
      return json({ ok: true, ...reasonOnlyRow });
    }

    if (currentStatus === targetStatus) {
      return json({ error: "既にその契約状態です" }, 409);
    }
    if (!(ALLOWED_TRANSITIONS[currentStatus] || []).includes(targetStatus)) {
      return json({ error: `この会社は現在「${currentStatus}」のため、その契約状態へは変更できません` }, 409);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const patch: Record<string, unknown> = {
      contract_status: targetStatus,
      free_reason: targetStatus === "free" ? (freeReason ?? null) : null,
      updated_at: nowIso,
    };

    if (targetStatus === "free") {
      patch.free_started_at = nowIso;
      // freeEndsAtが未指定(undefined)なら既存値を保持、指定されていれば(nullも含め)反映する。
      if (freeEndsAt !== undefined) {
        patch.free_ends_at = freeEndsAt;
      }
    } else if (targetStatus === "trial") {
      patch.trial_started_at = nowIso;
      const { data: trialEnd, error: trialEndError } = await admin.rpc("compute_trial_end_date", {
        start_at: nowIso,
      });
      if (trialEndError) throw trialEndError;
      patch.trial_ends_at = trialEnd;
    } else if (targetStatus === "active") {
      patch.contract_started_at = nowIso;
      const trialEndsAt = company.trial_ends_at ? new Date(company.trial_ends_at) : null;
      if (currentStatus === "trial" && trialEndsAt && trialEndsAt.getTime() > now.getTime()) {
        // トライアル終了日の翌日を課金開始予定日にする(Stripe自体のtrial_end満了に
        // 合わせた自然な日付。翌月1日ルールのDB関数はここでは使わない)。
        const nextDay = new Date(trialEndsAt.getTime() + 24 * 60 * 60 * 1000);
        patch.billing_starts_at = nextDay.toISOString().slice(0, 10);
      } else {
        const { data: billingStart, error: billingStartError } = await admin.rpc("compute_billing_start_date", {
          change_at: nowIso,
        });
        if (billingStartError) throw billingStartError;
        patch.billing_starts_at = billingStart;
      }
    } else if (targetStatus === "suspended") {
      patch.stopped_at = nowIso;
    }

    // company_id・関連データには一切触れない。契約状態と、上で組み立てた日付フィールドの
    // 列を更新するだけ。free以外へ遷移する場合は理由を自動的にクリアする(古い理由が
    // 残り続けないように)。.select()して実際にDBへ入った値を返す(上のコメント参照)。
    const { data: updatedRow, error: updateError } = await admin
      .from("companies")
      .update(patch)
      .eq("id", companyId)
      .select(
        "contract_status, free_reason, free_started_at, free_ends_at, trial_started_at, trial_ends_at, contract_started_at, stopped_at, billing_starts_at"
      )
      .single();
    if (updateError) throw updateError;

    return json({ ok: true, ...updatedRow });
  } catch (error) {
    const message = error instanceof Error ? error.message : "会社の契約状態変更に失敗しました";
    logStage("unhandled_error", { companyId, targetStatus, message });
    return json({ error: message }, 500);
  }
});
