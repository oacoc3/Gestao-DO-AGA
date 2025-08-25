// netlify/functions/adminUsers.js
// Esta Function roda no servidor (Netlify) e usa a Service Role Key do Supabase.
// Siglas:
// - JWT: JSON Web Token (token com “claims” do usuário, incluindo app_metadata.perfil)
// - RLS: Row Level Security (segurança em nível de linha, aplicada no banco)

import { createClient } from '@supabase/supabase-js';

const supaAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, // <- Service Role (NUNCA expor no cliente)
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Remove campos indefinidos para evitar erros de validação da API
function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined && v !== null)
  );
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

// Valida token do chamador e exige perfil Administrador
async function requireAdmin(event) {
  const auth = event.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw { status: 401, message: 'Sem token' };

  const { data, error } = await supaAdmin.auth.getUser(token);
  if (error || !data?.user) throw { status: 401, message: 'Token inválido' };

  const perfil = data.user.app_metadata?.perfil || 'Visitante';
  if (perfil !== 'Administrador') throw { status: 403, message: 'Acesso negado' };

  return { user: data.user };
}

export async function handler(event) {
  try {
    await requireAdmin(event);

    const url = new URL(event.rawUrl);
    const method = event.httpMethod;
    const action = url.searchParams.get('action');
    
    // LISTAR perfis (paginado simples)
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

    // RESETAR senha (envia link de recuperação por e-mail)
    if (method === 'POST' && action === 'reset') {
      const body = JSON.parse(event.body || '{}');
      const { email } = body;
      if (!email) return json(400, { error: 'email é obrigatório' });

      const { data: link, error: e1 } = await supaAdmin.auth.admin.generateLink({
        type: 'recovery',
        email
      });
      if (e1) throw e1;

      // O Supabase envia e-mail automaticamente (se SMTP configurado).
      return json(200, { ok: true, sent: true });
    }

    // CRIAR usuário
    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const {
        email,
        password,                 // opcional: se não vier, geramos ou enviaremos reset
        perfil,                   // 'Administrador', 'CH AGA', ...
        posto_graduacao,
        nome_guerra,
        full_name
      } = body;

      if (!email || !perfil) return json(400, { error: 'email e perfil são obrigatórios' });

      // Cria no Auth com perfil no app_metadata
      const userMeta = clean({ full_name, nome_guerra, posto_graduacao });
      const appMeta = clean({ perfil });
      const params = {
        email,
        password: password || crypto.randomUUID(), // senha temporária se não informada
        email_confirm: true
      };
      if (Object.keys(userMeta).length) params.user_metadata = userMeta;
      if (Object.keys(appMeta).length) params.app_metadata = appMeta;

      const { data: created, error: e1 } = await supaAdmin.auth.admin.createUser(params);
      if (e1) throw e1;

      // Registra/atualiza em public.profiles
      const { error: e2 } = await supaAdmin
        .from('profiles')
        .upsert({
          id: created.user.id,
          email,
          full_name,
          nome_guerra,
          posto_graduacao,
          perfil,
          must_change_password: true
        });
      if (e2) throw e2;

      return json(201, { ok: true, id: created.user.id });
    }

    // ATUALIZAR usuário
    if (method === 'PUT' || method === 'PATCH') {
      const body = JSON.parse(event.body || '{}');
      const { id, email, perfil, posto_graduacao, nome_guerra, full_name } = body;
      if (!id) return json(400, { error: 'id é obrigatório' });

      const updates = {};
      if (email) updates.email = email;
      const userMeta = clean({ full_name, nome_guerra, posto_graduacao });
      if (Object.keys(userMeta).length) updates.user_metadata = userMeta;
      const appMeta = clean({ perfil });
      if (Object.keys(appMeta).length) updates.app_metadata = appMeta;

      const { error: e1 } = await supaAdmin.auth.admin.updateUserById(id, updates);
      if (e1) throw e1;

      const { error: e2 } = await supaAdmin
        .from('profiles')
        .update({ email, full_name, nome_guerra, posto_graduacao, perfil })
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

      // O profile é removido automaticamente por ON DELETE CASCADE
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
