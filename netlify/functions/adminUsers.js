// netlify/functions/adminUsers.js
// Roda na Netlify usando a Service Role do Supabase.
// Siglas:
// - JWT: JSON Web Token (token do usuário, ex.: app_metadata.perfil)
// - RLS: Row Level Security (segurança em nível de linha no banco)

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_EMAILS // opcional: "email1@dom.com, email2@dom.com"
} = process.env;

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// Cria o client somente se o ambiente estiver OK (evita 502 na carga do módulo)
function getAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw {
      status: 500,
      message:
        'Faltam variáveis SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no ambiente da Netlify.',
    };
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Remove campos indefinidos (evita payload inválido para a API)
function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined && v !== null)
  );
}

// Valida o token do chamador e exige Administrador.
// Regras:
// 1) app_metadata.perfil === 'Administrador' -> OK
// 2) e-mail está em ADMIN_EMAILS            -> OK (opcional para bootstrap)
async function requireAdmin(event, supaAdmin) {
  const auth = event.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw { status: 401, message: 'Sem token' };

  const { data, error } = await supaAdmin.auth.getUser(token);
  if (error || !data?.user) throw { status: 401, message: 'Token inválido' };

  const email = (data.user.email || '').toLowerCase();
  const perfil = data.user.app_metadata?.perfil || 'Visitante';

  if (perfil === 'Administrador') return { user: data.user };

  if (ADMIN_EMAILS) {
    const allow = new Set(
      ADMIN_EMAILS.split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
    );
    if (allow.has(email)) return { user: data.user };
  }

  throw { status: 403, message: 'Acesso negado' };
}

export async function handler(event) {
  try {
    const supaAdmin = getAdminClient();   // valida ENV aqui
    await requireAdmin(event, supaAdmin); // valida JWT/admin

    const url = new URL(event.rawUrl);
    const method = event.httpMethod;
    const action = url.searchParams.get('action');

    // LISTAR usuários (profiles)
    if (method === 'GET') {
      const page = Number(url.searchParams.get('page') || '1');
      const size = Number(url.searchParams.get('size') || '50');
      const from = (page - 1) * size;
      const to = from + size - 1;

      const { data, error } = await supaAdmin
        .from('profiles')
        .select('*')
        .order('updated_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return json(200, { data });
    }

    // RESET de senha por e-mail
    if (method === 'POST' && action === 'reset') {
      const body = JSON.parse(event.body || '{}');
      const { email } = body;
      if (!email) return json(400, { error: 'email é obrigatório' });

      const { error: e1 } = await supaAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
      });
      if (e1) throw e1;

      return json(200, { ok: true, sent: true });
    }

    // CRIAR usuário
    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const {
        email,
        password,                 // opcional
        perfil,                   // 'Administrador', 'CH AGA', ...
        posto_graduacao,
        nome_guerra,
        full_name,
        nome                      // alias antigo
      } = body;

      const fullName = full_name || nome;
      if (!email || !perfil) return json(400, { error: 'email e perfil são obrigatórios' });

      // 1) cria no Auth
      const userMeta = clean({ full_name: fullName, nome_guerra, posto_graduacao });
      const params = {
        email,
        password: password || randomUUID(), // senha temporária
        email_confirm: true,
      };
      if (Object.keys(userMeta).length) params.user_metadata = userMeta;

      const { data: created, error: e1 } = await supaAdmin.auth.admin.createUser(params);
      if (e1) throw e1;

      // 2) garante app_metadata.perfil (compatibilidade)
      const { error: e1b } = await supaAdmin.auth.admin.updateUserById(created.user.id, {
        app_metadata: { perfil },
      });
      if (e1b) throw e1b;

      // 3) upsert em public.profiles
      const { error: e2 } = await supaAdmin
        .from('profiles')
        .upsert({
          id: created.user.id,
          email,
          full_name: fullName,
          nome_guerra,
          posto_graduacao,
          perfil,
          must_change_password: true,
        });
      if (e2) throw e2;

      return json(201, { ok: true, id: created.user.id });
    }

    // ATUALIZAR usuário
    if (method === 'PUT' || method === 'PATCH') {
      const body = JSON.parse(event.body || '{}');
      const { id, email, perfil, posto_graduacao, nome_guerra, full_name, nome } = body;
      if (!id) return json(400, { error: 'id é obrigatório' });

      const fullName = full_name || nome;

      const updates = {};
      if (email) updates.email = email;
      const userMeta = clean({ full_name: fullName, nome_guerra, posto_graduacao });
      if (Object.keys(userMeta).length) updates.user_metadata = userMeta;
      if (perfil) updates.app_metadata = { perfil };

      const { error: e1 } = await supaAdmin.auth.admin.updateUserById(id, updates);
      if (e1) throw e1;

      const { error: e2 } = await supaAdmin
        .from('profiles')
        .update({ email, full_name: fullName, nome_guerra, posto_graduacao, perfil })
        .eq('id', id);
      if (e2) throw e2;

      return json(200, { ok: true });
    }

    // EXCLUIR usuário
    if (method === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const { id } = body;
      if (!id) return json(400, { error: 'id é obrigatório' });

      const { error: e1 } = await supaAdmin.auth.admin.deleteUser(id);
      if (e1) throw e1;

      return json(200, { ok: true });
    }

    return json(404, { error: 'Rota não encontrada' });
  } catch (err) {
    const status = err?.status || err?.statusCode || (err?.name === 'ZodError' ? 400 : 500);
    let message = err?.message || String(err);
    if (err?.name === 'ZodError') {
      message = err.errors?.map(e => e.message).join('; ') || message;
    }
    return json(status, { error: message });
  }
}
