// modules/processos.js
// Observação de siglas usadas neste arquivo:
// - CRUD: Create, Read, Update, Delete (Criar, Ler, Atualizar, Excluir)

import { supabase } from "../supabaseClient.js";

const TIPOS = ["PDIR", "Inscrição/Alteração", "Exploração", "OPEA"];
const STATUS = [
  "Análise Documental", "Análise Técnica Preliminar", "Análise Técnica",
  "Parecer ATM", "Parecer DT", "Notificação", "Revisão OACO", "Aprovação",
  "Sobrestado Documental", "Sobrestado Técnico", "Análise ICA",
  "Publicação de Portaria", "Concluído", "Remoção/Rebaixamento", "Término de Obra"
];

// --------- Acesso ao banco ---------

async function listProcessos() {
  const { data, error } = await supabase
    .from("processos")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data;
}

async function getProcessoByNup(nup) {
  const { data, error } = await supabase
    .from("processos")
    .select("*")
    .eq("nup", nup)
    .maybeSingle(); // data = objeto ou null
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

// --------- Views auxiliares (tabela permanece igual) ---------

function viewTabela(list) {
  // Mantida exatamente como antes (não solicitado alterar a grade)
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

// --------- Novo formulário (conforme solicitado) ---------

function viewFormulario() {
  return `
    <div class="card">
      <h3>Insira o NUP do Processo</h3>

      <div class="row" style="align-items:flex-end">
        <div>
          <label>NUP</label>
          <input id="f-nup" placeholder="00000.000000/0000-00" />
        </div>
        <div style="flex:0 0 auto">
          <button id="btn-buscar">Buscar</button>
        </div>
      </div>

      <div class="row" style="margin-top:8px">
        <div>
          <label>Tipo</label>
          <select id="f-tipo" disabled>
            <option value="" disabled selected hidden>-- selecione --</option>
            ${TIPOS.map(t => `<option value="${t}">${t}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>1ª Entrada Regional</label>
          <input id="f-entrada" type="date" disabled />
        </div>
        <div>
          <label>Status</label>
          <select id="f-status" disabled>
            <option value="" disabled selected hidden>-- selecione --</option>
            ${STATUS.map(s => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </div>
      </div>

      <div style="margin-top:12px">
        <button id="btn-salvar" disabled>Salvar</button>
      </div>

      <div id="msg-novo" class="small" style="margin-top:8px"></div>
    </div>
  `;
}

// --------- Comportamento do formulário ---------

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
    // Renderização inicial
    container.innerHTML = `
      <div class="container">
        ${viewFormulario()}
        <div class="card">
          <h3>Lista de processos</h3>
          <div id="grid">Carregando...</div>
        </div>
      </div>
    `;

    // Referências dos elementos do formulário
    const el = (sel) => container.querySelector(sel);
    const $nup     = el("#f-nup");
    const $tipo    = el("#f-tipo");
    const $entrada = el("#f-entrada");
    const $status  = el("#f-status");
    const $buscar  = el("#btn-buscar");
    const $salvar  = el("#btn-salvar");
    const $msg     = el("#msg-novo");
    const grid     = el("#grid");

    // Estado interno simples do formulário
    let currentAction = null;     // 'update' | 'create' | null
    let currentRowId = null;      // id do processo quando encontrado
    let originalStatus = null;    // status antes de editar (para habilitar o Salvar somente se mudar)
    let pendingNup = "";          // NUP digitado quando for criar

    // Utilidades de UI
    function resetForm() {
      $msg.textContent = "";
      $tipo.value = "";
      $entrada.value = "";
      $status.value = "";
      $tipo.disabled = true;
      $entrada.disabled = true;
      $status.disabled = true;
      $salvar.disabled = true;
      currentAction = null;
      currentRowId = null;
      originalStatus = null;
      pendingNup = "";
    }

    function setCreateMode(nup) {
      pendingNup = nup;
      $msg.textContent = "Preencha os campos e clique em Salvar.";
      $tipo.disabled = false;
      $entrada.disabled = false;
      $status.disabled = false;
      $salvar.disabled = false; // pode salvar quando todos obrigatórios estiverem preenchidos (validação abaixo)
      currentAction = "create";
    }

    function setUpdateMode(row) {
      currentAction = "update";
      currentRowId = row.id;
      originalStatus = row.status;

      // Preenche campos
      $tipo.value = row.tipo || "";
      $entrada.value = row.entrada_regional || "";
      $status.value = row.status || "";

      // Travar Tipo e 1ª Entrada; Status liberado
      $tipo.disabled = true;
      $entrada.disabled = true;
      $status.disabled = false;

      // O botão Salvar só habilita se o usuário mudar o Status
      $salvar.disabled = true;
      $msg.textContent = "Processo encontrado. Altere o Status se necessário e clique em Salvar.";
    }

    function perguntaCriar(onDecide) {
      // Mensagem com botões Sim/Não (sem alterar layout geral)
      $msg.innerHTML = `
        Processo não encontrado, gostaria de criar?
        <button id="btn-sim" style="margin-left:8px">Sim</button>
        <button id="btn-nao" style="margin-left:4px">Não</button>
      `;
      el("#btn-sim").onclick = () => onDecide(true);
      el("#btn-nao").onclick = () => onDecide(false);
    }

    function validarObrigatoriosParaCriar() {
      if (!$tipo.value) { alert("Selecione o Tipo."); return false; }
      if (!$entrada.value) { alert("Informe a 1ª Entrada Regional."); return false; }
      if (!$status.value) { alert("Selecione o Status."); return false; }
      return true;
    }

    // Regras de habilitação do botão Salvar durante edição (update)
    $status.addEventListener("change", () => {
      if (currentAction === "update") {
        $salvar.disabled = ($status.value === originalStatus || !$status.value);
      }
    });

    // Clique em Buscar
    $buscar.addEventListener("click", async () => {
      const nup = ($nup.value || "").trim();
      if (!nup) {
        $msg.textContent = "Informe o NUP.";
        $nup.focus();
        return;
      }

      resetForm(); // limpa e bloqueia campos antes de buscar
      $msg.textContent = "Buscando...";

      try {
        const row = await getProcessoByNup(nup);
        if (row) {
          setUpdateMode(row);
        } else {
          // Pergunta se deseja criar
          perguntaCriar((decisao) => {
            if (decisao) setCreateMode(nup);
            else resetForm();
          });
        }
      } catch (e) {
        $msg.textContent = "Erro ao buscar: " + e.message;
      }
    });

    // Clique em Salvar (criar OU atualizar status)
    $salvar.addEventListener("click", async () => {
      try {
        if (currentAction === "update") {
          // Atualiza apenas o Status
          if ($status.value === originalStatus || !$status.value) {
            alert("Altere o Status para salvar.");
            return;
          }
          await updateStatus(currentRowId, $status.value);
          $msg.textContent = "Status atualizado com sucesso.";
          originalStatus = $status.value;
          $salvar.disabled = true;
          await refresh();
        } else if (currentAction === "create") {
          // Validação simples de obrigatórios
          if (!validarObrigatoriosParaCriar()) return;

          const payload = {
            nup: pendingNup,
            tipo: $tipo.value,
            status: $status.value,
            entrada_regional: $entrada.value,
            // Os campos 'prazo_saida_regional' e 'saida_regional' NÃO são usados aqui
          };

          await createProcesso(payload);
          $msg.textContent = "Processo criado com sucesso.";
          // Após criar, bloqueia campos como se tivesse encontrado (modo update)
          const novo = await getProcessoByNup(pendingNup);
          if (novo) setUpdateMode(novo);
          await refresh();
        } else {
          alert("Use o botão Buscar antes de salvar.");
        }
      } catch (e) {
        alert("Erro ao salvar: " + e.message);
      }
    });

    // --------- Lista (grid) ---------
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

    // Estado inicial do formulário (apenas NUP habilitado)
    resetForm();
    await refresh();
  },
};
