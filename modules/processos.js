// modules/processos.js
// Siglas usadas:
// - CRUD: Create, Read, Update, Delete (Criar, Ler, Atualizar, Excluir)
// - RLS: Row Level Security (Segurança em nível de linha)

import { supabase } from "../supabaseClient.js";

const TIPOS = ["PDIR", "Inscrição/Alteração", "Exploração", "OPEA"];
const STATUS = [
  "Análise Documental", "Análise Técnica Preliminar", "Análise Técnica",
  "Parecer ATM", "Parecer DT", "Notificação", "Revisão OACO", "Aprovação",
  "Sobrestado Documental", "Sobrestado Técnico", "Análise ICA",
  "Publicação de Portaria", "Concluído", "Remoção/Rebaixamento", "Término de Obra"
];

// ========= Utilitários: máscara/validação do NUP =========

/** Remove tudo que não for dígito e limita a 17 algarismos */
function onlyDigits17(value) {
  return (value || "").replace(/\D/g, "").slice(0, 17);
}

/** Aplica o formato 00000.000000/0000-00 sobre uma string com até 17 dígitos */
function maskNUP(digits) {
  const d = onlyDigits17(digits);
  const len = d.length;
  if (len === 0) return "";
  if (len <= 5) return d;
  if (len <= 11) return d.slice(0, 5) + "." + d.slice(5);
  if (len <= 15) return d.slice(0, 5) + "." + d.slice(5, 11) + "/" + d.slice(11);
  return (
    d.slice(0, 5) + "." +
    d.slice(5, 11) + "/" +
    d.slice(11, 15) + "-" +
    d.slice(15, 17)
  );
}

/** Retorna true se houver 17 dígitos (NUP completo) */
function isFullNUP(value) {
  return onlyDigits17(value).length === 17;
}

// ========= Acesso ao banco =========

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
    .eq("nup", nup) // buscamos pelo NUP já mascarado
    .maybeSingle();
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

async function deleteProcesso(id) {
  const { error } = await supabase
    .from("processos")
    .delete()
    .eq("id", id);
  if (error) throw error;
  return true;
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

// ========= Tabela (inalterada) =========

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

// ========= Formulário =========

function viewFormulario() {
  return `
    <div class="card">
      <h3>Insira o NUP do Processo</h3>

      <div class="row" style="align-items:flex-end">
        <div>
          <label>NUP</label>
          <input id="f-nup" inputmode="numeric" autocomplete="off" placeholder="00000.000000/0000-00" />
        </div>
        <div style="flex:0 0 auto; display:flex; gap:8px">
          <button id="btn-buscar">Buscar</button>
          <button id="btn-limpar" type="button">Limpar</button>
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
        <button id="btn-excluir" disabled style="margin-left:8px">Excluir</button>
      </div>

      <div id="msg-novo" class="small" style="margin-top:8px"></div>
    </div>
  `;
}

// ========= Comportamento =========

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
        ${viewFormulario()}
        <div class="card">
          <h3>Lista de processos</h3>
          <div id="grid">Carregando...</div>
        </div>
      </div>
    `;

    const el = (sel) => container.querySelector(sel);
    const $nup     = el("#f-nup");
    const $tipo    = el("#f-tipo");
    const $entrada = el("#f-entrada");
    const $status  = el("#f-status");
    const $buscar  = el("#btn-buscar");
    const $limpar  = el("#btn-limpar");
    const $salvar  = el("#btn-salvar");
    const $excluir = el("#btn-excluir");
    const $msg     = el("#msg-novo");
    const grid     = el("#grid");

    let currentAction = null;   // 'update' | 'create' | null
    let currentRowId = null;
    let originalStatus = null;
    let pendingNup = "";

    // === Máscara do NUP ===
    $nup.addEventListener("input", () => {
      const digits = onlyDigits17($nup.value);
      $nup.value = maskNUP(digits);
    });

    // Reset padrão (aceita limpar também o NUP)
    function resetForm(clearNup = false) {
      $msg.textContent = "";
      if (clearNup) $nup.value = "";
      $tipo.value = "";
      $entrada.value = "";
      $status.value = "";
      $tipo.disabled = true;
      $entrada.disabled = true;
      $status.disabled = true;
      $salvar.disabled = true;
      $excluir.disabled = true;
      currentAction = null;
      currentRowId = null;
      originalStatus = null;
      pendingNup = "";
    }

    function setCreateMode(nupMasked) {
      pendingNup = nupMasked;
      $msg.textContent = "Preencha os campos e clique em Salvar.";
      $tipo.disabled = false;
      $entrada.disabled = false;
      $status.disabled = false;
      $salvar.disabled = false;
      $excluir.disabled = true; // só em update
      currentAction = "create";
    }

    function setUpdateMode(row) {
      currentAction = "update";
      currentRowId = row.id;
      originalStatus = row.status;

      $tipo.value = row.tipo || "";
      $entrada.value = row.entrada_regional || "";
      $status.value = row.status || "";

      $tipo.disabled = true;
      $entrada.disabled = true;
      $status.disabled = false;

      $salvar.disabled = true; // habilita só se mudar o status
      $excluir.disabled = false;
      $msg.textContent = "Processo encontrado. Altere o Status se necessário e clique em Salvar (ou Excluir).";
    }

    function perguntaCriar(onDecide) {
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

    $status.addEventListener("change", () => {
      if (currentAction === "update") {
        $salvar.disabled = ($status.value === originalStatus || !$status.value);
      }
    });

    // Buscar
    $buscar.addEventListener("click", async () => {
      const digits = onlyDigits17($nup.value);
      if (digits.length !== 17) {
        $msg.textContent = "Informe um NUP completo (17 dígitos).";
        $nup.focus();
        return;
      }
      const nupMasked = maskNUP(digits);

      resetForm(false); // mantém o NUP visível durante a busca
      $msg.textContent = "Buscando...";

      try {
        const row = await getProcessoByNup(nupMasked);
        if (row) {
          setUpdateMode(row);
        } else {
          perguntaCriar((decisao) => {
            if (decisao) setCreateMode(nupMasked);
            else { resetForm(true); $nup.focus(); } // 'Não' limpa o NUP
          });
        }
      } catch (e) {
        $msg.textContent = "Erro ao buscar: " + e.message;
      }
    });

    // Limpar (NUP + reset)
    $limpar.addEventListener("click", () => {
      resetForm(true);
      $msg.textContent = "NUP limpo.";
      $nup.focus();
    });

    // Salvar (update/create)
    $salvar.addEventListener("click", async () => {
      try {
        if (currentAction === "update") {
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
          if (!validarObrigatoriosParaCriar()) return;

          const payload = {
            nup: pendingNup,                 // já no formato 00000.000000/0000-00
            tipo: $tipo.value,
            status: $status.value,
            entrada_regional: $entrada.value
          };

          await createProcesso(payload);
          $msg.textContent = "Processo criado com sucesso.";
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

    // Excluir (somente quando em update)
    $excluir.addEventListener("click", async () => {
      if (currentAction !== "update" || !currentRowId) {
        alert("Busque um processo existente antes de excluir.");
        return;
      }
      const confirmar = confirm("Tem certeza que deseja excluir este processo? Esta ação não pode ser desfeita.");
      if (!confirmar) return;

      try {
        await deleteProcesso(currentRowId);
        $msg.textContent = "Processo excluído com sucesso.";
        resetForm(true);
        $nup.focus();
        await refresh();
      } catch (e) {
        alert("Erro ao excluir: " + e.message);
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

    resetForm();      // estado inicial
    await refresh();
  },
};
