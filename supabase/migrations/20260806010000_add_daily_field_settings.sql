-- Per-store visibility settings for the daily sales entry form (which optional fields to
-- show: technical sales, retail sales, customer count, new/repeat customers, memo). Date,
-- total sales, and the day-closing action are always required and are not represented here.
alter table public.stores
  add column if not exists daily_field_settings jsonb not null default '{
    "mode": "detailed",
    "fields": {
      "technicalSales": true,
      "retailSales": true,
      "customers": true,
      "newCustomers": true,
      "repeatCustomers": true,
      "memo": true
    }
  }'::jsonb;

-- No RLS changes needed: stores already has company-scoped RLS (stores_update_company_scoped
-- etc. from 20260805130000_company_scoped_rls.sql) and this is just a new column on the same
-- row, governed by the same row-level policies.
