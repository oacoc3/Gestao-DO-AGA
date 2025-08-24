// modules/administracao.js
export default {
  id: "administracao",
  title: "Administração",
  route: "#/administracao",
  view(container) {
    container.innerHTML = `
      <div class="container">
        <div class="card">
          <h2>Administração</h2>
          <p>Módulo de administração.</p>
        </div>
      </div>
    `;
  },
};
