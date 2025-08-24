// netlify/functions/adminUsers.js
// API para o módulo Administração
// - Requer usuário logado com app_metadata.perfil === "Administrador"
// - Usa tabela `profiles` (id = auth.users.id)
// - Depende das variáveis de ambiente no Netlify:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(url, service, { auth: { persistSession: false } });
const supabaseAnon  = createClient(url, anon,    { auth: { persistSession: false } });

// Ajustado para sua base:
const TABLE = "profiles";  // antes era app_profiles
const KEY_ID = "id";       // antes era user_id

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS"
  }
});

function getCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  const parts = raw.split(";").map(s => s.trim());
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

async function getCurrentUser(req) {
  // tenta Authorization: Bearer <jwt>, senão cookie sb-access-token/sb:token
  const auth = req.headers.get("authorization");
  let token = null;
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7);
  } else {
    token = getCookie(req, "sb-access-token") || getCookie(req, "sb:token");
  }
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return data?.user || null;
}

function ensureAdmin(user) {
  const perfil = user?.app_metadata?.perfil || user?.user_metadata?.perfil;
  return perfil === "Administrador";
}

async function listUsers(page = 1, size = 50) {
  const from = (page - 1) * size;
  const to = from + size - 1;
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return data || [];
}

async function createUser(payload) {
  const {
    email,
    perfil = "Visitante",
    posto_graduacao,
    nome_guerra,
    full_name,
    password // opcional
  } = payload;

  if (!email) throw new Error("Informe o e-mail.");
  // cria no auth
  const { data: created, error: e1 } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: password || undefined,
    email_confirm: true,
    app_metadata: { perfil }
  });
  if (e1) throw e1;

  const userId = created?.user?.id;
  if (!userId) throw new Error("Falha ao criar usuário.");

  // insere no profiles
  const { error: e2 } = await supabaseAdmin
    .from(TABLE)
    .insert([{
      [KEY_ID]: userId,
      email,
      perfil,
      posto_graduacao: posto_graduacao || null,
      nome_guerra: nome_guerra || null,
      full_name: full_name || null,
      must_change_password: true
    }]);
  if (e2) throw e2;

  return { id: userId, email };
}

async function updateUser(payload) {
  const {
    id,           // obrigatório para atualizar
    email,        // pode alterar
    perfil,
    posto_graduacao,
    nome_guerra,
    full_name
  } = payload;

  if (!id) throw new Error("ID ausente.");

  // atualiza app_metadata.perfil e/ou email no auth
  const updateAuth = {};
  if (email) updateAuth.email = email;
  if (perfil) updateAuth.app_metadata = { perfil };

  if (Object.keys(updateAuth).length > 0) {
    const { error: e1 } = await supabaseAdmin.auth.admin.updateUserById(id, updateAuth);
    if (e1) throw e1;
  }

  // atualiza no profiles
  const { error: e2 } = await supabaseAdmin
    .from(TABLE)
    .update({
      email: email ?? undefined,
      perfil: perfil ?? undefined,
      posto_graduacao: posto_graduacao ?? undefined,
      nome_guerra: nome_guerra ?? undefined,
      full_name: full_name ?? undefined
    })
    .eq(KEY_ID, id);
  if (e2) throw e2;

  return { id };
}

async function deleteUser(id) {
  if (!id) throw new Error("ID ausente.");
  // apaga da tabela (por segurança; se houver FK ON DELETE CASCADE isso já resolve)
  await supabaseAdmin.from(TABLE).delete().eq(KEY_ID, id);
  // apaga do auth
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) throw error;
  return { id };
}

async function sendReset(email) {
  if (!email) throw new Error("Informe o e-mail.");
  // Forma 1: mandar o e-mail pelo endpoint público (usa anon). Requer SMTP no projeto.
  const { error } = await supabaseAnon.auth.resetPasswordForEmail(email);
  if (error) throw error;
  return { ok: true };
}

export async function handler(req) {
  if (req.method === "OPTIONS") return json(200, { ok: true });

  const me = await getCurrentUser(req);
  if (!me || !ensureAdmin(me)) {
    return json(403, { error: "Acesso negado. Necessário perfil Administrador." });
  }

  try {
    if (req.method === "GET") {
      const urlObj = new URL(req.url);
      const page = parseInt(urlObj.searchParams.get("page") || "1", 10);
      const size = parseInt(urlObj.searchParams.get("size") || "50", 10);
      const data = await listUsers(page, size);
      return json(200, { data });
    }

    const body = await req.json().catch(() => ({}));
    const urlObj = new URL(req.url);
    const action = urlObj.searchParams.get("action");

    if (req.method === "POST" && action === "reset") {
      const out = await sendReset(body.email);
      return json(200, { message: "Solicitação de redefinição enviada (se SMTP configurado).", ...out });
    }

    if (req.method === "POST") {
      const out = await createUser(body);
      return json(200, { message: "Usuário criado.", ...out });
    }

    if (req.method === "PUT") {
      const out = await updateUser(body);
      return json(200, { message: "Usuário atualizado.", ...out });
    }

    if (req.method === "DELETE") {
      const out = await deleteUser(body.id);
      return json(200, { message: "Usuário excluído.", ...out });
    }

    return json(405, { error: "Método não suportado." });
  } catch (err) {
    return json(500, { error: err.message || "Erro interno" });
  }
}
