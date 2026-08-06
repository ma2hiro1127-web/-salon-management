-- Inspect all current RLS policies in public schema.
select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  permissive,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- Inspect helper functions related to current user context.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like 'current_user_%'
  or p.proname = 'profile_company_id_for_profile'
order by p.proname;
