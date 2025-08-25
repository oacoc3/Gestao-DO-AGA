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
      // Desliga o auto-login quando há tokens na URL (evita entrar logado ao abrir o link)
      detectSessionInUrl: false,
      // Mantém sessão no storage e auto refresh como antes
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);
