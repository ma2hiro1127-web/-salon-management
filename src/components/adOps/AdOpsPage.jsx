import { useEffect, useMemo, useState } from "react";
import {
  loadAdCampaigns, upsertAdCampaign,
  loadAdDailyMetrics, upsertAdDailyMetric,
  loadAdConversionEvents,
  loadAdAiEvaluations, runAiAdEvaluation,
  loadAdBudgetSettings, upsertAdBudgetSettings, triggerEmergencyStopAllAds, clearEmergencyStop,
  loadAdBudgetProposals, createAdBudgetProposal, decideAdBudgetProposal,
  loadCompanyContractStatusesForAdOps, loadCompanyDailySalesDatesForAdOps,
} from "../../utils/adOpsSupabase.js";
import { calculateAdCpa, calculateAdRates, classifyWinningAd, validateBudgetProposal } from "../../utils/adOps.js";
import { money, number, formatMoneyOrDash, formatPercentOrDash } from "../../utils/storage.js";
import { getSupabaseErrorMessage } from "../../utils/supabase.js";

// AI広告自動運用システム(V1)。system_admin専用の完全に独立したページ(要件2・23)。
// V1ではMeta/TikTok広告APIへは一切接続しない——ここに保存される数値・状態は全てサロン
// マネージャー内部の記録・分析用であり、実際の広告プラットフォームには一切反映されない
// (要件13の安全設計を実際の誤操作から守るため、画面全体に常設の注意書きを表示する)。

const THEME_OPTIONS = [
  { key: "A_profit", label: "A: 利益訴求" },
  { key: "B_pos", label: "B: POSとの差別化" },
  { key: "C_cost", label: "C: コスト訴求" },
  { key: "D_ai", label: "D: AI訴求" },
  { key: "E_easy", label: "E: 簡単さ" },
  { key: "F_specialized", label: "F: 美容室特化" },
];
const themeLabel = (key) => THEME_OPTIONS.find((t) => t.key === key)?.label || key || "未設定";

const STATUS_LABELS = { draft: "準備中", active: "配信中", paused: "一時停止", stopped: "停止" };

const todayIso = () => new Date().toISOString().slice(0, 10);
const sum = (values) => values.reduce((total, value) => total + (Number(value) || 0), 0);

const emptyAdForm = { platform: "", campaignId: "", adsetId: "", adIdExternal: "", creativeId: "", creativeType: "", theme: "", hook: "", mainMessage: "", target: "", landingPage: "", utmSource: "", utmCampaign: "", utmContent: "", dailyBudget: "" };

