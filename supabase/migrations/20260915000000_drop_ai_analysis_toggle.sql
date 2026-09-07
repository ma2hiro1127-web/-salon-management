BEGIN;

-- 旧「AI分析」機能(会社単位ON/OFFで外部Anthropic APIを呼ぶチャットアシスタント、
-- ai-assistant Edge Function)を完全に廃止する。月次レビュー(monthlyReviewAnalysis.js)は
-- 入力済み数値・前月比較・定型テンプレートのみで完結する100%ローカル機能であり、この
-- カラム・トリガー条件のどちらにも依存していない(grep確認済み)ため、影響を受けない。
-- Stripeの料金設定・Customer・Subscription・Checkout・Portal・Webhookはこのマイグレーションの
-- スコープ外であり、一切変更しない。

alter table public.companies
  drop column if exists ai_analysis_enabled;

-- stores.ai_analysis_enabledは20260815020000_ai_analysis_company_toggle.sqlのコメントに
-- 明記されている通り、追加時点から現在まで実際にはどのRLS・Edge Functionからも参照されない
-- 未使用の将来拡張用プレースホルダーだった。ただし20260831000000_store_manager_can_rename_
-- own_store.sqlのBEFORE UPDATEトリガーが「store_managerが変更してはいけない列」の一つとして
-- このカラムを含めているため、カラムを落とす前にトリガー関数から該当チェックだけを取り除く
-- (status/is_active/company_id/code/daily_field_settingsの保護は既存のまま一切変更しない)。
create or replace function public.stores_restrict_store_manager_update_columns()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null or public.current_user_is_system_admin() or public.current_user_is_company_admin() then
    return new;
  end if;
  if new.status is distinct from old.status
    or new.is_active is distinct from old.is_active
    or new.company_id is distinct from old.company_id
    or new.code is distinct from old.code
    or new.daily_field_settings is distinct from old.daily_field_settings
  then
    raise exception 'store_manager can only update the store name' using errcode = '42501';
  end if;
  return new;
end;
$$;
alter function public.stores_restrict_store_manager_update_columns() owner to postgres;
revoke all on function public.stores_restrict_store_manager_update_columns() from public;

alter table public.stores
  drop column if exists ai_analysis_enabled;

COMMIT;
