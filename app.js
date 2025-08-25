// app.js – Bootstrap do app: autenticação + rotas + menu
import { supabase } from "./supabaseClient.js";
import { startRouter, addRoute } from "./router.js";
import { getModules, buildNav } from "./modules/index.js";
// IMPORT CORRETO PARA NAVEGADOR (ESM = ECMAScript Module)
import { createClient as createSbClient } from "https://esm.sh/@supabase/supabase-js@2";

const appContainer = document.getElementById("app");
const navEl = document.getElementById("nav");
const authArea = document.getElementById("auth-area");

let currentModules = [];

/* ========= Utilidades de URL (Uniform Resource Locator) ========= */
function isRecoveryLink() {
  const url = new URL(window.location.href);
  return url.hash.includes("type=recovery") || url.searchParams.get("type") === "recovery";
}
function clearAuthParamsFromUrl() {
  const keepHash = window.location.hash.startsWith("#/") ? window.location.hash : "";
  const clean = window.location.origin + window.location.pathname + keepHash;
  window.history.replaceState({}, document.title, clean);
}
function extractTokensFromUrl() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  return {
    access_token: hashParams.get("access_token") || queryParams.get("access_token"),
    refresh_token: hashParams.get("refresh_token") || queryParams.get("refresh_token"),
  };
}

/* ========= Cliente isolado (sem persistir sessão, em memória) ========= */
function makeMemoryStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
}
let recoveryClient = null;
function getRecoveryClient() {
  if (recoveryClient) return recoveryClient;
  recoveryClient = createSbClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,      // não toca no localStorage
      autoRefreshToken: false,
      detectSessionInUrl: false,  // vamos setar sessão manualmente
      storage: makeMemoryStorage()
    },
  });
  return recoveryClient;
}
async function ensureRecoverySession() {
  const rc = getRecoveryClient();
  const { data: g } = await rc.auth.getSession();
  if (g?.session) return rc;

  const { access_token, refresh_token } = extractTokensFromUrl();
  if (!access_token || !refresh_token) return null;

  const { error } = await rc.auth.setSession({ access_token, refresh_token });
  if (error) return null;
  return rc;
}

/* ========= Módulos ========= */
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

/* ========= UI de autenticação ========= */
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
    navEl.innerHTML = "";
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
      const redirectTo = window.location.origin + window.location.pathname; // raiz da SPA
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      msg.textContent = error ? ("Erro: " + error.message) : "E-mail enviado.";
    };
  }
}

/* ========= Tela de redefinição (usa o cliente isolado) ========= */
function renderPasswordReset(rc) {
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
    if (p1 !== p2) { msg.textContent = "Senhas não conferem."; return; }
    msg.textContent = "Atualizando...";
    try {
      const { error } = await rc.auth.updateUser({ password: p1 });
      if (error) { msg.textContent = "Erro: " + error.message; return; }

      clearAuthParamsFromUrl();
      await rc.auth.signOut();   // encerra a sessão só deste cliente em memória
      msg.textContent = "Senha alterada. Faça login novamente.";
      await renderAuthArea(null);
      guardRoutes(null);
    } catch (err) {
      console.error(err);
      msg.textContent = "Erro inesperado ao atualizar a senha.";
    }
  };
}

/* ========= Proteção de rotas ========= */
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

/* ========= Fluxo inicial ========= */
const { data: { session } } = await supabase.auth.getSession();

if (isRecoveryLink()) {
  const rc = await ensureRecoverySession(); // cria sessão só nesta aba
  renderPasswordReset(rc || getRecoveryClient());
  guardRoutes(null);
} else {
  await setupModules(session);
  await renderAuthArea(session);
  guardRoutes(session);
}

/* ========= Eventos de sessão ========= */
supabase.auth.onAuthStateChange(async (event, sessionNow) => {
  if (isRecoveryLink()) return; // ignora eventos enquanto estiver no fluxo de recuperação
  await setupModules(sessionNow);
  await renderAuthArea(sessionNow);
  guardRoutes(sessionNow);
});
