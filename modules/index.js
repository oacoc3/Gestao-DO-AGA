// modules/index.js – registro de módulos
import dashboard from "./dashboard.js";
import processos from "./processos.js";
import administracao from "./administracao.js";
import prazos from "./prazos.js";
// Retorna a lista de módulos conforme o perfil do usuário
export function getModules(perfil) {
  const mods = [dashboard, processos, prazos];
  if (perfil === "Administrador") mods.push(administracao);
  return mods;
}

// Utilitário para gerar o menu de navegação
export function buildNav(navEl, modules) {
  navEl.innerHTML = modules
    .map(m => `<a href="${m.route}">${m.title}</a>`)
    .join("");
}
