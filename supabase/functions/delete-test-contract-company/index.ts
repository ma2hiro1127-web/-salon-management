// テスト契約フロー(is_test_contract_run=true)専用の使い捨て会社を安全に完全削除する
// (2026-09追加、system_admin限定)。
//
// 背景: 「新規契約フローをテスト」を繰り返すたびに「テスト契約サロン YYYYMMDD-HHMMSS」
// という使い捨て会社が増えていく。これを整理するための削除導線だが、以下の2つを
// 絶対に削除してはならない:
//   - 正式な検証環境である「テストサロン」(is_test_company=true だが
//     is_test_contract_run=false — このテスト契約フローで作られたものではない)
//   - 実際の顧客企業(is_test_contract_run=false)
//
// 安全設計の核心: この関数はis_test_contract_run=trueの会社にしか実行できない
// (ハードゲート、cancel-test-contractと全く同じ思想)。これにより上記2つを誤って
// 削除することは構造的に不可能になっている。
//
// 実施内容(1回の呼び出しで完結させる。使い捨てのテスト会社のため、実顧客の完全削除
// (soft-delete-company→30日待機→delete-company)のような慎重な3段階を踏む必要が無い):
//   1. Stripe側にサブスクリプションが残っていれば「先に」キャンセルする
//      (要件: Stripe Subscriptionを残したままDB上の会社だけ削除しない、を構造的に
//      保証するため、DBの削除より前に行い、失敗したらDB削除に進まない)。
//      cancel-test-contractと全く同じロジック(テストモードキーのみ使用)。
//   2. companiesに紐づく全テーブル(delete-company Edge Functionと同じテーブル一覧を
//      ここでも保持する——このリポジトリのEdge Functionは関数間でモジュールを共有しない
//      規約のため、delete-company側にテーブルを追加した場合はここにも反映すること)を
//      company_idで絞り込んで削除する。
//   3. 削除されるprofiles行のauth_user_idを事前に控えておき、companies行自体の削除後、
//      対応するauth.usersアカウントも削除する(実顧客の完全削除では意図的にauth.users
//      を残す設計だが、テストアカウントは実在の利用者がいないため削除して問題ない——
//      要件: テスト用ユーザーも孤立データが残らないように)。
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
  console.error(`[delete-test-contract-company] ${stage}`, { ...detail, timestamp: new Date().toISOString() });
}

