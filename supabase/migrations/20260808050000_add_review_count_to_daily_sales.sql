-- 口コミ数(日次入力の新規オプション項目, デフォルトOFF)を保存するための列を追加する。
-- 既存のnot null default 0パターン(20260806020000_extend_daily_sales.sqlに倣う)と同じ形で
-- 追加するだけなので、既存行は自動的に0で埋まり、既存の日次売上データを一切変更しない。
-- RLSは既存のdaily_salesの行単位ポリシーがそのまま新しい列にも適用されるため変更不要。
alter table public.daily_sales
  add column if not exists review_count integer not null default 0;
