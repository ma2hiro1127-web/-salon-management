BEGIN;

-- 契約管理の拡張(無料利用/トライアル/契約中/停止中それぞれの日付管理・Stripe連携準備)。
-- 既存のcompanies.contract_status('free'/'trial'/'active'/'suspended')・free_reasonは
-- そのまま維持し、値の追加・変更は一切行わない。ここでは状態が「いつ始まったか」
-- 「いつ課金が始まる予定か」等を保持する列を追加するだけ(すべてnullable・デフォルト無し
-- =既存行は自動的にnullのままで、既存データへの影響は一切無い)。
alter table public.companies
  add column if not exists free_started_at timestamptz,
  add column if not exists free_ends_at timestamptz,
  add column if not exists contract_started_at timestamptz,
  add column if not exists stopped_at timestamptz,
  add column if not exists billing_starts_at timestamptz,
  add column if not exists next_billing_at timestamptz,
  add column if not exists current_price_id text,
  add column if not exists current_price_amount integer,
  add column if not exists payment_status text;

alter table public.companies
  drop constraint if exists companies_payment_status_check;
alter table public.companies
  add constraint companies_payment_status_check
    check (payment_status is null or payment_status in ('processing', 'error'));

comment on column public.companies.free_started_at is '無料利用を開始した日時(直近の遷移で更新)';
comment on column public.companies.free_ends_at is '無料利用終了日(任意。nullなら期限を決めない無料利用)';
comment on column public.companies.contract_started_at is '直近で「契約中」になった日時';
comment on column public.companies.stopped_at is '直近で「停止中」になった日時';
comment on column public.companies.billing_starts_at is '課金開始予定日。無料/停止中からの契約中への変更は「翌月1日」、トライアルからの変更は「トライアル終了日の翌日」で計算する(update-company-status Edge Function参照)';
comment on column public.companies.next_billing_at is 'Stripeから同期する次回請求予定日(次回invoice)';
comment on column public.companies.current_price_id is '現在のStripe Price ID。コードへ固定せず会社ごとに保持し、料金変更時は新しいPriceへ切り替える運用を想定';
comment on column public.companies.current_price_amount is '表示用の現在の月額(円)。Stripe Webhookから同期';
comment on column public.companies.payment_status is 'null=正常 / processing=支払い確認中(Stripeの再試行期間中) / error=支払いエラー。1回の失敗だけではcontract_statusをsuspendedにしない(要件)ための補助表示専用';

-- 課金開始日ルールを1箇所で管理するためのDB関数(将来ルールを変える場合はここだけ
-- create or replaceすればよい。update-company-status Edge Functionからrpc()で呼ぶ)。
-- 「無料利用/停止中 → 契約中」に変更した場合、変更した月の翌月1日(JST基準)を返す。
-- 例: 2026-09-15に変更 → 2026-10-01。2026-10-01ちょうどに変更した場合も「翌月」の
-- 2026-11-01を返す(常に「変更した月の次の月の1日」という単純なルールを維持するため)。
create or replace function public.compute_billing_start_date(change_at timestamptz)
returns date
language sql
immutable
as $$
  select (date_trunc('month', change_at at time zone 'Asia/Tokyo') + interval '1 month')::date;
$$;

comment on function public.compute_billing_start_date(timestamptz) is '「無料利用/停止中→契約中」変更時の課金開始予定日(変更月の翌月1日、JST基準)を返す。ルール変更時はこの関数をcreate or replaceする';

-- トライアル期間を1箇所で管理するためのDB関数(現状は1か月固定)。
create or replace function public.compute_trial_end_date(start_at timestamptz)
returns date
language sql
immutable
as $$
  select ((start_at at time zone 'Asia/Tokyo') + interval '1 month')::date;
$$;

comment on function public.compute_trial_end_date(timestamptz) is 'トライアル開始日時からトライアル終了日(現状1か月後、JST基準)を返す。トライアル期間を変える場合はこの関数をcreate or replaceする';

COMMIT;
