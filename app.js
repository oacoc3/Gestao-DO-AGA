// app.js
// Roteador simples por hash. Garante que '#/admin' só abre se logado como Administrador.
// Siglas:
// - JWT: JSON Web Token (traz app_metadata.perfil)
// - SPA: Single Page Application (aplicação de página única)

import { supabase } from "./supabaseClient.js";

// IMPORTS DOS MÓDULOS
import auth from "./modules/auth.js";
import admin from "./modules/admin.js";
import processos from "./modules/processos.js"; // seu módulo já existente

const MODULES = [auth, processos, admin];

function findModuleByRoute(hash) {
  return MODULES.find(m => m.route === hash) || null;
}

async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

async function isAdmin() {
  const sess = await getSession();
  return (sess?.user?.app_metadata?.perfil || "Visitante") === "Administrador";
}

async function navigate() {
  const hash = location.hash || "#/entrar";
  let mod = findModuleByRoute(hash);

  // Guarda simples:
  const sess = await getSession();

  if (!sess && hash !== "#/entrar") {
    location.hash = "#/entrar";
    return;
  }

  if (hash === "#/admin" && !(await isAdmin())) {
    // usuário logado mas não admin → manda para processos
    location.hash = "#/processos";
    return;
  }

  if (!mod) {
    // rota desconhecida
    location.hash = sess ? "#/processos" : "#/entrar";
    return;
  }

  const root = document.getElementById("app-root") || document.body;
  await mod.view(root);
}

window.addEventListener("hashchange", navigate);
window.addEventListener("load", navigate);
