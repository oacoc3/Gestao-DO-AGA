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
function isFullNUP(value) { return onlyDigits17(value).length === 17; }

// ========= Acesso ao banco =========

async function listProcessos() {
  const { data, error } = await supabase
    .from("processos")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);
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
  const saidaSobMap = new Map(); // processo_id -> timestamp da última saída de Sobrestado
  for (const h of historicos) {
    const saiuDeSob =
      SOBRESTADOS.has(h.old_status) && !SOBRESTADOS.has(h.new_status);
    if (saiuDeSob) {
      const t = new Date(h.changed_at).getTime();
      const prev = saidaSobMap.get(h.processo_id);
      if (!prev || t > prev) saidaSobMap.set(h.processo_id, t);
    }
  }

  const prazos = new Map();
  for (const p of processos) {
    let base = null;
    if (p.entrada_regional) base = new Date(p.entrada_regional);
    const tSaida = saidaSobMap.get(p.id);
    if (tSaida) {
      const dtSaida = new Date(tSaida);
      if (!base || dtSaida > base) base = dtSaida;
    }
    if (base) {
      const prazo = new Date(base.getTime() + 60 * DIA_MS);
      prazos.set(p.id, prazo.toISOString().slice(0, 10)); // YYYY-MM-DD
    } else {
      prazos.set(p.id, "");
    }
  }
  return prazos;
}

// ========= CSS de layout responsivo em duas metades, cabeçalhos fixos =========

function ensureLayoutCSS() {
  if (document.getElementById("spa-two-pane-css")) return;
  const style = document.createElement("style");
  style.id = "spa-two-pane-css";
  style.textContent = `
    /* container do módulo ocupa a viewport inteira e não rola a página */
    .proc-mod { height: 100vh; display:flex; flex-direction:column; overflow: hidden; }

    /* formulário: ocupa toda a largura */
    .proc-form-card { flex:0 0 auto; }
    .proc-form-row { display:flex; align-items:flex-end; gap:8px; flex-wrap:nowrap; overflow:auto; }
    .proc-form-row > div { display:flex; flex-direction:column; }

    /* faixa inferior em duas metades */
    .proc-split { flex:1 1 auto; min-height:0; display:flex; gap:8px; overflow:hidden; }
    .proc-pane { flex:1 1 50%; min-width:0; display:flex; flex-direction:column; overflow:hidden; }
    .proc-pane .pane-title { margin:0 0 8px 0; }
    .proc-pane .pane-body { flex:1 1 auto; min-height:0; overflow:auto; }

    /* grade (direita): sem rolagem horizontal, cabeçalho + filtros fixos, rolagem vertical interna */
    .grid-pane .pane-body { overflow:auto; }
    .grid-pane .table { width:100%; border-collapse:collapse; table-layout:fixed; }
    .grid-pane th, .grid-pane td { font-size:12px; padding:4px 6px; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .grid-pane select { font-size:12px; }
    .grid-scroll { height:100%; overflow:auto; position:relative; }
    .grid-scroll thead th { position: sticky; background:#fff; z-index:3; }
    .grid-scroll thead tr:nth-child(1) th { top: 0; }
    .grid-scroll thead tr:nth-child(2) th { top: 30px; } /* altura aproximada da 1ª linha */
    .grid-scroll thead tr:nth-child(1) th, .grid-scroll thead tr:nth-child(2) th { border-bottom:1px solid #ddd; }
    .grid-controls { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }

    /* histórico (esquerda): tabela com cabeçalho fixo e rolagem vertical interna */
    .hist-pane .table { width:100%; border-collapse:collapse; table-layout:fixed; }
    .hist-pane th, .hist-pane td { font-size:12px; padding:4px 6px; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .hist-scroll { height:100%; overflow:auto; position:relative; }
    .hist-scroll thead th { position:sticky; top:0; background:#fff; z-index:2; border-bottom:1px solid #ddd; }

    /* responsividade: em telas bem estreitas, mantém metades lado a lado mas com tipografia ainda mais compacta */
    @media (max-width: 900px) {
      .grid-pane th, .grid-pane td, .hist-pane th, .hist-pane td { font-size:11px; padding:3px 4px; }
      .grid-scroll thead tr:nth-child(2) th { top: 28px; }
    }
    @media (max-width: 600px) {
      .grid-pane th, .grid-pane td, .hist-pane th, .hist-pane td { font-size:10px; padding:2px 3px; }
      .grid-scroll thead tr:nth-child(2) th { top: 26px; }
    }

    /* destaque da linha selecionada na lista */
    .row-selected { outline: 2px solid #999; }
  `;
  document.head.appendChild(style);
}

