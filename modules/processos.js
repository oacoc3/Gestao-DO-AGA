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
  // processo_id -> timestamp da última saída de Sobrestado
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
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") modal.style.display = "none"; });
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
    <div class="table-wrap">
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
    </div>
  `;
  modal.style.display = "flex";
}

// ========= Helpers de ordenação/filtragem =========

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

// ========= (NOVO) CSS responsivo injetado =========

function ensureResponsiveCSS() {
  if (document.getElementById("spa-responsive-css")) return;
  const style = document.createElement("style");
  style.id = "spa-responsive-css";
  style.textContent = `
    /* Mantém o formulário numa linha em telas largas */
    .form-row { display:flex; align-items:flex-end; gap:8px; flex-wrap:nowrap; overflow:auto; }
    .form-row > div { display:flex; flex-direction:column; }
    /* Envelopes para rolagem horizontal da tabela quando necessário */
    .table-wrap { width:100%; overflow-x:auto; }
    .table-wrap .table { min-width: 980px; } /* evita "amassar" colunas */

    /* Quebra em múltiplas linhas quando a tela reduzir */
    @media (max-width: 1200px) {
      .form-row { flex-wrap: wrap !important; }
      .form-row > div { min-width: 160px; }
    }
    @media (max-width: 900px) {
      .form-row { gap: 6px; }
      .form-row > div { flex: 1 1 45%; min-width: 140px; }
      .form-row button { width: 100%; }
    }
    @media (max-width: 560px) {
      .form-row { flex-direction: column; align-items: stretch; }
      .form-row > div { width: 100%; }
      .form-row button { width: 100%; }
      .table-wrap .table { min-width: 700px; } /* para modais/lista em telas bem pequenas */
    }
  `;
  document.head.appendChild(style);
}

// ========= Tabela (com filtros + ordenação + células centralizadas) =========

function viewTabela(listView, sort, filters) {
  const th = (key, label) =>
    `<th data-sort-key="${key}" style="text-align:center; cursor:pointer">${label}${arrowFor(key, sort)}</th>`;

  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            ${th("nup","NUP")}
            ${th("tipo","Tipo")}
            ${th("status","Status")}
            ${th("entrada","1ª Entrada Regional")}
            ${th("prazo","Prazo Regional")}
            ${th("modificado","Modificado por")}
            ${th("atualizado","Atualizado em")}
            <th style="text-align:center">Ações</th>
          </tr>
          <tr>
            <th style="text-align:center">
              <input id="flt-nup" placeholder="Filtrar..." value="${filters.nup ?? ""}" style="text-align:center; width:95%">
            </th>
            <th style="text-align:center">
              <select id="flt-tipo" style="text-align:center; width:95%">
                <option value="">Todos</option>
                ${TIPOS.map(t => `<option ${filters.tipo===t?"selected":""}>${t}</option>`).join("")}
              </select>
            </th>
            <th style="text-align:center">
              <select id="flt-status" style="text-align:center; width:95%">
                <option value="">Todos</option>
                ${STATUS.map(s => `<option ${filters.status===s?"selected":""}>${s}</option>`).join("")}
              </select>
            </th>
            <th style="text-align:center">
              <div style="display:flex; gap:4px; justify-content:center">
                <input id="flt-ent-from" type="date" value="${filters.entFrom ?? ""}" style="text-align:center">
                <input id="flt-ent-to" type="date" value="${filters.entTo ?? ""}" style="text-align:center">
              </div>
            </th>
            <th style="text-align:center">
              <div style="display:flex; gap:6px; justify-content:center; align-items:center">
                <label class="small"><input id="flt-prazo-sob" type="checkbox" ${filters.prazoSob?"checked":""}> Somente Sobrestado</label>
              </div>
            </th>
            <th style="text-align:center">
              <input id="flt-mod" placeholder="Filtrar..." value="${filters.mod ?? ""}" style="text-align:center; width:95%">
            </th>
            <th style="text-align:center">
              <div style="display:flex; gap:4px; justify-content:center">
                <input id="flt-atl-from" type="date" value="${filters.atlFrom ?? ""}" style="text-align:center">
                <input id="flt-atl-to" type="date" value="${filters.atlTo ?? ""}" style="text-align:center">
              </div>
            </th>
            <th style="text-align:center">
              <button id="flt-clear">Limpar filtros</button>
            </th>
          </tr>
        </thead>
        <tbody>
          ${listView.map(v => `
            <tr data-id="${v.id}" data-nup="${v.nup}">
              <td style="text-align:center">${v.nup}</td>
              <td style="text-align:center">${v.tipo}</td>
              <td style="text-align:center">
                <div style="display:flex; justify-content:center">
                  <select class="status-select">
                    ${STATUS.map(s => `<option ${s === v.status ? "selected" : ""}>${s}</option>`).join("")}
                  </select>
                </div>
              </td>
              <td style="text-align:center">${v.entrada || ""}</td>
              <td style="text-align:center">${v.prazoDisplay}</td>
              <td class="small" style="text-align:center">${v.modificado || ""}</td>
              <td class="small" style="text-align:center">${v.atualizadoStr}</td>
              <td style="text-align:center">
                <div style="display:flex; justify-content:center">
                  <button class="btn-historico">Histórico</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ========= Formulário (uma linha após o título; responsivo por CSS) =========

