// modules/admin.js
// Administração de usuários via Netlify Function protegida.
// Ao criar usuário: NÃO define senha e já envia e-mail de "Definir senha".
//
// Siglas:
// - JWT: JSON Web Token (contém app_metadata.perfil do usuário)
// - RLS: Row Level Security (regras de acesso no banco)
// - CRUD: Create, Read, Update, Delete (Criar/Ler/Atualizar/Excluir)

import { supabase } from "../supabaseClient.js";

function cssOnce() {
  if (document.getElementById("admin-css")) return;
  const st = document.createElement("style");
  st.id = "admin-css";
  st.textContent = `
    .adm-card { padding:12px; }
    .row { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; }
    .row > div { display:flex; flex-direction:column; }
    .row label { margin-bottom:4px; }
    .row input, .row select, .row button { height:34px; }
    .grid { margin-top:12px; height: calc(100vh - 280px); overflow:auto; }
    .grid table { width:100%; border-collapse:collapse; }
    .grid th, .grid td { border-bottom:1px solid #ddd; padding:6px; font-size:12px; text-align:center; white-space:nowrap; }
    .grid thead th { position: sticky; top:0; background:#fff; }
    .actions button { margin:0 2px; }
    .msg { margin-top:8px; font-size:12px; }
  `;
  document.head.appendChild(st);
}

async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

async function ensureAdmin() {
  const sess = await getSession();
  const perfil = sess?.user?.app_metadata?.perfil || "Visitante";
  return perfil === "Administrador";
}

