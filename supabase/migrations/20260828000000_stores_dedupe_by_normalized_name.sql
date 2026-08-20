-- 同一会社内での店舗名の重複作成を防ぐ(要件: 店舗追加時の重複作成防止)。
--
-- クライアント側の事前チェック(normalizeStoreNameForDuplicateCheck、App.jsx)だけでは、
-- ボタン連打・複数端末からの同時操作による競合を防げない。DB側にも
-- 「company_id + 正規化した店舗名」の一意性を強制することで、最終防御とする。
--
-- 正規化はPostgres標準関数(lower/btrim)だけで表現できる範囲(大文字小文字・前後空白)に
-- 留める——全角/半角の統一(NFKC正規化)はPostgres標準機能・拡張無しでは実装できないため、
-- クライアント側のnormalizeStoreNameForDuplicateCheck(String.prototype.normalize("NFKC")を
-- 使える)が一次防御、この一意インデックスは「大文字小文字・前後空白だけの表記ゆれによる
-- 重複」を確実に防ぐ最終防御、という二段構えにする。
--
-- 適用前に本番DBを確認し、company_id + lower(btrim(name))が重複する行が無いことを確認済み
-- (0件)——既存データへの影響は無い。
--
-- アーカイブ済み店舗は対象外(部分インデックス、where status <> 'archived')。アーカイブ済み
-- の店舗名を再利用して新しい店舗を作ることは既存の運用上あり得るため、意図的に除外する
-- (既存のクライアント側「類似名」警告ロジックが直近有効な店舗(existingActiveStores)だけを
-- 見ているのと同じ考え方)。
create unique index if not exists stores_company_id_normalized_name_unique
  on public.stores (company_id, lower(btrim(name)))
  where status <> 'archived';
