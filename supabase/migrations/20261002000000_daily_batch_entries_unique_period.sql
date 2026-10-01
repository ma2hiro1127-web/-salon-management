BEGIN;

-- 池袋店2026年8月の「まとめて入力」3重登録不具合の恒久対策。
--
-- 根本原因: daily_batch_entriesには店舗+対象期間の一意制約が無く、保存処理
-- (createDailyBatchEntry)も常にinsert()のみだった。フロント側には二重送信ガード
-- (runWithSaveGuard/batchFormBusy)があるが、これは「同一ボタンへの連打・二重タップ」
-- のような同期的な多重実行だけを防ぐもので、「保存完了後に(成功通知が無く分かりにくい
-- ため)ユーザーが再度保存ボタンを押す」「通信再送」「複数タブ・複数端末からの操作」の
-- ような、時間差で発生する複数回の正当な保存リクエストまでは防げない設計だった。
-- そのため、同じ店舗・同じ期間への保存が複数回実行されると、その都度新しい行が
-- 作られてしまっていた(dailyBatchEntries側のeditフロー以外で保存した場合は常にinsert)。
--
-- 対策: store_id + start_date + end_date を対象期間の一意キーとしてDB側に制約を設け、
-- アプリ側もinsertからupsert(onConflict: store_id,start_date,end_date)へ変更する。
-- これにより、同じ期間への保存が何度実行されても常に同じ1行に収束し(2回目以降は
-- 自動的に更新になる)、フロント側のガードをすり抜けるケースが万一あってもDB側で
-- 重複が作られることが無くなる。

-- Step 1: 制約追加に先立ち、既存の「全ての業務データ列が完全に一致する」真の重複行
-- (事故的な多重保存の結果であり、情報の差分が無い)だけを安全に収束させる。
-- 1つでも値が異なる行(意図的な編集履歴である可能性がある)は対象外とし、その場合は
-- 次のstep 2の制約追加がエラーで失敗するため、個別の手動確認が必要になる
-- (黙って推測で削除しない)。created_atが最も古い行(=最初の正当な保存)を残し、
-- それ以外の完全一致コピーだけを削除する。
with duplicate_groups as (
  select
    store_id, start_date, end_date,
    sales_amount, technical_sales_amount, retail_sales_amount, other_sales_amount,
    customer_count, new_customer_count, repeat_customer_count, review_count,
    cash_amount, cashless_amount, point_amount, memo,
    array_agg(id order by created_at asc, id asc) as ids_oldest_first
  from public.daily_batch_entries
  group by store_id, start_date, end_date,
    sales_amount, technical_sales_amount, retail_sales_amount, other_sales_amount,
    customer_count, new_customer_count, repeat_customer_count, review_count,
    cash_amount, cashless_amount, point_amount, memo
  having count(*) > 1
)
delete from public.daily_batch_entries d
using duplicate_groups g
where d.id = any(g.ids_oldest_first[2:array_length(g.ids_oldest_first, 1)]);

-- Step 2: 一意制約を追加する(ここでまだ値の異なる重複行が残っていればエラーで止まる)。
alter table public.daily_batch_entries
  add constraint daily_batch_entries_store_period_unique unique (store_id, start_date, end_date);

-- Step 3: upsert経由の更新(2回目以降の保存)でもcreated_at/created_by(最初に保存した
-- 記録)が上書きされないよう、既存のupdated_at自動更新トリガーを拡張する。
-- supabase-jsのupsert()はonConflict時に渡した列を丸ごとUPDATE SETするため、
-- 何もしなければ2回目の保存でcreated_by/created_atが「再保存した人・再保存した時刻」に
-- 書き換わってしまう——このトリガーで常にOLDの値へ戻すことで、何度upsertされても
-- 「最初に作成した人・作成日時」の記録を保持する。
create or replace function public.set_daily_batch_entries_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if tg_op = 'UPDATE' then
    new.created_at = old.created_at;
    new.created_by = old.created_by;
  end if;
  return new;
end;
$$;

COMMIT;
