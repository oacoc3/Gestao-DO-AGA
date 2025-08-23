// modules/auth.js
// Fluxos: login por e-mail/senha, "esqueci minha senha" (recovery)
// e tratamento simples para "primeiro acesso".
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

    // Envia um e-mail para definir/redefinir senha e orienta o usuário
    const renderForceChangePassword = async () => {
      $area.innerHTML = `<p>Estamos enviando um e-mail para você definir sua senha...</p>`;
      try {
        const { data } = await supabase.auth.getSession();
        const email = data?.session?.user?.email;
        if (!email) throw new Error("Sessão inválida.");

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/#/entrar`
        });
        if (error) throw error;

        $area.innerHTML = `
          <p>Enviamos um e-mail para <strong>${email}</strong>.</p>
          <p>Abra o e-mail e clique no link “Definir/Redefinir senha”. Depois é só voltar e entrar normalmente.</p>
        `;
        $msg.textContent = "";
      } catch (e) {
        $area.innerHTML = "";
        $msg.textContent = "Não foi possível enviar o e-mail de definição de senha: " + e.message;
      }
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
        const { error } = await supabase.auth.signInWithPassword({
          email: $email.value,
          password: $pass.value
        });
        if (error) { $msg.textContent = "Falha no login: " + error.message; return; }

        try {
          const sess = await getSession();
          const user = sess?.user;
          const prof = await getMyProfile();

          if (prof?.must_change_password) {
            // Tentativa simples: limpar a flag para não repetir no próximo login
            try {
              await supabase.from("profiles")
                .update({ must_change_password: false })
                .eq("id", user.id);
              // Mesmo se falhar, seguimos para o fluxo do e-mail
            } catch (_) {}

            // Envia e-mail de definição (caso ainda não tenha definido)
            await renderForceChangePassword();
            return;
          }

          // Perfil OK → segue para a aplicação
          location.hash = "#/processos";
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

    // Roteamento do módulo: decide qual tela mostrar
    try {
      const sess = await getSession();
      if (!sess) { renderLogin(); return; }

      // Se já está logado, mostra resumo e botão "Sair"
      await renderLogged();
    } catch (e) {
      $msg.textContent = "Erro: " + e.message;
      renderLogin();
    }
  },
};
