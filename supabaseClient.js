// supabaseClient.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

if (!window.ENV?.SUPABASE_URL || !window.ENV?.SUPABASE_ANON_KEY) {
  throw new Error("Configure SUPABASE_URL e SUPABASE_ANON_KEY no arquivo env.js");
}

export const supabase = createClient(
  window.ENV.SUPABASE_URL,
  window.ENV.SUPABASE_ANON_KEY
);
