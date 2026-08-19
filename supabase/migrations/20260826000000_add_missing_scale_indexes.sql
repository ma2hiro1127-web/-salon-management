BEGIN;

-- テスト運用前の拡張性総点検で発覚したインデックス不足を追加する(既存データ・既存の
-- 挙動には一切影響しない、純粋な追加のみ)。100社・500店舗規模を見据えた点検で、
-- RLSのフィルタ条件・頻繁な検索条件として使われているのにインデックスが無いカラムを
-- 洗い出した結果。現時点の行数はごく小さい(数十件)ため CONCURRENTLY は使わず、他の
-- 既存マイグレーションと同じ BEGIN/COMMIT 内のCREATE INDEXで揃える(短時間のロックも
-- 実質無視できる規模)。

-- profiles.company_id: profiles_select_company_scoped等のRLSポリシーが直接フィルタに
-- 使うほか、会社管理画面の「ユーザー一覧」取得でも使われる。既存はauth_user_id/email/
-- invite_tokenのみインデックスがあり、company_id単体の検索はSeq Scanだった。
CREATE INDEX IF NOT EXISTS profiles_company_id_idx
  ON public.profiles (company_id);

-- tenant_snapshots: 全てのRLSポリシー(select/insert/update/delete)がcompany_id/store_id
-- でフィルタするが、主キー以外のインデックスが一切無かった。
CREATE INDEX IF NOT EXISTS tenant_snapshots_company_id_idx
  ON public.tenant_snapshots (company_id);

CREATE INDEX IF NOT EXISTS tenant_snapshots_store_id_idx
  ON public.tenant_snapshots (store_id);

-- user_stores.store_id: 「この店舗に所属しているユーザーは誰か」という単体検索に使われる
-- (user_stores_select/update/delete_company_scopedポリシー内)が、既存の複合ユニーク
-- (user_id, company_id, store_id)はstore_id単体の検索には使えない。
CREATE INDEX IF NOT EXISTS user_stores_store_id_idx
  ON public.user_stores (store_id);

COMMIT;
