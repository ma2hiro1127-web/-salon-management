-- The app has always kept daily sales figures + day-closing status only inside the
-- tenant_snapshots JSON blob (one row per company/store/month holding the *entire* app
-- state as of whichever save produced it). That design is what caused a string of data-loss
-- bugs: whichever snapshot happens to be freshest wins wholesale, so a stale or
-- differently-scoped fetch can silently omit days that were genuinely saved. daily_sales
-- already existed with proper company-scoped RLS but was never actually written to by the
-- app (syncLocalDraftToSupabase was defined but never called). This migration adds the
-- missing columns so daily_sales can become the real, row-per-day source of truth for daily
-- sales figures and day-closing state, queried and upserted directly instead of embedded in
-- a blob.
alter table public.daily_sales
  add column if not exists technical_sales_amount numeric not null default 0,
  add column if not exists other_sales_amount numeric not null default 0,
  add column if not exists repeat_customer_count integer not null default 0,
  add column if not exists is_day_closed boolean not null default false,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id),
  add column if not exists memo text not null default '',
  add column if not exists updated_by uuid references public.profiles(id);

create index if not exists daily_sales_company_store_date_idx
  on public.daily_sales (company_id, store_id, business_date);

-- No RLS changes needed: daily_sales already has company-scoped RLS from
-- 20260805130000_company_scoped_rls.sql (select: assigned store or company/system admin;
-- insert: any assigned store member, created_by must be self; update: store_manager for any
-- row in their store, staff only for rows they created themselves). New columns are governed
-- by the same row-level policies automatically.
