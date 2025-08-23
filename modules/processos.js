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

/* =========================
   Formatação do NUP
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

/* =========================
   Supabase
   ========================= */
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
  const { error } = await supabase.from("processos").delete().eq("id", id);
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
async function getHistoricoBatch(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("status_history")
    .select("processo_id, old_status, new_status, changed_at, changed_by_email, changed_by")
    .in("processo_id", ids);
  if (error) throw error;
  return data;
}

/* =========================
   Cálculo de Prazo Regional
   ========================= */
const SOBRESTADOS = new Set(["Sobrestado Técnico", "Sobrestado Documental"]);
const DIA_MS = 24 * 60 * 60 * 1000;

function calcularPrazosMapa(processos, historicos) {
  // pega a última saída de sobrestado de cada processo
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

/* =========================
   CSS do módulo (layout via CSS GRID)
   ========================= */
function ensureLayoutCSS() {
  if (document.getElementById("proc-grid-css")) return;
  const style = document.createElement("style");
  style.id = "proc-grid-css";
  style.textContent = `
    /* sem rolagem de página */
    html, body { overflow: hidden; }

    .proc-mod { display:flex; flex-direction:column; overflow:hidden; }

    /* formulário compacto */
    .proc-form-card { flex:0 0 auto; padding-top:8px; padding-bottom:8px; }
    .proc-form-row { display:flex; align-items:flex-end; gap:8px; flex-wrap:nowrap; overflow:auto; }
    .proc-form-row > div { display:flex; flex-direction:column; }
    .proc-form-row label { font-size:0.95rem; margin-bottom:2px; }
    .proc-form-row input, .proc-form-row select, .proc-form-row button { height:34px; }

    /* área dividida: 35% histórico, 65% processos */
    .proc-split { display:flex; gap:10px; overflow:hidden; }
    .proc-pane { min-width:0; display:flex; flex-direction:column; overflow:hidden; }
    .hist-pane { flex:0 0 35%; }
    .grid-pane { flex:1 1 65%; }
    .pane-title { margin:0 0 8px 0; }
    .pane-body { flex:1 1 auto; min-height:0; overflow:hidden; display:flex; } /* permite rolagem interna */

    /* =======================
       LISTA DE PROCESSOS (GRID)
       ======================= */
    :root{
      --w-nup: clamp(20ch, 22ch, 26ch);
      --w-tipo: clamp(8ch, 10ch, 14ch);
      --w-entrada: clamp(10ch, 12ch, 16ch);
      --w-prazo: clamp(8ch, 10ch, 12ch);
    }

    /* #grid ocupa todo o espaço da pane-body */
    #grid{ flex:1 1 auto; min-height:0; display:flex; }

    /* roletador vertical interno (sem height:100%; usa flex) */
    .grid-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; position:relative; }

    .proc-grid-header,
    .proc-grid-row{
      display: grid;
      grid-template-columns:
        var(--w-nup)           /* NUP */
        var(--w-tipo)          /* Tipo */
        minmax(0, 1.4fr)       /* Status (flex) */
        var(--w-entrada)       /* 1ª Entrada Regional */
        var(--w-prazo)         /* Prazo Regional */
        minmax(0, 1fr)         /* Atualizado por (flex) */
        minmax(0, 1fr);        /* Atualizado em (flex) */
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

    /* Título + botões de ordenação empilhados */
    .hdc { display:flex; flex-direction:column; align-items:center; gap:2px; }
    .hdc .title { line-height:1.05; }
    .sort-wrap { display:inline-flex; gap:2px; }
    .sort-btn { border:1px solid #ccc; background:#f7f7f7; padding:0 4px; line-height:16px; height:18px; cursor:pointer; }
    .sort-btn.active { background:#e9e9e9; font-weight:bold; }

    /* Linha selecionada */
    .proc-grid-row.row-selected { outline:2px solid #999; outline-offset:-1px; }

    /* =======================
       HISTÓRICO (GRID)
       ======================= */
    :root{
      --w-hist-data: clamp(12ch, 16ch, 18ch);
      --w-hist-autor: clamp(16ch, 20ch, 24ch);
    }
    .hist-scroll { height:100%; overflow-y:auto; overflow-x:hidden; }

    .hist-header,
    .hist-row{
      display:grid;
      grid-template-columns:
        var(--w-hist-data)     /* Data/Hora */
        minmax(0, 1fr)         /* De */
        minmax(0, 1fr)         /* Para */
        var(--w-hist-autor);   /* Por */
      gap:0;
      align-items:center;
    }

    .hist-header{
      position: sticky; top: 0; z-index:2;
      background:#fff; border-bottom:1px solid #ddd;
    }

    .hist-header > div,
    .hist-row > div{
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

/* ajusta alturas de área útil para rolagem vertical interna */
function applyHeights(root) {
  const mod = root.querySelector(".proc-mod");
  const split = root.querySelector(".proc-split");
  if (!mod || !split) return;

  const top = mod.getBoundingClientRect().top;
  const available = window.innerHeight - top - 12; /* respiro */
  mod.style.height = available + "px";

  const formH = root.querySelector(".proc-form-card").getBoundingClientRect().height;
  split.style.height = (available - formH - 10) + "px";
}

/* =========================
   Ordenação (header cell)
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
   VIEW: Tabela de Processos (GRID)
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
    <div class="proc-grid-row" data-id="${v.id}" data-nup="${v.nup}">
      <div>${v.nup}</div>
      <div>${v.tipo}</div>
      <div>${v.status}</div>
      <div>${v.entrada || ""}</div>
      <div>${v.prazoDisplay}</div>
      <div class="small">${v.atualizadoPor || ""}</div>
      <div class="small">${v.atualizadoStr}</div>
    </div>
  `).join("");

  return `
    <div class="grid-scroll">
      ${header}
      ${body}
    </div>
  `;
}

