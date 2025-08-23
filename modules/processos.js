// modules/processos.js
import { supabase } from "../supabaseClient.js";

const TIPOS = ["PDIR", "Inscrição/Alteração", "Exploração", "OPEA"];
const STATUS = [
  "Análise Documental", "Análise Técnica Preliminar", "Análise Técnica",
  "Parecer ATM", "Parecer DT", "Notificação", "Revisão OACO", "Aprovação",
  "Sobrestado Documental", "Sobrestado Técnico", "Análise ICA",
  "Publicação de Portaria", "Concluído", "Remoção/Rebaixamento", "Término de Obra"
];

async function listProcessos() {
  const { data, error } = await supabase
    .from("processos")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data;
}

async function createProcesso(payload) {
  const { data, error } = await supabase
    .from("processos")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateStatus(id, newStatus) {
  const { data, error } = await supabase
    .from("processos")
    .update({ status: newStatus })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getHistorico(processoId) {
  const { data, error } = await supabase
    .from("status_history")
    .select("*")
    .eq("processo_id", processoId)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return data;
}

function viewTabela(list) {
  return `
    <table class="table">
      <thead>
        <tr>
          <th>NUP</th>
          <th>Tipo</th>
          <th>Status</th>
          <th>1ª Entrada Regional</th>
          <th>Prazo Saída Regional</th>
          <th>Saída Regional</th>
          <th class="right">Modificado por</th>
          <th>Atualizado em</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(row => `
          <tr data-id="${row.id}">
            <td>${row.nup}</td>
            <td>${row.tipo}</td>
            <td>
              <select class="status-select">
                ${STATUS.map(s => `<option ${s === row.status ? "selected" : ""}>${s}</option>`).join("")}
              </select>
            </td>
            <td>${row.entrada_regional ?? ""}</td>
            <td>${row.prazo_saida_regional ?? ""}</td>
            <td>${row.saida_regional ?? ""}</td>
            <td class="right small">${row.modificado_por ?? ""}</td>
            <td class="small">${new Date(row.updated_at).toLocaleString()}</td>
            <td><button class="btn-historico">Histórico</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function viewFormularioNovo() {
  return `
    <div class="card">
      <h3>Novo processo</h3>
      <div class="row">
        <div>
          <label>NUP</label>
          <input id="f-nup" placeholder="00000.000000/0000-00" />
        </div>
        <div>
          <label>Tipo</label>
          <select id="f-tipo">
            ${TIPOS.map(t => `<option>${t}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Status</label>
          <select id="f-status">
            ${STATUS.map(s => `<option>${s}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="row">
        <div>
          <label>1ª Entrada Regional</label>
          <input id="f-entrada" type="date" />
        </div>
        <div>
          <label>Prazo Saída Regional</label>
          <input id="f-prazo" type="date" />
        </div>
        <div>
          <label>Saída Regional</label>
          <input id="f-saida" type="date" />
        </div>
      </div>
      <div style="margin-top:12px">
        <button id="btn-criar">Salvar</button>
      </div>
      <div id="msg-novo" class="small"></div>
    </div>
  `;
}

function bindCriar(container, refresh) {
  const el = (id) => container.querySelector(id);
  el("#btn-criar").addEventListener("click", async () => {
    const payload = {
      nup: el("#f-nup").value.trim(),
      tipo: el("#f-tipo").value,
      status: el("#f-status").value,
      entrada_regional: el("#f-entrada").value || null,
      prazo_saida_regional: el("#f-prazo").value || null,
      saida_regional: el("#f-saida").value || null,
    };
    const msg = el("#msg-novo");
    msg.textContent = "Salvando...";
    try {
      if (!payload.nup) throw new Error("Informe o NUP.");
      await createProcesso(payload);
      msg.textContent = "Criado com sucesso.";
      await refresh();
    } catch (e) {
      msg.textContent = "Erro: " + e.message;
    }
  });
}

function bindTabela(container, refresh) {
  container.querySelectorAll("tr[data-id]").forEach(tr => {
    const id = tr.getAttribute("data-id");
    const select = tr.querySelector(".status-select");
    select.addEventListener("change", async () => {
      const newStatus = select.value;
      try {
        await updateStatus(id, newStatus);
        await refresh();
      } catch (e) {
        alert("Erro ao atualizar status: " + e.message);
      }
    });
    tr.querySelector(".btn-historico").addEventListener("click", async () => {
      try {
        const hist = await getHistorico(id);
        alert(hist.length
          ? hist.map(h => `${new Date(h.changed_at).toLocaleString()} • ${h.old_status ?? "(novo)"} → ${h.new_status}`).join("\n")
          : "Sem histórico.");
      } catch (e) {
        alert("Erro ao carregar histórico: " + e.message);
      }
    });
  });
}

export default {
  id: "processos",
  title: "Processos",
  route: "#/processos",
  async view(container) {
    container.innerHTML = `
      <div class="container">
        ${viewFormularioNovo()}
        <div class="card">
          <h3>Lista de processos</h3>
          <div id="grid">Carregando...</div>
        </div>
      </div>
    `;

    const grid = container.querySelector("#grid");

    const refresh = async () => {
      grid.textContent = "Carregando...";
      try {
        const list = await listProcessos();
        grid.innerHTML = viewTabela(list);
        bindTabela(container, refresh);
      } catch (e) {
        grid.innerHTML = `<p>Erro ao carregar: ${e.message}</p>`;
      }
    };

    bindCriar(container, refresh);
    await refresh();
  },
};
