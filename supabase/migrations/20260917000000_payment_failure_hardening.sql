-- 支払い失敗処理の本番点検で発見した2点を修正する(2026-09-17)。
--
-- 1. payment_statusの意味が二重化していた不具合の修正:
--    invoice.payment_failed は payment_status='error' を書き、customer.subscription.updated
--    (status=past_due) は payment_status='processing' を書いていた。両イベントは同じ
--    「支払いに問題がある」状態に対して通常ほぼ同時に届くため、どちらが後から届くかで
--    'error'/'processing' が交互に上書きされ、意味の無い状態遷移になっていた。
--    Stripe自身の用語(past_due)に統一し、値を1つに絞る。
alter table public.companies
  drop constraint if exists companies_payment_status_check;
alter table public.companies
  add constraint companies_payment_status_check
    check (payment_status is null or payment_status in ('past_due'));

comment on column public.companies.payment_status is
  'null=正常 / past_due=支払いに問題があり確認が必要(Stripeの再試行期間中)。1回の失敗だけではcontract_statusをsuspendedにしない(要件)ための補助表示専用。';

-- 2. Webhookイベントの到着順が前後した場合に、古いイベントで新しい状態を上書きしない
--    ようにするための基準値。customer.subscription.*/invoice.* いずれかを処理するたびに、
--    そのStripeイベント自体のcreated(Stripeがイベントを生成した時刻)をここへ記録し、
--    次に届いたイベントのcreatedがこれより古ければ適用をスキップする。
alter table public.companies
  add column if not exists last_billing_event_at timestamptz;

comment on column public.companies.last_billing_event_at is
  '最後に契約状態(contract_status/subscription_status/payment_status等)へ反映した Stripe Webhookイベントのevent.created(Stripeが発行した時刻)。Webhookの到着順が前後しても、これより古いイベントは適用しない(要件: 古いイベントで最新状態を上書きしない)。';
