// router.js – roteador simples por hash (SPA)
const routes = new Map(); // route -> handler(container)

export function addRoute(path, handler) {
  routes.set(path, handler);
}

export function startRouter(container) {
  function render() {
    const hash = window.location.hash || "#/dashboard";
    const handler = routes.get(hash);
    if (handler) handler(container);
    else container.innerHTML = `<div class="container"><p>Rota não encontrada: ${hash}</p></div>`;
  }
  window.addEventListener("hashchange", render);
  render();
}