async function callAPI(path, method="GET", body=null) {
  const sess = await getSession();
  const token = sess?.access_token;
  const res = await fetch(`/.netlify/functions/adminUsers${path || ""}`, {
    method,
    headers: {
      "Content-Type":"application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

const PERFIS = ['Administrador','CH AGA','CH OACO','CH OAGA','Analista OACO','Analista OAGA','Visitante'];

export default {
  id: "admin",
  title: "Administração",
  route: "#/admin",
  async view(container) {
    cssOnce();

    container.innerHTML = `
      <div class="container">
        <div class="card adm-card">
          <h3>Administração de Usuários</h3>

          <div id="adm-guard"><em>Validando permissões...</em></div>

          <div id="adm-area" style="display:none">
            <h4>Novo/Editar usuário</h4>
            <div class="row">
              <div><label>Posto/Graduação</label><input id="pg" /></div>
              <div><label>Nome de Guerra</label><input id="ng" /></div>
              <div><label>Nome completo</label><input id="fn" /></div>
              <div><label>E-mail</label><input id="em" type="email" /></div>
              <div>
                <label>Perfil</label>
                <select id="pf">${PERFIS.map(p=>`<option value="${p}">${p}</option>`).join("")}</select>
              </div>
              <!-- Campo de senha não é usado no fluxo simples; mantido para futuro, se quiser -->
              <div><label>Senha inicial (ignorada)</label><input id="pw" type="password" placeholder="Fluxo envia e-mail para definir senha" disabled /></div>
              <div><label>&nbsp;</label><button id="btn-save">Salvar</button></div>
              <div><label>&nbsp;</label><button id="btn-clear" type="button">Limpar</button></div>
            </div>

            <div class="msg" id="msg"></div>

            <h4 style="margin-top:12px">Usuários</h4>
            <div class="grid">
              <table>
                <thead>
                  <tr>
                    <th>Posto/Graduação</th>
                    <th>Nome de Guerra</th>
                    <th>Nome completo</th>
                    <th>E-mail</th>
                    <th>Perfil</th>
                    <th>Deve trocar senha?</th>
                    <th>Atualizado em</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody id="tb"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;

    const $guard = container.querySelector("#adm-guard");
    const $area  = container.querySelector("#adm-area");
    const $msg   = container.querySelector("#msg");
    const $tb    = container.querySelector("#tb");

    const $pg = container.querySelector("#pg");
    const $ng = container.querySelector("#ng");
    const $fn = container.querySelector("#fn");
    const $em = container.querySelector("#em");
    const $pf = container.querySelector("#pf");
    const $pw = container.querySelector("#pw"); // ignorado

    let editingId = null;

    // Guarda
    if (!(await ensureAdmin())) {
      $guard.innerHTML = `<span style="color:#900">Acesso negado.</span> Este módulo é restrito a <strong>Administrador</strong>.`;
      return;
    }
    $guard.style.display = "none";
    $area.style.display = "";

    // Funções
    function clearForm() {
      editingId = null;
      $pg.value = ""; $ng.value = ""; $fn.value = ""; $em.value = ""; $pf.value = "Visitante"; $pw.value = "";
      $msg.textContent = "Preencha os dados e clique em Salvar.";
    }

    async function loadPage() {
      $msg.textContent = "Carregando usuários...";
      try {
        const { data } = await callAPI("", "GET");
        renderTable(data || []);
        $msg.textContent = `${(data||[]).length} usuários carregados.`;
      } catch(e) {
        $msg.textContent = "Erro: " + e.message;
      }
    }

    function renderTable(rows) {
      $tb.innerHTML = rows.map(r => `
        <tr data-id="${r.id}">
          <td>${r.posto_graduacao || ""}</td>
          <td>${r.nome_guerra || ""}</td>
          <td>${r.full_name || ""}</td>
          <td>${r.email || ""}</td>
          <td>${r.perfil || ""}</td>
          <td>${r.must_change_password ? "Sim" : "Não"}</td>
          <td>${r.updated_at ? new Date(r.updated_at).toLocaleString() : ""}</td>
          <td class="actions">
            <button class="btn-edit">Editar</button>
            <button class="btn-reset">Resetar senha</button>
            <button class="btn-del">Excluir</button>
          </td>
        </tr>
      `).join("");

      // Binds por linha
      $tb.querySelectorAll(".btn-edit").forEach(btn => {
        btn.onclick = () => {
          const tr = btn.closest("tr");
          const id = tr.getAttribute("data-id");
          const tds = tr.querySelectorAll("td");
          editingId = id;
          $pg.value = tds[0].textContent;
          $ng.value = tds[1].textContent;
          $fn.value = tds[2].textContent;
          $em.value = tds[3].textContent;
          $pf.value = tds[4].textContent || "Visitante";
          $pw.value = "";
          $msg.textContent = "Editando usuário. Altere os campos e clique em Salvar.";
          window.scrollTo({ top: 0, behavior: "smooth" });
        };
      });

      $tb.querySelectorAll(".btn-reset").forEach(btn => {
        btn.onclick = async () => {
          const tr = btn.closest("tr");
          const email = tr.querySelectorAll("td")[3].textContent;
          if (!confirm(`Enviar e-mail de redefinição de senha para ${email}?`)) return;
          try {
            $msg.textContent = "Enviando link de redefinição...";
            await callAPI("?action=reset", "POST", { email });
            $msg.textContent = "Link enviado (se o e-mail existir).";
          } catch (e) {
            $msg.textContent = "Erro: " + e.message;
          }
        };
      });

      $tb.querySelectorAll(".btn-del").forEach(btn => {
        btn.onclick = async () => {
          const tr = btn.closest("tr");
          const id = tr.getAttribute("data-id");
          const email = tr.querySelectorAll("td")[3].textContent;
          if (!confirm(`Excluir o usuário ${email}? Esta ação não pode ser desfeita.`)) return;
          try {
            $msg.textContent = "Excluindo...";
            await callAPI("", "DELETE", { id });
            await loadPage();
            $msg.textContent = "Usuário excluído.";
          } catch (e) {
            $msg.textContent = "Erro: " + e.message;
          }
        };
      });
    }

    // Ações do formulário
    container.querySelector("#btn-save").onclick = async () => {
      const payload = {
        email: $em.value.trim(),
        perfil: $pf.value,
        posto_graduacao: $pg.value,
        nome_guerra: $ng.value,
        full_name: $fn.value
        // password intencionalmente NÃO enviado (fluxo por e-mail)
      };

      try {
        if (!payload.email || !payload.perfil) {
          $msg.textContent = "E-mail e Perfil são obrigatórios.";
          return;
        }

        if (!editingId) {
          // CRIAR: sem senha, e já dispara e-mail de "definir senha"
          $msg.textContent = "Criando usuário...";
          await callAPI("", "POST", payload);

          $msg.textContent = "Enviando e-mail para definir senha...";
          await callAPI("?action=reset", "POST", { email: payload.email });

          clearForm();
          await loadPage();
          $msg.textContent = "Usuário criado. Ele recebeu um e-mail para definir a senha.";
        } else {
          // ATUALIZAR
          $msg.textContent = "Atualizando usuário...";
          await callAPI("", "PUT", { id: editingId, ...payload });
          clearForm();
          await loadPage();
          $msg.textContent = "Usuário atualizado.";
        }
      } catch (e) {
        $msg.textContent = "Erro: " + e.message;
      }
    };

    container.querySelector("#btn-clear").onclick = clearForm;

    // Init
    clearForm();
    await loadPage();
  }
};
