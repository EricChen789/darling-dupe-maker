// Hybrid client: Auth → Supabase, Data → D1 (via Pages Functions API)
import { createClient } from '@supabase/supabase-js';
import { createHybridClient } from '@/lib/d1Api';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabaseClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});

// Export hybrid client: uses Supabase for auth/storage/rpc, D1 for all data queries
export const supabase = createHybridClient(supabaseClient);