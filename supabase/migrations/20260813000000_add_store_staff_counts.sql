-- 店舗の「在籍スタッフ数」「生産性計算人数(1人あたり月間売上の計算に使うFTE)」を
-- store_profiles(店舗ごとのプロフィール、store_id主キー)に追加する。既存カラム・既存行の
-- 変更/削除は行わない。not null default 0 のため、既存店舗は自動的に0(=未設定)で埋まる。
alter table public.store_profiles
  add column if not exists staff_count integer not null default 0,
  add column if not exists productivity_staff_count numeric not null default 0;
