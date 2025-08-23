// modules/index.js – registro de módulos
import dashboard from "./dashboard.js";
import processos from "./processos.js";

export const modules = [
  dashboard,
  processos,
];

// Utilitário para gerar o menu de navegação
export function buildNav(navEl) {
  navEl.innerHTML = modules
    .map(m => `<a href="${m.route}">${m.title}</a>`)
    .join("");
}
