BEGIN;

-- Every created_by/updated_by/closed_by column referencing profiles(id) was NO ACTION (the
-- Postgres default), meaning deleting a profile would fail outright with a foreign key
-- violation the moment that user had ever entered a single daily_sales row, fixed cost, month
-- close, etc. That's the opposite of what's needed: staff must be deletable from the app once
-- they leave, but the business records they created (sales, targets, costs, closings...) must
-- survive — only the "who did this" attribution is allowed to go away. Switching these to
-- ON DELETE SET NULL is exactly that: the row stays, the column that pointed at the deleted
-- profile just becomes null. user_stores.user_id is deliberately left as CASCADE (unchanged) —
-- a deleted user's store *assignments* have no historical value of their own once the user is
-- gone, unlike the sales/cost/closing data they entered.

alter table public.company_all_stores_holidays
  drop constraint company_all_stores_holidays_created_by_fkey,
  add constraint company_all_stores_holidays_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.company_all_stores_targets
  drop constraint company_all_stores_targets_updated_by_fkey,
  add constraint company_all_stores_targets_updated_by_fkey
    foreign key (updated_by) references public.profiles(id) on delete set null;

alter table public.company_settings
  drop constraint company_settings_updated_by_fkey,
  add constraint company_settings_updated_by_fkey
    foreign key (updated_by) references public.profiles(id) on delete set null;

alter table public.daily_sales
  drop constraint daily_sales_closed_by_fkey,
  add constraint daily_sales_closed_by_fkey
    foreign key (closed_by) references public.profiles(id) on delete set null;
alter table public.daily_sales
  drop constraint daily_sales_created_by_fkey,
  add constraint daily_sales_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.daily_sales
  drop constraint daily_sales_updated_by_fkey,
  add constraint daily_sales_updated_by_fkey
    foreign key (updated_by) references public.profiles(id) on delete set null;

alter table public.fixed_costs
  drop constraint fixed_costs_created_by_fkey,
  add constraint fixed_costs_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.fixed_costs
  drop constraint fixed_costs_updated_by_fkey,
  add constraint fixed_costs_updated_by_fkey
    foreign key (updated_by) references public.profiles(id) on delete set null;

alter table public.monthly_closing_items
  drop constraint monthly_closing_items_created_by_fkey,
  add constraint monthly_closing_items_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.monthly_closing_items
  drop constraint monthly_closing_items_updated_by_fkey,
  add constraint monthly_closing_items_updated_by_fkey
    foreign key (updated_by) references public.profiles(id) on delete set null;

alter table public.monthly_closings
  drop constraint monthly_closings_closed_by_fkey,
  add constraint monthly_closings_closed_by_fkey
    foreign key (closed_by) references public.profiles(id) on delete set null;

alter table public.monthly_targets
  drop constraint monthly_targets_updated_by_fkey,
  add constraint monthly_targets_updated_by_fkey
    foreign key (updated_by) references public.profiles(id) on delete set null;

alter table public.store_business_holidays
  drop constraint store_business_holidays_created_by_fkey,
  add constraint store_business_holidays_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.store_profiles
  drop constraint store_profiles_updated_by_fkey,
  add constraint store_profiles_updated_by_fkey
    foreign key (updated_by) references public.profiles(id) on delete set null;

alter table public.variable_costs
  drop constraint variable_costs_created_by_fkey,
  add constraint variable_costs_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.variable_costs
  drop constraint variable_costs_updated_by_fkey,
  add constraint variable_costs_updated_by_fkey
    foreign key (updated_by) references public.profiles(id) on delete set null;

COMMIT;
