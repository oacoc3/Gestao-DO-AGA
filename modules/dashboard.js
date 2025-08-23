// modules/dashboard.js
export default {
  id: "dashboard",
  title: "Início",
  route: "#/dashboard",
  view(container) {
    container.innerHTML = `
      <div class="container">
        <div class="card">
          <h2>Bem-vindo(a)!</h2>
          <p>Esta é uma SPA (Single-Page Application) conectada ao Supabase.</p>
          <p>Use o menu acima para navegar entre os módulos.</p>
        </div>
      </div>
    `;
  },
};
