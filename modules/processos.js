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
// Opções de parecer interno
const PARECER_OPCOES = ["ATM", "DT", "CGNA"];
// Nenhum órgão interno gera necessidade automática de SIGADAER
const SIGADAER_ORGAOS = [];
// Opções disponíveis para SIGADAER
const SIGADAER_OPCOES = [
  "COMAE",
  "COMPREP",
  "COMGAP",
  "OPR AD",
  "Município",
  "Estado",
  "SAC",
  "GABAER",
  "JJAER",
  "AGU",
];
// Tipos extras disponíveis apenas no recebimento
const RECEBIMENTO_EXTRA_MAP = {
  PDIR: "ANAC - PDIR",
  "Exploração": "SAC - Exploração",
};
const RECEBIMENTO_EXTRA_OPCOES = Object.values(RECEBIMENTO_EXTRA_MAP);
// Opções de notificação (atualizadas)
const NOTIFICACAO_OPCOES = [
  "Favorável - Obra Não Iniciada",
  "Favorável - Obra em Andamento",
  "Favorável - Concluída",
  "Desfavorável - Remoção/Rebaixamento",
  "Desfavorável - JJAER",
  "Término de Obra - Atraso",
  "Não Conformidade Documental",
  "Não Conformidade Técnica",
];
const ALL_PARECERES = Array.from(new Set([
  ...PARECER_OPCOES,
  ...SIGADAER_OPCOES,
  ...RECEBIMENTO_EXTRA_OPCOES,
]));

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

