BEGIN;

-- スタッフ管理の「削除」を、物理削除ではなく論理削除にする(2026-09-04)。
-- 従来は削除時にprofiles行そのものをDELETEしていた(delete-user Edge Function)。
-- 業務データ(daily_sales等)側のcreated_by等はON DELETE SET NULLで保持されていたが、
-- 「誰が入力したか」の情報自体はnull化されて失われていた。また、同じメールアドレスを
-- 別会社から再招待する際に「以前招待済みのため招待できない」という誤ったブロックが
-- 発生していた(停止=is_active falseのユーザーが行として残り続けるため)。
--
-- ここではprofilesにdeleted_at列を追加し、削除は「deleted_atを立てるだけ」に変更する。
-- 業務データのcreated_by等はprofiles.idを指したまま(nullにならない)なので、削除後も
-- 「誰が入力したか」を辿れる(表示側は必要に応じてdeleted_atを見て「(削除済み)」等の
-- 表示に切り替えればよい)。
alter table public.profiles add column if not exists deleted_at timestamptz;
comment on column public.profiles.deleted_at is 'スタッフの論理削除日時。nullなら有効。削除後もprofiles行自体は保持し、業務データのcreated_by等の参照を壊さない';

-- email列のUNIQUE制約(1メールアドレス=1会社)を、「削除されていない行の中でだけ一意」に
-- 緩和する。これにより、削除済み(deleted_at設定済み)の行がいくら残っていても、
-- 同じメールアドレスで新しい行(別会社・別店舗への招待)を作成できるようになる。
alter table public.profiles drop constraint if exists profiles_email_key;
create unique index if not exists profiles_email_active_key on public.profiles (email) where deleted_at is null;

COMMIT;
