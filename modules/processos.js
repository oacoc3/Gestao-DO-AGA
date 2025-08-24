// modules/processos.js
// Siglas (expansão):
// - CRUD: Create, Read, Update, Delete (Criar, Ler, Atualizar, Excluir)
// - RLS: Row Level Security (Segurança em nível de linha)

import { supabase } from "../supabaseClient.js";

/* =========================
   Constantes de domínio
   ========================= */
const TIPOS = ["PDIR", "Inscrição/Alteração", "Exploração", "OPEA"];
const STATUS = [
  "Análise Documental", "Análise Técnica Preliminar", "Análise Técnica",
  "Parecer ATM", "Parecer DT", "Notificação", "Revisão OACO", "Aprovação",
  "Sobrestado Documental", "Sobrestado Técnico", "Análise ICA",
  "Publicação de Portaria", "Concluído", "Remoção/Rebaixamento", "Término de Obra"
];
const SOBRESTADOS = new Set(["Sobrestado Documental", "Sobrestado Técnico"]);
const DIA_MS = 24 * 60 * 60 * 1000;

/* =========================
   Máscara / validação NUP
   ========================= */
function onlyDigits17(value) {
  return (value || "").replace(/\D/g, "").slice(0, 17);
}
function maskNUP(digits) {
  const d = onlyDigits17(digits);
  const len = d.length;
  if (len === 0) return "";
  if (len <= 5)  return d;
  if (len <= 11) return d.slice(0, 5) + "." + d.slice(5);
  if (len <= 15) return d.slice(0, 5) + "." + d.slice(5, 11) + "/" + d.slice(11);
  return d.slice(0, 5) + "." + d.slice(5, 11) + "/" + d.slice(11, 15) + "-" + d.slice(15, 17);
}

/* Exibição: formata NUP completo (00000.000000/0000-00) sem alterar o valor bruto */
function formatNUP(n) {
  const d = (n || "").replace(/\D/g, "");
  if (d.length !== 17) return maskNUP(d);
  return d.replace(/^(\d{5})(\d{6})(\d{4})(\d{2})$/, '$1.$2/$3-$4');
}

/* =========================
   Data access (Supabase)
   ========================= */
async function fetchPageByCursor(cursor) {
  // Consulta com paginação por cursor (keyset)
  const pageSize = 50;

  let query = supabase
    .from("processos")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(pageSize + 1);

  if (cursor) {
    query = query.lt("updated_at", cursor);
  }

  const { data, error } = await query;
  if (error) throw error;

  let nextCursor = null;
  let rows = data || [];
  if (rows.length > pageSize) {
    const last = rows.pop();
    nextCursor = last.updated_at;
  }
  return { data: rows, nextCursor };
}

