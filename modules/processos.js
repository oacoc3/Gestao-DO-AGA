// modules/processos.js
// Siglas (expansão):
// - CRUD: Create, Read, Update, Delete (Criar, Ler, Atualizar, Excluir)
// - RLS: Row Level Security (Segurança em nível de linha)

import { supabase, ensureSession } from "../supabaseClient.js";

// Cache para exibir "Posto/Graduação" e "Nome de Guerra" em vez do e-mail
const userCache = new Map();
async function fetchProfilesByEmails(emails) {
  const list = Array.from(new Set(emails.filter(e => e && !userCache.has(e))));
  if (!list.length) return;
  await ensureSession();
  const { data, error } = await supabase
    .from("profiles")
    .select("email, posto_graduacao, nome_guerra")
    .in("email", list);
  if (error) throw error;
  (data || []).forEach(p => {
    const display = [p.posto_graduacao, p.nome_guerra].filter(Boolean).join(" ");
    userCache.set(p.email, display);
  });
}
function displayUser(email) {
  return userCache.get(email) || email || "";
}

/* =========================
   Constantes de domínio
   ========================= */
const TIPOS = ["PDIR", "Inscrição/Alteração", "Exploração", "OPEA"];
const STATUS = [
  "Análise Documental", "Análise ICA", "Análise Téc. Prel.",
  "Análise Técnica", "Análise GABAER", "Confecção de Doc.", "Revisão OACO",
  "Aprovação", "Sobrestado", "Publicação de Portaria", "Arquivado"
];
const PARECER_OPCOES = ["ATM", "DT", "CGNA", "COMAE", "COMGAP", "COMPREP", "OPR AD"];
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
const isFullNUP = (v) => onlyDigits17(v).length === 17;
// Sempre exibir com máscara
const displayNUP = (v) => maskNUP(onlyDigits17(v));

// Formata datas no padrão DD/MM/AA
function formatDateShort(value) {
  if (!value) return "";
  try {
    const [y, m, d] = String(value).split("T")[0].split("-");
    return `${d}/${m}/${y.slice(-2)}`;
  } catch {
    return "";
  }
}

/* =========================
   Acesso Supabase (CRUD)
   ========================= */
async function getProcessoByNup(nup) {
  await ensureSession();
  const { data, error } = await supabase
    .from("processos")
    .select("*")
    .eq("nup", nup)
    .maybeSingle();
  if (error) throw error;
  return data;
}
async function createProcesso(payload) {
  await ensureSession();
  const { data, error } = await supabase
    .from("processos")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}
async function updateStatus(id, newStatus) {
  await ensureSession();
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
  await ensureSession();
  const { error } = await supabase.from("processos").delete().eq("id", id);
  if (error) throw error;
  return true;
}
async function getHistorico(processoId) {
 await ensureSession();
  const { data, error } = await supabase
    .from("status_history")
    .select("*")
    .eq("processo_id", processoId)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return data;
}
async function getHistoricoBatch(ids) {
  if (!ids.length) return [];
  await ensureSession();
  const { data, error } = await supabase
    .from("status_history")
    .select("processo_id, old_status, new_status, changed_at, changed_by_email, changed_by, parecer")
    .in("processo_id", ids);
  if (error) throw error;
  return data;
}

/* =========================
   Cálculo Prazo Regional
   ========================= */
const SOBRESTADOS = new Set(["Sobrestado"]);
const DIA_MS = 24 * 60 * 60 * 1000;

