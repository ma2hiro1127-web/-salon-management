import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing Supabase env');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const row = {
  id: `diag-${Date.now()}`,
  company_id: 'diag-company',
  store_id: 'diag-store',
  target_month: '2099-03',
  created_by: 'diag-user',
  updated_at: new Date().toISOString(),
  payload: { hello: 'world' },
};

const { data, error } = await supabase.from('tenant_snapshots').insert(row).select().single();
console.log(JSON.stringify({ data, error }, null, 2));