// delete-company/index.ts の COMPANY_SCOPED_TABLES と同一(意図的な重複、上記コメント参照)。
const COMPANY_SCOPED_TABLES = [
  "cost_monthly_amounts",
  "monthly_closing_items",
  "fixed_costs",
  "variable_costs",
  "monthly_targets",
  "monthly_closings",
  "daily_sales",
  "store_business_holidays",
  "company_all_stores_holidays",
  "company_all_stores_targets",
  "store_inventory_balances",
  "store_input_settings",
  "store_profiles",
  "company_settings",
  "tenant_snapshots",
  "user_stores",
  "profiles",
  "stores",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let companyId = "";
  let confirmName = "";
  try {
    const body = await req.json();
    companyId = String(body?.companyId || "").trim();
    confirmName = String(body?.confirmName || "").trim();
  } catch {
    return json({ error: "リクエストの形式が不正です" }, 400);
  }
  if (!companyId || !confirmName) {
    return json({ error: "companyId, confirmName は必須です" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // is_test_contract_run=trueの会社は必ずSTRIPE_TEST_SECRET_KEYで作られたテストモードの
  // サブスクリプションのため、本番のライブキーは絶対に使わない(cancel-test-contractと同じ)。
  const stripeTestSecretKey = Deno.env.get("STRIPE_TEST_SECRET_KEY");
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
      .select("id, role, is_active")
      .eq("auth_user_id", callerAuth.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.is_active || callerProfile.role !== "system_admin") {
      return json({ error: "テスト契約会社の削除はシステム管理者のみ実行できます" }, 403);
    }

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, name, is_test_contract_run, stripe_customer_id, stripe_subscription_id")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) {
      return json({ error: "対象の会社が見つかりません" }, 404);
    }
    // 最重要の安全ガード: テスト契約フロー専用会社以外は絶対に削除させない
    // (正式な「テストサロン」・実際の顧客企業を構造的に保護する)。
    if (!company.is_test_contract_run) {
      return json({ error: "この会社はテスト契約フロー専用会社ではないため、この操作は実行できません" }, 403);
    }
    if (confirmName !== company.name) {
      return json({ error: "入力された会社名が一致しません" }, 400);
    }

    // 1. Stripe側のサブスクリプションを先にキャンセルする(DB削除より前に必ず行う——
    //    ここで失敗したら以降のDB削除には一切進まない)。
    let stripeSubscriptionResult: "no_subscription" | "canceled" | "already_canceled" = "no_subscription";
    if (company.stripe_subscription_id) {
      if (!stripeTestSecretKey) {
        return json({ error: "サーバー設定が不足しています(STRIPE_TEST_SECRET_KEYが未設定です)" }, 500);
      }
      const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(company.stripe_subscription_id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${stripeTestSecretKey}` },
      });
      const resJson = await res.json();
      if (!res.ok) {
        if (resJson?.error?.code === "resource_missing") {
          stripeSubscriptionResult = "already_canceled";
        } else {
          logStage("stripe_cancel_failed", { companyId, message: resJson?.error?.message });
          throw new Error(resJson?.error?.message || `Stripeサブスクリプションのキャンセルに失敗しました(${res.status})`);
        }
      } else {
        stripeSubscriptionResult = "canceled";
      }
    }

    // 2. 削除されるprofiles行のauth_user_idを、削除前に控えておく(後でauth.usersも
    //    削除するため)。
    const { data: profileRows, error: profileFetchError } = await admin
      .from("profiles")
      .select("auth_user_id")
      .eq("company_id", companyId);
    if (profileFetchError) throw profileFetchError;
    const authUserIds = (profileRows || []).map((row) => row.auth_user_id).filter(Boolean) as string[];

    // 3. company_idに紐づく全テーブルを削除(子→親の順、delete-companyと同じ考え方)。
    for (const table of COMPANY_SCOPED_TABLES) {
      const { error: deleteError } = await admin.from(table).delete().eq("company_id", companyId);
      if (deleteError) {
        logStage("related_data_delete_failed", { companyId, table, message: deleteError.message });
        throw deleteError;
      }
    }

    const { error: companyDeleteError } = await admin.from("companies").delete().eq("id", companyId);
    if (companyDeleteError) throw companyDeleteError;

    // 4. 使い捨てテストアカウント(auth.users)も削除する(ベストエフォート——個別に失敗
    //    しても、既に完了しているDB削除・Stripeキャンセルの結果は取り消さない)。
    let authUsersDeleted = 0;
    let authUserDeleteErrorCount = 0;
    for (const authUserId of authUserIds) {
      const { error: authDeleteError } = await admin.auth.admin.deleteUser(authUserId);
      if (authDeleteError) {
        authUserDeleteErrorCount += 1;
        logStage("auth_user_delete_failed", { companyId, authUserId, message: authDeleteError.message });
      } else {
        authUsersDeleted += 1;
      }
    }

    logStage("company_deleted", {
      companyId,
      companyName: company.name,
      performedBy: callerProfile.id,
      stripeSubscriptionResult,
      authUsersDeleted,
      authUserDeleteErrorCount,
    });
    return json({
      ok: true,
      deletedName: company.name,
      stripeSubscriptionResult,
      authUsersDeleted,
      authUserDeleteErrorCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "テスト契約会社の削除に失敗しました";
    logStage("unhandled_error", { companyId, message });
    return json({ error: message }, 500);
  }
});
