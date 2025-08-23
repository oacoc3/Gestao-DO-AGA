// modules/processos.js
// Siglas usadas:
// - CRUD: Create, Read, Update, Delete (Criar, Ler, Atualizar, Excluir)
// - RLS: Row Level Security (Segurança em nível de linha)
// - UUID: Universally Unique Identifier (Identificador único universal)

import { supabase } from "../supabaseClient.js";

const TIPOS = ["PDIR", "Inscrição/Alteração", "Exploração", "OPEA"];
const STATUS = [
  "Análise Documental", "Análise Técnica Preliminar", "Análise Técnica",
  "Parecer ATM", "Parecer DT", "Notificação", "Revisão OACO", "Aprovação",
  "Sobrestado Documental", "Sobrestado Técnico", "Análise ICA",
  "Publicação de Portaria", "Concluído", "Remoção/Rebaixamento", "Término de Obra"
];

// ========= Utilitários: máscara/validação do NUP =========

/** Mantém apenas dígitos e limita a 17 algarismos */
function onlyDigits17(value) {
  return (value || "").replace(/\D/g, "").slice(0, 17);
}

/** Aplica o formato 00000.000000/0000-00 sobre até 17 dígitos */
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
    .eq("nup", nup)
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

/** Busca histórico de vários processos de uma vez (para calcular prazos) */
async function getHistoricoBatch(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("status_history")
    .select("processo_id, old_status, new_status, changed_at")
    .in("processo_id", ids);
  if (error) throw error;
  return data;
}

// ========= Cálculo do "Prazo Regional" (na SPA, não grava no banco) =========

const SOBRESTADOS = new Set(["Sobrestado Técnico", "Sobrestado Documental"]);
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Para cada processo, define a "data base" do prazo:
 * - por padrão: 1ª Entrada Regional
 * - se houve saída de Sobrestado (old_status ∈ SOBRESTADOS e new_status ∉ SOBRESTADOS),
 *   usa a data da ÚLTIMA saída como nova base.
 * O "Prazo Regional" = data base + 60 dias corridos.
 * Retorna um Map<processo_id, 'YYYY-MM-DD'> (string) ou '' se não puder calcular.
 */
function calcularPrazosMapa(processos, historicos) {
  // Mapa: processo_id -> timestamp da última "saída de Sobrestado"
  const saidaSobMap = new Map();
  for (const h of historicos) {
    const saiuDeSob =
      SOBRESTADOS.has(h.old_status) && !SOBRESTADOS.has(h.new_status);
    if (saiuDeSob) {
      const t = new Date(h.changed_at).getTime();
      const prev = saidaSobMap.get(h.processo_id);
      if (!prev || t > prev) saidaSobMap.set(h.processo_id, t);
    }
  }

  // Calcula prazos
  const prazos = new Map();
  for (const p of processos) {
    let base = null;

    // 1ª Entrada Regional (se existir)
    if (p.entrada_regional) {
      base = new Date(p.entrada_regional);
    }

    // Saída mais recente de Sobrestado (se existir e for depois da entrada)
    const tSaida = saidaSobMap.get(p.id);
    if (tSaida) {
      const dtSaida = new Date(tSaida);
      if (!base || dtSaida > base) base = dtSaida;
    }

    if (base) {
      const prazo = new Date(base.getTime() + 60 * DIA_MS);
      prazos.set(p.id, prazo.toISOString().slice(0, 10)); // YYYY-MM-DD
    } else {
      prazos.set(p.id, ""); // sem como calcular
    }
  }
  return prazos;
}

// ========= Modal (popup) para Histórico =========

