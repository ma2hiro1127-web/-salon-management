BEGIN;

-- Stripe契約フロー実機検証(2026-09追加)。決済完了後にStripeから戻った直後の一瞬
-- (ページ再読み込み直後、Supabaseセッションがまだ確立していない可能性がある段階)の
-- 実際の状態(URL・sessionStorageマーカーの有無・見つかったセッションの種別)を追跡する
-- ため、ログイン前(anonロール)でも書き込めるようにする。既存のclient_diagnostic_logs_
-- insert_own(20260902000000)がauthenticatedロールでuser_id is nullの行を許可している
-- のと全く同じ制限(user_id/company_id/store_idはnullのみ)を、anonロールにも広げるだけ
-- ——閲覧はこれまでどおりsystem_admin限定のまま変更しない。機微情報を含まない診断用の
-- テーブルという既存の設計方針(migration 20260902000000のコメント参照)は維持する。
create policy client_diagnostic_logs_insert_anon
on public.client_diagnostic_logs for insert to anon
with check (
  company_id is null
  and store_id is null
  and user_id is null
);

COMMIT;
