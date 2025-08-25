// netlify/functions/adminUsers.js
// Roda na Netlify usando a Service Role do Supabase.
// Siglas:
// - JWT: JSON Web Token (token do usuário, ex.: app_metadata.perfil)
// - RLS: Row Level Security (segurança em nível de linha no banco)
// - SMTP: Simple Mail Transfer Protocol (envio de e-mails)

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_EMAILS,       // opcional: "email1@dom.com, email2@dom.com"
  DEFAULT_PASSWORD,   // opcional: senha padrão se você quiser (ex.: "123456")
  SITE_URL            // ex.: "https://gestao-do-aga.netlify.app"
} = process.env;

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

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

function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined && v !== null)
  );
}

function resolveRedirectTo(event) {
  if (SITE_URL) return SITE_URL; // recomendado
  const proto = event.headers['x-forwarded-proto'] || 'https';
  const host = event.headers['x-forwarded-host'] || event.headers.host;
  if (host) return `${proto}://${host}`;
  return 'https://exemplo.com'; // ajuste se aparecer isso nos logs
}

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
    const supaAdmin = getAdminClient();
    await requireAdmin(event, supaAdmin);

    const url = new URL(event.rawUrl);
    const method = event.httpMethod;
    const action = url.searchParams.get('action');

    // LISTAR perfis
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

    // REENVIAR e-mail de definição de senha manualmente
    if (method === 'POST' && action === 'reset') {
      const body = JSON.parse(event.body || '{}');
      const { email } = body;
      if (!email) return json(400, { error: 'email é obrigatório' });

      const redirectTo = resolveRedirectTo(event);
      // usa o mailer do Supabase
      const { error: e1 } = await supaAdmin.auth.resetPasswordForEmail(email, { redirectTo });
      if (e1) throw e1;

      return json(200, { ok: true, sent: true });
    }

    // CRIAR usuário (com envio de e-mail garantido)
    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const {
        email,
        password,                 // opcional — se vier, tem prioridade
        perfil,                   // 'Administrador', 'CH AGA', ...
        posto_graduacao,
        nome_guerra,
        full_name,
        nome                      // alias antigo
      } = body;

      const fullName = full_name || nome;
      if (!email || !perfil) return json(400, { error: 'email e perfil são obrigatórios' });

      const userMeta = clean({ full_name: fullName, nome_guerra, posto_graduacao });
      const redirectTo = resolveRedirectTo(event);

      // 1) Tenta o fluxo RECOMENDADO: inviteUserByEmail (cria e envia e-mail de convite)
      const { data: invited, error: invErr } = await supaAdmin.auth.admin.inviteUserByEmail(
        email,
        { data: userMeta, redirectTo }
      );

      if (!invErr && invited?.user) {
        const userId = invited.user.id;

        // garante app_metadata.perfil
        const { error: e1b } = await supaAdmin.auth.admin.updateUserById(userId, {
          app_metadata: { perfil },
        });
        if (e1b) throw e1b;

        // upsert no public.profiles
        const { error: e2 } = await supaAdmin
          .from('profiles')
          .upsert({
            id: userId,
            email,
            full_name: fullName,
            nome_guerra,
            posto_graduacao,
            perfil,
            must_change_password: true,
          });
        if (e2) throw e2;

        return json(201, { ok: true, id: userId, invited: true, email_sent: true });
      }

      // 2) Fallback (se o invite falhar — ex.: usuário já existe):
      //    cria o usuário (se ainda não existir) e envia e-mail de reset
      const initialPassword = password ?? DEFAULT_PASSWORD ?? randomUUID();
      const { data: created, error: e1 } = await supaAdmin.auth.admin.createUser({
        email,
        password: initialPassword,
        email_confirm: true,
        user_metadata: userMeta,
      });
      // se já existir, o erro costuma ser 422; seguimos mesmo assim
      if (e1 && e1.status !== 422) throw e1;

      const userId = created?.user?.id;
      if (userId) {
        const { error: e1b } = await supaAdmin.auth.admin.updateUserById(userId, {
          app_metadata: { perfil },
        });
        if (e1b) throw e1b;

        const { error: e2 } = await supaAdmin
          .from('profiles')
          .upsert({
            id: userId,
            email,
            full_name: fullName,
            nome_guerra,
            posto_graduacao,
            perfil,
            must_change_password: true,
          });
        if (e2) throw e2;
      }

      // envia o e-mail de redefinição (usa o mailer do Supabase)
      const { error: e3 } = await supaAdmin.auth.resetPasswordForEmail(email, { redirectTo });
      if (e3) throw e3;

      return json(201, { ok: true, id: userId ?? null, invited: false, email_sent: true });
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
