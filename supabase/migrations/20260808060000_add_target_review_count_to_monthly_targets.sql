-- 口コミ数目標(月間目標設定の新規オプション項目, 日次入力で口コミ数をONにした店舗のみ表示)
-- を保存するための列を追加する。既存のtarget_*列と同じnot null default 0パターンで追加する
-- だけなので、既存行は自動的に0で埋まり、既存の月間目標データを一切変更しない。RLSは既存の
-- monthly_targetsの行単位ポリシーがそのまま新しい列にも適用されるため変更不要。
alter table public.monthly_targets
  add column if not exists target_review_count numeric not null default 0;
