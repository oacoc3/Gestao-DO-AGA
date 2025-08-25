// app.js – Bootstrap do app: autenticação + rotas + menu
import { supabase } from "./supabaseClient.js";
import { startRouter, addRoute } from "./router.js";
import { getModules, buildNav } from "./modules/index.js";

const appContainer = document.getElementById("app");
const navEl = document.getElementById("nav");
const authArea = document.getElementById("auth-area");

let currentModules = [];

/* ==== Utilidades de URL (Uniform Resource Locator) ==== */
function isRecoveryLink() {
  const url = new URL(window.location.href);
  // Supabase manda "type=recovery" no hash (#) e, às vezes, também na query (?)
  return url.hash.includes("type=recovery") || url.searchParams.get("type") === "recovery";
}

function extractTokensFromUrl() {
  // Tokens podem vir no hash (#access_token=...) ou na query (?access_token=...)
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);

  const access_token = hashParams.get("access_token") || queryParams.get("access_token");
  const refresh_token = hashParams.get("refresh_token") || queryParams.get("refresh_token");
  const type = hashParams.get("type") || queryParams.get("type");

  return { access_token, refresh_token, type };
}

/* Remove access_token/refresh_token/type=recovery da URL */
function clearAuthParamsFromUrl() {
  const keepHash = window.location.hash.startsWith("#/") ? window.location.hash : "";
  const clean = window.location.origin + window.location.pathname + keepHash;
  window.history.replaceState({}, document.title, clean);
}

/* Cria a sessão de recuperação somente nesta aba, se necessário */
async function ensureRecoverySession() {
  const { access_token, refresh_token } = extractTokensFromUrl();
  if (!access_token || !refresh_token) return { ok: false, reason: "missing_tokens" };

  // Seta a sessão localmente para permitir updateUser({ password })
  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, session: data.session };
}

/* ==== Módulos ==== */
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

/* ==== UI de autenticação ==== */
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
      // Redireciona de volta para a raiz da SPA
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      msg.textContent = error ? ("Erro: " + error.message) : "E-mail enviado.";
    };
  }
}

/* ==== Tela de redefinição de senha ==== */
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
    try {
      const { error } = await supabase.auth.updateUser({ password: p1 });
      if (error) {
        msg.textContent = "Erro: " + error.message;
        return;
      }
      msg.textContent = "Senha alterada. Faça login novamente.";
      clearAuthParamsFromUrl();     // remove tokens/type=recovery da URL
      await supabase.auth.signOut(); // sai para voltar ao formulário de login
      // Mostra o login
      authArea.innerHTML = "";
      const { data: { session: s2 } } = await supabase.auth.getSession();
      await renderAuthArea(s2);
      guardRoutes(null);
    } catch (err) {
      msg.textContent = "Erro inesperado ao atualizar a senha.";
      console.error(err);
    }
  };
}

/* ==== Proteção de rotas ==== */
function guardRoutes(session) {
  if (!session?.user) {
    appContainer.innerHTML = `
      <div class="container">
        <div class="card"><h3>Faça login para continuar.</h3></div>
      </div>
    `;
  } else {
    startRouter(appContainer);
    if (!window.location.hash) window.location.hash = "#/dashboard";
  }
}

/* ==== Fluxo inicial ==== */
const { data: { session } } = await supabase.auth.getSession();

if (isRecoveryLink()) {
  // Cria sessão temporária apenas nesta aba (sem auto-login global)
  const ok = await ensureRecoverySession();
  renderPasswordReset();
  guardRoutes(null); // não carrega módulos enquanto redefine a senha
} else {
  await setupModules(session);
  await renderAuthArea(session);
  guardRoutes(session);
}

/* ==== Eventos de sessão (JWT: JSON Web Token) ==== */
supabase.auth.onAuthStateChange(async (event, sessionNow) => {
  // Enquanto estivermos em / com type=recovery na URL,
  // mantenha SEMPRE a tela de redefinição (ignora SIGNED_IN etc.)
  if (isRecoveryLink()) {
    renderPasswordReset();
    guardRoutes(null);
    return;
  }
  await setupModules(sessionNow);
  await renderAuthArea(sessionNow);
  guardRoutes(sessionNow);
});
