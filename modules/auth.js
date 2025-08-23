// modules/auth.js
// Fluxos: login por e-mail/senha, "esqueci minha senha" (recovery) e
// "troca obrigatória de senha" (must_change_password).
//
// Siglas:
// - JWT: JSON Web Token (token do usuário logado)
// - RLS: Row Level Security (segurança no banco)

import { supabase } from "../supabaseClient.js";

function cssOnce() {
  if (document.getElementById("auth-css")) return;
  const st = document.createElement("style");
  st.id = "auth-css";
  st.textContent = `
    .auth-card { padding:12px; }
    .auth-row { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; }
    .auth-row > div { display:flex; flex-direction:column; }
    .auth-row label { margin-bottom:4px; }
    .auth-row input, .auth-row button { height:34px; }
    .msg { margin-top:8px; font-size:12px; }
  `;
  document.head.appendChild(st);
}

async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

async function getMyProfile() {
  const sess = await getSession();
  if (!sess?.user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", sess.user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export default {
  id: "auth",
  title: "Entrar",
  route: "#/entrar",
  async view(container) {
    cssOnce();

    container.innerHTML = `
      <div class="container">
        <div class="card auth-card">
          <h3>Entrar</h3>
          <div id="auth-area"></div>
          <div class="msg" id="auth-msg"></div>
        </div>
      </div>
    `;

    const $area = container.querySelector("#auth-area");
    const $msg = container.querySelector("#auth-msg");

    // Renderizações
    const renderLogin = () => {
      $area.innerHTML = `
        <div class="auth-row">
          <div><label>E-mail</label><input id="lg-email" type="email" autocomplete="username" /></div>
          <div><label>Senha</label><input id="lg-pass" type="password" autocomplete="current-password" /></div>
          <div><label>&nbsp;</label><button id="btn-entrar">Entrar</button></div>
          <div><label>&nbsp;</label><button id="btn-recovery" type="button">Esqueci minha senha</button></div>
        </div>
      `;
      $msg.textContent = "Informe e-mail e senha. Se não lembrar, use 'Esqueci minha senha'.";
      bindLogin();
    };

    const renderForceChangePassword = () => {
      $area.innerHTML = `
        <p>Por segurança, defina uma nova senha para continuar.</p>
        <div class="auth-row">
          <div><label>Nova senha</label><input id="np1" type="password" autocomplete="new-password" /></div>
          <div><label>Confirmar nova senha</label><input id="np2" type="password" autocomplete="new-password" /></div>
          <div><label>&nbsp;</label><button id="btn-setpass">Definir nova senha</button></div>
        </div>
      `;
      $msg.textContent = "A senha precisa atender sua política interna (tamanho/complexidade).";
      bindSetPassword();
    };

    const renderLogged = async () => {
      const sess = await getSession();
      const user = sess?.user;
      const prof = await getMyProfile();
      $area.innerHTML = `
        <div class="auth-row">
          <div><label>Usuário</label><input disabled value="${prof?.full_name || user?.email || ''}" /></div>
          <div><label>E-mail</label><input disabled value="${user?.email || ''}" /></div>
          <div><label>Perfil</label><input disabled value="${user?.app_metadata?.perfil || prof?.perfil || ''}" /></div>
          <div><label>&nbsp;</label><button id="btn-sair">Sair</button></div>
        </div>
      `;
      $msg.textContent = "Sessão ativa.";
      container.querySelector("#btn-sair").onclick = async () => {
        await supabase.auth.signOut();
        location.hash = "#/entrar";
      };
    };

    // Binds
    function bindLogin() {
      const $email = container.querySelector("#lg-email");
      const $pass  = container.querySelector("#lg-pass");
      container.querySelector("#btn-entrar").onclick = async () => {
        $msg.textContent = "Autenticando...";
        const { error } = await supabase.auth.signInWithPassword({ email: $email.value, password: $pass.value });
        if (error) { $msg.textContent = "Falha no login: " + error.message; return; }

        try {
          const prof = await getMyProfile();
          if (prof?.must_change_password) {
            renderForceChangePassword();
          } else {
            location.hash = "#/processos";
          }
        } catch (e) {
          $msg.textContent = "Erro ao carregar perfil: " + e.message;
        }
      };
      container.querySelector("#btn-recovery").onclick = async () => {
        if (!$email.value) { $msg.textContent = "Informe seu e-mail e clique novamente."; return; }
        $msg.textContent = "Enviando e-mail de recuperação...";
        const { error } = await supabase.auth.resetPasswordForEmail($email.value, {
          redirectTo: `${location.origin}/#/entrar`
        });
        if (error) { $msg.textContent = "Erro: " + error.message; return; }
        $msg.textContent = "Se o e-mail existir, você receberá um link para redefinir a senha.";
      };
    }

    function bindSetPassword() {
      const $p1 = container.querySelector("#np1");
      const $p2 = container.querySelector("#np2");
      container.querySelector("#btn-setpass").onclick = async () => {
        if (!$p1.value || $p1.value !== $p2.value) { $msg.textContent = "As senhas não coincidem."; return; }
        $msg.textContent = "Atualizando senha...";
        const { error } = await supabase.auth.updateUser({ password: $p1.value });
        if (error) { $msg.textContent = "Erro ao atualizar senha: " + error.message; return; }

        // Desliga a flag must_change_password (política/trigger permite apenas isso)
        const sess = await getSession();
        if (sess?.user?.id) {
          const { error: e2 } = await supabase
            .from("profiles")
            .update({ must_change_password: false })
            .eq("id", sess.user.id);
          if (e2) { $msg.textContent = "Senha atualizada, mas houve erro ao finalizar: " + e2.message; return; }
        }
        $msg.textContent = "Senha atualizada. Redirecionando...";
        setTimeout(() => (location.hash = "#/processos"), 600);
      };
    }

    // Roteamento do módulo: decide qual tela mostrar
    try {
      const sess = await getSession();
      if (!sess) { renderLogin(); return; }

      // Se veio de um link de recuperação, o SDK já cria a sessão.
      // Verifica se precisa trocar a senha.
      const prof = await getMyProfile();
      if (prof?.must_change_password) { renderForceChangePassword(); return; }

      // Senão, já mostra o "logado"
      await renderLogged();
    } catch (e) {
      $msg.textContent = "Erro: " + e.message;
      renderLogin();
    }
  },
};
