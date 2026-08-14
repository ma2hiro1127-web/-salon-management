BEGIN;

-- store_managerが自分の管理するスタッフの招待状態(再招待・停止/再開・編集)をprofilesへ直接
-- UPDATEできるようにする。profiles_update_company_scopedはこれまでsystem_admin/company_admin
-- のみを許可しており、store_managerの分岐が無かったため、店長が自分で招待したスタッフに対して
-- 「招待メール再送」(refreshInviteState経由のUPDATE)・「停止/再開」・「編集」を行うと常にRLSで
-- 拒否されていた(招待フロー整理の一環で発見したバグ)。current_user_managed_staff_ids()は
-- 既にprofiles_select_company_scoped(20260809030000_fix_cross_table_recursion.sql)で使われて
-- いる「自分が管理する店舗に所属するスタッフのprofiles.id一覧」を返す関数で、それをそのまま
-- 再利用する(cross-table recursionを避けるため、raw joinではなくSECURITY DEFINER関数経由に
-- する既存の設計を踏襲)。
drop policy if exists profiles_update_company_scoped on public.profiles;
create policy profiles_update_company_scoped
  on public.profiles
  for update to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
        and role <> 'system_admin'
      )
      or (
        public.current_user_is_store_manager()
        and role = 'staff'
        and id = any(public.current_user_managed_staff_ids())
      )
    )
  )
  with check (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
        and role <> 'system_admin'
      )
      or (
        public.current_user_is_store_manager()
        and role = 'staff'
        and id = any(public.current_user_managed_staff_ids())
      )
    )
  );

-- store_managerが自分の招待した未登録スタッフ(auth_user_idがまだ無いprofiles行)を取り消せる
-- ようにする(招待フロー整理の要件10「招待取消」、および招待作成の途中(user_stores紐付け)で
-- 失敗した際にprofiles側だけをロールバックするための削除)。auth_user_idが既に設定されている
-- 行(=実際に登録済みのユーザー)を店長が削除する操作は、admin.auth.admin.deleteUserによる
-- auth側の後始末が必要なため、引き続きdelete-user Edge Function(サービスロール)経由でのみ
-- 行う — このRLSはあくまで「まだAuthユーザーが存在しない、対象外にできる招待中の行」だけを
-- 直接削除できるようにする用途のもの。
drop policy if exists profiles_delete_company_scoped on public.profiles;
create policy profiles_delete_company_scoped
  on public.profiles
  for delete to authenticated
  using (
    auth.uid() is not null and (
      public.current_user_is_system_admin()
      or (
        public.current_user_is_company_admin()
        and company_id in (select unnest(public.current_user_company_ids()))
        and role <> 'system_admin'
      )
      or (
        public.current_user_is_store_manager()
        and role = 'staff'
        and auth_user_id is null
        and id = any(public.current_user_managed_staff_ids())
      )
    )
  );

-- 上のRLSは「store_managerがUPDATEできる行」を絞るだけで、その行のどの列をどんな値に変更して
-- よいかまでは絞れない(WITH CHECKはNEW行全体に対する条件のため、role='staff'のままなら他の
-- どの列を書き換えても通ってしまう)。company_admin向けに既にある
-- enforce_profile_company_admin_update_rules()と同じ考え方で、store_managerにも
-- 「roleをstaff以外に変更できない」「auth_user_id/company_idを変更できない」制約を追加する
-- (URLや入力値を書き換えても権限昇格できないようにする、招待フロー整理の要件8と同じ趣旨)。
create or replace function public.enforce_profile_company_admin_update_rules()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  is_system_admin boolean;
  is_company_admin boolean;
  is_store_manager boolean;
begin
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.is_active = true
      and p.role = 'system_admin'
  ) into is_system_admin;

  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.is_active = true
      and p.role = 'company_admin'
  ) into is_company_admin;

  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.is_active = true
      and p.role = 'store_manager'
  ) into is_store_manager;

  if not is_system_admin and is_company_admin then
    if coalesce(new.role, '') not in ('staff', 'store_manager') then
      raise exception 'company_admin can only assign staff or store_manager roles';
    end if;

    if new.auth_user_id is distinct from old.auth_user_id then
      raise exception 'company_admin cannot change auth_user_id';
    end if;

    if new.company_id is distinct from old.company_id then
      raise exception 'company_admin cannot change company_id';
    end if;
  end if;

  if not is_system_admin and not is_company_admin and is_store_manager then
    if coalesce(new.role, '') <> 'staff' or coalesce(old.role, '') <> 'staff' then
      raise exception 'store_manager can only update staff profiles and cannot change role';
    end if;

    if new.auth_user_id is distinct from old.auth_user_id then
      raise exception 'store_manager cannot change auth_user_id';
    end if;

    if new.company_id is distinct from old.company_id then
      raise exception 'store_manager cannot change company_id';
    end if;
  end if;

  return new;
end;
$$;
alter function public.enforce_profile_company_admin_update_rules() owner to postgres;
revoke all on function public.enforce_profile_company_admin_update_rules() from public;
grant execute on function public.enforce_profile_company_admin_update_rules() to authenticated;
-- profiles_company_admin_update_guardトリガーは既に上の関数を参照して定義済み(20260805130000)
-- なので、create or replace functionだけで新しいロジックが即座に有効になる。

COMMIT;
