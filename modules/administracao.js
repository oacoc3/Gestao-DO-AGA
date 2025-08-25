import { supabase } from "../supabaseClient.js";

// Perfis permitidos
const PERFIS = [
  "Administrador",
  "CH AGA",
  "CH OACO",
  "CH OAGA",
  "Analista OACO",
  "Analista OAGA",
  "Visitante"
];

export default {
  id: "administracao",
  title: "Administração",
  route: "#/administracao",
  async view(container) {
    container.innerHTML = `
      <div class="container">
        <div class="card">
          <h2>Gestão de Usuários</h2>
          <form id="user-form">
            <input type="hidden" id="user-id" />
            <div class="row">
              <div>
                <label>Email</label>
                <input id="email" type="email" />
              </div>
              <div>
                <label>Posto/Graduação</label>
                <input id="posto" />
              </div>
            </div>
            <div class="row">
              <div>
                <label>Nome de Guerra</label>
                <input id="nome-guerra" />
              </div>
              <div>
                <label>Nome Completo</label>
                <input id="nome-completo" />
              </div>
            </div>
            <div class="row">
              <div>
                <label>Perfil</label>
                <select id="perfil">
                  ${PERFIS.map(p => `<option value="${p}">${p}</option>`).join("")}
                </select>
              </div>
              <div class="right">
                <button type="button" id="salvar">Salvar</button>
                <button type="button" id="cancelar">Cancelar</button>
              </div>
            </div>
          </form>
          <div id="msg" class="small"></div>
        </div>
        <div class="card">
          <table class="table" id="user-table">
            <thead>
              <tr>
                <th>Posto/Graduação</th>
                <th>Nome de Guerra</th>
                <th>Nome Completo</th>
                <th>Perfil</th>
                <th>Email</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    const form = document.getElementById("user-form");
    const msg = document.getElementById("msg");
    const tbody = document.querySelector("#user-table tbody");
    const $id = document.getElementById("user-id");
    const $email = document.getElementById("email");
    const $posto = document.getElementById("posto");
    const $nomeGuerra = document.getElementById("nome-guerra");
    const $nomeCompleto = document.getElementById("nome-completo");
    const $perfil = document.getElementById("perfil");

    let token = null;
    const { data: sessionData } = await supabase.auth.getSession();
    token = sessionData.session?.access_token;

    async function fetchUsers() {
      tbody.innerHTML = "<tr><td colspan='6'>Carregando...</td></tr>";
      const res = await fetch("/.netlify/functions/adminUsers", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { data } = await res.json();
      renderTable(data || []);
    }

    function renderTable(users) {
      tbody.innerHTML = users
        .map(
          (u) => `
          <tr>
            <td>${u.posto_graduacao || ""}</td>
            <td>${u.nome_guerra || ""}</td>
            <td>${u.full_name || ""}</td>
            <td>${u.perfil || ""}</td>
            <td>${u.email}</td>
            <td>
              <button data-act="edit" data-id="${u.id}">Editar</button>
              <button data-act="del" data-id="${u.id}">Excluir</button>
            </td>
          </tr>
        `
        )
        .join("");
    }

    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === "edit") {
        const row = Array.from(tbody.querySelectorAll("tr")).find((r) =>
          r.querySelector(`button[data-id='${id}']`)
        );
        $id.value = id;
        $posto.value = row.children[0].textContent;
        $nomeGuerra.value = row.children[1].textContent;
        $nomeCompleto.value = row.children[2].textContent;
        $perfil.value = row.children[3].textContent;
        $email.value = row.children[4].textContent;
        msg.textContent = `Editando ${$email.value}`;
      } else if (btn.dataset.act === "del") {
        if (confirm("Excluir usuário?")) {
          await fetch("/.netlify/functions/adminUsers", {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ id }),
          });
          await fetchUsers();
          msg.textContent = "Usuário excluído.";
          form.reset();
        }
      }
    });

    document.getElementById("salvar").onclick = async () => {
      const payload = {
        email: $email.value.trim(),
        posto_graduacao: $posto.value.trim(),
        nome_guerra: $nomeGuerra.value.trim(),
        full_name: $nomeCompleto.value.trim(),
        perfil: $perfil.value,
      };
      const id = $id.value;
      let method = "POST";
      if (id) {
        payload.id = id;
        method = "PUT";
      }
      await fetch("/.netlify/functions/adminUsers", {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      msg.textContent = "Dados salvos.";
      form.reset();
      await fetchUsers();
    };

    document.getElementById("cancelar").onclick = () => {
      form.reset();
      msg.textContent = "";
    };

    await fetchUsers();
  },
};