/* =========================
   VIEW: Histórico (GRID)
   ========================= */
function viewHistorico(title, hist) {
  const header = `
    <div class="hist-header">
      <div>Data/Hora</div><div>De</div><div>Para</div><div>Por</div>
    </div>
  `;
  const rows = (hist || []).map(h => {
    const autor = h.changed_by_email || h.changed_by || "(desconhecido)";
    the const quando = new Date(h.changed_at).toLocaleString();
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
   Formulário (inalterado visualmente)
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
   Bind dos eventos da lista
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
   Módulo
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
    let pendingNup = "";
    let currentNupMasked = "";

    let allList = [];
    let prazosMap = new Map();
    let viewData = [];

    // NOVO: id "pinned" para ir ao topo após busca
    let pinnedId = null;

    const sort = { key:"atualizado", dir:"desc" };

    // alturas (evita rolagem da página)
    const resizeAll = () => applyHeights(root);
    window.addEventListener("resize", resizeAll);
    setTimeout(resizeAll, 0);

    // máscara NUP
    $nup.addEventListener("input", () => { $nup.value = maskNUP(onlyDigits17($nup.value)); });

    // helpers do formulário
    function resetForm(clearNup=false) {
      $msg.textContent = "";
      if (clearNup) $nup.value = "";
      $tipo.value = ""; $entrada.value = ""; $status.value = "";
      $tipo.disabled = true; $entrada.disabled = true; $status.disabled = true;
      $salvar.disabled = true; $excluir.disabled = true;
      currentAction = null; currentRowId = null; originalStatus = null; pendingNup = ""; currentNupMasked = "";
      pinnedId = null; // limpa o pino ao resetar formulário
    }
    function setCreateMode(nupMasked) {
      pendingNup = nupMasked; currentNupMasked = nupMasked;
      $msg.textContent = "Preencha os campos e clique em Salvar.";
      $tipo.disabled = false; $entrada.disabled = false; $status.disabled = false;
      $salvar.disabled = false; $excluir.disabled = true;
      histPane.innerHTML = viewHistorico("Histórico", []);
    }
    function setUpdateMode(row) {
      currentAction = "update"; currentRowId = row.id; originalStatus = row.status; currentNupMasked = row.nup;
      $tipo.value = row.tipo || ""; $entrada.value = row.entrada_regional || ""; $status.value = row.status || "";
      $tipo.disabled = true; $entrada.disabled = true; $status.disabled = false;
      $salvar.disabled = true; $excluir.disabled = false;
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

    // viewData
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
      const val = (v) => {
        switch (key) {
          case "nup": return v.nup || "";
          case "tipo": return v.tipo || "";
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

      // NOVO: se houver um "pinnedId", move essa linha para o topo
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
      bindTabela(gridWrap, refresh, onPickRowFromList);

      // ordenação
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

      if (currentRowId) {
        const rows = gridWrap.querySelectorAll(".proc-grid-row");
        rows.forEach(r => { if (r.getAttribute("data-id") === String(currentRowId)) r.classList.add("row-selected"); });
      }
    }
    function onPickRowFromList(id) {
      const row = allList.find(r => String(r.id) === String(id));
      if (!row) return;
      setUpdateMode(row);
      $nup.value = row.nup;
      currentRowId = row.id;
      // (não “pina” ao clicar na lista; só ao buscar)
    }

    // formulário
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
          pinnedId = row.id; // << NOVO: pino para ir ao topo
          renderGrid();
          const hist = await getHistorico(row.id);
          histPane.innerHTML = viewHistorico(`Histórico — ${row.nup}`, hist);
        } else {
          perguntaCriar((decisao) => {
            if (decisao) setCreateMode(nupMasked);
            else { resetForm(true); histPane.innerHTML = viewHistorico("Histórico", []); $nup.focus(); }
          });
        }
      } catch (e) { $msg.textContent = "Erro ao buscar: " + e.message; }
    };
    $buscar.addEventListener("click", buscar);
    $limpar.addEventListener("click", () => {
      resetForm(true); 
      histPane.innerHTML = viewHistorico("Histórico", []); 
      renderGrid(); // re-render sem o pino
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
          await refresh();
          const hist = await getHistorico(currentRowId);
          histPane.innerHTML = viewHistorico(`Histórico — ${currentNupMasked}`, hist);
        } else if (currentAction === "create") {
          if (!validarObrigatoriosParaCriar()) return;
          const payload = { nup: pendingNup, tipo: $tipo.value, status: $status.value, entrada_regional: $entrada.value };
          const novo = await createProcesso(payload);
          $msg.textContent = "Processo criado com sucesso.";
          setUpdateMode(novo); currentRowId = novo.id; await refresh();
          const hist = await getHistorico(novo.id);
          histPane.innerHTML = viewHistorico(`Histórico — ${novo.nup}`, hist);
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
        resetForm(true); histPane.innerHTML = viewHistorico("Histórico", []); await refresh(); $nup.focus();
      } catch (e) { alert("Erro ao excluir: " + e.message); }
    });

    // carregar lista
    const refresh = async () => {
      gridWrap.innerHTML = "Carregando...";
      try {
        allList = await listProcessos();
        const ids = allList.map(r => r.id);
        const historicos = await getHistoricoBatch(ids);
        prazosMap = calcularPrazosMapa(allList, historicos);
        buildViewData();
        renderGrid();
        setTimeout(resizeAll, 0);
      } catch (e) {
        gridWrap.innerHTML = `<p>Erro ao carregar: ${e.message}</p>`;
      }
    };

    resetForm();
    await refresh();
  },
};