// ========= UI helpers (setinhas de ordenação, normalização etc.) =========

function arrowFor(col, sort) {
  if (sort.key !== col) return "";
  return sort.dir === "asc" ? " ▲" : " ▼";
}
function norm(str) { return (str || "").toString().toLowerCase(); }
function parseYmd(s) {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ========= Render da tabela da lista (cabeçalho + filtros fixos) =========

function viewTabela(listView, sort, filters, STATUS, TIPOS) {
  const th = (key, label) =>
    `<th data-sort-key="${key}" style="cursor:pointer">${label}${arrowFor(key, sort)}</th>`;

  return `
    <div class="grid-controls">
      <div style="font-weight:bold">Lista de processos</div>
      <button id="flt-clear">Limpar filtros</button>
    </div>
    <div class="grid-scroll">
      <table class="table">
        <thead>
          <tr class="thead1">
            ${th("nup","NUP")}
            ${th("tipo","Tipo")}
            ${th("status","Status")}
            ${th("entrada","1ª Entrada Regional")}
            ${th("prazo","Prazo Regional")}
            ${th("modificado","Modificado por")}
            ${th("atualizado","Atualizado em")}
            <th>Ações</th>
          </tr>
          <tr class="thead2">
            <th>
              <input id="flt-nup" placeholder="Filtrar..." value="${filters.nup ?? ""}" style="width:95%">
            </th>
            <th>
              <select id="flt-tipo" style="width:95%">
                <option value="">Todos</option>
                ${TIPOS.map(t => `<option ${filters.tipo===t?"selected":""}>${t}</option>`).join("")}
              </select>
            </th>
            <th>
              <select id="flt-status" style="width:95%">
                <option value="">Todos</option>
                ${STATUS.map(s => `<option ${filters.status===s?"selected":""}>${s}</option>`).join("")}
              </select>
            </th>
            <th>
              <div style="display:flex; gap:4px; justify-content:center">
                <input id="flt-ent-from" type="date" value="${filters.entFrom ?? ""}">
                <input id="flt-ent-to" type="date" value="${filters.entTo ?? ""}">
              </div>
            </th>
            <th>
              <label class="small"><input id="flt-prazo-sob" type="checkbox" ${filters.prazoSob?"checked":""}> Somente Sobrestado</label>
            </th>
            <th>
              <input id="flt-mod" placeholder="Filtrar..." value="${filters.mod ?? ""}" style="width:95%">
            </th>
            <th>
              <div style="display:flex; gap:4px; justify-content:center">
                <input id="flt-atl-from" type="date" value="${filters.atlFrom ?? ""}">
                <input id="flt-atl-to" type="date" value="${filters.atlTo ?? ""}">
              </div>
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${listView.map(v => `
            <tr data-id="${v.id}" data-nup="${v.nup}">
              <td>${v.nup}</td>
              <td>${v.tipo}</td>
              <td>
                <select class="status-select">
                  ${STATUS.map(s => `<option ${s === v.status ? "selected" : ""}>${s}</option>`).join("")}
                </select>
              </td>
              <td>${v.entrada || ""}</td>
              <td>${v.prazoDisplay}</td>
              <td class="small">${v.modificado || ""}</td>
              <td class="small">${v.atualizadoStr}</td>
              <td><button class="btn-historico">Histórico</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ========= Render do painel de Histórico (tabela fixa) =========

function viewHistorico(title, hist) {
  const rows = (hist || []).map(h => {
    const autor = h.changed_by_email || h.changed_by || "(desconhecido)";
    const quando = new Date(h.changed_at).toLocaleString();
    const de = h.old_status ?? "(criação)";
    const para = h.new_status ?? "(sem status)";
    return `<tr>
      <td>${quando}</td>
      <td>${de}</td>
      <td>${para}</td>
      <td>${autor}</td>
    </tr>`;
  }).join("");
  return `
    <h3 class="pane-title">${title}</h3>
    <div class="hist-scroll pane-body">
      <table class="table">
        <thead>
          <tr>
            <th>Data/Hora</th>
            <th>De</th>
            <th>Para</th>
            <th>Por</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="4">Sem histórico.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

// ========= Formulário (uma linha; ocupa 100%) =========

function viewFormulario() {
  return `
    <div class="card proc-form-card">
      <h3>Insira o NUP do Processo</h3>
      <div class="proc-form-row">
        <!-- NUP -->
        <div style="min-width:260px; flex:1 1 260px">
          <label>NUP</label>
          <input id="f-nup" inputmode="numeric" autocomplete="off" placeholder="00000.000000/0000-00" />
        </div>

        <!-- Buscar -->
        <div style="flex:0 0 auto">
          <label>&nbsp;</label>
          <button id="btn-buscar">Buscar</button>
        </div>

        <!-- Limpar -->
        <div style="flex:0 0 auto">
          <label>&nbsp;</label>
          <button id="btn-limpar" type="button">Limpar</button>
        </div>

        <!-- Tipo -->
        <div style="min-width:180px; flex:1 1 180px">
          <label>Tipo</label>
          <select id="f-tipo" disabled>
            <option value="" disabled selected hidden>-- selecione --</option>
            ${TIPOS.map(t => `<option value="${t}">${t}</option>`).join("")}
          </select>
        </div>

        <!-- 1ª Entrada Regional -->
        <div style="min-width:160px; flex:1 1 160px">
          <label>1ª Entrada Regional</label>
          <input id="f-entrada" type="date" disabled />
        </div>

        <!-- Status -->
        <div style="min-width:200px; flex:1 1 200px">
          <label>Status</label>
          <select id="f-status" disabled>
            <option value="" disabled selected hidden>-- selecione --</option>
            ${STATUS.map(s => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </div>

        <!-- Salvar -->
        <div style="flex:0 0 auto">
          <label>&nbsp;</label>
          <button id="btn-salvar" disabled>Salvar</button>
        </div>

        <!-- Histórico -->
        <div style="flex:0 0 auto">
          <label>&nbsp;</label>
          <button id="btn-historico-form" disabled>Histórico</button>
        </div>

        <!-- Excluir -->
        <div style="flex:0 0 auto">
          <label>&nbsp;</label>
          <button id="btn-excluir" disabled>Excluir</button>
        </div>
      </div>

      <div id="msg-novo" class="small" style="margin-top:8px"></div>
    </div>
  `;
}

// ========= Comportamento: bind da lista (inclui click da linha) =========

function bindTabela(container, refresh, onPickRow) {
  container.querySelectorAll("tr[data-id]").forEach(tr => {
    const id = tr.getAttribute("data-id");
    const nup = tr.getAttribute("data-nup");
    const select = tr.querySelector(".status-select");
    const btnHist = tr.querySelector(".btn-historico");

    // Alteração de status direto na lista
    select.addEventListener("change", async (ev) => {
      ev.stopPropagation();
      const newStatus = select.value;
      try {
        await updateStatus(id, newStatus);
        await refresh();
      } catch (e) {
        alert("Erro ao atualizar status: " + e.message);
      }
    });

    // Botão Histórico: mostra no painel da esquerda
    btnHist.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      try {
        const hist = await getHistorico(id);
        const histPane = document.getElementById("hist-pane");
        histPane.innerHTML = viewHistorico(`Histórico — ${nup}`, hist);
      } catch (e) {
        alert("Erro ao carregar histórico: " + e.message);
      }
    });

    // Clique na linha: seleciona processo no formulário + histórico
    tr.addEventListener("click", async () => {
      onPickRow(id); // define no formulário
      try {
        // destacar linha selecionada
        container.querySelectorAll("tbody tr").forEach(row => row.classList.remove("row-selected"));
        tr.classList.add("row-selected");

        const hist = await getHistorico(id);
        const histPane = document.getElementById("hist-pane");
        histPane.innerHTML = viewHistorico(`Histórico — ${nup}`, hist);
      } catch (e) {
        alert("Erro ao carregar histórico: " + e.message);
      }
    });
  });
}

// ========= Módulo =========

export default {
  id: "processos",
  title: "Processos",
  route: "#/processos",
  async view(container) {
    // aplica CSS de layout
    ensureLayoutCSS();

    // Layout base do módulo: formulário em cima; duas metades abaixo
    container.innerHTML = `
      <div class="container proc-mod">
        ${viewFormulario()}
        <div class="proc-split">
          <div class="card proc-pane hist-pane" id="hist-pane">
            <h3 class="pane-title">Histórico</h3>
            <div class="pane-body hist-scroll">
              <table class="table">
                <thead><tr><th>Data/Hora</th><th>De</th><th>Para</th><th>Por</th></tr></thead>
                <tbody><tr><td colspan="4">Selecione um processo para ver o histórico.</td></tr></tbody>
              </table>
            </div>
          </div>
          <div class="card proc-pane grid-pane" id="grid-pane">
            <div id="grid">Carregando...</div>
          </div>
        </div>
      </div>
    `;

    // ------------ refs ------------
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
    const gridWrap = el("#grid");
    const histPane = el("#hist-pane");

    // ------------ estado ------------
    let currentAction = null;   // 'update' | 'create' | null
    let currentRowId = null;
    let originalStatus = null;
    let pendingNup = "";
    let currentNupMasked = "";

    let allList = [];          // dados crus
    let prazosMap = new Map(); // id -> "YYYY-MM-DD"
    let viewData = [];         // dados de visualização

    const filters = {
      nup: "", tipo: "", status: "",
      entFrom: "", entTo: "",
      prazoSob: false,
      mod: "", atlFrom: "", atlTo: ""
    };
    const sort = { key: "atualizado", dir: "desc" }; // padrão: mais recente primeiro

    // ------------ helpers do form ------------
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
      $histFrm.disabled = true;
      currentAction = "create";
      // limpa histórico
      histPane.innerHTML = viewHistorico("Histórico", []);
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

      $salvar.disabled = true;
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

    // ------------ montagem dos dados de visualização ------------
    function buildViewData() {
      viewData = allList.map(r => {
        const prazoStr = SOBRESTADOS.has(r.status) ? "Sobrestado" : (prazosMap.get(r.id) || "");
        const prazoTS = prazoStr && prazoStr !== "Sobrestado" ? new Date(prazoStr).getTime() : null;
        const entradaTS = r.entrada_regional ? new Date(r.entrada_regional).getTime() : null;
        const atualizadoTS = r.updated_at ? new Date(r.updated_at).getTime() : 0;
        return {
          id: r.id,
          nup: r.nup,
          tipo: r.tipo,
          status: r.status,
          entrada: r.entrada_regional || "",
          modificado: r.modificado_por || "",
          atualizado: atualizadoTS,
          atualizadoStr: r.updated_at ? new Date(r.updated_at).toLocaleString() : "",
          prazoDisplay: prazoStr,
          prazoTS, entradaTS
        };
      });
    }

    function applyFiltersSort() {
      let arr = viewData.slice();

      // Filtros
      if (filters.nup) arr = arr.filter(v => norm(v.nup).includes(norm(filters.nup)));
      if (filters.tipo) arr = arr.filter(v => v.tipo === filters.tipo);
      if (filters.status) arr = arr.filter(v => v.status === filters.status);
      if (filters.entFrom) {
        const t = parseYmd(filters.entFrom);
        arr = arr.filter(v => (v.entradaTS ?? 0) >= (t ?? 0));
      }
      if (filters.entTo) {
        const t = parseYmd(filters.entTo);
        arr = arr.filter(v => (v.entradaTS ?? 0) <= (t ? t + (24*60*60*1000 - 1) : Infinity));
      }
      if (filters.prazoSob) arr = arr.filter(v => v.prazoDisplay === "Sobrestado");
      if (filters.mod) arr = arr.filter(v => norm(v.modificado).includes(norm(filters.mod)));
      if (filters.atlFrom) {
        const t = parseYmd(filters.atlFrom);
        arr = arr.filter(v => v.atualizado >= (t ?? 0));
      }
      if (filters.atlTo) {
        const t = parseYmd(filters.atlTo);
        arr = arr.filter(v => v.atualizado <= (t ? t + (24*60*60*1000 - 1) : Infinity));
      }

      // Ordenação
      const key = sort.key, dir = sort.dir === "asc" ? 1 : -1;
      const val = (v) => {
        switch (key) {
          case "nup": return v.nup || "";
          case "tipo": return v.tipo || "";
          case "status": return v.status || "";
          case "entrada": return v.entradaTS ?? -Infinity;
          case "prazo": return (v.prazoDisplay === "Sobrestado") ? Number.POSITIVE_INFINITY : (v.prazoTS ?? Number.POSITIVE_INFINITY);
          case "modificado": return v.modificado || "";
          case "atualizado": return v.atualizado ?? 0;
          default: return "";
        }
      };
      arr.sort((a, b) => {
        const va = val(a), vb = val(b);
        if (va === vb) return 0;
        return (va > vb ? 1 : -1) * dir;
      });

      return arr;
    }

    function attachFilterSortHandlers() {
      const qs = (s) => gridWrap.querySelector(s);

      // Ordenação por clique no cabeçalho
      gridWrap.querySelectorAll("th[data-sort-key]").forEach(th => {
        th.addEventListener("click", () => {
          const key = th.getAttribute("data-sort-key");
          if (sort.key === key) {
            sort.dir = sort.dir === "asc" ? "desc" : "asc";
          } else {
            sort.key = key;
            sort.dir = "asc";
          }
          renderGrid();
        });
      });

      // Filtros
      const bind = (id, prop, isCheckbox = false) => {
        const el = qs(id);
        if (!el) return;
        el.addEventListener("input", () => {
          filters[prop] = isCheckbox ? el.checked : el.value;
          renderGrid();
        });
      };
      bind("#flt-nup", "nup");
      bind("#flt-tipo", "tipo");
      bind("#flt-status", "status");
      bind("#flt-ent-from", "entFrom");
      bind("#flt-ent-to", "entTo");
      bind("#flt-prazo-sob", "prazoSob", true);
      bind("#flt-mod", "mod");
      bind("#flt-atl-from", "atlFrom");
      bind("#flt-atl-to", "atlTo");

      const clear = qs("#flt-clear");
      if (clear) {
        clear.addEventListener("click", () => {
          Object.assign(filters, { nup:"", tipo:"", status:"", entFrom:"", entTo:"", prazoSob:false, mod:"", atlFrom:"", atlTo:"" });
          renderGrid();
        });
      }
    }

    // ------------ render da grade à direita ------------
    function renderGrid() {
      const listView = applyFiltersSort();
      gridWrap.innerHTML = viewTabela(listView, sort, filters, STATUS, TIPOS);
      bindTabela(gridWrap, refresh, onPickRowFromList);
      attachFilterSortHandlers();

      // Reaplica destaque na linha atualmente selecionada (se houver)
      if (currentRowId) {
        const tr = gridWrap.querySelector(`tr[data-id="${currentRowId}"]`);
        if (tr) tr.classList.add("row-selected");
      }
    }

    // ------------ preencher formulário a partir do clique na lista ------------
    function onPickRowFromList(id) {
      const row = allList.find(r => String(r.id) === String(id));
      if (!row) return;
      setUpdateMode(row);
      $nup.value = row.nup; // mantém NUP visível coerente ao selecionar pela lista
    }

    // ------------ fluxo do formulário ------------
    $buscar.addEventListener("click", async () => {
      const digits = onlyDigits17($nup.value);
      if (digits.length !== 17) {
        $msg.textContent = "Informe um NUP completo (17 dígitos).";
        $nup.focus();
        return;
      }
      const nupMasked = maskNUP(digits);

      // mantém NUP visível durante a busca
      $msg.textContent = "Buscando...";

      try {
        const row = await getProcessoByNup(nupMasked);
        if (row) {
          setUpdateMode(row);

          // destaca na lista e carrega histórico à esquerda
          currentRowId = row.id;
          renderGrid(); // para destacar a linha
          const hist = await getHistorico(row.id);
          histPane.innerHTML = viewHistorico(`Histórico — ${row.nup}`, hist);
        } else {
          // pergunta: criar?
          perguntaCriar((decisao) => {
            if (decisao) {
              setCreateMode(nupMasked);
            } else {
              resetForm(true);
              histPane.innerHTML = viewHistorico("Histórico", []);
              $nup.focus();
            }
          });
        }
      } catch (e) {
        $msg.textContent = "Erro ao buscar: " + e.message;
      }
    });

    $limpar.addEventListener("click", () => {
      resetForm(true);
      histPane.innerHTML = viewHistorico("Histórico", []);
      $msg.textContent = "NUP limpo.";
      $nup.focus();
    });

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
          // atualiza histórico visível
          const hist = await getHistorico(currentRowId);
          histPane.innerHTML = viewHistorico(`Histórico — ${currentNupMasked}`, hist);
        } else if (currentAction === "create") {
          if (!validarObrigatoriosParaCriar()) return;

          const payload = {
            nup: pendingNup,
            tipo: $tipo.value,
            status: $status.value,
            entrada_regional: $entrada.value
          };

          await createProcesso(payload);
          $msg.textContent = "Processo criado com sucesso.";
          const novo = await getProcessoByNup(pendingNup);
          if (novo) {
            setUpdateMode(novo);
            currentRowId = novo.id;
            await refresh();
            const hist = await getHistorico(novo.id);
            histPane.innerHTML = viewHistorico(`Histórico — ${novo.nup}`, hist);
          }
        } else {
          alert("Use o botão Buscar antes de salvar.");
        }
      } catch (e) {
        alert("Erro ao salvar: " + e.message);
      }
    });

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
        histPane.innerHTML = viewHistorico("Histórico", []);
        await refresh();
        $nup.focus();
      } catch (e) {
        alert("Erro ao excluir: " + e.message);
      }
    });

    // Histórico (botão do formulário) – mostra na metade esquerda
    $histFrm.addEventListener("click", async () => {
      if (currentAction !== "update" || !currentRowId) return;
      try {
        const hist = await getHistorico(currentRowId);
        histPane.innerHTML = viewHistorico(`Histórico — ${currentNupMasked}`, hist);
      } catch (e) {
        alert("Erro ao carregar histórico: " + e.message);
      }
    });

    // ------------ carregar + atualizar grade ------------
    const refresh = async () => {
      gridWrap.innerHTML = "Carregando...";
      try {
        allList = await listProcessos();
        const ids = allList.map(r => r.id);
        const historicos = await getHistoricoBatch(ids);
        prazosMap = calcularPrazosMapa(allList, historicos);
        buildViewData();
        renderGrid();
      } catch (e) {
        gridWrap.innerHTML = `<p>Erro ao carregar: ${e.message}</p>`;
      }
    };

    // Estado inicial
    resetForm();
    await refresh();
  },
};
