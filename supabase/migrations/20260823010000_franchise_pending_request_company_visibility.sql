BEGIN;

-- 加盟店連携リクエストの通知バナー・詳細画面で「送信元の会社名を必ず表示する」ため、
-- 承認前(pending)でも、リクエストの受信側(partner_company_id側)が送信元(本部/parent側)
-- の会社の基本情報(companies行 — name/code等。業務データは一切含まない)だけを閲覧できる
-- ようにする。current_user_can_view_franchise_company()はstatus='approved'限定のため、
-- これとは別の狭い追加分岐として companies_select_company_scoped にだけ足す
-- (業務データテーブル17個は一切変更しない — 承認前は本当に何も見えないままにするため)。

drop policy if exists companies_select_company_scoped on public.companies;
create policy companies_select_company_scoped
  on public.companies
  for select to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or id in (select p.company_id from public.profiles p where p.auth_user_id = auth.uid() and p.company_id is not null and p.is_active = true)
      or public.current_user_can_view_franchise_company(id)
      or (
        public.current_user_is_company_admin()
        and id in (
          select cp.parent_company_id
          from public.company_partnerships cp
          where cp.partner_company_id in (select unnest(public.current_user_company_ids()))
            and cp.status in ('pending', 'approved')
        )
      )
    )
  );

COMMIT;
