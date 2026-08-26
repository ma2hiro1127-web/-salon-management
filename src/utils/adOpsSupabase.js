// AI広告自動運用システム(V1)専用のSupabase CRUD。src/utils/supabase.jsを肥大化させず、
// company_id/store_idに紐づかない社内マーケティングデータだけをこのファイルに閉じる
// (要件23の独立モジュール要件)。RLSは全テーブルsystem_admin限定(20260905000000_ai_ad_ops.sql
// 参照)——このファイルの各関数はそのRLSに守られている前提で、クライアント側の追加チェックは
// 行わない(呼び出し元のUI/App.jsx側でcanManageAdOpsを必ず確認すること)。
import { supabase, isSupabaseConfigured, logSupabaseError } from "./supabase.js";

const noCompanyContext = { companyId: null, storeId: null };

// 「有料化」判定(要件8・事前確認事項)は既存のcompanies.contract_statusを流用する
// ('active'を有料とみなす、新しい課金テーブルは作らない)。system_adminはcompanies_select_
// company_scoped RLSにより全社閲覧できるため、広告ごとに紐づいたcompany_idの契約状態を
// まとめて取得できる。created_atも合わせて取得し、day_7/day_30継続判定の基準日に使う。
export const loadCompanyContractStatusesForAdOps = async () => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase.from("companies").select("id, contract_status, created_at");
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadCompanyContractStatusesForAdOps", table: "companies", ...noCompanyContext, error });
    return { ok: false, error, data: [] };
  }
};

// day_7_active/day_30_active(要件7)はcronの無いこのプロジェクトの方針(20260901010000
// 以降で確立済み: 新しいインフラを追加しない)に合わせ、保存イベントではなくクエリ時に
// 「登録日+N日以降のdaily_salesが1件でもあるか」で判定する。company_id単位で絞り込むため、
// 広告に紐づいていない会社の売上データは一切取得しない(必要最小限のみ)。
export const loadCompanyDailySalesDatesForAdOps = async ({ companyIds }) => {
  const ids = Array.from(new Set((companyIds || []).filter(Boolean)));
  if (!isSupabaseConfigured || !ids.length) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase.from("daily_sales").select("company_id, business_date").in("company_id", ids);
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadCompanyDailySalesDatesForAdOps", table: "daily_sales", ...noCompanyContext, error });
    return { ok: false, error, data: [] };
  }
};

export const loadAdCampaigns = async () => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase.from("ad_campaigns").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadAdCampaigns", table: "ad_campaigns", ...noCompanyContext, error });
    return { ok: false, error, data: [] };
  }
};

export const upsertAdCampaign = async (payload) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  try {
    const { data, error } = await supabase.from("ad_campaigns").upsert(payload).select().single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertAdCampaign", table: "ad_campaigns", ...noCompanyContext, error });
    return { ok: false, error };
  }
};

export const loadAdDailyMetrics = async () => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase.from("ad_daily_metrics").select("*").order("metric_date", { ascending: false });
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadAdDailyMetrics", table: "ad_daily_metrics", ...noCompanyContext, error });
    return { ok: false, error, data: [] };
  }
};

// 広告×日付の実績(広告費・インプレッション・クリック)を手入力で保存する(要件1・20:
// V1はMeta/TikTok API接続なし)。onConflictでupsertするため、同じ日の再入力は上書きになる。
export const upsertAdDailyMetric = async ({ adId, metricDate, spend, impressions, clicks, userId }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  try {
    const { data, error } = await supabase
      .from("ad_daily_metrics")
      .upsert(
        { ad_id: adId, metric_date: metricDate, spend: Number(spend) || 0, impressions: Number(impressions) || 0, clicks: Number(clicks) || 0, updated_by: userId },
        { onConflict: "ad_id,metric_date" }
      )
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertAdDailyMetric", table: "ad_daily_metrics", ...noCompanyContext, error });
    return { ok: false, error };
  }
};

export const loadAdConversionEvents = async () => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase.from("ad_conversion_events").select("*").order("occurred_at", { ascending: false });
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadAdConversionEvents", table: "ad_conversion_events", ...noCompanyContext, error });
    return { ok: false, error, data: [] };
  }
};

// 匿名(会員化前)のイベント記録。log_ad_conversion_event RPC(SECURITY DEFINER、
// 20260905000000_ai_ad_ops.sql)経由——anon/authenticatedどちらのセッションからも呼べる。
// event_typeはlp_view/signup_startedのみサーバー側で許可される(それ以外はRPC側で拒否)。
// ベストエフォート——失敗しても登録フロー自体は止めない(呼び出し元でエラーを握りつぶす)。
export const logAdConversionEvent = async ({ eventType, sessionId, utmSource, utmCampaign, utmContent }) => {
  if (!isSupabaseConfigured || !sessionId) return { ok: true, skipped: true };
  try {
    const { error } = await supabase.rpc("log_ad_conversion_event", {
      p_event_type: eventType,
      p_session_id: sessionId,
      p_utm_source: utmSource || "",
      p_utm_campaign: utmCampaign || "",
      p_utm_content: utmContent || "",
    });
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    logSupabaseError({ operation: "logAdConversionEvent", table: "ad_conversion_events", ...noCompanyContext, error });
    return { ok: false, error };
  }
};

