-- 会社管理画面の是正(要件3・4): system_adminであっても、通常のユーザー招待フロー
-- (client側からのprofiles INSERT)経由ではsystem_admin権限を新規付与できないようにRLS
-- レベルで塞ぐ。UI側(getInvitableRoles)は既にsystem_adminを選択肢から除外しているが、
-- それはあくまで利便性のためのガードであり、このコードベースの規約(RLSこそが実際の
-- 強制力、UIは選択肢を絞るだけ)に従い、DB側でも同じ制約を掛ける。
--
-- UPDATE側(profiles_update_company_scoped)は意図的に変更しない — WITH CHECKは変更後の
-- 行全体に対して評価されるため、role列を含まない部分更新(名前変更等)であっても既存の
-- system_admin行の現在値がそのまま再評価されてしまい、「role<>'system_admin'」を単純に
-- 追加すると既存system_adminの名前変更等の無関係な更新まで拒否してしまう。UPDATE経由の
-- 昇格は既にUI側(getInvitableRoles + handleSaveUserEditのcanChangeRole)で完全に閉じている
-- — 対象ユーザーの現在roleがinvitableRolesに含まれない場合(system_adminはこの変更後
-- 常に含まれない)、role変更自体が一切送信されない。
--
-- current_user_is_system_admin()はcallerの既存profiles行(role='system_admin')を見るだけ
-- なので、この変更後もsystem_admin自身の通常業務(他社への招待)は一切妨げない —
-- 変わるのは「role='system_admin'の新規行を書き込めない」ことだけ。system_adminの
-- 新規付与は今後、直接のDB操作(管理者による手動SQL)でのみ行う。

drop policy if exists profiles_insert_company_scoped on public.profiles;
create policy profiles_insert_company_scoped
on public.profiles
for insert
to authenticated
with check (
  auth.uid() is not null
  and (
    (public.current_user_is_system_admin() and role <> 'system_admin')
    or (auth_user_id = auth.uid() and role = 'staff' and company_id is null)
    or (
      public.current_user_is_company_admin()
      and company_id in (select unnest(public.current_user_company_ids()))
      and role = any (array['staff', 'store_manager', 'company_admin'])
    )
    or (
      role = 'staff'
      and company_id in (select unnest(public.current_user_company_ids()))
      and public.current_user_is_store_manager()
    )
  )
);