export default function AdOpsPage({ userId }) {
  const [ads, setAds] = useState([]);
  const [dailyMetrics, setDailyMetrics] = useState([]);
  const [conversionEvents, setConversionEvents] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [budgetSettings, setBudgetSettings] = useState(null);
  const [budgetProposals, setBudgetProposals] = useState([]);
  const [companyStatusById, setCompanyStatusById] = useState({});
  const [dailySalesDatesByCompany, setDailySalesDatesByCompany] = useState({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [selectedAdId, setSelectedAdId] = useState("");
  const [adForm, setAdForm] = useState(emptyAdForm);
  const [metricDraft, setMetricDraft] = useState({ spend: "", impressions: "", clicks: "" });
  const [evaluationRunning, setEvaluationRunning] = useState(false);
  const [budgetSettingsDraft, setBudgetSettingsDraft] = useState({ dailyMaxSpend: "", monthlyMaxSpend: "", maxIncreasePercent: "" });
  const [proposalDraft, setProposalDraft] = useState({ proposedDailyBudget: "", reasoning: "" });

  const reloadAll = async () => {
    setLoading(true);
    const [adsResult, metricsResult, eventsResult, evaluationsResult, settingsResult, proposalsResult, statusResult] = await Promise.all([
      loadAdCampaigns(), loadAdDailyMetrics(), loadAdConversionEvents(), loadAdAiEvaluations(),
      loadAdBudgetSettings(), loadAdBudgetProposals(), loadCompanyContractStatusesForAdOps(),
    ]);
    if (adsResult.ok) setAds(adsResult.data);
    if (metricsResult.ok) setDailyMetrics(metricsResult.data);
    if (eventsResult.ok) setConversionEvents(eventsResult.data);
    if (evaluationsResult.ok) setEvaluations(evaluationsResult.data);
    if (settingsResult.ok && settingsResult.data) {
      setBudgetSettings(settingsResult.data);
      setBudgetSettingsDraft({
        dailyMaxSpend: String(settingsResult.data.daily_max_spend ?? ""),
        monthlyMaxSpend: String(settingsResult.data.monthly_max_spend ?? ""),
        maxIncreasePercent: String(settingsResult.data.max_increase_percent ?? ""),
      });
    }
    if (proposalsResult.ok) setBudgetProposals(proposalsResult.data);
    if (statusResult.ok) {
      setCompanyStatusById(Object.fromEntries(statusResult.data.map((row) => [row.id, row])));
    }
    // signup_completedイベントに紐づくcompany_idだけを対象にdaily_salesを取得する
    // (要件7のday_7/day_30継続判定、クエリ時計算——保存イベント・cronは使わない)。
    const companyIds = (eventsResult.data || [])
      .filter((event) => event.event_type === "signup_completed" && event.company_id)
      .map((event) => event.company_id);
    if (companyIds.length) {
      const salesResult = await loadCompanyDailySalesDatesForAdOps({ companyIds });
      if (salesResult.ok) {
        const byCompany = {};
        salesResult.data.forEach((row) => {
          if (!byCompany[row.company_id]) byCompany[row.company_id] = [];
          byCompany[row.company_id].push(row.business_date);
        });
        setDailySalesDatesByCompany(byCompany);
      }
    }
    setLoading(false);
  };

  // マウント時の1回だけのデータ取得(React公式ドキュメントが明示的に認めているuseEffectの
  // 用途——外部システム(Supabase)から初期データを取得して同期する)。reloadAllは各種保存
  // 操作後の再取得にも再利用するため、named関数のまま呼び出す。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- マウント時の初期データ取得(React公式が認める用途)、prop変化への追従ではない
    reloadAll();
  }, []);

  // 広告ごとの集計サマリー(要件3・8・9)。spend/impressions/clicksはad_daily_metrics(手入力)
  // の合算、registrations以降はad_conversion_eventsのイベント種別カウント、有料化は
  // companies.contract_status='active'(事前確認事項で合意した既存流用)から判定する。
  const adSummaries = useMemo(() => {
    return ads.map((ad) => {
      const metricsForAd = dailyMetrics.filter((m) => m.ad_id === ad.id);
      const spend = sum(metricsForAd.map((m) => m.spend));
      const impressions = sum(metricsForAd.map((m) => m.impressions));
      const clicks = sum(metricsForAd.map((m) => m.clicks));
      const eventsForAd = conversionEvents.filter((e) => e.ad_id === ad.id);
      const signupCompleted = eventsForAd.filter((e) => e.event_type === "signup_completed");
      const registrations = signupCompleted.length;
      const onboardingCompleted = eventsForAd.filter((e) => e.event_type === "onboarding_completed").length;
      const aiUsed = eventsForAd.filter((e) => e.event_type === "first_ai_use").length;
      const attributedCompanyIds = signupCompleted.map((e) => e.company_id).filter(Boolean);
      const paidUsers = attributedCompanyIds.filter((id) => companyStatusById[id]?.contract_status === "active").length;
      // Stripe未導入(事前確認事項)のため売上は常に0円 — 有料化件数・有料CPAまでが今回の
      // 実装範囲で、ARPU/ROASはStripe接続後に意味のある値になる(最終報告に明記)。
      const revenue = 0;
      const day7Active = attributedCompanyIds.filter((id) => hasDailySalesAfterSignup(id, dailySalesDatesByCompany[id], signupCompleted, 7)).length;
      const day30Active = attributedCompanyIds.filter((id) => hasDailySalesAfterSignup(id, dailySalesDatesByCompany[id], signupCompleted, 30)).length;
      const { registrationCpa, paidCpa } = calculateAdCpa({ spend, registrations, paidUsers });
      const rates = calculateAdRates({ spend, impressions, clicks, registrations, onboardingCompleted, paidUsers, revenue });
      const todayMetric = metricsForAd.find((m) => m.metric_date === todayIso());
      return {
        ad, spend, impressions, clicks, registrations, onboardingCompleted, aiUsed, paidUsers, revenue,
        day7Active, day30Active, registrationCpa, paidCpa, ...rates,
        todaySpend: Number(todayMetric?.spend) || 0, todayImpressions: Number(todayMetric?.impressions) || 0, todayClicks: Number(todayMetric?.clicks) || 0,
      };
    });
  }, [ads, dailyMetrics, conversionEvents, companyStatusById, dailySalesDatesByCompany]);

  const todaySummary = useMemo(() => {
    const todayConversions = conversionEvents.filter((e) => (e.occurred_at || "").slice(0, 10) === todayIso());
    return {
      spend: sum(adSummaries.map((s) => s.todaySpend)),
      impressions: sum(adSummaries.map((s) => s.todayImpressions)),
      clicks: sum(adSummaries.map((s) => s.todayClicks)),
      registrations: todayConversions.filter((e) => e.event_type === "signup_completed").length,
      onboardingCompleted: todayConversions.filter((e) => e.event_type === "onboarding_completed").length,
    };
  }, [adSummaries, conversionEvents]);
  const todayRates = calculateAdRates({
    spend: todaySummary.spend, impressions: todaySummary.impressions, clicks: todaySummary.clicks,
    registrations: todaySummary.registrations, onboardingCompleted: todaySummary.onboardingCompleted, paidUsers: 0, revenue: 0,
  });

  const winningAd = useMemo(() => classifyWinningAd(adSummaries.map((s) => ({ id: s.ad.id, paidCpa: s.paidCpa }))), [adSummaries]);
  const sortedByPaidCpa = useMemo(
    () => [...adSummaries].sort((a, b) => (a.paidCpa === null ? Infinity : a.paidCpa) - (b.paidCpa === null ? Infinity : b.paidCpa)),
    [adSummaries]
  );

  const selectedSummary = adSummaries.find((s) => s.ad.id === selectedAdId) || null;
  const selectedEvaluations = evaluations.filter((e) => e.ad_id === selectedAdId);
  const latestEvaluation = selectedEvaluations[0] || null;
  const pendingProposals = budgetProposals.filter((p) => p.status === "pending");

  const handleCreateAd = async (event) => {
    event.preventDefault();
    if (!adForm.platform || !adForm.theme) {
      setNotice("プラットフォームとテーマは必須です");
      return;
    }
    const result = await upsertAdCampaign({
      platform: adForm.platform, campaign_id: adForm.campaignId, adset_id: adForm.adsetId, ad_id_external: adForm.adIdExternal,
      creative_id: adForm.creativeId, creative_type: adForm.creativeType, theme: adForm.theme, hook: adForm.hook,
      main_message: adForm.mainMessage, target: adForm.target, landing_page: adForm.landingPage,
      utm_source: adForm.utmSource, utm_campaign: adForm.utmCampaign, utm_content: adForm.utmContent,
      daily_budget: adForm.dailyBudget ? Number(adForm.dailyBudget) : null,
      status: "draft", created_by: userId, updated_by: userId,
    });
    if (!result.ok) {
      setNotice(getSupabaseErrorMessage(result.error));
      return;
    }
    setAdForm(emptyAdForm);
    await reloadAll();
  };

  const handleUpdateAdStatus = async (ad, status) => {
    const result = await upsertAdCampaign({ id: ad.id, status, updated_by: userId });
    if (!result.ok) {
      setNotice(getSupabaseErrorMessage(result.error));
      return;
    }
    await reloadAll();
  };

  const handleSaveMetric = async () => {
    if (!selectedAdId) return;
    const result = await upsertAdDailyMetric({
      adId: selectedAdId, metricDate: todayIso(), spend: metricDraft.spend, impressions: metricDraft.impressions, clicks: metricDraft.clicks, userId,
    });
    if (!result.ok) {
      setNotice(getSupabaseErrorMessage(result.error));
      return;
    }
    setMetricDraft({ spend: "", impressions: "", clicks: "" });
    await reloadAll();
  };

  const handleRunEvaluation = async () => {
    if (!selectedAdId || !selectedSummary || evaluationRunning) return;
    setEvaluationRunning(true);
    try {
      const result = await runAiAdEvaluation({
        adId: selectedAdId,
        metrics: {
          spend: selectedSummary.spend, ctr: selectedSummary.ctr, cpc: selectedSummary.cpc,
          registrationRate: selectedSummary.registrationRate, onboardingCompletionRate: selectedSummary.onboardingCompletionRate,
          day7ActiveRate: selectedSummary.registrations ? (selectedSummary.day7Active / selectedSummary.registrations) * 100 : null,
          aiUsageCount: selectedSummary.aiUsed, paidConversionRate: selectedSummary.paidConversionRate,
          paidCpa: selectedSummary.paidCpa, arpu: selectedSummary.arpu, registrations: selectedSummary.registrations, paidUsers: selectedSummary.paidUsers,
        },
      });
      if (!result.ok) {
        setNotice(getSupabaseErrorMessage(result.error));
        return;
      }
      await reloadAll();
    } finally {
      setEvaluationRunning(false);
    }
  };

  const handleCreateProposal = async () => {
    if (!selectedAdId || !selectedSummary) return;
    const currentDailyBudget = Number(selectedSummary.ad.daily_budget) || 0;
    const proposedDailyBudget = Number(proposalDraft.proposedDailyBudget) || 0;
    const validation = validateBudgetProposal({
      current: currentDailyBudget, proposed: proposedDailyBudget,
      maxIncreasePercent: budgetSettings?.max_increase_percent, dailyMaxSpend: budgetSettings?.daily_max_spend,
    });
    if (!validation.ok) {
      setNotice(validation.reason);
      return;
    }
    const result = await createAdBudgetProposal({
      adId: selectedAdId, currentDailyBudget, proposedDailyBudget, reasoning: proposalDraft.reasoning,
    });
    if (!result.ok) {
      setNotice(getSupabaseErrorMessage(result.error));
      return;
    }
    setProposalDraft({ proposedDailyBudget: "", reasoning: "" });
    await reloadAll();
  };

  const handleDecideProposal = async (proposal, status) => {
    const result = await decideAdBudgetProposal({ proposalId: proposal.id, adId: proposal.ad_id, status, newDailyBudget: proposal.proposed_daily_budget, userId });
    if (!result.ok) {
      setNotice(getSupabaseErrorMessage(result.error));
      return;
    }
    await reloadAll();
  };

  const handleSaveBudgetSettings = async () => {
    if (!budgetSettings?.id) return;
    const result = await upsertAdBudgetSettings({
      id: budgetSettings.id, dailyMaxSpend: budgetSettingsDraft.dailyMaxSpend, monthlyMaxSpend: budgetSettingsDraft.monthlyMaxSpend,
      maxIncreasePercent: budgetSettingsDraft.maxIncreasePercent, userId,
    });
    if (!result.ok) {
      setNotice(getSupabaseErrorMessage(result.error));
      return;
    }
    await reloadAll();
  };

  const handleEmergencyStop = async () => {
    if (!budgetSettings?.id) return;
    if (!window.confirm("すべての広告を内部記録上「停止」にします(実際の広告プラットフォームの配信は止まりません)。よろしいですか？")) return;
    const result = await triggerEmergencyStopAllAds({ settingsId: budgetSettings.id, userId });
    if (!result.ok) {
      setNotice(getSupabaseErrorMessage(result.error));
      return;
    }
    await reloadAll();
  };

  const handleClearEmergencyStop = async () => {
    if (!budgetSettings?.id) return;
    const result = await clearEmergencyStop({ settingsId: budgetSettings.id, userId });
    if (!result.ok) {
      setNotice(getSupabaseErrorMessage(result.error));
      return;
    }
    await reloadAll();
  };

  if (loading) {
    return <div className="stack"><div className="empty-card">読み込み中…</div></div>;
  }

  return (
    <div className="stack ad-ops-page">
      <section className="panel ad-ops-disclaimer">
        <p className="helper-text">
          <strong>この画面はサロンマネージャー内部の記録・分析専用です。</strong>
          実際の広告の作成・入稿・停止・金額変更は、Meta/TikTok等の各広告プラットフォームの管理画面で行ってください。
          このページの「停止する」「予算を反映」等の操作は、実際の広告配信には一切反映されません(V1、要件20)。
        </p>
      </section>

      {notice ? <div className="notice-box error">{notice}</div> : null}

      {budgetSettings?.emergency_stopped_at ? (
        <section className="panel ad-ops-disclaimer">
          <p className="helper-text danger-text">
            緊急停止中です({new Date(budgetSettings.emergency_stopped_at).toLocaleString("ja-JP")})。全広告の内部ステータスが「停止」になっています。
          </p>
          <button type="button" className="secondary-button" onClick={handleClearEmergencyStop}>緊急停止を解除</button>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">TODAY</p><h2>本日の状況</h2></div></div>
        <div className="summary-grid">
          <div className="summary-card"><span>広告費</span><strong>{money(todaySummary.spend)}</strong></div>
          <div className="summary-card"><span>インプレッション</span><strong>{number(todaySummary.impressions)}</strong></div>
          <div className="summary-card"><span>クリック</span><strong>{number(todaySummary.clicks)}</strong></div>
          <div className="summary-card"><span>CTR</span><strong>{formatPercentOrDash(todayRates.ctr, todayRates.ctr !== null)}</strong></div>
          <div className="summary-card"><span>CPC</span><strong>{formatMoneyOrDash(todayRates.cpc, todayRates.cpc !== null)}</strong></div>
          <div className="summary-card"><span>無料登録</span><strong>{number(todaySummary.registrations)}</strong></div>
          <div className="summary-card"><span>登録率</span><strong>{formatPercentOrDash(todayRates.registrationRate, todayRates.registrationRate !== null)}</strong></div>
          <div className="summary-card"><span>初期設定完了</span><strong>{number(todaySummary.onboardingCompleted)}</strong></div>
        </div>
      </section>

      {winningAd ? (
        <section className="panel">
          <div className="panel-heading"><div><p className="eyebrow">WINNING</p><h2>勝ち広告</h2></div></div>
          {(() => {
            const summary = adSummaries.find((s) => s.ad.id === winningAd.id);
            if (!summary) return null;
            return (
              <div className="summary-grid">
                <div className="summary-card"><span>広告</span><strong>{summary.ad.hook || summary.ad.campaign_id || "(無題)"}</strong></div>
                <div className="summary-card"><span>有料CPA</span><strong>{formatMoneyOrDash(summary.paidCpa, summary.paidCpa !== null)}</strong></div>
                <div className="summary-card"><span>有料化率</span><strong>{formatPercentOrDash(summary.paidConversionRate, summary.paidConversionRate !== null)}</strong></div>
              </div>
            );
          })()}
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">ADS</p><h2>広告一覧（有料CPA順）</h2></div></div>
        <div className="ad-ops-list">
          {sortedByPaidCpa.length === 0 ? <div className="empty-card">広告がまだ登録されていません。下のフォームから追加してください。</div> : null}
          {sortedByPaidCpa.map((summary) => {
            const isStopCandidate = summary.registrations > 0 && summary.paidUsers === 0 && summary.spend > 0 && summary.paidCpa === null;
            return (
              <button
                key={summary.ad.id}
                type="button"
                className={`ad-ops-list-item${selectedAdId === summary.ad.id ? " active" : ""}`}
                onClick={() => setSelectedAdId(summary.ad.id)}
              >
                <div>
                  <strong>{summary.ad.hook || summary.ad.campaign_id || "(無題)"}</strong>
                  <small>{themeLabel(summary.ad.theme)} ・ {STATUS_LABELS[summary.ad.status] || summary.ad.status}</small>
                </div>
                <div className="ad-ops-list-item-metrics">
                  <span>有料CPA {formatMoneyOrDash(summary.paidCpa, summary.paidCpa !== null)}</span>
                  {winningAd?.id === summary.ad.id ? <span className="ad-ops-badge win">勝ち広告</span> : null}
                  {isStopCandidate ? <span className="ad-ops-badge stop">停止候補</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">NEW</p><h2>広告を追加</h2></div></div>
        <form className="inline-form" onSubmit={handleCreateAd}>
          <input value={adForm.platform} onChange={(e) => setAdForm((p) => ({ ...p, platform: e.target.value }))} placeholder="プラットフォーム(例: Instagram)" />
          <select value={adForm.theme} onChange={(e) => setAdForm((p) => ({ ...p, theme: e.target.value }))}>
            <option value="">テーマを選択</option>
            {THEME_OPTIONS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <input value={adForm.hook} onChange={(e) => setAdForm((p) => ({ ...p, hook: e.target.value }))} placeholder="フック(コピー冒頭)" />
          <input value={adForm.mainMessage} onChange={(e) => setAdForm((p) => ({ ...p, mainMessage: e.target.value }))} placeholder="メインメッセージ" />
          <input value={adForm.utmSource} onChange={(e) => setAdForm((p) => ({ ...p, utmSource: e.target.value }))} placeholder="utm_source" />
          <input value={adForm.utmCampaign} onChange={(e) => setAdForm((p) => ({ ...p, utmCampaign: e.target.value }))} placeholder="utm_campaign" />
          <input value={adForm.utmContent} onChange={(e) => setAdForm((p) => ({ ...p, utmContent: e.target.value }))} placeholder="utm_content" />
          <button type="submit" className="primary-button">追加</button>
        </form>
      </section>

      {selectedSummary ? (
        <section className="panel">
          <div className="panel-heading">
            <div><p className="eyebrow">DETAIL</p><h2>{selectedSummary.ad.hook || selectedSummary.ad.campaign_id || "広告詳細"}</h2></div>
          </div>

          <div className="segmented-control" role="group" aria-label="広告ステータス">
            {["draft", "active", "paused", "stopped"].map((status) => (
              <button
                key={status}
                type="button"
                className={selectedSummary.ad.status === status ? "segmented-button active" : "segmented-button"}
                onClick={() => handleUpdateAdStatus(selectedSummary.ad, status)}
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>

          <div className="summary-grid">
            <div className="summary-card"><span>広告費(累計)</span><strong>{money(selectedSummary.spend)}</strong></div>
            <div className="summary-card"><span>インプレッション</span><strong>{number(selectedSummary.impressions)}</strong></div>
            <div className="summary-card"><span>クリック</span><strong>{number(selectedSummary.clicks)}</strong></div>
            <div className="summary-card"><span>CTR</span><strong>{formatPercentOrDash(selectedSummary.ctr, selectedSummary.ctr !== null)}</strong></div>
            <div className="summary-card"><span>CPC</span><strong>{formatMoneyOrDash(selectedSummary.cpc, selectedSummary.cpc !== null)}</strong></div>
            <div className="summary-card"><span>無料登録</span><strong>{number(selectedSummary.registrations)}</strong></div>
            <div className="summary-card"><span>登録CPA</span><strong>{formatMoneyOrDash(selectedSummary.registrationCpa, selectedSummary.registrationCpa !== null)}</strong></div>
            <div className="summary-card"><span>初期設定完了</span><strong>{number(selectedSummary.onboardingCompleted)}</strong></div>
            <div className="summary-card"><span>7日継続</span><strong>{number(selectedSummary.day7Active)}</strong></div>
            <div className="summary-card"><span>30日継続</span><strong>{number(selectedSummary.day30Active)}</strong></div>
            <div className="summary-card"><span>有料化</span><strong>{number(selectedSummary.paidUsers)}</strong></div>
            <div className="summary-card emphasize"><span>有料顧客CPA</span><strong>{formatMoneyOrDash(selectedSummary.paidCpa, selectedSummary.paidCpa !== null)}</strong></div>
          </div>
          <p className="helper-text">売上・ARPU・ROASはStripe未導入のため現在0円で表示されます(Stripe接続後に実数値になります)。</p>

          <div className="panel-heading compact"><div><h3>本日の実績を入力</h3></div></div>
          <p className="helper-text">V1はMeta/TikTok API未接続のため、広告費・インプレッション・クリック数は手入力です。</p>
          <div className="inline-form">
            <label className="field"><span>広告費</span><input type="number" value={metricDraft.spend} onChange={(e) => setMetricDraft((p) => ({ ...p, spend: e.target.value }))} /></label>
            <label className="field"><span>インプレッション</span><input type="number" value={metricDraft.impressions} onChange={(e) => setMetricDraft((p) => ({ ...p, impressions: e.target.value }))} /></label>
            <label className="field"><span>クリック</span><input type="number" value={metricDraft.clicks} onChange={(e) => setMetricDraft((p) => ({ ...p, clicks: e.target.value }))} /></label>
            <button type="button" className="secondary-button" onClick={handleSaveMetric}>本日分を保存</button>
          </div>

          <div className="panel-heading compact"><div><h3>AI評価</h3></div></div>
          <button type="button" className="primary-button" disabled={evaluationRunning} onClick={handleRunEvaluation}>
            {evaluationRunning ? "評価中…" : "AI評価を実行"}
          </button>
          {latestEvaluation ? (
            <div className="setup-card" style={{ marginTop: 12 }}>
              <p><strong>判定: {latestEvaluation.judgment}</strong>（{new Date(latestEvaluation.evaluated_at).toLocaleString("ja-JP")}）</p>
              <p className="helper-text">{latestEvaluation.reasoning}</p>
              <p><strong>改善案:</strong> {latestEvaluation.improvement_suggestion}</p>
              <p><strong>次の広告案:</strong> {latestEvaluation.next_ad_concept}</p>
              {latestEvaluation.video_prompt && Object.keys(latestEvaluation.video_prompt).length ? (
                <details>
                  <summary>動画生成指示・ナレーション原稿</summary>
                  <p>0-3秒(フック): {latestEvaluation.video_prompt.hook_0_3s}</p>
                  <p>3-6秒(問題提示): {latestEvaluation.video_prompt.problem_3_6s}</p>
                  <p>6-10秒(画面): {latestEvaluation.video_prompt.screen_6_10s}</p>
                  <p>10-13秒(AIコンサル): {latestEvaluation.video_prompt.ai_consult_10_13s}</p>
                  <p>13-15秒(価格・CTA): {latestEvaluation.video_prompt.price_cta_13_15s}</p>
                  <p>ナレーション原稿: {latestEvaluation.video_prompt.narration_script}</p>
                </details>
              ) : null}
            </div>
          ) : <p className="helper-text">まだAI評価を実行していません。</p>}

          <div className="panel-heading compact"><div><h3>予算変更を提案</h3></div></div>
          <div className="inline-form">
            <label className="field"><span>1日の提案予算</span><input type="number" value={proposalDraft.proposedDailyBudget} onChange={(e) => setProposalDraft((p) => ({ ...p, proposedDailyBudget: e.target.value }))} /></label>
            <label className="field"><span>理由</span><input value={proposalDraft.reasoning} onChange={(e) => setProposalDraft((p) => ({ ...p, reasoning: e.target.value }))} placeholder="例: 有料CPAが目標を下回っているため" /></label>
            <button type="button" className="secondary-button" onClick={handleCreateProposal}>提案を作成</button>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">BUDGET</p><h2>予算提案の承認</h2></div></div>
        {pendingProposals.length === 0 ? <div className="empty-card">承認待ちの予算提案はありません。</div> : null}
        {pendingProposals.map((proposal) => {
          const ad = ads.find((a) => a.id === proposal.ad_id);
          return (
            <div key={proposal.id} className="setup-card" style={{ marginBottom: 12 }}>
              <p><strong>{ad?.hook || ad?.campaign_id || "広告"}</strong></p>
              <p>現在 {money(proposal.current_daily_budget)} → 提案 {money(proposal.proposed_daily_budget)}</p>
              <p className="helper-text">理由: {proposal.reasoning}</p>
              <div className="button-row">
                <button type="button" className="primary-button" onClick={() => handleDecideProposal(proposal, "approved")}>承認</button>
                <button type="button" className="secondary-button" onClick={() => handleDecideProposal(proposal, "rejected")}>却下</button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">SAFETY</p><h2>予算上限・安全装置</h2></div></div>
        <div className="inline-form">
          <label className="field"><span>1日最大広告費</span><input type="number" value={budgetSettingsDraft.dailyMaxSpend} onChange={(e) => setBudgetSettingsDraft((p) => ({ ...p, dailyMaxSpend: e.target.value }))} /></label>
          <label className="field"><span>月間最大広告費</span><input type="number" value={budgetSettingsDraft.monthlyMaxSpend} onChange={(e) => setBudgetSettingsDraft((p) => ({ ...p, monthlyMaxSpend: e.target.value }))} /></label>
          <label className="field"><span>1回の増額上限(%)</span><input type="number" value={budgetSettingsDraft.maxIncreasePercent} onChange={(e) => setBudgetSettingsDraft((p) => ({ ...p, maxIncreasePercent: e.target.value }))} /></label>
          <button type="button" className="secondary-button" onClick={handleSaveBudgetSettings}>保存</button>
        </div>
        <button type="button" className="danger-button" onClick={handleEmergencyStop}>全広告を緊急停止（内部記録のみ）</button>
      </section>
    </div>
  );
}

// 対象会社に、登録日(signup_completedイベントのoccurred_at)からN日以降のdaily_sales行が
// 1件でもあるかを判定する(要件7、cronの無いこのプロジェクトの方針に合わせクエリ時計算)。
function hasDailySalesAfterSignup(companyId, dailySalesDates, signupCompletedEvents, days) {
  const signupEvent = (signupCompletedEvents || []).find((e) => e.company_id === companyId);
  if (!signupEvent || !Array.isArray(dailySalesDates)) return false;
  const thresholdDate = new Date(signupEvent.occurred_at);
  thresholdDate.setDate(thresholdDate.getDate() + days);
  const thresholdIso = thresholdDate.toISOString().slice(0, 10);
  return dailySalesDates.some((date) => date >= thresholdIso);
}
