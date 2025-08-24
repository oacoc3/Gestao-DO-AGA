// app.js – Bootstrap do app: autenticação + rotas + menu
import { supabase } from "./supabaseClient.js";
import { startRouter, addRoute } from "./router.js";
import { modules, buildNav } from "./modules/index.js";

const appContainer = document.getElementById("app");
const navEl = document.getElementById("nav");
const authArea = document.getElementById("auth-area");

// Rotas dos módulos
modules.forEach(m => addRoute(m.route, (c) => m.view(c)));

// Autenticação (e-mail/senha)
function renderAuthArea(session) {
  if (session?.user) {
    authArea.innerHTML = `
      <span class="small">Logado: ${session.user.email}</span>
      <button id="btn-logout" style="margin-left:8px">Sair</button>
    `;
    document.getElementById("btn-logout").onclick = async () => {
      await supabase.auth.signOut();
    };
    buildNav(navEl);
  } else {
    authArea.innerHTML = `
      <form id="login-form" style="display:flex; gap:8px; align-items:center">
        <input id="email" type="email" placeholder="email" />
        <input id="password" type="password" placeholder="senha" />
        <button type="submit">Entrar</button>
        <button type="button" id="btn-signup">Cadastrar</button>
      </form>
      <div id="auth-msg" class="small"></div>
    `;
    navEl.innerHTML = ""; // esconde menu quando deslogado
    const form = document.getElementById("login-form");
    const msg = document.getElementById("auth-msg");
    form.onsubmit = async (e) => {
      e.preventDefault();
      msg.textContent = "Entrando...";
      const email = form.email.value.trim();
      const password = form.password.value;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      msg.textContent = error ? ("Erro: " + error.message) : "";
    };
    document.getElementById("btn-signup").onclick = async () => {
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        alert("Erro: " + error.message);
      } else {
        alert("Cadastro realizado. Verifique seu e-mail, se o projeto exigir confirmação.");
      }
    };
  }
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
const { data: { session } } = await supabase.auth.getSession();
renderAuthArea(session);
guardRoutes(session);

// Reage a mudanças de sessão (login/logout)
supabase.auth.onAuthStateChange((_event, sessionNow) => {
  renderAuthArea(sessionNow);
  guardRoutes(sessionNow);
});
