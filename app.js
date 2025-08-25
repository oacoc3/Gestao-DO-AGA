// app.js – Bootstrap do app: autenticação + rotas + menu
import { supabase } from "./supabaseClient.js";
import { startRouter, addRoute } from "./router.js";
import { getModules, buildNav } from "./modules/index.js";

const appContainer = document.getElementById("app");
const navEl = document.getElementById("nav");
const authArea = document.getElementById("auth-area");

let currentModules = [];

/* Utilitário: estamos num link de recuperação? */
function isRecoveryLink() {
  const url = new URL(window.location.href);
  // Supabase envia "type=recovery" no hash (#) e pode aparecer também na query (?type=)
  return url.hash.includes("type=recovery") || url.searchParams.get("type") === "recovery";
}

/* Utilitário: limpa o hash e a query da URL (remove access_token, type=recovery, etc.) */
function clearAuthParamsFromUrl() {
  const clean = window.location.origin + window.location.pathname + (window.location.hash.startsWith("#/") ? window.location.hash : "");
  window.history.replaceState({}, document.title, clean);
}

async function setupModules(session) {
  let perfil = session?.user?.app_metadata?.perfil;
  if (session?.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("perfil")
      .eq("id", session.user.id)
      .single();
    perfil = profile?.perfil || perfil;
  }
  currentModules = getModules(perfil);
  currentModules.forEach(m => addRoute(m.route, (c) => m.view(c)));
}

// Autenticação (e-mail/senha)
async function renderAuthArea(session) {
  if (session?.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("posto_graduacao, nome_guerra, email, perfil")
      .eq("id", session.user.id)
      .single();

    const postoGrad = profile?.posto_graduacao || "";
    const nomeGuerra = profile?.nome_guerra || "";
    const email = profile?.email || session.user.email;
    const perfil = profile?.perfil || session.user.app_metadata?.perfil || "";

    authArea.innerHTML = `
      <span class="small">${postoGrad} ${nomeGuerra} - ${email} - ${perfil}</span>
      <button id="btn-logout" style="margin-left:8px">Sair</button>
    `;
    document.getElementById("btn-logout").onclick = async () => {
      await supabase.auth.signOut();
    };
    buildNav(navEl, currentModules);
  } else {
    authArea.innerHTML = `
      <form id="login-form" style="display:flex; gap:8px; align-items:center">
        <input id="email" type="email" placeholder="email" />
        <input id="password" type="password" placeholder="senha" />
        <button type="submit">Entrar</button>
        <a href="#" id="show-forgot" class="small">Esqueci minha senha</a>
      </form>
      <form id="forgot-form" style="display:none; gap:8px; align-items:center">
        <input id="forgot-email" type="email" placeholder="email" />
        <button type="submit">Enviar</button>
        <button type="button" id="cancel-forgot">Cancelar</button>
      </form>
      <div id="auth-msg" class="small"></div>
    `;
    navEl.innerHTML = ""; // esconde menu quando deslogado
    const loginForm = document.getElementById("login-form");
    const forgotForm = document.getElementById("forgot-form");
    const msg = document.getElementById("auth-msg");
    loginForm.onsubmit = async (e) => {
      e.preventDefault();
      msg.textContent = "Entrando...";
      const email = loginForm.email.value.trim();
      const password = loginForm.password.value;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      msg.textContent = error ? ("Erro: " + error.message) : "";
    };
    document.getElementById("show-forgot").onclick = (e) => {
      e.preventDefault();
      loginForm.style.display = "none";
      forgotForm.style.display = "flex";
      msg.textContent = "";
    };
    document.getElementById("cancel-forgot").onclick = () => {
      forgotForm.style.display = "none";
      loginForm.style.display = "flex";
      msg.textContent = "";
    };
    forgotForm.onsubmit = async (e) => {
      e.preventDefault();
      msg.textContent = "Enviando...";
      const email = document.getElementById("forgot-email").value.trim();
      // redireciona o usuário de volta ao app para escolher a nova senha
      const redirectTo = window.location.origin + window.location.pathname; // ex.: https://gestao-do-aga.netlify.app/
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      msg.textContent = error ? ("Erro: " + error.message) : "E-mail enviado.";
    };
  }
}

// Tela exibida quando o usuário acessa o link de recuperação de senha
function renderPasswordReset() {
  navEl.innerHTML = "";
  authArea.innerHTML = `
      <form id="reset-form" style="display:flex; gap:8px; align-items:center">
        <input id="new-pass" type="password" placeholder="nova senha" />
        <input id="conf-pass" type="password" placeholder="confirmar senha" />
        <button type="submit">Salvar</button>
      </form>
      <div id="auth-msg" class="small"></div>
    `;
  const form = document.getElementById("reset-form");
  const msg = document.getElementById("auth-msg");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const p1 = form["new-pass"].value;
    const p2 = form["conf-pass"].value;
    if (p1 !== p2) {
      msg.textContent = "Senhas não conferem.";
      return;
    }
    msg.textContent = "Atualizando...";
    const { error } = await supabase.auth.updateUser({ password: p1 });
    if (error) {
      msg.textContent = "Erro: " + error.message;
    } else {
      msg.textContent = "Senha alterada. Faça login novamente.";
      // IMPORTANTE: remove access_token e type=recovery da URL antes de deslogar
      clearAuthParamsFromUrl();
      await supabase.auth.signOut();
    }
  };
}

// Protege as rotas: se não estiver logado, mostra a tela de login
function guardRoutes(session) {
  if (!session?.user) {
    appContainer.innerHTML = `
      <div class="container">
        <div class="card"><h3>Faça login para continuar.</h3></div>
      </div>
    `;
  } else {
    // dispara o roteador normalmente
    startRouter(appContainer);
    // navega para dashboard por padrão se não houver hash
    if (!window.location.hash) window.location.hash = "#/dashboard";
  }
}

// Sessão inicial
const {
  data: { session }
} = await supabase.auth.getSession();

// Se a URL é de recuperação, mostra o formulário de nova senha e não carrega o app
if (isRecoveryLink()) {
  renderPasswordReset();
  guardRoutes(null);
} else {
  await setupModules(session);
  await renderAuthArea(session);
  guardRoutes(session);
}

// Reage a mudanças de sessão (login/logout)
supabase.auth.onAuthStateChange(async (event, sessionNow) => {
  // Em qualquer evento enquanto estivermos num fluxo de recuperação,
  // priorize SEMPRE a tela de troca de senha.
  if (isRecoveryLink() || event === "PASSWORD_RECOVERY") {
    renderPasswordReset();
    guardRoutes(null);
    return;
  }

  await setupModules(sessionNow);
  await renderAuthArea(sessionNow);
  guardRoutes(sessionNow);
});
