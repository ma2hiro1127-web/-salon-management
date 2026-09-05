BEGIN;

-- Stripe契約フローの実機検証(2026-09-12追加)。system_adminが「新規契約フローをテスト」から
-- 発行したリンク経由でセルフサインアップした使い捨ての検証用会社だけをtrueにする。
-- is_test_company(既存、運営専用の"テストサロン"本体を指すフラグ)とは別に、こちらは
-- 「その都度使い捨てで作られる契約フロー検証専用の会社」だけを区別するためのフラグで、
-- self-signup Edge FunctionがSELF_SIGNUP_TEST_KEYバイパス経由の登録でのみtrueをセットする
-- (実際の一般利用者の登録では絶対にtrueにならない)。既存のテストサロン本体
-- (id d058858f-...)はこのフラグをfalseのまま維持し、通常のテストサロンと混同しない。
alter table public.companies add column if not exists is_test_contract_run boolean not null default false;
comment on column public.companies.is_test_contract_run is 'system_adminが発行したテスト契約リンク経由でセルフサインアップされた使い捨ての契約フロー検証用会社かどうか。is_test_companyは常に併せてtrueになるが、逆(is_test_company=trueだからこちらもtrue)は成り立たない——運営専用のテストサロン本体はこちらはfalseのまま。';

COMMIT;