function calcularPrazosMapa(processos, historicos) {
  // última saída de sobrestado por processo
  const saidaSobMap = new Map();
  for (const h of historicos) {
    const saiuDeSob = SOBRESTADOS.has(h.old_status) && !SOBRESTADOS.has(h.new_status);
    if (saiuDeSob) {
      const t = new Date(h.changed_at).getTime();
      const prev = saidaSobMap.get(h.processo_id);
      if (!prev || t > prev) saidaSobMap.set(h.processo_id, t);
    }
  }
  const prazos = new Map();
  for (const p of processos) {
    let base = p.entrada_regional ? new Date(p.entrada_regional) : null;
    const tSaida = saidaSobMap.get(p.id);
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
    const saiuDeSob = SOBRESTADOS.has(h.old_status) && !SOBRESTADOS.has(h.new_status);
    if (saiuDeSob) {
      const t = new Date(h.changed_at);
      if (!base || t > base) base = t;
    }
  }
  return base ? new Date(base.getTime() + 60 * DIA_MS).toISOString().slice(0, 10) : "";
}

function extractPareceresRecebidos(hist = []) {
  const set = new Set();
  for (const h of hist) {
    const p = h.parecer;
    if (!p) continue;
    if (Array.isArray(p)) p.forEach(v => set.add(v));
    else set.add(p);
  }
  return Array.from(set);
}

/* =========================
   Seleção múltipla de parecer
   ========================= */
function selectParecerOptions(options) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0,0,0,0.3)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
      background: "#fff",
      padding: "12px",
      border: "1px solid #ccc",
      borderRadius: "4px",
      minWidth: "200px",
    });
    box.innerHTML = `
      <label>Selecione os pareceres:</label><br/>
      <select id="parecer-select" multiple size="${Math.min(options.length, 5)}" style="width:100%; margin-top:4px;">
        ${options.map(o => `<option value="${o}">${o}</option>`).join("")}
      </select>
      <div style="margin-top:8px; text-align:right;">
        <button id="parecer-ok">OK</button>
        <button id="parecer-cancel" type="button" style="margin-left:6px;">Cancelar</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const select = box.querySelector("#parecer-select");
    box.querySelector("#parecer-ok").addEventListener("click", () => {
      const values = Array.from(select.selectedOptions).map((o) => o.value);
      document.body.removeChild(overlay);
      resolve(values);
    });
    box.querySelector("#parecer-cancel").addEventListener("click", () => {
      document.body.removeChild(overlay);
      resolve([]);
    });
  });
}

function selectParecerRecebido(options) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0,0,0,0.3)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
      background: "#fff",
      padding: "12px",
      border: "1px solid #ccc",
      borderRadius: "4px",
      minWidth: "200px",
    });
    box.innerHTML = `
      <label>Selecione o parecer:</label><br/>
      <select id="parecer-select" style="width:100%; margin-top:4px;">
        <option value="" disabled selected hidden>-- selecione --</option>
        ${options.map(o => `<option value="${o}">${o}</option>`).join("")}
      </select>
      <div style="margin-top:8px; text-align:right;">
        <button id="parecer-ok">OK</button>
        <button id="parecer-cancel" type="button" style="margin-left:6px;">Cancelar</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const select = box.querySelector("#parecer-select");
    box.querySelector("#parecer-ok").addEventListener("click", () => {
      const value = select.value;
      document.body.removeChild(overlay);
      resolve(value);
    });
    box.querySelector("#parecer-cancel").addEventListener("click", () => {
      document.body.removeChild(overlay);
      resolve("");
    });
  });
}

/* =========================
   CSS (grid, rolagens, etc.)
   ========================= */
