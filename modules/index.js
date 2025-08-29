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
    .map(m => `<a href="${m.route}" data-route="${m.route}">${m.title}</a>`)
    .join("");

  const highlight = () => {
    const h = window.location.hash || "#/dashboard";
    navEl.querySelectorAll("a").forEach(a => {
      a.classList.toggle("active", a.getAttribute("data-route") === h);
    });
  };

  navEl.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      const href = a.getAttribute("href");
      window.location.href = href;
      window.location.reload();
    });
  });

  highlight();
  window.addEventListener("hashchange", highlight);
}
