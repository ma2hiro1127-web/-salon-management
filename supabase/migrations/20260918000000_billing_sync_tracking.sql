-- 店舗追加・状態変更後のStripe請求同期(追加店舗quantity)が失敗した場合に、
-- 「トースト通知が消えたら気づけなくなる」問題を解消するための永続的な状態を追加する
-- (2026-09-18)。
--
-- billing_synced_store_count: 最後に実際にStripeへ反映(成功)した「課金対象店舗数」
-- (=addonQuantity+1)。create-checkout-session(Checkout時の初期line items)と
-- sync-store-billing-quantity(その後の店舗追加/削除時の同期)の両方が、成功した
-- タイミングでこの値を更新する。フロント側は「現在の課金対象店舗数(billableStoreCount、
-- 常にDBから即時計算)」とこの列を比較するだけで、Stripeとの不一致を判定できる——
-- 判定材料が両方とも保存済みの値であり、画面を開いた瞬間の一時的な状態に依存しない
-- (要件: 保存済みの状態から判定する)。
--
-- billing_sync_error / billing_sync_error_at: 直近の同期失敗の内容と日時。成功時は
-- 両方nullに戻す。billing_synced_store_countは失敗時には更新しない(=不一致が
-- そのまま残り続け、再同期が成功するまで警告が消えない)。
alter table public.companies
  add column if not exists billing_synced_store_count integer,
  add column if not exists billing_sync_error text,
  add column if not exists billing_sync_error_at timestamptz;

comment on column public.companies.billing_synced_store_count is
  '最後にStripeへ実際に反映(成功)した課金対象店舗数(addonQuantity+1)。現在の実店舗数(status=active件数)と食い違っていれば、Stripe側の請求数量が古いまま=同期失敗が未解決であることを示す。';
comment on column public.companies.billing_sync_error is
  '直近のStripe請求同期(sync-store-billing-quantity/create-checkout-session)失敗時のエラーメッセージ。成功時はnullに戻す。';
comment on column public.companies.billing_sync_error_at is
  '直近のStripe請求同期失敗の発生日時。成功時はnullに戻す。';
