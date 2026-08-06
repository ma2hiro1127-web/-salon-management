# Supabase remote setup

The app is already wired to use Supabase Auth and tenant snapshot persistence.

## Required live-project steps

1. Open the Supabase Dashboard for project mtjiauhliezbjjpqpvuj.
2. Go to SQL Editor and run the migration file at supabase/migrations/20260805120000_role_based_rls_policies.sql.
3. Confirm the `tenant_snapshots`, `companies`, `stores`, `profiles`, `user_stores`, `daily_sales`, and `monthly_closings` tables have the new policies enabled.
4. Sign in with a real authenticated user in the app and verify that a tenant snapshot write succeeds.

## Verification command

Run the following from the project root:

```bash
node scripts/check-supabase-write.js
```

A successful write will return a row instead of the current `42501` row-level-security error.