function ensureLayoutCSS() {
  if (document.getElementById("proc-grid-css")) return;
  const style = document.createElement("style");
  style.id = "proc-grid-css";
  style.textContent = `
    /* Sem rolagem de página */
    html, body { overflow: hidden; }

    .proc-mod { display:flex; flex-direction:column; overflow:hidden; }

    /* Formulário compacto */
    .proc-form-card { flex:0 0 auto; padding-top:8px; padding-bottom:8px; }
    .proc-form-row { display:flex; align-items:flex-end; gap:8px; flex-wrap:nowrap; overflow:auto; }
    .proc-form-row > div { display:flex; flex-direction:column; }
    .proc-form-row label { font-size:0.95rem; margin-bottom:2px; }
    .proc-form-row input, .proc-form-row select, .proc-form-row button { height:34px; }

    /* Split: processos 65%, histórico 35% */
    .proc-split { display:flex; gap:10px; overflow:hidden; }
    .proc-pane { min-width:0; display:flex; flex-direction:column; overflow:hidden; }
    .grid-pane { flex:0 0 65%; }
    .hist-pane { flex:0 0 35%; }
    .pane-title { margin:0 0 8px 0; }
    .pane-body { flex:1 1 auto; min-height:0; overflow:hidden; display:flex; } /* rolagem interna */

    /* Grid de processos */
    :root{
      --w-nup: clamp(20ch, 22ch, 26ch);
      --w-tipo: clamp(8ch, 10ch, 14ch);
      --w-parecer: clamp(16ch, 20ch, 26ch);
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
        var(--w-parecer)
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
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: center;
      padding: 4px 6px;
      font-size: 12px;
    }
    .proc-grid-row > div:nth-child(4){
      white-space: normal;
      overflow: visible;
      text-overflow: unset;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 2px;
    }
    /* Título + botões (ordenadores) empilhados */
    .hdc { display:flex; flex-direction:column; align-items:center; gap:2px; }
    .hdc .title { line-height:1.05; }
    .sort-wrap { display:inline-flex; gap:2px; }
    .sort-btn { border:1px solid #ccc; background:#f7f7f7; padding:0 4px; line-height:16px; height:18px; cursor:pointer; }
    .sort-btn.active { background:#e9e9e9; font-weight:bold; }

    .proc-grid-row.row-selected { outline:2px solid #999; outline-offset:-1px; }
    .badge-parecer{ font-size:10px; padding:1px 4px; border:1px solid transparent; }
    .badge-parecer.pendente{ background:#f8d7da; color:#721c24; border-color:#f5c6cb; }
    .badge-parecer.recebido{ background:#d4edda; color:#155724; border-color:#c3e6cb; }

    /* Histórico */
    :root{
      --w-hist-data: clamp(12ch, 16ch, 18ch);
      --w-hist-autor: clamp(16ch, 20ch, 24ch);
    }
    .hist-scroll { height:100%; overflow-y:auto; overflow-x:hidden; }

    .hist-header,
    .hist-row{
      display:grid;
      grid-template-columns:
        var(--w-hist-data)
        minmax(0, 1fr)
        var(--w-hist-autor);
      gap:0;
      align-items:center;
    }
    .hist-header{
      position: sticky; top: 0; z-index:2;
      background:#fff; border-bottom:1px solid #ddd;
    }
    .hist-header > div, .hist-row > div{
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: center;
      padding: 4px 6px;
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
}

function applyHeights(root) {
  const mod = root.querySelector(".proc-mod");
  const split = root.querySelector(".proc-split");
  if (!mod || !split) return;

  const top = mod.getBoundingClientRect().top;
  const available = window.innerHeight - top - 12;
  mod.style.height = available + "px";

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
      ${headerCell("parecer","Pareceres",sort)}
      ${headerCell("entrada","1ª Entrada<br>Regional",sort)}
      ${headerCell("prazo","Prazo<br>Regional",sort)}
      ${headerCell("atualizadoPor","Atualizado por",sort)}
      ${headerCell("atualizado","Atualizado em",sort)}
    </div>
  `;
  const body = listView.map(v => `
    <div class="proc-grid-row" data-id="${v.id}" data-nup="${v.nup}">
      <div>${v.nup}</div>
      <div>${v.tipo}</div>
      <div>${v.status}</div>
      <div>${v.parecerDisplay}</div>
      <div>${v.entrada || ""}</div>
      <div>${v.prazoDisplay}</div>
      <div class="small">${v.atualizadoPor || ""}</div>
      <div class="small">${v.atualizadoStr}</div>
    </div>
  `).join("");

  return `<div class="grid-scroll">${header}${body}</div>`;
}

/* =========================
   VIEW: histórico (grid)
   ========================= */
