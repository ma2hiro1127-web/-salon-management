BEGIN;

-- 「会社データを削除」ボタンはこれまでcompany_idに紐づく全テーブルを即座に物理削除していた
-- (delete-store: 関連データがあれば拒否する設計とは異なり、会社の削除は要件上あえて
-- cascade式の即時削除にしていた)。今回、誤操作対策として論理削除(soft delete)を挟む
-- 3段階(停止→削除(論理)→完全削除(物理))へ変更するため、状態を保持する列を追加する。
-- 既存の物理削除ロジック自体(delete-company Edge Function)は「完全削除」としてそのまま
-- 再利用し、論理削除済み(deleted_at is not null)の会社にしか実行できないよう制限を追加する
-- (Edge Function側で実施 — このmigrationはあくまで列の追加のみ)。

alter table public.companies
  add column if not exists free_reason text
    check (free_reason is null or free_reason in ('self', 'monitor', 'friend', 'campaign', 'other'));

alter table public.companies
  add column if not exists deleted_at timestamptz;

alter table public.companies
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

alter table public.companies
  add column if not exists deletion_scheduled_at timestamptz;

-- 自社(Fi-Ne/サロン本社)を要件通り「無料利用・理由:自社」として扱う。既存データ
-- (店舗・ユーザー・売上等)は一切変更せず、companiesの2列を更新するだけ。他の会社の
-- 契約状態には影響しない一意なUPDATE。
update public.companies
  set contract_status = 'free', free_reason = 'self'
  where name = 'サロン本社';

COMMIT;