function ensureHistoryModal() {
  let modal = document.getElementById("hist-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "hist-modal";
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.display = "none";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";
  modal.style.background = "rgba(0,0,0,0.4)";
  modal.style.zIndex = "1000";

  modal.innerHTML = `
    <div style="background:#fff; max-width:900px; width:90%; border-radius:8px; padding:16px; box-shadow:0 10px 30px rgba(0,0,0,.2)">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
        <h3 id="hist-title" style="margin:0">Histórico</h3>
        <button id="hist-close">Fechar</button>
      </div>
      <div id="hist-body" style="max-height:60vh; overflow:auto"></div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector("#hist-close").onclick = () => (modal.style.display = "none");
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modal.style.display = "none";
  });

  return modal;
}

function showHistoryModal(titulo, hist) {
  const modal = ensureHistoryModal();
  modal.querySelector("#hist-title").textContent = titulo;

  const rows = (hist || []).map(h => {
    const autor = h.changed_by_email || h.changed_by || "(desconhecido)";
    const quando = new Date(h.changed_at).toLocaleString();
    const de = h.old_status ?? "(criação)";
    const para = h.new_status ?? "(sem status)";
    return `<tr>
      <td style="text-align:center">${quando}</td>
      <td style="text-align:center">${de}</td>
      <td style="text-align:center">${para}</td>
      <td style="text-align:center">${autor}</td>
    </tr>`;
  }).join("");

  modal.querySelector("#hist-body").innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th style="text-align:center">Data/Hora</th>
          <th style="text-align:center">De</th>
          <th style="text-align:center">Para</th>
          <th style="text-align:center">Por</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td style="text-align:center" colspan="4">Sem histórico.</td></tr>`}
      </tbody>
    </table>
  `;

  modal.style.display = "flex";
}

// ========= Tabela (ajustada: conteúdo centralizado) =========

function viewTabela(list, prazosMap) {
  return `
    <table class="table">
      <thead>
        <tr>
          <th style="text-align:center">NUP</th>
          <th style="text-align:center">Tipo</th>
          <th style="text-align:center">Status</th>
          <th style="text-align:center">1ª Entrada Regional</th>
          <th style="text-align:center">Prazo Regional</th>
          <th style="text-align:center">Modificado por</th>
          <th style="text-align:center">Atualizado em</th>
          <th style="text-align:center">Ações</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(row => {
          const prazoCell = SOBRESTADOS.has(row.status)
            ? "Sobrestado"
            : (prazosMap.get(row.id) ?? "");
          return `
            <tr data-id="${row.id}" data-nup="${row.nup}">
              <td style="text-align:center">${row.nup}</td>
              <td style="text-align:center">${row.tipo}</td>
              <td style="text-align:center">
                <div style="display:flex; justify-content:center">
                  <select class="status-select">
                    ${STATUS.map(s => `<option ${s === row.status ? "selected" : ""}>${s}</option>`).join("")}
                  </select>
                </div>
              </td>
              <td style="text-align:center">${row.entrada_regional ?? ""}</td>
              <td style="text-align:center">${prazoCell}</td>
              <td class="small" style="text-align:center">${row.modificado_por ?? ""}</td>
              <td class="small" style="text-align:center">${new Date(row.updated_at).toLocaleString()}</td>
              <td style="text-align:center">
                <div style="display:flex; justify-content:center">
                  <button class="btn-historico">Histórico</button>
                </div>
              </td>
            </tr>
          `;
        }).join("")}
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

      <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap">
        <button id="btn-salvar" disabled>Salvar</button>
        <button id="btn-excluir" disabled>Excluir</button>
        <button id="btn-historico-form" disabled>Histórico</button>
      </div>

      <div id="msg-novo" class="small" style="margin-top:8px"></div>
    </div>
  `;
}

// ========= Comportamento =========

function bindTabela(container, refresh) {
  container.querySelectorAll("tr[data-id]").forEach(tr => {
    const id = tr.getAttribute("data-id");
    const nup = tr.getAttribute("data-nup");
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
        showHistoryModal(`Histórico — ${nup}`, hist);
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
    const $histFrm = el("#btn-historico-form");
    const $msg     = el("#msg-novo");
    const grid     = el("#grid");

    let currentAction = null;   // 'update' | 'create' | null
    let currentRowId = null;
    let originalStatus = null;
    let pendingNup = "";
    let currentNupMasked = "";

    // Máscara do NUP
    $nup.addEventListener("input", () => {
      const digits = onlyDigits17($nup.value);
      $nup.value = maskNUP(digits);
    });

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
      $histFrm.disabled = true;
      currentAction = null;
      currentRowId = null;
      originalStatus = null;
      pendingNup = "";
      currentNupMasked = "";
    }

    function setCreateMode(nupMasked) {
      pendingNup = nupMasked;
      currentNupMasked = nupMasked;
      $msg.textContent = "Preencha os campos e clique em Salvar.";
      $tipo.disabled = false;
      $entrada.disabled = false;
      $status.disabled = false;
      $salvar.disabled = false;
      $excluir.disabled = true;
      $histFrm.disabled = true; // só habilita quando já existe (update)
      currentAction = "create";
    }

    function setUpdateMode(row) {
      currentAction = "update";
      currentRowId = row.id;
      originalStatus = row.status;
      currentNupMasked = row.nup;

      $tipo.value = row.tipo || "";
      $entrada.value = row.entrada_regional || "";
      $status.value = row.status || "";

      $tipo.disabled = true;
      $entrada.disabled = true;
      $status.disabled = false;

      $salvar.disabled = true; // habilita só se mudar o status
      $excluir.disabled = false;
      $histFrm.disabled = false;
      $msg.textContent = "Processo encontrado. Altere o Status se necessário ou consulte o Histórico.";
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
            else { resetForm(true); $nup.focus(); }
          });
        }
      } catch (e) {
        $msg.textContent = "Erro ao buscar: " + e.message;
      }
    });

    // Limpar
    $limpar.addEventListener("click", () => {
      resetForm(true);
      $msg.textContent = "NUP limpo.";
      $nup.focus();
    });

    // Salvar
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
            nup: pendingNup,                 // formato 00000.000000/0000-00
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

    // Excluir
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

    // Histórico (botão do formulário)
    $histFrm.addEventListener("click", async () => {
      if (currentAction !== "update" || !currentRowId) return;
      try {
        const hist = await getHistorico(currentRowId);
        showHistoryModal(`Histórico — ${currentNupMasked}`, hist);
      } catch (e) {
        alert("Erro ao carregar histórico: " + e.message);
      }
    });

    // --------- Lista (grid) ---------
    const refresh = async () => {
      grid.textContent = "Carregando...";
      try {
        const list = await listProcessos();

        // Calcula "Prazo Regional" para todos os itens
        const ids = list.map(r => r.id);
        const historicos = await getHistoricoBatch(ids);
        const prazosMap = calcularPrazosMapa(list, historicos);

        grid.innerHTML = viewTabela(list, prazosMap);
        bindTabela(container, refresh);
      } catch (e) {
        grid.innerHTML = `<p>Erro ao carregar: ${e.message}</p>`;
      }
    };

    resetForm();      // estado inicial
    await refresh();
  },
};