function viewHistorico(title, hist) {
  const header = `
    <div class="hist-header">
     <div>Data</div><div>Mudança</div><div>Por</div>
    </div>
  `;
  const rows = (hist || []).map(h => {
    const autor = displayUser(h.changed_by_email) || h.changed_by || "(desconhecido)";
    const quando = formatDateShort(h.changed_at);
    let mudanca = h.new_status || "";
    if (!mudanca) {
      if (h.parecer) {
        const p = Array.isArray(h.parecer) ? h.parecer.join(', ') : h.parecer;
        mudanca = `Parecer ${p} recebido`;
      } else {
        const p = h.parecer_solicitado || h.orgao;
        if (p) mudanca = `Parecer ${Array.isArray(p) ? p.join(', ') : p} solicitado`;
      }
    }
    if (!mudanca) mudanca = h.old_status || "(sem registro)";
    return `<div class="hist-row"><div>${quando}</div><div>${mudanca}</div><div>${autor}</div></div>`;
  }).join("");

  return `
    <h3 class="pane-title">${title}</h3>
    <div class="pane-body">
      <div class="hist-scroll">
        ${header}
        ${rows || `<div class="hist-row"><div colspan="3">Sem histórico.</div></div>`}
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
      <div class="proc-form-row">
        <div style="flex:0 0 auto"><label>&nbsp;</label><button id="btn-parecer" disabled>Solicitar Parecer</button></div>
        <div style="flex:0 0 auto"><label>&nbsp;</label><button id="btn-receber" disabled>Receber Parecer</button></div>
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
    const nupMasked = row.getAttribute("data-nup"); // já vem mascarado
    row.addEventListener("click", async () => {
      onPickRow(id);
      try {
        container.querySelectorAll(".proc-grid-row").forEach(r => r.classList.remove("row-selected"));
        row.classList.add("row-selected");
        const hist = await getHistorico(id);
        await fetchProfilesByEmails(hist.map(h => h.changed_by_email).filter(Boolean));
         const pane = document.getElementById("hist-pane");
        pane.innerHTML = viewHistorico(`Histórico — ${nupMasked}`, hist);
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
const PAGE_SIZE = 200; // tamanho da página

async function fetchPageByCursor(cursor) {
  // Estratégia: duas consultas para emular keyset (evita OR complexo no PostgREST)
  // 1) updated_at < cursor.updated_at
  // 2) updated_at = cursor.updated_at AND id < cursor.id
  await ensureSession();
  if (!cursor) {
    const { data, error } = await supabase
      .from("processos")
      .select("*")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);
    if (error) throw error;
    return pack(data || []);
  } else {
    const { data: part1, error: e1 } = await supabase
      .from("processos")
      .select("*")
      .lt("updated_at", cursor.updated_at)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);
    if (e1) throw e1;

    const remain = Math.max(0, PAGE_SIZE - (part1?.length || 0));
    let part2 = [];
    if (remain > 0) {
      const { data: eqdata, error: e2 } = await supabase
        .from("processos")
        .select("*")
        .eq("updated_at", cursor.updated_at)
        .lt("id", cursor.id)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(remain);
      if (e2) throw e2;
      part2 = eqdata || [];
    }
    const rows = [...(part1 || []), ...part2];
    return pack(rows);
  }

  function pack(rows) {
    const nextCursor = rows.length
      ? { updated_at: rows[rows.length - 1].updated_at, id: rows[rows.length - 1].id }
      : null;
    return { data: rows, nextCursor };
  }
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
    const $parecer = el("#btn-parecer");
    const $receber = el("#btn-receber");
    const $msg = el("#msg-novo");
    const gridWrap = el("#grid");
    const histPane = el("#hist-pane");
    const root = container;

    // estado
    let currentAction = null;   // 'update' | 'create' | null
    let currentRowId = null;
    let originalStatus = null;
    let pendingNup = "";
    let currentNupMasked = "";

    let allList = [];
    let prazosMap = new Map();
    let viewData = [];
    let pinnedId = null; // para fixar no topo após busca

    // paginação (keyset)
    let cursor = null;
    let hasNext = true;
    let loadingPage = false;

    const sort = { key:"atualizado", dir:"desc" };

    // Alturas/rolagem interna
    const resizeAll = () => applyHeights(root);
    window.addEventListener("resize", resizeAll);
    setTimeout(resizeAll, 0);

    // Máscara NUP no input
    $nup.addEventListener("input", () => { $nup.value = maskNUP(onlyDigits17($nup.value)); });

    // Helpers de formulário
    function resetForm(clearNup=false) {
      $msg.textContent = "";
      if (clearNup) $nup.value = "";
      $tipo.value = ""; $entrada.value = ""; $status.value = "";
      $tipo.disabled = true; $entrada.disabled = true; $status.disabled = true;
      $salvar.disabled = true; $excluir.disabled = true; $parecer.disabled = true; $receber.disabled = true;
      currentAction = null; currentRowId = null; originalStatus = null; pendingNup = ""; currentNupMasked = "";
      pinnedId = null; // remove o pino ao limpar
    }
    function setCreateMode(nupMasked) {
      // >>> Correção principal: limpar campos e entrar em modo "create"
      currentAction = "create";
      pendingNup = nupMasked;
      currentNupMasked = nupMasked;

      $nup.value = nupMasked; // garante máscara no campo
      $tipo.value = "";
      $entrada.value = "";
      $status.value = "";

      $tipo.disabled = false;
      $entrada.disabled = false;
      $status.disabled = false;

      $salvar.disabled = false;
     $excluir.disabled = true; $parecer.disabled = true; $receber.disabled = true;

      $msg.textContent = "Preencha os campos e clique em Salvar.";
      histPane.innerHTML = viewHistorico(`Histórico — ${nupMasked}`, []);
    }
    function setUpdateMode(row) {
      currentAction = "update";
      currentRowId = row.id;
      originalStatus = row.status;
      currentNupMasked = displayNUP(row.nup);

      // preenche e bloqueia tipo/entrada; status editável
      $nup.value = currentNupMasked;
      $tipo.value = row.tipo || "";
      $entrada.value = row.entrada_regional || "";
      $status.value = row.status || "";

      $tipo.disabled = true;
      $entrada.disabled = true;
      $status.disabled = false;

      $salvar.disabled = true;
      $excluir.disabled = false;
      $parecer.disabled = (row.pareceres_pendentes?.length || 0) >= PARECER_OPCOES.length;
      $receber.disabled = !(row.pareceres_pendentes && row.pareceres_pendentes.length);
      $msg.textContent = "Processo encontrado. Altere o Status se necessário ou veja o Histórico.";
    }
    function perguntaCriar(on) {
      $msg.innerHTML = `Processo não encontrado, gostaria de criar?
        <button id="btn-sim" style="margin-left:8px">Sim</button>
        <button id="btn-nao" style="margin-left:4px">Não</button>`;
      el("#btn-sim").onclick = () => on(true);
      el("#btn-nao").onclick = () => on(false);
    }
    function validarObrigatoriosParaCriar() {
      if (!$tipo.value) { alert("Selecione o Tipo."); return false; }
      if (!$entrada.value) { alert("Informe a 1ª Entrada Regional."); return false; }
      if (!$status.value) { alert("Selecione o Status."); return false; }
      return true;
    }
    $status.addEventListener("change", () => {
      if (currentAction === "update") $salvar.disabled = ($status.value === originalStatus || !$status.value);
    });

    // viewData (mapeia allList -> grid) — NUP sempre mascarado
    function buildViewData() {
      viewData = allList.map(r => {
        const prazoStrRaw = SOBRESTADOS.has(r.status) ? "Sobrestado" : (prazosMap.get(r.id) || "");
        const prazoDisplay = prazoStrRaw && prazoStrRaw !== "Sobrestado" ? formatDateShort(prazoStrRaw) : prazoStrRaw;
        return {
          id: r.id,
          nup: displayNUP(r.nup),   // <<< garante máscara na lista
          tipo: r.tipo,
          status: r.status,
          parecerCount: (r.pareceres_pendentes || []).length,
          parecerDisplay: (function(){
            const parts = PARECER_OPCOES.map(p => {
              if (r.pareceres_pendentes?.includes(p)) return `<span class="badge badge-parecer pendente">${p}</span>`;
              if (r.pareceres_recebidos?.includes(p)) return `<span class="badge badge-parecer recebido">${p}</span>`;
              return "";
            }).filter(Boolean);
            return parts.length ? parts.join("") : '-';
          })(),
          entrada: formatDateShort(r.entrada_regional),
          atualizadoPor: displayUser(r.modificado_por),
          atualizado: r.updated_at ? new Date(r.updated_at).getTime() : 0,
          atualizadoStr: formatDateShort(r.updated_at),
          prazoDisplay: prazoDisplay,
          prazoTS: prazoStrRaw && prazoStrRaw !== "Sobrestado" ? new Date(prazoStrRaw).getTime() : null,
          entradaTS: r.entrada_regional ? new Date(r.entrada_regional).getTime() : null
        };
      });
    }
    function applySort() {
      const key = sort.key, dir = sort.dir === "asc" ? 1 : -1;
      const val = (v) => {
        switch (key) {
          case "nup": return v.nup || "";
          case "tipo": return v.tipo || "";
         case "parecer": return v.parecerCount || 0;
           case "status": return v.status || "";
          case "entrada": return v.entradaTS ?? -Infinity;
          case "prazo": return (v.prazoDisplay === "Sobrestado") ? Number.POSITIVE_INFINITY : (v.prazoTS ?? Number.POSITIVE_INFINITY);
          case "atualizadoPor": return v.atualizadoPor || "";
          case "atualizado": return v.atualizado ?? 0;
          default: return "";
        }
      };
      const arr = viewData.slice();
      arr.sort((a,b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);

      // pino vai para o topo
      if (pinnedId != null) {
        const idx = arr.findIndex(v => String(v.id) === String(pinnedId));
        if (idx > 0) {
          const [item] = arr.splice(idx, 1);
          arr.unshift(item);
        }
      }
      return arr;
    }

    function renderGrid() {
      const view = applySort();
      gridWrap.innerHTML = viewTabela(view, sort);
      bindTabela(gridWrap, refreshFirstPage, onPickRowFromList);

      // eventos de ordenação
      gridWrap.addEventListener("sortchange", (ev) => {
        sort.key = ev.detail.key;
        sort.dir = ev.detail.dir;
        renderGrid();
      });
      gridWrap.addEventListener("sorttoggle", (ev) => {
        const k = ev.detail.key;
        if (sort.key === k) sort.dir = sort.dir === "asc" ? "desc" : "asc";
        else { sort.key = k; sort.dir = "asc"; }
        renderGrid();
      });

      // liga o infinite scroll
      attachInfiniteScroll();
      // mantém linha selecionada (se houver)
      if (currentRowId) {
        gridWrap.querySelectorAll(".proc-grid-row").forEach(r => {
          if (r.getAttribute("data-id") === String(currentRowId)) r.classList.add("row-selected");
        });
      }
    }

    function renderGridPreservandoScroll() {
      const sc = gridWrap.querySelector(".grid-scroll");
      const st = sc ? sc.scrollTop : 0;
      renderGrid();
      const sc2 = gridWrap.querySelector(".grid-scroll");
      if (sc2) sc2.scrollTop = st;
    }

    function onPickRowFromList(id) {
      const row = allList.find(r => String(r.id) === String(id));
      if (!row) return;
      setUpdateMode(row);
      $nup.value = displayNUP(row.nup); // <<< máscara no formulário
      currentRowId = row.id;
      // não fixa pino no clique (só na busca)
    }

    // garante que um processo buscado apareça no topo
    async function upsertPinnedRow(row) {
      if (!allList.some(r => String(r.id) === String(row.id))) {
        allList.push(row);
        await fetchProfilesByEmails([row.modificado_por].filter(Boolean));
        const hist = await getHistorico(row.id);
        const prazo = calcularPrazoUnit(row, hist);
        row.pareceres_recebidos = extractPareceresRecebidos(hist);
        prazosMap.set(row.id, prazo);
        buildViewData();
      }
      pinnedId = row.id;
      renderGridPreservandoScroll();
    }

    // Scroll infinito
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
      await fetchProfilesByEmails(rows.map(r => r.modificado_por).filter(Boolean));
      const ids = rows.map(r => r.id);
      const historicos = await getHistoricoBatch(ids);
      const prazosSub = calcularPrazosMapa(rows, historicos);
      prazosSub.forEach((v, k) => prazosMap.set(k, v));
      const recebidosMap = new Map();
      historicos.forEach(h => {
        if (!h.parecer) return;
        const arr = Array.isArray(h.parecer) ? h.parecer : [h.parecer];
        const set = recebidosMap.get(h.processo_id) || new Set();
        arr.forEach(v => set.add(v));
        recebidosMap.set(h.processo_id, set);
      });
      rows.forEach(r => {
        r.pareceres_recebidos = Array.from(recebidosMap.get(r.id) || []);
      });
      buildViewData();
      renderGridPreservandoScroll();
    }

    async function fetchFirstPage() {
      loadingPage = true;
      try {
        const { data, nextCursor } = await fetchPageByCursor(null);
        cursor = nextCursor;
        hasNext = !!nextCursor && (data?.length || 0) > 0;
        allList = []; prazosMap = new Map(); viewData = [];
        await assimilateRows(data || []);
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
        hasNext = !!nextCursor && (data?.length || 0) > 0;
        await assimilateRows(data || []);
      } finally {
        loadingPage = false;
      }
    }

    async function refreshFirstPage() {
      // recarrega a primeira página (após salvar/excluir)
      pinnedId = null;
      await fetchFirstPage();
    }

    // Ações do formulário
    const buscar = async () => {
      if (!isFullNUP($nup.value)) {
        $msg.textContent = "Informe um NUP completo (17 dígitos)."; $nup.focus(); return;
      }
      const nupMasked = maskNUP(onlyDigits17($nup.value));
      $msg.textContent = "Buscando...";
      try {
        const row = await getProcessoByNup(nupMasked);
        if (row) {
          setUpdateMode(row);
          currentRowId = row.id;
          await upsertPinnedRow(row); // garante a 1ª linha
          const hist = await getHistorico(row.id);
          histPane.innerHTML = viewHistorico(`Histórico — ${displayNUP(row.nup)}`, hist);
        } else {
          perguntaCriar((decisao) => {
            if (decisao) {
              setCreateMode(nupMasked);    // <<< limpa campos e habilita criação
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
    };

    $buscar.addEventListener("click", buscar);
    $limpar.addEventListener("click", () => {
      resetForm(true);
      histPane.innerHTML = viewHistorico("Histórico", []);
      renderGridPreservandoScroll();
      $msg.textContent = "NUP limpo.";
      $nup.focus();
    });

    $salvar.addEventListener("click", async () => {
      try {
        if (currentAction === "update") {
          if ($status.value === originalStatus || !$status.value) { alert("Altere o Status para salvar."); return; }
          await updateStatus(currentRowId, $status.value);
          $msg.textContent = "Status atualizado com sucesso.";
          originalStatus = $status.value; $salvar.disabled = true;
          await refreshFirstPage();
          const hist = await getHistorico(currentRowId);
          histPane.innerHTML = viewHistorico(`Histórico — ${currentNupMasked}`, hist);
        } else if (currentAction === "create") {
          if (!validarObrigatoriosParaCriar()) return;
          const payload = {
            nup: pendingNup, // já mascarado
            tipo: $tipo.value,
            status: $status.value,
            entrada_regional: $entrada.value
          };
          const novo = await createProcesso(payload);
          $msg.textContent = "Processo criado com sucesso.";
          setUpdateMode(novo); currentRowId = novo.id;
          await refreshFirstPage();
          const hist = await getHistorico(novo.id);
          histPane.innerHTML = viewHistorico(`Histórico — ${displayNUP(novo.nup)}`, hist);
        } else {
          alert("Use o botão Buscar antes de salvar.");
        }
      } catch (e) { alert("Erro ao salvar: " + e.message); }
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

    $parecer.addEventListener("click", async () => {
      if (!currentRowId) { alert("Busque um processo antes de solicitar parecer."); return; }
      const row = allList.find(r => String(r.id) === String(currentRowId));
      const pend = row?.pareceres_pendentes || [];
      const disponiveis = PARECER_OPCOES.filter(p => !pend.includes(p));
      const escolhas = await selectParecerOptions(disponiveis);
      if (!escolhas.length) return;
      $parecer.disabled = true;
      try {
        await ensureSession();
        const { error } = await supabase.rpc("request_parecer", { p_processo_id: currentRowId, p_orgaos: escolhas });
        if (error) throw error;
        if (row) {
          row.pareceres_pendentes = Array.from(new Set([...(row.pareceres_pendentes || []), ...escolhas]));
        }
        const hist = await getHistorico(currentRowId);
        await fetchProfilesByEmails(hist.map(h => h.changed_by_email).filter(Boolean));
        if (row) row.pareceres_recebidos = extractPareceresRecebidos(hist);
        const titulo = row ? `Histórico — ${displayNUP(row.nup)}` : "Histórico";
        histPane.innerHTML = viewHistorico(titulo, hist);
        buildViewData();
        renderGridPreservandoScroll();
        $parecer.disabled = (row?.pareceres_pendentes?.length || 0) >= PARECER_OPCOES.length;
       $receber.disabled = !(row?.pareceres_pendentes && row.pareceres_pendentes.length);
        $msg.textContent = "Parecer solicitado.";
      } catch (e) {
        $msg.textContent = "Erro ao solicitar parecer: " + e.message;
        $parecer.disabled = false;
      }
    });

    $receber.addEventListener("click", async () => {
      if (!currentRowId) { alert("Busque um processo antes de receber parecer."); return; }
      const row = allList.find(r => String(r.id) === String(currentRowId));
      const pend = row?.pareceres_pendentes || [];
      if (!pend.length) { alert("Não há parecer pendente."); return; }
      const escolha = await selectParecerRecebido(pend);
      if (!escolha) return;
      $receber.disabled = true;
      try {
        await ensureSession();
        const { error } = await supabase.rpc("receive_parecer", { p_processo_id: currentRowId, p_orgao: escolha });
        if (error) throw error;
        if (row) {
          row.pareceres_pendentes = (row.pareceres_pendentes || []).filter(p => p !== escolha);
        }
        const hist = await getHistorico(currentRowId);
        await fetchProfilesByEmails(hist.map(h => h.changed_by_email).filter(Boolean));
        if (row) row.pareceres_recebidos = extractPareceresRecebidos(hist);
        const titulo = row ? `Histórico — ${displayNUP(row.nup)}` : "Histórico";
        histPane.innerHTML = viewHistorico(titulo, hist);
        buildViewData();
        renderGridPreservandoScroll();
        $parecer.disabled = (row?.pareceres_pendentes?.length || 0) >= PARECER_OPCOES.length;
        $msg.textContent = "Parecer recebido.";
      } catch (e) {
        $msg.textContent = "Erro ao registrar parecer: " + e.message;
      } finally {
        $receber.disabled = !(row?.pareceres_pendentes && row.pareceres_pendentes.length);
      }
    });

    // Inicialização
    await fetchFirstPage();
  },
};