async function getHistorico(processo_id) {
  const { data, error } = await supabase
    .from("status_history")
    .select("*")
    .eq("processo_id", processo_id)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getHistoricoBatch(ids) {
  if (!ids || !ids.length) return [];
  const { data, error } = await supabase
    .from("status_history")
    .select("*")
    .in("processo_id", ids);
  if (error) throw error;
  return data || [];
}

async function getProcessoPorNUP(nupDigits17) {
  const { data, error } = await supabase
    .from("processos")
    .select("*")
    .eq("nup", nupDigits17)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function insertProcesso({ nup, tipo, entrada, status }) {
  const { data, error } = await supabase
    .from("processos")
    .insert({
      nup,
      tipo,
      entrada_regional: entrada || null,
      status
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateProcessoStatus(id, newStatus) {
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
}

/* =========================
   Prazos (60 dias + sobrestado)
   ========================= */
function calcularPrazosMapa(rows, historicosBatch) {
  const histByProc = new Map();
  for (const h of (historicosBatch || [])) {
    const arr = histByProc.get(h.processo_id) || [];
    arr.push(h);
    histByProc.set(h.processo_id, arr);
  }
  for (const [k, arr] of histByProc) {
    arr.sort((a,b) => new Date(a.changed_at) - new Date(b.changed_at));
  }

  const prazos = new Map();
  for (const p of rows || []) {
    if (SOBRESTADOS.has(p.status)) {
      prazos.set(p.id, "Sobrestado");
      continue;
    }
    let base = p.entrada_regional ? new Date(p.entrada_regional) : null;
    const hist = histByProc.get(p.id) || [];
    let saiuST = null, saiuSD = null;
    for (const h of hist) {
      const de = h.old_status || "";
      const para = h.new_status || "";
      if (de === "Sobrestado Técnico" && para !== "Sobrestado Técnico") saiuST = h.changed_at;
      if (de === "Sobrestado Documental" && para !== "Sobrestado Documental") saiuSD = h.changed_at;
    }
    const tSaida = saiuST || saiuSD;
    if (tSaida) {
      const dt = new Date(tSaida);
      if (!base || dt > base) base = dt;
    }
    prazos.set(
      p.id,
      base ? new Date(base.getTime() + 60 * DIA_MS).toISOString().slice(0, 10) : ""
    );
  }
  return prazos;
}
function calcularPrazoUnit(p, hist = []) {
  if (SOBRESTADOS.has(p.status)) return "Sobrestado";
  let base = p.entrada_regional ? new Date(p.entrada_regional) : null;
  for (const h of hist) {
    const de = h.old_status || "";
    const para = h.new_status || "";
    if (de === "Sobrestado Técnico" && para !== "Sobrestado Técnico") {
      const dt = new Date(h.changed_at);
      if (!base || dt > base) base = dt;
    }
    if (de === "Sobrestado Documental" && para !== "Sobrestado Documental") {
      const dt = new Date(h.changed_at);
      if (!base || dt > base) base = dt;
    }
  }
  if (!base) return "";
  return new Date(base.getTime() + 60 * DIA_MS).toISOString().slice(0,10);
}

/* =========================
   CSS injetado (layout atual)
   ========================= */
function ensureLayoutCSS() {
  if (document.getElementById("proc-css")) return;
  const style = document.createElement("style");
  style.id = "proc-css";
  style.textContent = `
    .container{ max-width: 1200px; margin: 0 auto; padding: 0 8px; }

    .card { background:#fff; border:1px solid #e6e6e6; border-radius:6px; padding:14px; }
    .pane-title { font-size:1.2rem; font-weight:600; margin:0 0 10px 0; }
    .small{ font-size:0.9rem; color:#444; }

    .proc-form-card{ margin-bottom:10px; }
    .proc-form-row{ display:flex; gap:8px; flex-wrap:wrap; align-items:end; }
    .proc-form-row label { font-size:0.95rem; margin-bottom:2px; }
    .proc-form-row input, .proc-form-row select, .proc-form-row button { height:34px; }

    /* Split 35%/65% */
    .proc-split { display:flex; gap:10px; overflow:hidden; }
    .proc-pane { min-width:0; display:flex; flex-direction:column; overflow:hidden; }
    .hist-pane { flex:0 0 35%; }
    .grid-pane { flex:1 1 65%; }
    .pane-title { margin:0 0 8px 0; }
    .pane-body { flex:1 1 auto; min-height:0; overflow:hidden; display:flex; } /* rolagem interna */

    /* Grid de processos */
    :root{
      --w-nup: clamp(20ch, 22ch, 26ch);
      --w-tipo: clamp(8ch, 10ch, 14ch);
      --w-entrada: clamp(10ch, 12ch, 16ch);
      --w-prazo: clamp(8ch, 10ch, 12ch);
    }

    #grid{ flex:1 1 auto; min-height:0; display:flex; }
    .grid-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; position:relative; }

    .proc-grid-header,
    .proc-grid-row{
      display: grid;
      grid-template-columns:
        var(--w-nup)
        var(--w-tipo)
        minmax(0, 1.4fr)
        var(--w-entrada)
        var(--w-prazo)
        minmax(0, 1fr)
        minmax(0, 1fr);
      gap: 0;
      align-items: center;
    }
    .proc-grid-header{
      position: sticky; top: 0; z-index: 3;
      background:#fff; border-bottom:1px solid #ddd;
    }
    .proc-grid-header > div,
    .proc-grid-row > div{
      padding: 10px 10px;
      border-bottom:1px solid #eee;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .proc-grid-row:hover{ background:#fafafa; }
    .proc-grid-row.row-selected{ background:#f2f8ff; }

    .hdc{ display:flex; flex-direction:column; align-items:flex-start; gap:6px; }
    .hdc .sort-wrap{ display:flex; gap:2px; }
    .sort-btn{ font-size:12px; padding:0 4px; height:20px; line-height:20px; }
    .sort-btn.active{ background:#333; color:#fff; }

    /* Histórico */
    .hist-scroll{ flex:1 1 auto; min-height:0; overflow:auto; }
    .hist-header, .hist-row{ display:grid; grid-template-columns: 1.3fr 1fr 1fr 1fr; }
    .hist-header{ position:sticky; top:0; background:#fff; z-index:2; border-bottom:1px solid #ddd; }
    .hist-header > div, .hist-row > div{ padding:10px; border-bottom:1px solid #eee; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  `;
  document.head.appendChild(style);

  // altura dos painéis = viewport - cabeçalho - formulário
  const split = document.querySelector(".proc-split");
  if (!split) return;
  const root = document.querySelector(".proc-mod");
  const available = window.innerHeight - root.getBoundingClientRect().top - 16;
  const formH = root.querySelector(".proc-form-card").getBoundingClientRect().height;
  split.style.height = (available - formH - 10) + "px";
}

/* =========================
   UI helpers (ordenadores)
   ========================= */
function headerCell(key, labelHtml, sort) {
  return `
    <div class="hdc" data-sort-key="${key}">
      <span class="title" data-k="${key}" style="cursor:pointer">${labelHtml}</span>
      <span class="sort-wrap">
        <button class="sort-btn ${sort.key===key && sort.dir==='asc' ? 'active':''}" data-k="${key}" data-d="asc">▲</button>
        <button class="sort-btn ${sort.key===key && sort.dir==='desc' ? 'active':''}" data-k="${key}" data-d="desc">▼</button>
      </span>
    </div>
  `;
}

/* =========================
   VIEW: tabela de processos
   ========================= */
function viewTabela(listView, sort) {
  const header = `
    <div class="proc-grid-header">
      ${headerCell("nup","NUP",sort)}
      ${headerCell("tipo","Tipo",sort)}
      ${headerCell("status","Status",sort)}
      ${headerCell("entrada","1ª Entrada<br>Regional",sort)}
      ${headerCell("prazo","Prazo<br>Regional",sort)}
      ${headerCell("atualizadoPor","Atualizado por",sort)}
      ${headerCell("atualizado","Atualizado em",sort)}
    </div>
  `;
  const body = listView.map(v => `
    <div class="proc-grid-row" data-id="${v.id}" data-nup="${formatNUP(v.nup)}">
      <div>${formatNUP(v.nup)}</div>
      <div>${v.tipo}</div>
      <div>${v.status}</div>
      <div>${v.entrada || ""}</div>
      <div>${v.prazoDisplay}</div>
      <div class="small">${v.atualizadoPor || ""}</div>
      <div class="small">${v.atualizadoStr}</div>
    </div>
  `).join("");

  return `<div class="grid-scroll">${header}${body}</div>`;
}

/* =========================
   VIEW: Histórico
   ========================= */
function viewHistorico(title, hist) {
  const header = `
    <div class="hist-header">
      <div>Data/Hora</div><div>De</div><div>Para</div><div>Por</div>
    </div>
  `;
  const rows = (hist || []).map(h => {
    const autor = h.changed_by_email || h.changed_by || "(desconhecido)";
    const quando = new Date(h.changed_at).toLocaleString();
    const de = h.old_status ?? "(criação)";
    const para = h.new_status ?? "(sem status)";
    return `<div class="hist-row"><div>${quando}</div><div>${de}</div><div>${para}</div><div>${autor}</div></div>`;
  }).join("");

  return `
    <h3 class="pane-title">${title}</h3>
    <div class="pane-body">
      <div class="hist-scroll">
        ${header}
        ${rows || `<div class="hist-row"><div colspan="4">Sem histórico.</div></div>`}
      </div>
    </div>
  `;
}

/* =========================
   Formulário
   ========================= */
function viewFormulario() {
  return `
    <div class="card proc-form-card">
      <div class="proc-form-row">
        <div style="min-width:260px; flex:1 1 260px">
          <label>Insira o NUP do Processo</label>
          <input id="f-nup" inputmode="numeric" autocomplete="off" placeholder="00000.000000/0000-00" />
        </div>
        <div style="flex:0 0 auto"><label>&nbsp;</label><button id="btn-buscar">Buscar</button></div>
        <div style="flex:0 0 auto"><label>&nbsp;</label><button id="btn-limpar" type="button">Limpar</button></div>
        <div style="min-width:180px; flex:1 1 180px">
          <label>Tipo</label>
          <select id="f-tipo" disabled>
            <option value="" disabled selected hidden>-- selecione --</option>
            ${TIPOS.map(t => `<option value="${t}">${t}</option>`).join("")}
          </select>
        </div>
        <div style="min-width:160px; flex:1 1 160px">
          <label>1ª Entrada Regional</label>
          <input id="f-entrada" type="date" disabled />
        </div>
        <div style="min-width:200px; flex:1 1 200px">
          <label>Status</label>
          <select id="f-status" disabled>
            <option value="" disabled selected hidden>-- selecione --</option>
            ${STATUS.map(s => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </div>
        <div style="flex:0 0 auto"><label>&nbsp;</label><button id="btn-salvar" disabled>Salvar</button></div>
        <div style="flex:0 0 auto"><label>&nbsp;</label><button id="btn-excluir" disabled>Excluir</button></div>
      </div>
      <div id="msg-novo" class="small" style="margin-top:6px"></div>
    </div>
  `;
}

/* =========================
   Bind da tabela (click/ordenar)
   ========================= */
function bindTabela(container, refresh, onPickRow) {
  // clique nas linhas
  container.querySelectorAll(".proc-grid-row").forEach(row => {
    const id = row.getAttribute("data-id");
    const nup = row.getAttribute("data-nup");
    row.addEventListener("click", async () => {
      onPickRow(id);
      try {
        container.querySelectorAll(".proc-grid-row").forEach(r => r.classList.remove("row-selected"));
        row.classList.add("row-selected");
        const hist = await getHistorico(id);
        const pane = document.getElementById("hist-pane");
        pane.innerHTML = viewHistorico(`Histórico — ${nup}`, hist);
      } catch (e) {
        alert("Erro ao carregar histórico: " + e.message);
      }
    });
  });

  // ordenação
  container.querySelectorAll(".sort-btn").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      const k = btn.getAttribute("data-k");
      const d = btn.getAttribute("data-d");
      container.dispatchEvent(new CustomEvent("sortchange", { detail: { key:k, dir:d } }));
      ev.stopPropagation();
    });
  });
  container.querySelectorAll(".hdc .title").forEach(lbl => {
    lbl.addEventListener("click", () => {
      const k = lbl.getAttribute("data-k");
      container.dispatchEvent(new CustomEvent("sorttoggle", { detail: { key:k } }));
    });
  });
}

/* =========================
   Paginação (keyset) + scroll
   ========================= */
function viewGrid(listView, sort) {
  const html = viewTabela(listView, sort);
  const grid = document.getElementById("grid");
  grid.innerHTML = html;
}
function attachTableHandlers(container, refresh, onPickRow) {
  bindTabela(container, refresh, onPickRow);
}
function attachHeaderHandlers(container) {
  container.querySelectorAll(".hdc .title").forEach(lbl => {
    lbl.addEventListener("click", () => {
      const k = lbl.getAttribute("data-k");
      container.dispatchEvent(new CustomEvent("sorttoggle", { detail: { key:k } }));
    });
  });
}

/* =========================
   Módulo principal
   ========================= */
export default {
  id: "processos",
  title: "Processos",
  route: "#/processos",
  async view(container) {
    ensureLayoutCSS();

    container.innerHTML = `
      <div class="container proc-mod">
        ${viewFormulario()}
        <div class="proc-split">
          <div class="card proc-pane hist-pane" id="hist-pane">
            ${viewHistorico("Histórico", [])}
          </div>
          <div class="card proc-pane grid-pane" id="grid-pane">
            <h3 class="pane-title">Lista de processos</h3>
            <div class="pane-body">
              <div id="grid">Carregando...</div>
            </div>
          </div>
        </div>
      </div>
    `;

    // refs
    const el = (s) => container.querySelector(s);
    const $nup = el("#f-nup");
    const $tipo = el("#f-tipo");
    const $entrada = el("#f-entrada");
    const $status = el("#f-status");
    const $buscar = el("#btn-buscar");
    const $limpar = el("#btn-limpar");
    const $salvar = el("#btn-salvar");
    const $excluir = el("#btn-excluir");
    const $msg = el("#msg-novo");
    const gridWrap = el("#grid");
    const histPane = el("#hist-pane");
    const root = container;

    // estado
    let currentAction = null;   // 'update' | 'create' | null
    let currentRowId = null;
    let originalStatus = null;
    let pendingCreateNUP = null;

    // sort
    let sort = { key: "updated_at", dir: "desc" };

    // dados em memória
    let allList = [];
    let viewData = [];
    let prazosMap = new Map();

    // paginação
    let cursor = null;        // guarda o updated_at da última página
    let hasNext = true;
    let loadingPage = false;

    function mapLabel(key) {
      switch (key) {
        case "nup": return "NUP";
        case "tipo": return "Tipo";
        case "status": return "Status";
        case "entrada": return "1ª Entrada Regional";
        case "prazo": return "Prazo Regional";
        case "atualizadoPor": return "Atualizado por";
        case "atualizado": return "Atualizado em";
        default: return key;
      }
    }

    function renderGridPreservandoScroll() {
      const sc = gridWrap.querySelector(".grid-scroll");
      const top = sc ? sc.scrollTop : 0;
      viewGrid(viewData, { key: sort.key, dir: sort.dir });
      attachTableHandlers(gridWrap, refreshFirstPage, onPickRow);
      const newSc = gridWrap.querySelector(".grid-scroll");
      if (newSc) newSc.scrollTop = top;
    }

    function onPickRow(id) {
      currentRowId = id;
      currentAction = "update";
      $salvar.disabled = true;
      $excluir.disabled = false;
      $tipo.disabled = true;
      $entrada.disabled = false;
      $status.disabled = false;
    }

    function resetForm(clearNUP = false) {
      currentAction = null;
      currentRowId = null;
      originalStatus = null;
      $salvar.disabled = true;
      $excluir.disabled = true;
      $tipo.value = "";
      $entrada.value = "";
      $status.value = "";
      if (clearNUP) $nup.value = "";
      $tipo.disabled = true;
      $entrada.disabled = true;
      $status.disabled = true;
      $msg.textContent = "";
    }

    // máscara de input do NUP (já existente)
    $nup.addEventListener("input", () => {
      const raw = $nup.value;
      $nup.value = maskNUP(raw);
    });

    function validarObrigatoriosParaCriar() {
      if (!$tipo.value) { alert("Selecione o Tipo."); return false; }
      if (!$entrada.value) { alert("Informe a 1ª Entrada Regional."); return false; }
      if (!$status.value) { alert("Selecione o Status."); return false; }
      return true;
    }
    $status.addEventListener("change", () => {
      if (currentAction === "update") $salvar.disabled = ($status.value === originalStatus || !$status.value);
    });

    // viewData (mapeia allList -> grid)
    function buildViewData() {
      viewData = allList.map(r => {
        const prazoStr = SOBRESTADOS.has(r.status) ? "Sobrestado" : (prazosMap.get(r.id) || "");
        return {
          id: r.id,
          nup: r.nup, tipo: r.tipo, status: r.status,
          entrada: r.entrada_regional || "",
          atualizadoPor: r.modificado_por || "",
          atualizado: r.updated_at ? new Date(r.updated_at).getTime() : 0,
          atualizadoStr: r.updated_at ? new Date(r.updated_at).toLocaleString() : "",
          prazoDisplay: prazoStr,
          prazoTS: prazoStr && prazoStr !== "Sobrestado" ? new Date(prazoStr).getTime() : null,
          entradaTS: r.entrada_regional ? new Date(r.entrada_regional).getTime() : null
        };
      });
    }
    function applySort() {
      const key = sort.key, dir = sort.dir === "asc" ? 1 : -1;
      const comp = (a, b) => {
        switch (key) {
          case "nup": return (a.nup > b.nup ? 1 : a.nup < b.nup ? -1 : 0) * dir;
          case "tipo": return (a.tipo > b.tipo ? 1 : a.tipo < b.tipo ? -1 : 0) * dir;
          case "status": return (a.status > b.status ? 1 : a.status < b.status ? -1 : 0) * dir;
          case "entrada": return ((a.entradaTS || 0) - (b.entradaTS || 0)) * dir;
          case "prazo": return ((a.prazoTS || 0) - (b.prazoTS || 0)) * dir;
          case "atualizadoPor": return (a.atualizadoPor > b.atualizadoPor ? 1 : a.atualizadoPor < b.atualizadoPor ? -1 : 0) * dir;
          case "atualizado": return ((a.atualizado || 0) - (b.atualizado || 0)) * dir;
          default: return 0;
        }
      };
      viewData.sort(comp);
    }

    function attachInfiniteScroll() {
      const sc = gridWrap.querySelector(".grid-scroll");
      if (!sc || sc.__bound) return;
      sc.__bound = true;
      sc.addEventListener("scroll", async () => {
        if (loadingPage || !hasNext) return;
        const nearBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 200;
        if (nearBottom) {
          await fetchNextPage();
        }
      });
    }

    // Carregamento incremental
    async function assimilateRows(rows) {
      if (!rows || !rows.length) return;
      allList = allList.concat(rows);
      const ids = rows.map(r => r.id);
      const historicos = await getHistoricoBatch(ids);
      const prazosSub = calcularPrazosMapa(rows, historicos);
      prazosSub.forEach((v, k) => prazosMap.set(k, v));
      buildViewData();
      renderGridPreservandoScroll();
    }

    async function fetchFirstPage() {
      loadingPage = true;
      try {
        const { data, nextCursor } = await fetchPageByCursor(null);
        cursor = nextCursor;
        hasNext = !!nextCursor;
        allList = data || [];
        const ids = allList.map(r => r.id);
        const historicos = await getHistoricoBatch(ids);
        prazosMap = calcularPrazosMapa(allList, historicos);
        buildViewData();
        applySort();
        viewGrid(viewData, sort);
        attachTableHandlers(gridWrap, refreshFirstPage, onPickRow);
        attachInfiniteScroll();
      } catch (e) {
        alert("Erro ao carregar processos: " + e.message);
      } finally {
        loadingPage = false;
      }
    }

    async function fetchNextPage() {
      if (!hasNext || loadingPage) return;
      loadingPage = true;
      try {
        const { data, nextCursor } = await fetchPageByCursor(cursor);
        cursor = nextCursor;
        hasNext = !!nextCursor;
        await assimilateRows(data || []);
      } catch (e) {
        console.error(e);
      } finally {
        loadingPage = false;
      }
    }

    async function refreshFirstPage() {
      cursor = null;
      hasNext = true;
      loadingPage = false;
      gridWrap.innerHTML = "Atualizando...";
      await fetchFirstPage();
    }

    // Ações do formulário
    $limpar.addEventListener("click", () => {
      resetForm(true);
      histPane.innerHTML = viewHistorico("Histórico", []);
      $nup.focus();
    });

    $buscar.addEventListener("click", async () => {
      const digits = onlyDigits17($nup.value);
      if (digits.length !== 17) { alert("Informe um NUP válido (17 dígitos)."); return; }
      try {
        const found = await getProcessoPorNUP(digits);
        if (found) {
          // posiciona no topo será feito em outra rotina; aqui apenas seleciona
          $tipo.value = found.tipo || "";
          $entrada.value = found.entrada_regional || "";
          $status.value = found.status || "";
          currentRowId = found.id;
          currentAction = "update";
          originalStatus = found.status || "";
          $salvar.disabled = true;
          $excluir.disabled = false;
          $tipo.disabled = true;
          $entrada.disabled = false;
          $status.disabled = false;

          const hist = await getHistorico(found.id);
          histPane.innerHTML = viewHistorico(`Histórico — ${formatNUP(found.nup)}`, hist);
        } else {
          if (!confirm("Processo não encontrado, gostaria de criar?")) {
            resetForm(false);
            return;
          }
          $tipo.disabled = false;
          $entrada.disabled = false;
          $status.disabled = false;
          currentAction = "create";
          pendingCreateNUP = digits;
          $salvar.disabled = false;
          $excluir.disabled = true;
          $msg.textContent = "Preencha os campos e clique em Salvar.";
        }
      } catch (e) {
        alert("Erro na busca: " + e.message);
      }
    });

    $salvar.addEventListener("click", async () => {
      try {
        if (currentAction === "create") {
          if (!validarObrigatoriosParaCriar()) return;
          const novo = await insertProcesso({
            nup: pendingCreateNUP,
            tipo: $tipo.value,
            entrada: $entrada.value || null,
            status: $status.value
          });
          $msg.textContent = "Processo criado com sucesso.";
          resetForm(false);
          histPane.innerHTML = viewHistorico(`Histórico — ${formatNUP(novo.nup)}`, []);
          await refreshFirstPage();
        } else if (currentAction === "update" && currentRowId) {
          if (!$status.value) { alert("Selecione um Status para salvar."); return; }
          const updated = await updateProcessoStatus(currentRowId, $status.value);
          originalStatus = updated.status || "";
          $salvar.disabled = true;
          $msg.textContent = "Status atualizado.";
          await refreshFirstPage();
        } else {
          alert("Busque ou crie um processo antes de salvar.");
        }
      } catch (e) {
        alert("Erro ao salvar: " + e.message);
      }
    });

    $excluir.addEventListener("click", async () => {
      if (currentAction !== "update" || !currentRowId) { alert("Busque um processo existente antes de excluir."); return; }
      if (!confirm("Tem certeza que deseja excluir este processo? Esta ação não pode ser desfeita.")) return;
      try {
        await deleteProcesso(currentRowId);
        $msg.textContent = "Processo excluído com sucesso.";
        resetForm(true); histPane.innerHTML = viewHistorico("Histórico", []);
        await refreshFirstPage(); $nup.focus();
      } catch (e) { alert("Erro ao excluir: " + e.message); }
    });

    // Inicialização
    await fetchFirstPage();
  },
};