export const loadAdAiEvaluations = async () => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase.from("ad_ai_evaluations").select("*").order("evaluated_at", { ascending: false });
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadAdAiEvaluations", table: "ad_ai_evaluations", ...noCompanyContext, error });
    return { ok: false, error, data: [] };
  }
};

// ai-ad-evaluation Edge Function(service-role、Anthropic Claude API呼び出し)を叩き、
// 評価結果をad_ai_evaluationsへ保存済みの状態で返す(Edge Function側が保存まで行う)。
export const runAiAdEvaluation = async ({ adId, metrics }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  const { data, error } = await supabase.functions.invoke("ai-ad-evaluation", { body: { adId, metrics } });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // ignore — fall back to error.message
    }
    return { ok: false, error: new Error(message) };
  }
  if (data?.error) {
    return { ok: false, error: new Error(data.error) };
  }
  return { ok: true, data };
};

export const loadAdBudgetSettings = async () => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true, data: null };
  try {
    const { data, error } = await supabase.from("ad_budget_settings").select("*").limit(1).maybeSingle();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "loadAdBudgetSettings", table: "ad_budget_settings", ...noCompanyContext, error });
    return { ok: false, error, data: null };
  }
};

export const upsertAdBudgetSettings = async ({ id, dailyMaxSpend, monthlyMaxSpend, maxIncreasePercent, userId }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  try {
    const { data, error } = await supabase
      .from("ad_budget_settings")
      .update({ daily_max_spend: Number(dailyMaxSpend) || 0, monthly_max_spend: Number(monthlyMaxSpend) || 0, max_increase_percent: Number(maxIncreasePercent) || 0, updated_by: userId })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "upsertAdBudgetSettings", table: "ad_budget_settings", ...noCompanyContext, error });
    return { ok: false, error };
  }
};

// 「全広告停止」ボタン(要件13)。ad_campaigns.statusを一括で'stopped'にする内部記録のみ——
// 実際の広告プラットフォームには一切反映されない。ad_budget_settings.emergency_stopped_at
// も同時に記録し、AI広告運用画面に警告バナーを常設表示できるようにする。
export const triggerEmergencyStopAllAds = async ({ settingsId, userId }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  try {
    const { error: campaignsError } = await supabase.from("ad_campaigns").update({ status: "stopped", updated_by: userId }).neq("status", "stopped");
    if (campaignsError) throw campaignsError;
    const { data, error } = await supabase
      .from("ad_budget_settings")
      .update({ emergency_stopped_at: new Date().toISOString(), updated_by: userId })
      .eq("id", settingsId)
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "triggerEmergencyStopAllAds", table: "ad_budget_settings", ...noCompanyContext, error });
    return { ok: false, error };
  }
};

export const clearEmergencyStop = async ({ settingsId, userId }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  try {
    const { data, error } = await supabase
      .from("ad_budget_settings")
      .update({ emergency_stopped_at: null, updated_by: userId })
      .eq("id", settingsId)
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "clearEmergencyStop", table: "ad_budget_settings", ...noCompanyContext, error });
    return { ok: false, error };
  }
};

export const loadAdBudgetProposals = async () => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true, data: [] };
  try {
    const { data, error } = await supabase.from("ad_budget_proposals").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return { ok: true, data: data || [] };
  } catch (error) {
    logSupabaseError({ operation: "loadAdBudgetProposals", table: "ad_budget_proposals", ...noCompanyContext, error });
    return { ok: false, error, data: [] };
  }
};

export const createAdBudgetProposal = async ({ adId, currentDailyBudget, proposedDailyBudget, reasoning }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  try {
    const { data, error } = await supabase
      .from("ad_budget_proposals")
      .insert({ ad_id: adId, current_daily_budget: Number(currentDailyBudget) || 0, proposed_daily_budget: Number(proposedDailyBudget) || 0, reasoning: reasoning || "" })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "createAdBudgetProposal", table: "ad_budget_proposals", ...noCompanyContext, error });
    return { ok: false, error };
  }
};

// 承認(approved)の場合のみ、対象広告のdaily_budgetも同時に更新する(あくまで内部記録 —
// 実際の広告プラットフォームの予算には反映されない)。
export const decideAdBudgetProposal = async ({ proposalId, adId, status, newDailyBudget, userId }) => {
  if (!isSupabaseConfigured) return { ok: true, skipped: true };
  try {
    const { data, error } = await supabase
      .from("ad_budget_proposals")
      .update({ status, decided_by: userId, decided_at: new Date().toISOString() })
      .eq("id", proposalId)
      .select()
      .single();
    if (error) throw error;
    if (status === "approved") {
      const { error: campaignError } = await supabase.from("ad_campaigns").update({ daily_budget: Number(newDailyBudget) || 0, updated_by: userId }).eq("id", adId);
      if (campaignError) throw campaignError;
    }
    return { ok: true, data };
  } catch (error) {
    logSupabaseError({ operation: "decideAdBudgetProposal", table: "ad_budget_proposals", ...noCompanyContext, error });
    return { ok: false, error };
  }
};
