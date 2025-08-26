// supabaseClient.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

if (!window.ENV?.SUPABASE_URL || !window.ENV?.SUPABASE_ANON_KEY) {
  throw new Error("Configure SUPABASE_URL e SUPABASE_ANON_KEY no arquivo env.js");
}

export const supabase = createClient(
  window.ENV.SUPABASE_URL,
  window.ENV.SUPABASE_ANON_KEY,
  {
    auth: {
      // Evita que abrir um link com #access_token faça login automático
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

// Garante que a sessão esteja ativa antes de cada chamada ao Supabase
export async function ensureSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error } = await supabase.auth.refreshSession();
    if (error) throw error;
  }
}
