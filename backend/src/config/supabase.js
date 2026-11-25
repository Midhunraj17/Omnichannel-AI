import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

let supabaseAuthClient = null;

export const getSupabaseAuthClient = () => {

    if (supabaseAuthClient) {
        return supabaseAuthClient;
    }

    if (!env.supabaseUrl || !env.supabaseAnonKey) {
        throw new Error(
            'SUPABASE_URL or SUPABASE_ANON_KEY is not configured'
        );
    }

    supabaseAuthClient = createClient(
        env.supabaseUrl,
        env.supabaseAnonKey,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false
            }
        }
    );

    return supabaseAuthClient;
};