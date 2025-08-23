// netlify/functions/adminUsers.js
import { createClient } from '@supabase/supabase-js';

const supaAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, // service role
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

// Valida o token do chamador e checa se é Admin
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
    const { user } = await requireAdmin(event);
    const url = new URL(event.rawUrl);
    const path = url.pathname; // e.g., /.netlify/functions/adminUsers
    const method = event.httpMethod;

    // LISTAR perfis (pagina simples)
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

    // CRIAR usuário
    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const {
        email,
        password,                 // opcional se preferir link
        perfil,                   // 'Administrador', 'CH AGA', ...
        posto_graduacao,
        nome_guerra,
        full_name
      } = body;

      if (!email || (!password && !perfil)) {
        return json(400, { error: 'email e perfil são obrigatórios; password opcional (pode usar link de recuperação).' });
      }

      // Cria usuário no Auth com perfil no app_metadata
      const { data: created, error: e1 } = await supaAdmin.auth.admin.createUser({
        email,
        password: password || crypto.randomUUID(), // se não mandar senha, gera uma temporária
        email_confirm: true,
        user_metadata: { full_name, nome_guerra, posto_graduacao },
        app_metadata: { perfil }                    // <- claim de perfil no JWT
      });
      if (e1) throw e1;

      // Garante perfil no public.profiles
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

      // Atualiza metadados no Auth (nome e perfil)
      const updates = {};
      if (email) updates.email = email;
      updates.user_metadata = { full_name, nome_guerra, posto_graduacao };
      updates.app_metadata = { perfil };

      const { error: e1 } = await supaAdmin.auth.admin.updateUserById(id, updates);
      if (e1) throw e1;

      // Atualiza perfil na tabela
      const { error: e2 } = await supaAdmin
        .from('profiles')
        .update({ email, full_name, nome_guerra, posto_graduacao, perfil })
        .eq('id', id);
      if (e2) throw e2;

      return json(200, { ok: true });
    }

    // RESETAR senha (envia link de recuperação)
    if (method === 'POST' && event.queryStringParameters?.action === 'reset') {
      const body = JSON.parse(event.body || '{}');
      const { email } = body;
      if (!email) return json(400, { error: 'email é obrigatório' });

      // Gera link de recuperação (password reset)
      const { data: link, error: e1 } = await supaAdmin.auth.admin.generateLink({
        type: 'recovery',
        email
      });
      if (e1) throw e1;

      // Você pode enviar o link por e-mail via seu SMTP aqui,
      // ou simplesmente confiar no e-mail padrão do Supabase.
      return json(200, { ok: true, sent: true });
    }

    // EXCLUIR usuário
    if (method === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const { id } = body;
      if (!id) return json(400, { error: 'id é obrigatório' });

      const { error: e1 } = await supaAdmin.auth.admin.deleteUser(id);
      if (e1) throw e1;

      // limpeza do profile é cascata pelo FK
      return json(200, { ok: true });
    }

    return json(404, { error: 'Rota não encontrada' });
  } catch (err) {
    const status = err?.status || 500;
    return json(status, { error: err?.message || String(err) });
  }
}
