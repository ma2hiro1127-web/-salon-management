BEGIN;

-- 20260823010000で追加した「pending/approved中の相手会社名を見せる」分岐は、受信側
-- (partner)が送信元(parent)の名前を見る方向にしか対応していなかった。RLS検証テストで
-- 発覚: 送信側(parent)が、まだ承認されていない送信済みリクエストの相手先(partner)の
-- 会社名を見られない(「送信済み・承認待ち」一覧を今後表示する上で必要)。双方向に広げる —
-- 業務データには一切関係せず、companiesテーブルの基本情報(name/code等)だけの話であり、
-- pending/approvedのどちらの当事者からも見えて問題ない。

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
          union
          select cp.partner_company_id
          from public.company_partnerships cp
          where cp.parent_company_id in (select unnest(public.current_user_company_ids()))
            and cp.status in ('pending', 'approved')
        )
      )
    )
  );

COMMIT;
