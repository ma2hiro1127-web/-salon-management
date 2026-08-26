BEGIN;

-- AI広告自動運用システム(V1)。system_admin専用の完全に独立したモジュール — どの顧客
-- company_idにも属さない社内マーケティングデータのため、既存のcompany_id/store_idスコープ型
-- RLS(current_user_company_ids()等)は使わず、全テーブル「system_adminのみ全操作可、他は
-- 一切不可」という最もシンプルな形にする。既存テーブル・既存RLSポリシーへの変更は一切ない。
--
-- V1では実際のMeta/TikTok広告への操作(入稿・停止・増額)は行わない——ここに保存される
-- status/daily_budget等はあくまでサロンマネージャー内部の記録・分析用であり、実際の広告
-- プラットフォームには一切反映されない(UI側にもその旨を明示する、要件13の安全設計)。

-- ============================================================
-- ad_campaigns: 広告1件=1行。company_idを持たない(全社共通の社内マーケティングデータ)。
-- ============================================================
create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  platform text not null default '',
  campaign_id text not null default '',
  adset_id text not null default '',
  ad_id_external text not null default '',
  creative_id text not null default '',
  creative_type text not null default '',
  -- 要件4の6軸(A:利益訴求/B:POS差別化/C:コスト訴求/D:AI訴求/E:簡単さ/F:美容室特化)。
  theme text not null default '',
  hook text not null default '',
  main_message text not null default '',
  target text not null default '',
  landing_page text not null default '',
  utm_source text not null default '',
  utm_campaign text not null default '',
  utm_content text not null default '',
  -- draft(準備中)/active(配信中)/paused(一時停止)/stopped(停止) — あくまで内部記録。
  status text not null default 'draft',
  daily_budget numeric,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ad_campaigns
  add constraint ad_campaigns_status_check check (status in ('draft', 'active', 'paused', 'stopped'));

create unique index ad_campaigns_utm_idx on public.ad_campaigns(utm_source, utm_campaign, utm_content)
  where utm_source <> '' and utm_campaign <> '' and utm_content <> '';

alter table public.ad_campaigns enable row level security;

create policy ad_campaigns_system_admin_all
  on public.ad_campaigns for all to authenticated
  using (public.current_user_is_system_admin())
  with check (public.current_user_is_system_admin());

create or replace function public.set_ad_campaigns_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger ad_campaigns_set_updated_at
  before update on public.ad_campaigns
  for each row execute function public.set_ad_campaigns_updated_at();

-- ============================================================
-- ad_daily_metrics: 広告×日付、system_admin手入力(要件1・20: V1はAPI接続なし)。
-- 広告費・インプレッション・クリックの累計値/本日値はこの表をSUM/当日抽出して都度算出する
-- (ad_campaigns側に重複保存しない、単一の真実源)。
-- ============================================================
create table public.ad_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ad_campaigns(id) on delete cascade,
  metric_date date not null,
  spend numeric not null default 0,
  impressions integer not null default 0,
  clicks integer not null default 0,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_id, metric_date)
);

create index ad_daily_metrics_ad_id_idx on public.ad_daily_metrics(ad_id);
create index ad_daily_metrics_metric_date_idx on public.ad_daily_metrics(metric_date);

alter table public.ad_daily_metrics enable row level security;

create policy ad_daily_metrics_system_admin_all
  on public.ad_daily_metrics for all to authenticated
  using (public.current_user_is_system_admin())
  with check (public.current_user_is_system_admin());

create trigger ad_daily_metrics_set_updated_at
  before update on public.ad_daily_metrics
  for each row execute function public.set_ad_campaigns_updated_at();

-- ============================================================
-- ad_conversion_events: 匿名〜会員化までの行動ログ。lp_view/signup_startedは匿名(会員化前)、
-- signup_completed以降はcompany_id/profile_idが判明した状態で記録される。
-- ============================================================
create table public.ad_conversion_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  occurred_at timestamptz not null default now(),
  session_id text not null default '',
  company_id uuid references public.companies(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  ad_id uuid references public.ad_campaigns(id) on delete set null,
  utm_source text not null default '',
  utm_campaign text not null default '',
  utm_content text not null default '',
  created_at timestamptz not null default now()
);

alter table public.ad_conversion_events
  add constraint ad_conversion_events_event_type_check check (event_type in (
    'lp_view', 'signup_started', 'signup_completed', 'onboarding_started', 'onboarding_completed',
    'first_sales_input', 'first_pl_view', 'first_ai_use', 'subscription_started'
  ));

create index ad_conversion_events_ad_id_idx on public.ad_conversion_events(ad_id);
create index ad_conversion_events_company_id_idx on public.ad_conversion_events(company_id);
create index ad_conversion_events_session_id_idx on public.ad_conversion_events(session_id);
create index ad_conversion_events_event_type_idx on public.ad_conversion_events(event_type);

alter table public.ad_conversion_events enable row level security;

-- 閲覧・直接書き込みはsystem_admin限定。匿名(会員化前)の書き込みは下のlog_ad_conversion_event
-- RPC(SECURITY DEFINER)経由のみに限定し、直接INSERTは許可しない——RPCがevent_typeを
-- lp_view/signup_startedだけに絞り、company_id/profile_idを常にnullにする安全な窓口になる。
create policy ad_conversion_events_system_admin_all
  on public.ad_conversion_events for all to authenticated
  using (public.current_user_is_system_admin())
  with check (public.current_user_is_system_admin());

