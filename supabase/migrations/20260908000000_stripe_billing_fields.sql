BEGIN;

-- Stripe決済導入(2026-09-02)。既存のcompanies列(stripe_customer_id/stripe_subscription_id/
-- subscription_status/plan/free_started_at/free_ends_at/trial_started_at/trial_ends_at/
-- contract_started_at/stopped_at/next_billing_at等)はすべて前回のタスクで追加済みのため
-- 重複作成しない。next_billing_atをStripeのcurrent_period_endとしてそのまま流用する
-- (ユーザー承認済み — 会社カードの「次回請求」表示もnext_billing_atのまま変更しない)。
--
-- 今回、本当に新しく必要な列だけを追加する(すべてnullable/デフォルト付きで既存行は無傷)。
alter table public.companies
  add column if not exists billing_interval text,
  add column if not exists current_period_start timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false;

alter table public.companies
  drop constraint if exists companies_billing_interval_check;
alter table public.companies
  add constraint companies_billing_interval_check
    check (billing_interval is null or billing_interval in ('month', 'year'));

comment on column public.companies.billing_interval is '月払い(month)/年払い(year)。Stripeサブスクリプションのinterval と同期する';
comment on column public.companies.current_period_start is '現在の請求期間の開始日(Stripeから同期)';
comment on column public.companies.cancel_at_period_end is '解約予約中かどうか(true=次回更新日に停止予定、Stripeのcancel_at_period_endと同期)';

-- Stripe Webhookイベントの冪等性を担保するテーブル。stripe_event_id列のUNIQUE制約
-- (PRIMARY KEY)そのものが「同じイベントを二度処理しない」保証の要——アプリ側のロジックの
-- 正しさに頼らず、DB制約で機械的に保証する。company_idはヒットした場合のみ記録する
-- (未知のstripe_customer_idの場合はnullのまま——既存のwebhook実装と同じ「該当会社が
-- 無ければ何もしない」方針を踏襲)。
create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  company_id uuid references public.companies(id) on delete set null,
  received_at timestamptz not null default now()
);

comment on table public.stripe_webhook_events is 'Stripe Webhookで受信済みのevent.idを記録し、同じイベントの再送を二重処理しないための冪等性テーブル。業務データは持たない';

alter table public.stripe_webhook_events enable row level security;

-- クライアントから直接読み書きする必要が一切無い(Webhook Edge Functionがservice-role経由で
-- のみ書き込む)。system_adminだけ調査目的で閲覧できるようにし、INSERT/UPDATE/DELETEの
-- ポリシーは作らない(store_status_audit_logと同じ、default-denyのread-only設計)。
create policy stripe_webhook_events_select_system_admin
  on public.stripe_webhook_events
  for select to authenticated
  using (public.current_user_is_system_admin());

COMMIT;