function viewFormulario() {
  return `
    <div class="card">
      <h3>Insira o NUP do Processo</h3>

      <div id="form-row" class="form-row">
        <!-- NUP -->
        <div style="min-width:260px">
          <label>NUP</label>
          <input id="f-nup" inputmode="numeric" autocomplete="off" placeholder="00000.000000/0000-00" />
        </div>

        <!-- Buscar -->
        <div style="flex:0 0 auto">
          <button id="btn-buscar">Buscar</button>
        </div>

        <!-- Limpar -->
        <div style="flex:0 0 auto">
          <button id="btn-limpar" type="button">Limpar</button>
        </div>

        <!-- Tipo -->
        <div style="min-width:200px">
          <label>Tipo</label>
          <select id="f-tipo" disabled>
            <option value="" disabled selected hidden>-- selecione --</option>
            ${TIPOS.map(t => `<option value="${t}">${t}</option>`).join("")}
          </select>
        </div>

        <!-- 1ª Entrada Regional -->
        <div style="min-width:180px">
          <label>1ª Entrada Regional</label>
          <input id="f-entrada" type="date" disabled />
        </div>

        <!-- Status -->
        <div style="min-width:220px">
          <label>Status</label>
          <select id="f-status" disabled>
            <option value="" disabled selected hidden>-- selecione --</option>
            ${STATUS.map(s => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </div>

        <!-- Salvar -->
        <div style="flex:0 0 auto">
          <button id="btn-salvar" disabled>Salvar</button>
        </div>

        <!-- Histórico -->
        <div style="flex:0 0 auto">
          <button id="btn-historico-form" disabled>Histórico</button>
        </div>

        <!-- Excluir -->
        <div style="flex:0 0 auto">
          <button id="btn-excluir" disabled>Excluir</button>
        </div>
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
    // injeta CSS responsivo (uma vez)
    ensureResponsiveCSS();

    container.innerHTML = `
      <div class="container">
        ${viewFormulario()}
        <div class="card">
          <h3>Lista de processos</h3>
          <div id="grid">Carregando...</div>
        </div>
      </div>
    `;

    // ------------ refs do formulário ------------
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

    // ------------ estado ------------
    let currentAction = null;   // 'update' | 'create' | null
    let currentRowId = null;
    let originalStatus = null;
    let pendingNup = "";
    let currentNupMasked = "";

    let allList = [];          // dados crus do banco
    let prazosMap = new Map(); // id -> "YYYY-MM-DD"
    let viewData = [];         // dados para a grade (derivados)

    const filters = {
      nup: "", tipo: "", status: "",
      entFrom: "", entTo: "",
      prazoSob: false,
      mod: "", atlFrom: "", atlTo: ""
    };
    const sort = { key: "atualizado", dir: "desc" }; // padrão: mais recente primeiro

    // ------------ máscaras e helpers do form ------------
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

    // ------------ grid: montagem dos dados de visualização ------------
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
      const qs = (s) => grid.querySelector(s);

      // Ordenação por clique no cabeçalho
      grid.querySelectorAll("th[data-sort-key]").forEach(th => {
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

    // ------------ renderização da grade ------------
    function renderGrid() {
      const listView = applyFiltersSort();
      grid.innerHTML = viewTabela(listView, sort, filters);
      bindTabela(grid, refresh);
      attachFilterSortHandlers();
    }

    // ------------ fluxo de busca/salvar/excluir do formulário ------------
    $buscar.addEventListener("click", async () => {
      const digits = onlyDigits17($nup.value);
      if (digits.length !== 17) {
        $msg.textContent = "Informe um NUP completo (17 dígitos).";
        $nup.focus();
        return;
      }
      const nupMasked = maskNUP(digits);

      resetForm(false);
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

    $limpar.addEventListener("click", () => {
      resetForm(true);
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
          if (novo) setUpdateMode(novo);
          await refresh();
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
        $nup.focus();
        await refresh();
      } catch (e) {
        alert("Erro ao excluir: " + e.message);
      }
    });

    $histFrm.addEventListener("click", async () => {
      if (currentAction !== "update" || !currentRowId) return;
      try {
        const hist = await getHistorico(currentRowId);
        showHistoryModal(`Histórico — ${currentNupMasked}`, hist);
      } catch (e) {
        alert("Erro ao carregar histórico: " + e.message);
      }
    });

    // ------------ carregar + atualizar grade ------------
    const refresh = async () => {
      grid.textContent = "Carregando...";
      try {
        allList = await listProcessos();
        const ids = allList.map(r => r.id);
        const historicos = await getHistoricoBatch(ids);
        prazosMap = calcularPrazosMapa(allList, historicos);
        buildViewData();
        renderGrid();
      } catch (e) {
        grid.innerHTML = `<p>Erro ao carregar: ${e.message}</p>`;
      }
    };

    resetForm();
    await refresh();
  },
};