-- self-signup Edge Function(service-role)がsignup_completedを記録する際に使うため、
-- authenticatedにもINSERTを許可しておく必要はない(service-roleはRLSを常にバイパスする)。
-- ここでは匿名/authenticatedの直接INSERTを一切許可しない(RPC経由のみ)。

-- ============================================================
-- log_ad_conversion_event: 匿名(会員化前)のイベント記録専用の安全な窓口。
-- get_invite_info(20260809000000)と同じ、匿名呼び出し可能なSECURITY DEFINER関数の前例に倣う。
-- event_typeをlp_view/signup_startedだけに制限し、company_id/profile_idは常にnullで記録する
-- (会員化後の紐付けはself-signup Edge Function側がservice-roleで直接行う)。
-- ad_idはutm_source+utm_campaign+utm_contentの完全一致でad_campaignsと照合して解決する。
-- ============================================================
create or replace function public.log_ad_conversion_event(
  p_event_type text,
  p_session_id text,
  p_utm_source text default '',
  p_utm_campaign text default '',
  p_utm_content text default ''
)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_ad_id uuid;
begin
  if p_event_type not in ('lp_view', 'signup_started') then
    raise exception 'invalid event_type for anonymous logging';
  end if;
  if coalesce(p_session_id, '') = '' then
    raise exception 'session_id is required';
  end if;

  select id into v_ad_id
  from public.ad_campaigns
  where utm_source = coalesce(p_utm_source, '')
    and utm_campaign = coalesce(p_utm_campaign, '')
    and utm_content = coalesce(p_utm_content, '')
    and utm_source <> ''
  limit 1;

  insert into public.ad_conversion_events (event_type, session_id, ad_id, utm_source, utm_campaign, utm_content)
  values (p_event_type, p_session_id, v_ad_id, coalesce(p_utm_source, ''), coalesce(p_utm_campaign, ''), coalesce(p_utm_content, ''));
end;
$$;
alter function public.log_ad_conversion_event(text, text, text, text, text) owner to postgres;
revoke all on function public.log_ad_conversion_event(text, text, text, text, text) from public;
grant execute on function public.log_ad_conversion_event(text, text, text, text, text) to anon, authenticated;

-- ============================================================
-- ad_ai_evaluations: AI評価の実行履歴(キャッシュ兼監査ログ)。
-- ============================================================
create table public.ad_ai_evaluations (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ad_campaigns(id) on delete cascade,
  evaluated_at timestamptz not null default now(),
  judgment text not null,
  reasoning text not null default '',
  improvement_suggestion text not null default '',
  next_ad_concept text not null default '',
  input_metrics_snapshot jsonb not null default '{}'::jsonb,
  -- 要件15: 動画生成指示(0-3秒フック等の構成)とナレーション原稿。次回広告制作にそのまま
  -- 使えるよう、評価結果と一緒に永続化する。
  video_prompt jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id)
);

alter table public.ad_ai_evaluations
  add constraint ad_ai_evaluations_judgment_check check (judgment in ('SCALE', 'KEEP', 'WATCH', 'STOP'));

create index ad_ai_evaluations_ad_id_idx on public.ad_ai_evaluations(ad_id);

alter table public.ad_ai_evaluations enable row level security;

create policy ad_ai_evaluations_system_admin_all
  on public.ad_ai_evaluations for all to authenticated
  using (public.current_user_is_system_admin())
  with check (public.current_user_is_system_admin());

-- ============================================================
-- ad_budget_settings: 単一行、予算上限設定(要件13の安全装置)。
-- ============================================================
create table public.ad_budget_settings (
  id uuid primary key default gen_random_uuid(),
  daily_max_spend numeric not null default 2000,
  monthly_max_spend numeric not null default 30000,
  max_increase_percent numeric not null default 30,
  -- 「全広告停止」ボタンの状態(内部記録のみ、実際の広告配信には影響しない)。
  emergency_stopped_at timestamptz,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.ad_budget_settings enable row level security;

create policy ad_budget_settings_system_admin_all
  on public.ad_budget_settings for all to authenticated
  using (public.current_user_is_system_admin())
  with check (public.current_user_is_system_admin());

create trigger ad_budget_settings_set_updated_at
  before update on public.ad_budget_settings
  for each row execute function public.set_ad_campaigns_updated_at();

insert into public.ad_budget_settings (daily_max_spend, monthly_max_spend, max_increase_percent) values (2000, 30000, 30);

-- ============================================================
-- ad_budget_proposals: AIによる予算変更提案の承認/却下ワークフロー(要件12)。
-- ============================================================
create table public.ad_budget_proposals (
  id uuid primary key default gen_random_uuid(),
  ad_id uuid not null references public.ad_campaigns(id) on delete cascade,
  current_daily_budget numeric not null default 0,
  proposed_daily_budget numeric not null default 0,
  reasoning text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz
);

alter table public.ad_budget_proposals
  add constraint ad_budget_proposals_status_check check (status in ('pending', 'approved', 'rejected'));

create index ad_budget_proposals_ad_id_idx on public.ad_budget_proposals(ad_id);
create index ad_budget_proposals_status_idx on public.ad_budget_proposals(status);

alter table public.ad_budget_proposals enable row level security;

create policy ad_budget_proposals_system_admin_all
  on public.ad_budget_proposals for all to authenticated
  using (public.current_user_is_system_admin())
  with check (public.current_user_is_system_admin());

COMMIT;
