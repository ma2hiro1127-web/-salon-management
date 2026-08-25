BEGIN;

-- βテスト開始前の総点検(要件8・9)で新設する2テーブル。どちらも既存のRLSヘルパー関数
-- (current_user_company_ids/current_user_is_system_admin、20260805130000で定義済み)を
-- そのまま再利用し、新しい権限モデルは作らない。破壊的変更なし・既存テーブルへの変更なし。

-- ============================================================
-- beta_feedback: 「使い方・FAQ」画面付近に追加する不具合・改善要望の送信先(要件8)。
-- 送信は誰でも(認証済みなら)でき、閲覧はsystem_admin限定(運営側だけが確認する想定)。
-- 大規模な新規システムは不要、というβ期間中に十分な最小限のテーブル。
-- ============================================================
create table public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  -- 送信者のcompany_id/store_idは「どの会社・店舗で発生したか」の手がかりとして残すが、
  -- 会社・店舗が削除されても報告内容自体は消さない(調査価値が残るため on delete set null)。
  company_id uuid references public.companies(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  -- 要件8: 対象画面・何をしようとしたか・何が起きたか・自由記述。
  screen text,
  situation text,
  what_happened text,
  free_text text,
  app_version text,
  created_at timestamptz not null default now()
);

create index beta_feedback_company_id_idx on public.beta_feedback(company_id);
create index beta_feedback_created_at_idx on public.beta_feedback(created_at);

alter table public.beta_feedback enable row level security;

-- 送信: ログイン済みユーザーなら誰でも、必ず自分自身のprofile idをcreated_byとして
-- (なりすまし防止)、かつ自社(または未所属=company_id null)としてのみ送信できる。
create policy beta_feedback_insert_own
on public.beta_feedback for insert to authenticated
with check (
  created_by in (select id from public.profiles where auth_user_id = auth.uid() and is_active = true)
  and (
    company_id is null
    or company_id = any (public.current_user_company_ids())
    or public.current_user_is_system_admin()
  )
);

-- 閲覧: system_admin限定(β運営側の確認用)。company_admin/store_manager/staffは自分が
-- 送った内容も含め閲覧できない(送信フォームは送信専用、送信後の一覧表示はアプリ側で
-- 提供しない——閲覧UIが要件に含まれていないため、意図的にRLSでも閉じておく)。
create policy beta_feedback_select_system_admin
on public.beta_feedback for select to authenticated
using (public.current_user_is_system_admin());

-- ============================================================
-- client_diagnostic_logs: 障害調査用ログ(要件9)。「保存されなかった」「突然ログイン画面に
-- なった」等の報告を受けた際に、発生日時・user_id・company_id・store_id・対象画面・
-- 操作種別・エラー種別から原因を追跡できるようにする。売上詳細・個人情報・入力内容・
-- 認証トークン等の機密情報は一切保存しない設計(messageは既存のlogSupabaseError相当の
-- 構造化情報 = operation/table/error codeのみを組み立てて渡す、呼び出し側の責務)。
-- ============================================================
create table public.client_diagnostic_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  screen text,
  action_type text,
  error_type text,
  -- 構造化された非機密メッセージのみ(operation/table/error code程度)。売上金額・氏名・
  -- メールアドレス・トークン等を含めてはならない——強制はDB側では出来ないため、
  -- 呼び出し元(App.jsx側)の責務として徹底する。
  message text,
  created_at timestamptz not null default now()
);

create index client_diagnostic_logs_company_id_idx on public.client_diagnostic_logs(company_id);
create index client_diagnostic_logs_created_at_idx on public.client_diagnostic_logs(created_at);

alter table public.client_diagnostic_logs enable row level security;

-- 書き込み: ログイン済みユーザーなら誰でも、自分自身のprofile id(またはnull、認証確立前の
-- ログ用)としてのみ書き込める。
create policy client_diagnostic_logs_insert_own
on public.client_diagnostic_logs for insert to authenticated
with check (
  user_id is null
  or user_id in (select id from public.profiles where auth_user_id = auth.uid())
);

-- 閲覧: system_admin限定(障害調査はβ運営側が行う)。
create policy client_diagnostic_logs_select_system_admin
on public.client_diagnostic_logs for select to authenticated
using (public.current_user_is_system_admin());

-- ログ肥大化への配慮(要件9): このmigrationでは自動削除の仕組み(定期cron等)は追加しない
-- ——このアプリには既存のスケジュール実行基盤が無く、新しいインフラを今回追加することは
-- 「不要な機能追加をしない」という方針に反するため。運用上は、system_adminが定期的に
-- (例: 手動で3か月以上前の行を削除する等)保守することを想定する。created_atにインデックスが
-- あるため、その種の削除・集計クエリは効率的に実行できる。

COMMIT;
