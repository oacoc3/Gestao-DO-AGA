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
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  let session = data.session;
  const now = Date.now();
  const needsRefresh = !session || (session.expires_at && session.expires_at * 1000 - now < 60_000);
  if (needsRefresh) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw refreshError;
  }
}

// Mantém a sessão ativa ao retornar para a página
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    ensureSession().catch((e) => console.error("Falha ao renovar sessão:", e));
  }
});
