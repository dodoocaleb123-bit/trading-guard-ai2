import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

// The Manus development preview does not always inject Render build-time
// variables. Avoid constructing an invalid client in that environment; the
// production Render build still receives both values and gets the normal client.
const configuredClient = hasSupabaseConfig
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

const previewClient = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    signOut: async () => ({ error: null }),
    signInWithOAuth: async () => ({ data: { provider: null, url: null }, error: new Error("Supabase is not configured in this preview") }),
  },
} as unknown as SupabaseClient;

export const supabase = configuredClient ?? previewClient;

export const isSupabaseConfigured = hasSupabaseConfig;
