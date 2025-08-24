// modules/administracao.js
// Módulo Administração (front-end)
// Usa os estilos existentes (.container, .card, .table) — sem mexer no layout geral
// Fala com a Function /.netlify/functions/adminUsers (acima)

const PERFIS = [
  "Administrador", "CH AGA", "CH OACO", "CH OAGA",
  "Analista OACO", "Analista OAGA", "Visitante"
];

const API = "/.netlify/functions/adminUsers";

async function api(method, body = null, query = "") {
  const res = await fetch(`${API}${query}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : null,
    credentials: "include"
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Erro ${res.status}`);
  return json;
}
function h(s){ return s == null ? "" : String(s); }

export default {
  id: "admin",
  title: "Administração",
  route: "#/admin",
  async view(container) {
    container.innerHTML = `
      <div class="container">
        <div class="card">
          <h2>Gerenciar usuários</h2>
          <div class="row">
            <div>
              <label>Posto/Graduação</label>
              <input id="a-pg" placeholder="Ex.: Maj" />
            </div>
            <div>
              <label>Nome de Guerra</label>
              <input id="a-guerra" placeholder="Ex.: SANTOS" />
            </div>
            <div>
              <label>Nome completo</label>
              <input id="a-full" placeholder="Ex.: Maria de Souza Santos" />
            </div>
            <div>
              <label>E-mail</label>
              <input id="a-email" type="email" placeholder="nome@dominio" />
            </div>
            <div>
              <label>Perfil</label>
              <select id="a-perfil">
                ${PERFIS.map(p => `<option value="${p}">${p}</option>`).join("")}
              </select>
            </div>
            <div>
              <label>Senha inicial (opcional)</label>
              <input id="a-pass" type="password" placeholder="gerada automaticamente se vazio" />
            </div>
          </div>
          <div class="row" style="align-items:center">
            <div class="small" id="a-msg"></div>
            <div class="right">
              <button id="a-novo" type="button">Novo</button>
              <button id="a-salvar" type="button">Criar</button>
              <button id="a-reset" type="button" disabled>Enviar link de redefinição</button>
              <button id="a-excluir" type="button" disabled>Excluir</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="row" style="align-items:center">
            <div><strong>Usuários</strong></div>
            <div class="right">
              <button id="a-prev" type="button">&larr; Anterior</button>
              <span id="a-page" class="small"></span>
              <button id="a-next" type="button">Próxima &rarr;</button>
            </div>
          </div>
          <table class="table" id="a-tab">
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Posto/Grad.</th>
                <th>Nome de Guerra</th>
                <th>Nome completo</th>
                <th class="right">Ações</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    const $pg = document.getElementById("a-pg");
    const $guerra = document.getElementById("a-guerra");
    const $full = document.getElementById("a-full");
    const $email = document.getElementById("a-email");
    const $perfil = document.getElementById("a-perfil");
    const $pass = document.getElementById("a-pass");
    const $msg = document.getElementById("a-msg");

    const $novo = document.getElementById("a-novo");
    const $salvar = document.getElementById("a-salvar");
    const $reset = document.getElementById("a-reset");
    const $excluir = document.getElementById("a-excluir");

    const $tbody = document.querySelector("#a-tab tbody");
    const $page = document.getElementById("a-page");
    const $prev = document.getElementById("a-prev");
    const $next = document.getElementById("a-next");

    let editingId = null;
    let page = 1, size = 50;

    function formToPayload() {
      return {
        id: editingId || undefined,
        email: h($email.value).trim(),
        perfil: $perfil.value,
        posto_graduacao: h($pg.value).trim(),
        nome_guerra: h($guerra.value).trim(),
        full_name: h($full.value).trim(),
        password: h($pass.value).trim() || undefined
      };
    }
    function clearForm(keepEmail = false) {
      editingId = null;
      if (!keepEmail) $email.value = "";
      $perfil.value = "Visitante";
      $pg.value = "";
      $guerra.value = "";
      $full.value = "";
      $pass.value = "";
      $salvar.textContent = "Criar";
      $reset.disabled = true;
      $excluir.disabled = true;
      $msg.textContent = "";
    }
    function fillForm(row) {
      editingId = row.id;
      $email.value = row.email || "";
      $perfil.value = row.perfil || "Visitante";
      $pg.value = row.posto_graduacao || "";
      $guerra.value = row.nome_guerra || "";
      $full.value = row.full_name || "";
      $pass.value = "";
      $salvar.textContent = "Salvar alterações";
      $reset.disabled = false;
      $excluir.disabled = false;
      $msg.textContent = "";
    }

    async function load(pageNum = 1) {
      const { data } = await api("GET", null, `?page=${pageNum}&size=${size}`);
      $tbody.innerHTML = (data || []).map(u => `
        <tr data-id="${u.id}">
          <td>${h(u.email)}</td>
          <td>${h(u.perfil)}</td>
          <td>${h(u.posto_graduacao)}</td>
          <td>${h(u.nome_guerra)}</td>
          <td>${h(u.full_name)}</td>
          <td class="right">
            <button class="a-edit" type="button">Editar</button>
          </td>
        </tr>
      `).join("");
      $page.textContent = `Página ${pageNum}`;
      page = pageNum;
    }

    // Eventos
    $tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      const id = tr.getAttribute("data-id");
      if (e.target.classList.contains("a-edit")) {
        const cells = tr.children;
        fillForm({
          id,
          email: cells[0].textContent,
          perfil: cells[1].textContent,
          posto_graduacao: cells[2].textContent,
          nome_guerra: cells[3].textContent,
          full_name: cells[4].textContent
        });
      }
    });

    $novo.addEventListener("click", () => clearForm());
    $prev.addEventListener("click", () => load(Math.max(1, page - 1)));
    $next.addEventListener("click", () => load(page + 1));

    $salvar.addEventListener("click", async () => {
      try {
        const payload = formToPayload();
        if (!payload.email) { alert("Informe o e-mail."); return; }
        if (!payload.perfil) { alert("Selecione o perfil."); return; }
        if (editingId) {
          await api("PUT", payload);
          $msg.textContent = "Usuário atualizado.";
        } else {
          await api("POST", payload);
          $msg.textContent = "Usuário criado.";
        }
        await load(page);
      } catch (err) {
        alert("Erro: " + err.message);
      }
    });

    $reset.addEventListener("click", async () => {
      if (!editingId) return;
      try {
        await api("POST", { email: $email.value }, "?action=reset");
        alert("Se SMTP estiver configurado no Supabase, a mensagem de redefinição foi enviada.");
      } catch (err) {
        alert("Erro: " + err.message);
      }
    });

    $excluir.addEventListener("click", async () => {
      if (!editingId) return;
      if (!confirm("Confirma excluir este usuário?")) return;
      try {
        await api("DELETE", { id: editingId });
        clearForm();
        await load(page);
      } catch (err) {
        alert("Erro: " + err.message);
      }
    });

    clearForm();
    await load(1);
  }
};
