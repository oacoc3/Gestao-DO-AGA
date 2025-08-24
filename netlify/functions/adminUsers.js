// API do módulo Administração (CommonJS)
// Requer SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY no Netlify

const { createClient } = require("@supabase/supabase-js");

const URL     = process.env.SUPABASE_URL;
const ANON    = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TABLE  = "profiles";
const KEY_ID = "id";

function res(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Client-Authorization, X-Supabase-Auth",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function getCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const s = part.trim();
    const i = s.indexOf("=");
    if (i === -1) continue;
    const k = s.slice(0, i);
    const v = decodeURIComponent(s.slice(i + 1));
    if (k === name) return v;
  }
  return null;
}

function extractToken(event) {
  const headers = event.headers || {};
  const qs      = event.queryStringParameters || {};
  let token = null;

  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;

  let auth =
    h["authorization"] ||
    h["client-authorization"] ||
    h["x-supabase-auth"];

  if (auth && typeof auth === "string") {
    const low = auth.toLowerCase();
    token = low.startsWith("bearer ") ? auth.slice(7) : auth;
  }

  if (!token) {
    const cookie = h["cookie"];
    token =
      getCookie(cookie, "sb-access-token") ||
      getCookie(cookie, "sb:token") ||
      null;
  }

  if (!token && qs.auth) token = qs.auth;

  if (!token && event.body) {
    try {
      const body = JSON.parse(event.body);
      if (body && body.token) token = body.token;
    } catch {}
  }

  return token || null;
}

async function getCurrentUserWith(token, client) {
  if (!token) return { user: null, err: "no-token" };
  const { data, error } = await client.auth.getUser(token);
  if (error) return { user: null, err: error.message || "getUser-error" };
  return { user: data?.user || null, err: null };
}

async function isAdmin(client, user) {
  const perfilMeta =
    user?.app_metadata?.perfil || user?.user_metadata?.perfil;
  if (perfilMeta === "Administrador") return true;

  const { data, error } = await client
    .from(TABLE)
    .select("perfil")
    .eq(KEY_ID, user.id)
    .maybeSingle();

  if (error) return false;
  return data?.perfil === "Administrador";
}

async function listUsers(client, page = 1, size = 50) {
  const from = (page - 1) * size;
  const to   = from + size - 1;
  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return data || [];
}

async function createUser(admin, _anon, payload) {
  const {
    email,
    perfil = "Visitante",
    posto_graduacao,
    nome_guerra,
    full_name,
    password,
  } = payload;

  if (!email) throw new Error("Informe o e-mail.");

  const { data: created, error: e1 } =
    await admin.auth.admin.createUser({
      email,
      password: password || undefined,
      email_confirm: true,
      app_metadata: { perfil },
    });
  if (e1) throw e1;

  const userId = created?.user?.id;
  if (!userId) throw new Error("Falha ao criar usuário.");

  const { error: e2 } = await admin.from(TABLE).insert([{
    [KEY_ID]: userId,
    email,
    perfil,
    posto_graduacao: posto_graduacao || null,
    nome_guerra:     nome_guerra     || null,
    full_name:       full_name       || null,
    must_change_password: true,
  }]);
  if (e2) throw e2;

  return { id: userId, email };
}

async function updateUser(admin, payload) {
  const { id, email, perfil, posto_graduacao, nome_guerra, full_name } = payload;
  if (!id) throw new Error("ID ausente.");

  const patch = {};
  if (email) patch.email = email;
  if (perfil) patch.app_metadata = { perfil };
  if (Object.keys(patch).length) {
    const { error: e1 } = await admin.auth.admin.updateUserById(id, patch);
    if (e1) throw e1;
  }

  const { error: e2 } = await admin
    .from(TABLE)
    .update({
      email: email ?? undefined,
      perfil: perfil ?? undefined,
      posto_graduacao: posto_graduacao ?? undefined,
      nome_guerra:     nome_guerra     ?? undefined,
      full_name:       full_name       ?? undefined,
    })
    .eq(KEY_ID, id);
  if (e2) throw e2;

  return { id };
}

async function deleteUser(admin, id) {
  if (!id) throw new Error("ID ausente.");
  await admin.from(TABLE).delete().eq(KEY_ID, id);
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) throw error;
  return { id };
}

async function sendReset(anon, email) {
  if (!email) throw new Error("Informe o e-mail.");
  const { error } = await anon.auth.resetPasswordForEmail(email);
  if (error) throw error;
  return { ok: true };
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod === "OPTIONS") return res(200, { ok: true });

    if (!URL || !ANON || !SERVICE) {
      return res(500, { error: "Variáveis SUPABASE_URL/ANON/SERVICE ausentes no Netlify." });
    }

    const supabaseAdmin = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const supabaseAnon  = createClient(URL, ANON,    { auth: { persistSession: false } });

    // Autenticação (token pode vir no header, query, cookie OU body.token)
    const token = extractToken(event);
    if (!token) return res(401, { error: "Não autenticado." });

    // Tenta validar com service; se falhar, tenta com anon
    let { user } = await getCurrentUserWith(token, supabaseAdmin);
    if (!user) {
      const retry = await getCurrentUserWith(token, supabaseAnon);
      user = retry.user;
    }
    if (!user) return res(401, { error: "Não autenticado." });

    // Autorização
    const allowed = await isAdmin(supabaseAdmin, user);
    if (!allowed) return res(403, { error: "Acesso negado. Requer Administrador." });

    const qs   = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};

    // ---- LISTAGEM: aceitar POST action=list (token no body)
    if (event.httpMethod === "POST" && qs.action === "list") {
      const page = parseInt(body.page || "1", 10);
      const size = parseInt(body.size || "50", 10);
      const data = await listUsers(supabaseAdmin, page, size);
      return res(200, { data });
    }

    // GET (mantido para compatibilidade, mas sem token por cookie pode falhar)
    if (event.httpMethod === "GET") {
      const page = parseInt(qs.page || "1", 10);
      const size = parseInt(qs.size || "50", 10);
      const data = await listUsers(supabaseAdmin, page, size);
      return res(200, { data });
    }

    if (event.httpMethod === "POST" && qs.action === "reset") {
      const out = await sendReset(supabaseAnon, body.email);
      return res(200, { message: "Solicitação de redefinição enviada (se SMTP configurado).", ...out });
    }

    if (event.httpMethod === "POST") {
      const out = await createUser(supabaseAdmin, supabaseAnon, body);
      return res(200, { message: "Usuário criado.", ...out });
    }

    if (event.httpMethod === "PUT") {
      const out = await updateUser(supabaseAdmin, body);
      return res(200, { message: "Usuário atualizado.", ...out });
    }

    if (event.httpMethod === "DELETE") {
      const out = await deleteUser(supabaseAdmin, body.id);
      return res(200, { message: "Usuário excluído.", ...out });
    }

    return res(405, { error: "Método não suportado." });
  } catch (err) {
    return res(500, { error: err?.message || "Erro interno" });
  }
};
