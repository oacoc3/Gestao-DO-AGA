// modules/index.js – registro de módulos
import dashboard from "./dashboard.js";
import processos from "./processos.js";
import administracao from "./administracao.js";

export const modules = [
  dashboard,
  processos,
  administracao,
];

// Utilitário para gerar o menu de navegação
export function buildNav(navEl) {
  navEl.innerHTML = modules
    .map(m => `<a href="${m.route}">${m.title}</a>`)
    .join("");
}
