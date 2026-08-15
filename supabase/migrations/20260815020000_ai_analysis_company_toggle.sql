-- AI分析機能(AI経営アシスタントのチャット、Anthropic APIを実際に呼び出す唯一の経路)を
-- 通常機能から分離し、会社単位でON/OFFできる有料オプションにする。デフォルトはfalse
-- (未契約) — このカラムを追加した時点で既存の全会社(自社Fi-Neを含む)は自動的にOFFの
-- 状態になる。company_adminではなくsystem_admin限定で管理する想定のため、companiesテーブル
-- に追加する(company_settingsはcompany_admin自身が書き込めるテーブルのため、company_admin
-- が自分でONにできてしまう置き場所は避ける — companiesのUPDATE用RLS(companies_update_
-- system_only、20260805130000_company_scoped_rls.sqlで作成済み)は既にsystem_admin限定に
-- なっているため、このカラムも自動的に同じ保護を受ける)。
alter table public.companies
  add column if not exists ai_analysis_enabled boolean not null default false;

-- 将来、company側がONの場合に限り店舗単位でも絞り込めるようにするための構造だけを先に
-- 用意しておく(要件: 「将来的な拡張として...対応できるようにしてください。ただし現時点では
-- 会社単位のON/OFFを基本仕様としてください」)。現時点ではこのカラムはどのRLS・Edge
-- Functionからも参照されない(=会社側がONであれば、店舗側の値に関わらずAI機能を使える)。
-- デフォルトをtrueにしているのはこのため — 将来ここを実際に使い始めた時、既存店舗が
-- 意図せず一律ブロックされないようにする(有効化时に必要な店舗だけ明示的にfalseにする運用を
-- 想定)。
alter table public.stores
  add column if not exists ai_analysis_enabled boolean not null default true;
