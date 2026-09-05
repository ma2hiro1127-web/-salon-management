BEGIN;

-- ヘルプ・お問い合わせ機能(2026-09追加)。「使い方がわからない」はFAQへ誘導し、メール問い合わせは
-- 不具合・表示異常・契約/料金・その他に限定する。既存のcurrent_user_company_ids() /
-- current_user_is_system_admin() / current_user_profile_id()(20260805130000で定義済み)を
-- そのまま再利用し、新しい権限モデルは作らない。既存テーブル・RLS・全社/全店舗データには
-- 一切変更を加えない、追加のみのmigration。

-- ============================================================
-- support_inquiries: 問い合わせ本体。メール送信の成否に関わらず必ずここへ記録が残る
-- (要件17: メール送信だけ失敗してもDB上の問い合わせ自体は失わない)。
-- ============================================================
create table public.support_inquiries (
  -- クライアント側で生成したUUIDをそのまま主キーにする(要件18の二重送信防止の鍵にもなる:
  -- 送信ボタン連打・通信再送で同じidが再送されてもinsertは1回しか成立しない)。
  id uuid primary key,
  -- 会社・店舗・ユーザーが後で削除されても問い合わせ記録自体は残す(on delete set null、
  -- beta_feedbackと同じ方針)。氏名・会社名等は下のスナップショット列に別途保持する。
  company_id uuid references public.companies(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  category text not null check (category in ('bug', 'display_issue', 'billing', 'other')),
  message text not null check (length(btrim(message)) > 0),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  -- メール送信結果を問い合わせ本体とは独立に保持する(要件17)。DB保存とメール送信を
  -- 1つのトランザクションにしない設計のため、メール送信は後から失敗しても良い形にする。
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  -- 自動取得する付随情報(要件10)。パスワード・トークン等の機密情報は一切含まない
  -- (submit-support-inquiry Edge Function側で組み立てる非機密の文字列のみ)。
  current_page text,
  target_month text,
  user_agent text,
  current_url text,
  -- 会社名・店舗名・ユーザー名・メールアドレス・権限は、company_id/store_id/user_idが
  -- 後から変更・削除されても問い合わせ発生時点の記録として残す必要があるため、
  -- スナップショットとして別列に複製して保持する。
  company_name text,
  store_name text,
  user_name text,
  user_email text,
  user_role text,
  created_at timestamptz not null default now()
);

create index support_inquiries_company_id_idx on public.support_inquiries(company_id);
create index support_inquiries_created_at_idx on public.support_inquiries(created_at);

alter table public.support_inquiries enable row level security;

-- 送信: ログイン済みユーザーなら誰でも、必ず自分自身のprofile idをuser_idとして
-- (なりすまし防止)、かつ自社(または未所属=company_id null)としてのみ送信できる。
-- 実際の書き込みはsubmit-support-inquiry Edge Function(service role)経由で行うが、
-- 将来クライアントから直接書く経路が増えても安全なように、beta_feedbackと同じ形で
-- 通常のRLSも用意しておく(defense in depth)。
create policy support_inquiries_insert_own
on public.support_inquiries for insert to authenticated
with check (
  user_id = public.current_user_profile_id()
  and (
    company_id is null
    or company_id = any (public.current_user_company_ids())
    or public.current_user_is_system_admin()
  )
);

-- 閲覧: 自社の問い合わせのみ(要件12: 他社の問い合わせは絶対に取得できないこと)。
-- system_adminは全社の問い合わせを閲覧できる(要件12: 将来の管理画面向けに許可するが、
-- 今回は一覧・詳細UIそのものは作らない)。
create policy support_inquiries_select_own_company
on public.support_inquiries for select to authenticated
using (
  (company_id is not null and company_id = any (public.current_user_company_ids()))
  or public.current_user_is_system_admin()
);

-- ============================================================
-- support_inquiry_attachments: 添付画像のメタデータ(実体はstorageの
-- support-attachments private bucketに保存、ここにはパスとメタ情報のみを持つ)。
-- ============================================================
create table public.support_inquiry_attachments (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.support_inquiries(id) on delete cascade,
  -- RLSで問い合わせ本体へのjoinを毎回書かずに済むよう、company_idをここにも複製する
  -- (support_inquiries.company_idと常に一致させる、Edge Function側で同じ値を書き込む)。
  company_id uuid references public.companies(id) on delete set null,
  storage_path text not null,
  mime_type text,
  file_size integer,
  created_at timestamptz not null default now()
);

create index support_inquiry_attachments_inquiry_id_idx on public.support_inquiry_attachments(inquiry_id);
create index support_inquiry_attachments_company_id_idx on public.support_inquiry_attachments(company_id);

alter table public.support_inquiry_attachments enable row level security;

create policy support_inquiry_attachments_insert_own
on public.support_inquiry_attachments for insert to authenticated
with check (
  company_id is null
  or company_id = any (public.current_user_company_ids())
  or public.current_user_is_system_admin()
);

create policy support_inquiry_attachments_select_own_company
on public.support_inquiry_attachments for select to authenticated
using (
  (company_id is not null and company_id = any (public.current_user_company_ids()))
  or public.current_user_is_system_admin()
);

-- ============================================================
-- Storage: 問い合わせ添付画像専用のprivate bucket。公開URLでは一切保存しない(要件9)。
-- パスは support-attachments/{company_id}/{inquiry_id}/{ランダムファイル名} に固定し、
-- storage.objects側のRLSでパス先頭のcompany_idが自分の所属会社と一致する場合のみ
-- 読み書きを許可する——元のファイル名は使わず、アップロード側(クライアント)で
-- crypto.randomUUID()等により生成したファイル名のみを許可する運用にする。
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments',
  'support-attachments',
  false,
  5242880, -- 5MB (要件7の上限と一致させ、Storage側でも二重に強制する)
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- アップロード: 認証済みユーザーが、自分の所属会社idから始まるパスへのみアップロードできる。
-- (storage.foldername(name))[1]がuuid形式であることを正規表現で確認してからキャストする
-- ことで、不正な形式のパスではエラーで弾かれる(=拒否)ようにする。
create policy support_attachments_insert_own_company
on storage.objects for insert to authenticated
with check (
  bucket_id = 'support-attachments'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and (
    ((storage.foldername(name))[1])::uuid = any (public.current_user_company_ids())
    or public.current_user_is_system_admin()
  )
);

-- 閲覧: 自社の添付画像のみ(要件9: 他社の画像を閲覧できない・URL推測で閲覧できない・
-- 未ログインユーザーから一覧取得できない — anon roleには一切ポリシーを与えないため、
-- 未認証では読み書きとも常に拒否される)。メール添付用のSigned URL発行はEdge Function側が
-- service roleで行うため、このポリシーの対象外(service roleはRLSをバイパスする)。
create policy support_attachments_select_own_company
on storage.objects for select to authenticated
using (
  bucket_id = 'support-attachments'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and (
    ((storage.foldername(name))[1])::uuid = any (public.current_user_company_ids())
    or public.current_user_is_system_admin()
  )
);

COMMIT;