// Formata horas no padrão HH:MM
function formatTimeShort(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
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
async function updateStatus(id, newStatus, terminoObra) {
  await ensureSession();
  const payload = { status: newStatus };
  if (terminoObra !== undefined) payload.termino_obra = terminoObra || null;
  const { data, error } = await supabase
    .from("processos")
    .update(payload)
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

function extractComunicacoesCientes(hist = []) {
  const set = new Set();
  for (const h of hist) {
    const c = h.comunicacao;
    if (!c) continue;
    if (Array.isArray(c)) c.forEach(v => set.add(v));
    else set.add(c);
  }
  return Array.from(set);
}

/* =========================
   Seleção múltipla de parecer
   ========================= */
function selectParecerOptions(options, titulo = "o Parecer") {
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
      <label>Selecione ${titulo}:</label><br/>
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
function selectParecerRecebido(options, titulo = "o Parecer") {
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
      <label>Selecione ${titulo}:</label><br/>
      <select id="parecer-select" size="${Math.min(options.length, 5)}" style="width:100%; margin-top:4px;">
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


function selectParecerExpedir(options, titulo = "o Parecer para Expedir") {
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
      <label>Selecione ${titulo}:</label><br/>
      <select id="parecer-select" size="${Math.min(options.length, 5)}" style="width:100%; margin-top:4px;">
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
    .proc-form-row button { width:130px; white-space:normal; font-size:11px; height:auto; min-height:34px; line-height:1.2; }

    /* Split: processos 65%, histórico 35% */
    .proc-split { display:flex; gap:10px; overflow:hidden; }
    .proc-pane { min-width:0; display:flex; flex-direction:column; overflow:hidden; }
    .grid-pane { flex:0 0 65%; }
    .hist-pane { flex:0 0 35%; }
    .pane-title { margin:0 0 8px 0; }
    .pane-body { flex:1 1 auto; min-height:0; overflow:hidden; display:flex; } /* rolagem interna */

    /* Grid de processos */
    :root{
      --w-nup: 20ch;
      --w-tipo: clamp(14ch, 18ch, 24ch);
      --w-notif: clamp(10ch, 12ch, 16ch);
      --w-parecer: clamp(16ch, 20ch, 26ch);
      --w-entrada: clamp(8ch, 10ch, 10ch);
      --w-prazo: clamp(8ch, 10ch, 10ch);
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
        var(--w-notif)
        var(--w-parecer)
        var(--w-entrada)
        var(--w-prazo);
      gap: 0;
      align-items: center;
       border-bottom:1px dashed #ddd;
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
    .proc-grid-row > div:nth-child(4),
    .proc-grid-row > div:nth-child(5){
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
    .filter-select { font-size:11px; }

    .proc-grid-row.row-selected { outline:2px solid #999; outline-offset:-1px; }
    .badge-parecer{ font-size:10px; padding:1px 4px; border:1px solid transparent; line-height:1.1; }
    .badge-parecer .sub{ font-size:8px; display:block; }
    /* >>> Patch: troca as cores das badges para pendente/expedir */
    .badge-parecer.pendente{ background:#fff3cd; color:#856404; border-color:#ffeeba; }
    .badge-parecer.recebido{ background:#d4edda; color:#155724; border-color:#c3e6cb; }
    .badge-parecer.expedir{ background:#f8d7da; color:#721c24; border-color:#f5c6cb; }
    .badge-notif{ font-size:10px; padding:1px 4px; border:1px solid transparent; line-height:1.1; white-space:normal; text-align:center; }
    .badge-notif .sub{ font-size:8px; display:block; }
    .badge-notif.pendente{ background:#fff3cd; color:#856404; border-color:#ffeeba; }
    .badge-notif.recebido{ background:#d4edda; color:#155724; border-color:#c3e6cb; }

    /* Histórico */
    :root{
      --w-hist-data: clamp(14ch, 18ch, 22ch);
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
    .hist-header > div,
    .hist-row > div{
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

function filterHeaderCell(key, labelHtml, options, selected) {
  return `
    <div class="hdc">
      <span class="title">${labelHtml}</span>
      <select class="filter-select" data-k="${key}">
        <option value="">Todos</option>
        ${options.map(o => `<option value="${o}" ${selected===o?'selected':''}>${o}</option>`).join("")}
      </select>
    </div>
  `;
}

function plainHeaderCell(labelHtml) {
  return `<div class="hdc"><span class="title">${labelHtml}</span></div>`;
}

/* =========================
   VIEW: tabela de processos
   ========================= */
function viewTabela(listView, sort, filters) {
  const header = `
    <div class="proc-grid-header">
      ${headerCell("nup","NUP",sort)}
      ${filterHeaderCell("tipo","Tipo",TIPOS,filters.tipo)}
      ${filterHeaderCell("status","Status",STATUS,filters.status)}
      ${plainHeaderCell("Notificações")}
      ${plainHeaderCell("Envios/Recebimentos")}
      ${headerCell("entrada","1ª Entrada<br>Regional",sort)}
      ${headerCell("prazo","Prazo<br>Regional",sort)}
    </div>
  `;
  const body = listView.map(v => `
    <div class="proc-grid-row" data-id="${v.id}" data-nup="${v.nup}">
      <div>${v.nup}</div>
      <div>${v.tipo}</div>
      <div>${v.status}</div>
      <div>${v.notificacaoDisplay}</div>
      <div>${v.parecerDisplay}</div>
      <div>${v.entrada || ""}</div>
      <div>${v.prazoDisplay}</div>
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
     <div>Data/Hora</div><div>Mudança</div><div>Por</div>
    </div>
  `;
  const rows = (hist || []).map(h => {
    const autor = displayUser(h.changed_by_email) || h.changed_by || "(desconhecido)";
    const quando = `${formatDateShort(h.changed_at)} ${formatTimeShort(h.changed_at)}`;
    let mudanca = h.new_status || "";
    if (!mudanca) {
      if (h.parecer) {
        const p = Array.isArray(h.parecer) ? h.parecer.join(', ') : h.parecer;
        mudanca = `Recebido Parecer/Doc ${p}`;
      } else if (h.parecer_expedido) {
        const p = Array.isArray(h.parecer_expedido) ? h.parecer_expedido.join(', ') : h.parecer_expedido;
        mudanca = `Expedido SIGADAER ${p}`;
      } else if (h.parecer_solicitado) {
        const p = Array.isArray(h.parecer_solicitado) ? h.parecer_solicitado.join(', ') : h.parecer_solicitado;
        mudanca = `Solicitado Parecer ${p}`;
      } else if (h.comunicacao_expedida) {
        const c = Array.isArray(h.comunicacao_expedida) ? h.comunicacao_expedida.join(', ') : h.comunicacao_expedida;
        mudanca = `Enviada Notificação ${c}`;
      } else if (h.comunicacao) {
        const c = Array.isArray(h.comunicacao) ? h.comunicacao.join(', ') : h.comunicacao;
        mudanca = `Ciência da Notificação ${c}`;
      } else if (h.comunicacao_solicitada) {
        const c = Array.isArray(h.comunicacao_solicitada) ? h.comunicacao_solicitada.join(', ') : h.comunicacao_solicitada;
        mudanca = `Solicitada Notificação ${c}`;
      } else if (h.orgao) {
        const c = h.orgao;
        mudanca = `Solicitada Confecção de SIGADAER ${Array.isArray(c) ? c.join(', ') : c}`;
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
        <div style="min-width:160px; flex:1 1 160px">
          <label>Término de Obra</label>
          <input id="f-termino" type="date" disabled />
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
        <div style="flex:0 0 auto"><label>&nbsp;</label><button id="btn-parecer" disabled>Parecer Interno</button></div>
        <!-- >>> Patch: adiciona botões de expedição e recebimento -->
        <div style="flex:0 0 auto"><label>&nbsp;</label><button id="btn-expedir" disabled>Necessidade SIGADAER</button></div>
        <div style="flex:0 0 auto"><label>&nbsp;</label><button id="btn-receber" disabled>Expedição SIGADAER</button></div>
        <div style="flex:0 0 auto"><label>&nbsp;</label><button id="btn-recebimento" disabled>Recebimento</button></div>
        <div style="flex:0 0 auto"><label>&nbsp;</label><button id="btn-envio-notificacao" disabled>Registrar Envio de Notificação</button></div>
        <div style="flex:0 0 auto"><label>&nbsp;</label><button id="btn-ciencia-notificacao" disabled>Registrar Ciência de Notificação</button></div>
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
  container.querySelectorAll(".hdc .title[data-k]").forEach(lbl => {
    lbl.addEventListener("click", () => {
      const k = lbl.getAttribute("data-k");
      container.dispatchEvent(new CustomEvent("sorttoggle", { detail: { key:k } }));
    });
  });

  container.querySelectorAll(".filter-select").forEach(sel => {
    sel.addEventListener("change", () => {
      const k = sel.getAttribute("data-k");
      container.dispatchEvent(new CustomEvent("filterchange", { detail: { key:k, value: sel.value } }));
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
    const $termino = el("#f-termino");
    const $status = el("#f-status");
    const $buscar = el("#btn-buscar");
    const $limpar = el("#btn-limpar");
    const $salvar = el("#btn-salvar");
    const $excluir = el("#btn-excluir");
    const $parecer = el("#btn-parecer");
    const $expedir = el("#btn-expedir");
    const $receber = el("#btn-receber");
    const $recebimento = el("#btn-recebimento");
    const $envioNotif = el("#btn-envio-notificacao");
    const $cienciaNotif = el("#btn-ciencia-notificacao");
    const $msg = el("#msg-novo");
    const gridWrap = el("#grid");
    const histPane = el("#hist-pane");
    const root = container;

    // estado
    let currentAction = null;   // 'update' | 'create' | null
    let currentRowId = null;
    let originalStatus = null;
    let originalTermino = "";
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

    const sort = { key:"entrada", dir:"desc" };
    const filters = { tipo:"", status:"" };

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
      $tipo.value = ""; $entrada.value = ""; $termino.value = ""; $status.value = "";
      $tipo.disabled = true; $entrada.disabled = true; $termino.disabled = true; $status.disabled = true;
      $salvar.disabled = true; $excluir.disabled = true; $parecer.disabled = true; $expedir.disabled = true; $receber.disabled = true; $recebimento.disabled = true; $envioNotif.disabled = true; $cienciaNotif.disabled = true;
      currentAction = null; currentRowId = null; originalStatus = null; originalTermino = ""; pendingNup = ""; currentNupMasked = "";
      pinnedId = null; // remove o pino ao limpar
    }
    function setCreateMode(nupMasked) {
      // >>> Correção principal: limpar campos e entrar em modo "create"
      currentAction = "create";
      pendingNup = nupMasked;
      currentNupMasked = nupMasked;
      originalTermino = "";

      $nup.value = nupMasked; // garante máscara no campo
      $tipo.value = "";
      $entrada.value = "";
      $status.value = "";

      $tipo.disabled = false;
      $entrada.disabled = false;
      $termino.disabled = false;
      $status.disabled = false;

      $salvar.disabled = false;
      $excluir.disabled = true; $parecer.disabled = true; $expedir.disabled = true; $receber.disabled = true; $recebimento.disabled = true; $envioNotif.disabled = true; $cienciaNotif.disabled = true;

      $msg.textContent = "Preencha os campos e clique em Salvar.";
      histPane.innerHTML = viewHistorico(`Histórico — ${nupMasked}`, []);
    }
    function setUpdateMode(row) {
      currentAction = "update";
      currentRowId = row.id;
      originalStatus = row.status;
      originalTermino = row.termino_obra || "";
      currentNupMasked = displayNUP(row.nup);

      // preenche e bloqueia tipo/entrada; status editável
      $nup.value = currentNupMasked;
      $tipo.value = row.tipo || "";
      $entrada.value = row.entrada_regional || "";
      $termino.value = row.termino_obra || "";
      $status.value = row.status || "";

      $tipo.disabled = true;
      $entrada.disabled = true;
      $termino.disabled = false;
      $status.disabled = false;

      $salvar.disabled = true;
      $excluir.disabled = false;
      const totalPend = (row.pareceres_pendentes?.length || 0) + (row.pareceres_a_expedir?.length || 0);
      $parecer.disabled = totalPend >= PARECER_OPCOES.length;
      const usedSig = new Set([...(row.pareceres_a_expedir || []), ...(row.pareceres_pendentes || []), ...(row.pareceres_recebidos || [])]);
      const usedSigCount = SIGADAER_OPCOES.filter(p => usedSig.has(p)).length;
      $expedir.disabled = usedSigCount >= SIGADAER_OPCOES.length;
      $receber.disabled = !(row.pareceres_a_expedir && row.pareceres_a_expedir.length);
      const extraRec = RECEBIMENTO_EXTRA_MAP[row.tipo];
      $recebimento.disabled = !((row.pareceres_pendentes && row.pareceres_pendentes.length) || extraRec);
      const notifPend = row.comunicacoes_pendentes || [];
      const notifCientes = row.comunicacoes_cientes || [];
      $envioNotif.disabled = (notifPend.length + notifCientes.length) >= NOTIFICACAO_OPCOES.length;
      $cienciaNotif.disabled = !(notifPend && notifPend.length);
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
    function checkSaveDisabled() {
      if (currentAction === "update") {
        $salvar.disabled = ((
          $status.value === originalStatus && $termino.value === originalTermino
        ) || !$status.value);
      }
    }
    $status.addEventListener("change", checkSaveDisabled);
    $termino.addEventListener("change", checkSaveDisabled);

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
          notificacaoDisplay: (function(){
            const pend = r.comunicacoes_pendentes || [];
            const cientes = r.comunicacoes_cientes || [];
            const parts = NOTIFICACAO_OPCOES.map(p => {
              if (pend.includes(p)) {
                return `<span class="badge badge-notif pendente">${p}<span class="sub">ENVIADA</span></span>`;
              }
              if (cientes.includes(p)) {
                return `<span class="badge badge-notif recebido">${p}<span class="sub">CIENTE</span></span>`;
              }
              return "";
            }).filter(Boolean);
            return parts.length ? parts.join("") : '-';
          })(),
          parecerCount: (r.pareceres_pendentes || []).length + (r.pareceres_a_expedir || []).length,
          parecerDisplay: (function(){
            const parts = ALL_PARECERES.map(p => {
              if (r.pareceres_a_expedir?.includes(p)) {
                return `<span class="badge badge-parecer expedir">${p}<span class="sub">EXPEDIR</span></span>`;
              }
              if (r.pareceres_pendentes?.includes(p)) {
                const sub = PARECER_OPCOES.includes(p) ? "SOLICITADO" : "EXPEDIDO";
                return `<span class="badge badge-parecer pendente">${p}<span class="sub">${sub}</span></span>`;
              }
              if (r.pareceres_recebidos?.includes(p)) {
                return `<span class="badge badge-parecer recebido">${p}<span class="sub">RECEBIDO</span></span>`;
              }
              return "";
            }).filter(Boolean);
            return parts.length ? parts.join("") : '-';
          })(),
          entrada: formatDateShort(r.entrada_regional),
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
          default: return "";
        }
      };
      const arr = viewData.filter(v =>
        (!filters.tipo || v.tipo === filters.tipo) &&
        (!filters.status || v.status === filters.status)
      );
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
      gridWrap.innerHTML = viewTabela(view, sort, filters);
      bindTabela(gridWrap, refreshFirstPage, onPickRowFromList);

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

    // eventos de ordenação e filtros (apenas uma vez)
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
    gridWrap.addEventListener("filterchange", (ev) => {
      filters[ev.detail.key] = ev.detail.value;
      renderGrid();
    });

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
        const hist = await getHistorico(row.id);
        const prazo = calcularPrazoUnit(row, hist);
        row.pareceres_recebidos = extractPareceresRecebidos(hist);
        row.comunicacoes_cientes = extractComunicacoesCientes(hist);
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
      const ids = rows.map(r => r.id);
      const historicos = await getHistoricoBatch(ids);
      const prazosSub = calcularPrazosMapa(rows, historicos);
      prazosSub.forEach((v, k) => prazosMap.set(k, v));
      const recebidosMap = new Map();
      const cientesMap = new Map();
      historicos.forEach(h => {
        if (h.parecer) {
          const arr = Array.isArray(h.parecer) ? h.parecer : [h.parecer];
          const set = recebidosMap.get(h.processo_id) || new Set();
          arr.forEach(v => set.add(v));
          recebidosMap.set(h.processo_id, set);
        }
        if (h.comunicacao) {
          const arr = Array.isArray(h.comunicacao) ? h.comunicacao : [h.comunicacao];
          const setC = cientesMap.get(h.processo_id) || new Set();
          arr.forEach(v => setC.add(v));
          cientesMap.set(h.processo_id, setC);
        }
      });
      rows.forEach(r => {
        r.pareceres_recebidos = Array.from(recebidosMap.get(r.id) || []);
        r.comunicacoes_cientes = Array.from(cientesMap.get(r.id) || []);
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
          if (($status.value === originalStatus && $termino.value === originalTermino) || !$status.value) { alert("Altere o Status ou o Término de Obra para salvar."); return; }
          await updateStatus(currentRowId, $status.value, $termino.value);
          $msg.textContent = "Dados atualizados com sucesso.";
          originalStatus = $status.value; originalTermino = $termino.value; $salvar.disabled = true;
          await refreshFirstPage();
          const hist = await getHistorico(currentRowId);
          histPane.innerHTML = viewHistorico(`Histórico — ${currentNupMasked}`, hist);
        } else if (currentAction === "create") {
          if (!validarObrigatoriosParaCriar()) return;
          const payload = {
            nup: pendingNup, // já mascarado
            tipo: $tipo.value,
            status: $status.value,
            entrada_regional: $entrada.value,
            termino_obra: $termino.value || null
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
      if (!currentRowId) { alert("Busque um processo antes de registrar solicitação de parecer interno."); return; }
      const row = allList.find(r => String(r.id) === String(currentRowId));
      const pend = [...(row?.pareceres_pendentes || []), ...(row?.pareceres_a_expedir || [])];
      const disponiveis = PARECER_OPCOES.filter(p => !pend.includes(p));
      const escolhas = await selectParecerOptions(disponiveis, "o Parecer");
      if (!escolhas.length) return;
      $parecer.disabled = true;
      try {
        await ensureSession();
        const { error } = await supabase.rpc("request_parecer", { p_processo_id: currentRowId, p_orgaos: escolhas });
        if (error) throw error;
        if (row) {
          escolhas.forEach(o => {
            if (SIGADAER_ORGAOS.includes(o)) {
              row.pareceres_a_expedir = Array.from(new Set([...(row.pareceres_a_expedir || []), o]));
            } else {
              row.pareceres_pendentes = Array.from(new Set([...(row.pareceres_pendentes || []), o]));
            }
          });
        }
        const hist = await getHistorico(currentRowId);
        await fetchProfilesByEmails(hist.map(h => h.changed_by_email).filter(Boolean));
        if (row) {
          row.pareceres_recebidos = extractPareceresRecebidos(hist);
          row.comunicacoes_cientes = extractComunicacoesCientes(hist);
        }
        const titulo = row ? `Histórico — ${displayNUP(row.nup)}` : "Histórico";
        histPane.innerHTML = viewHistorico(titulo, hist);
        buildViewData();
        renderGridPreservandoScroll();
        const totalPend = (row?.pareceres_pendentes?.length || 0) + (row?.pareceres_a_expedir?.length || 0);
        $parecer.disabled = totalPend >= PARECER_OPCOES.length;
        const usedSig = new Set([...(row?.pareceres_a_expedir || []), ...(row?.pareceres_pendentes || []), ...(row?.pareceres_recebidos || [])]);
        $expedir.disabled = SIGADAER_OPCOES.every(p => usedSig.has(p));
        $receber.disabled = !(row?.pareceres_a_expedir && row.pareceres_a_expedir.length);
        const extraRec = RECEBIMENTO_EXTRA_MAP[row?.tipo];
        $recebimento.disabled = !((row?.pareceres_pendentes && row.pareceres_pendentes.length) || extraRec);
        $msg.textContent = "Solicitação de parecer interno registrada.";
      } catch (e) {
        $msg.textContent = "Erro ao registrar solicitação de parecer interno: " + e.message;
        $parecer.disabled = false;
      }
    });

    $expedir.addEventListener("click", async () => {
      if (!currentRowId) { alert("Busque um processo antes de registrar necessidade de SIGADAER."); return; }
      const row = allList.find(r => String(r.id) === String(currentRowId));
      const used = new Set([...(row?.pareceres_a_expedir || []), ...(row?.pareceres_pendentes || []), ...(row?.pareceres_recebidos || [])]);
      const disponiveis = SIGADAER_OPCOES.filter(p => !used.has(p));
      const escolha = await selectParecerExpedir(disponiveis, "o Tipo para SIGADAER");
      if (!escolha) return;
      $expedir.disabled = true;
      try {
        await ensureSession();
        const { error } = await supabase.rpc("request_sigadaer", { p_processo_id: currentRowId, p_orgao: escolha });
        if (error) throw error;
        if (row) {
          row.pareceres_a_expedir = Array.from(new Set([...(row.pareceres_a_expedir || []), escolha]));
        }
        const hist = await getHistorico(currentRowId);
        await fetchProfilesByEmails(hist.map(h => h.changed_by_email).filter(Boolean));
        if (row) {
          row.pareceres_recebidos = extractPareceresRecebidos(hist);
          row.comunicacoes_cientes = extractComunicacoesCientes(hist);
        }
        const titulo = row ? `Histórico — ${displayNUP(row.nup)}` : "Histórico";
        histPane.innerHTML = viewHistorico(titulo, hist);
        buildViewData();
        renderGridPreservandoScroll();
        const totalPend = (row?.pareceres_pendentes?.length || 0) + (row?.pareceres_a_expedir?.length || 0);
        $parecer.disabled = totalPend >= PARECER_OPCOES.length;
        const usedSig = new Set([...(row.pareceres_a_expedir || []), ...(row.pareceres_pendentes || []), ...(row.pareceres_recebidos || [])]);
        $expedir.disabled = SIGADAER_OPCOES.every(p => usedSig.has(p));
        $receber.disabled = !(row?.pareceres_a_expedir && row.pareceres_a_expedir.length);
        const extraRec = RECEBIMENTO_EXTRA_MAP[row?.tipo];
        $recebimento.disabled = !((row?.pareceres_pendentes && row.pareceres_pendentes.length) || extraRec);
        $msg.textContent = "Necessidade de SIGADAER registrada.";
      } catch (e) {
        $msg.textContent = "Erro ao registrar necessidade de SIGADAER: " + e.message;
      } finally {
        const usedSig2 = new Set([...(row?.pareceres_a_expedir || []), ...(row?.pareceres_pendentes || []), ...(row?.pareceres_recebidos || [])]);
        $expedir.disabled = SIGADAER_OPCOES.every(p => usedSig2.has(p));
      }
    });
    
    $receber.addEventListener("click", async () => {
      if (!currentRowId) { alert("Busque um processo antes de registrar expedição de SIGADAER."); return; }
      const row = allList.find(r => String(r.id) === String(currentRowId));
      const pend = row?.pareceres_a_expedir || [];
      const escolha = await selectParecerExpedir(pend, "o Tipo para Expedir");
      if (!escolha) return;
      $receber.disabled = true;
      try {
        await ensureSession();
        const { error } = await supabase.rpc("expedir_sigadaer", { p_processo_id: currentRowId, p_orgao: escolha });
        if (error) throw error;
        if (row) {
          row.pareceres_a_expedir = (row.pareceres_a_expedir || []).filter(p => p !== escolha);
          row.pareceres_pendentes = Array.from(new Set([...(row.pareceres_pendentes || []), escolha]));
        }
        const hist = await getHistorico(currentRowId);
        await fetchProfilesByEmails(hist.map(h => h.changed_by_email).filter(Boolean));
        if (row) {
          row.pareceres_recebidos = extractPareceresRecebidos(hist);
          row.comunicacoes_cientes = extractComunicacoesCientes(hist);
        }
        const titulo = row ? `Histórico — ${displayNUP(row.nup)}` : "Histórico";
        histPane.innerHTML = viewHistorico(titulo, hist);
        buildViewData();
        renderGridPreservandoScroll();
        const totalPend = (row?.pareceres_pendentes?.length || 0) + (row?.pareceres_a_expedir?.length || 0);
        $parecer.disabled = totalPend >= PARECER_OPCOES.length;
        const usedSig = new Set([...(row?.pareceres_a_expedir || []), ...(row?.pareceres_pendentes || []), ...(row?.pareceres_recebidos || [])]);
        $expedir.disabled = SIGADAER_OPCOES.every(p => usedSig.has(p));
        const extraRec = RECEBIMENTO_EXTRA_MAP[row?.tipo];
        $recebimento.disabled = !((row?.pareceres_pendentes && row.pareceres_pendentes.length) || extraRec);
        $msg.textContent = "Expedição de SIGADAER registrada.";
      } catch (e) {
        $msg.textContent = "Erro ao registrar expedição de SIGADAER: " + e.message;
      } finally {
        $receber.disabled = !(row?.pareceres_a_expedir && row.pareceres_a_expedir.length);
      }
    });

    $recebimento.addEventListener("click", async () => {
      if (!currentRowId) { alert("Busque um processo antes de registrar recebimento."); return; }
      const row = allList.find(r => String(r.id) === String(currentRowId));
      const extra = RECEBIMENTO_EXTRA_MAP[row?.tipo];
      const pend = Array.from(new Set([...(row?.pareceres_pendentes || []), ...(extra ? [extra] : [])]));
      if (!pend.length) { alert("Não há itens pendentes."); return; }
      const escolha = await selectParecerRecebido(pend, "o Tipo");
      if (!escolha) return;
      $recebimento.disabled = true;
      try {
        await ensureSession();
        const { error } = await supabase.rpc("receive_parecer", { p_processo_id: currentRowId, p_orgao: escolha });
        if (error) throw error;
        if (row) {
          row.pareceres_pendentes = (row.pareceres_pendentes || []).filter(p => p !== escolha);
        }
        const hist = await getHistorico(currentRowId);
        await fetchProfilesByEmails(hist.map(h => h.changed_by_email).filter(Boolean));
        if (row) {
          row.pareceres_recebidos = extractPareceresRecebidos(hist);
          row.comunicacoes_cientes = extractComunicacoesCientes(hist);
        }
        const titulo = row ? `Histórico — ${displayNUP(row.nup)}` : "Histórico";
        histPane.innerHTML = viewHistorico(titulo, hist);
        buildViewData();
        renderGridPreservandoScroll();
        const totalPend = (row?.pareceres_pendentes?.length || 0) + (row?.pareceres_a_expedir?.length || 0);
        $parecer.disabled = totalPend >= PARECER_OPCOES.length;
        const usedSig = new Set([...(row?.pareceres_a_expedir || []), ...(row?.pareceres_pendentes || []), ...(row?.pareceres_recebidos || [])]);
        $expedir.disabled = SIGADAER_OPCOES.every(p => usedSig.has(p));
        $receber_DISABLED = !(row?.pareceres_a_expedir && row.pareceres_a_expedir.length);
        $msg.textContent = "Recebimento registrado.";
      } catch (e) {
        $msg.textContent = "Erro ao registrar recebimento: " + e.message;
      } finally {
        const extraRec = RECEBIMENTO_EXTRA_MAP[row?.tipo];
        $recebimento.disabled = !((row?.pareceres_pendentes && row.pareceres_pendentes.length) || extraRec);
      }
    });

    $envioNotif.addEventListener("click", async () => {
      if (!currentRowId) { alert("Busque um processo antes de registrar envio de notificação."); return; }
      const row = allList.find(r => String(r.id) === String(currentRowId));
      const pend = row?.comunicacoes_pendentes || [];
      const cientes = row?.comunicacoes_cientes || [];
      const disponiveis = NOTIFICACAO_OPCOES.filter(p => !pend.includes(p) && !cientes.includes(p));
      const escolha = await selectParecerExpedir(disponiveis, "a Notificação");
      if (!escolha) return;
      $envioNotif.disabled = true;
      try {
        await ensureSession();
        const { error } = await supabase.rpc("request_comunicacao", { p_processo_id: currentRowId, p_orgaos: [escolha] });
        if (error) throw error;
        const { error: e2 } = await supabase.rpc("expedir_comunicacao", { p_processo_id: currentRowId, p_orgao: escolha });
        if (e2) throw e2;
        if (row) {
          row.comunicacoes_pendentes = Array.from(new Set([...(row.comunicacoes_pendentes || []), escolha]));
          // Remove de cientes caso reenviado
          if (row.comunicacoes_cientes) {
            row.comunicacoes_cientes = row.comunicacoes_cientes.filter(p => p !== escolha);
          }
        }
        const hist = await getHistorico(currentRowId);
        await fetchProfilesByEmails(hist.map(h => h.changed_by_email).filter(Boolean));
        const titulo = row ? `Histórico — ${displayNUP(row.nup)}` : "Histórico";
        histPane.innerHTML = viewHistorico(titulo, hist);
        buildViewData();
        renderGridPreservandoScroll();
        $msg.textContent = "Envio de notificação registrado.";
      } catch (e) {
        $msg.textContent = "Erro ao registrar envio de notificação: " + e.message;
      } finally {
        const pendAtual = row?.comunicacoes_pendentes || [];
        const cientesAtual = row?.comunicacoes_cientes || [];
        $envioNotif.disabled = (pendAtual.length + cientesAtual.length) >= NOTIFICACAO_OPCOES.length;
        $cienciaNotif.disabled = !(pendAtual.length);
      }
    });

    $cienciaNotif.addEventListener("click", async () => {
      if (!currentRowId) { alert("Busque um processo antes de registrar ciência de notificação."); return; }
      const row = allList.find(r => String(r.id) === String(currentRowId));
      const pend = row?.comunicacoes_pendentes || [];
      if (!pend.length) { alert("Não há notificações pendentes."); return; }
      const escolha = await selectParecerExpedir(pend, "a Notificação para Ciência");
      if (!escolha) return;
      $cienciaNotif.disabled = true;
      try {
        await ensureSession();
        const { error } = await supabase.rpc("receive_comunicacao", { p_processo_id: currentRowId, p_orgao: escolha });
        if (error) throw error;
        if (row) {
          row.comunicacoes_pendentes = (row.comunicacoes_pendentes || []).filter(p => p !== escolha);
          row.comunicacoes_cientes = Array.from(new Set([...(row.comunicacoes_cientes || []), escolha]));
        }
        const hist = await getHistorico(currentRowId);
        await fetchProfilesByEmails(hist.map(h => h.changed_by_email).filter(Boolean));
        const titulo = row ? `Histórico — ${displayNUP(row.nup)}` : "Histórico";
        histPane.innerHTML = viewHistorico(titulo, hist);
        buildViewData();
        renderGridPreservandoScroll();
        $msg.textContent = "Ciência de notificação registrada.";
      } catch (e) {
        $msg.textContent = "Erro ao registrar ciência de notificação: " + e.message;
      } finally {
        const pendAtual = row?.comunicacoes_pendentes || [];
        const cientesAtual = row?.comunicacoes_cientes || [];
        $envioNotif.disabled = (pendAtual.length + cientesAtual.length) >= NOTIFICACAO_OPCOES.length;
        $cienciaNotif.disabled = !(pendAtual.length);
      }
    });

    // Inicialização
    await fetchFirstPage();
  },
};
