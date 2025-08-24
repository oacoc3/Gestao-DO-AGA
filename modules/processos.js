// modules/processos.js
// Siglas (expansão):
// - CRUD: Create/Read/Update/Delete (Criar/Ler/Atualizar/Excluir)
// - RLS: Row Level Security (Segurança por Linha no banco)
// - JWT: JSON Web Token (token do usuário autenticado)

import { supabase } from "../supabaseClient.js";

// Utilitário: formata NUP (00000.000000/0000-00) apenas para exibição
function formatNUP(n) {
  const d = (n || '').replace(/\D/g, '');
  return d.replace(/^(\d{5})(\d{6})(\d{4})(\d{2})$/, '$1.$2/$3-$4');
}

// =====================
// Estado do módulo
// =====================
let state = {
  // Tabela (lista de processos)
  pageSize: 50,          // quantidade por página na paginação infinita
  hasMore: true,         // se ainda há páginas a carregar
  lastCursor: null,      // { updated_at: timestamptz, id: uuid } da última linha carregada
  allList: [],           // dados brutos acumulados das páginas
  viewData: [],          // dados prontos para render (com campos de exibição)
  order: {               // ordenação visual (por coluna)
    col: "nup",          // coluna inicial
    dir: "asc",          // "asc" ou "desc"
  },

  // Seleção atual para formulário + histórico
  selected: null,        // processo selecionado (objeto)
  historico: [],         // histórico do processo selecionado

  // Controles de UI
  isFetching: false,
  isSaving: false,
  isDeleting: false,
  searchNUP: "",         // campo NUP do formulário (apenas números)
  lockStatus: true,      // bloqueia edição do status se for processo já existente
  lockTipoEEntrada: true,// bloqueia tipo e 1ª entrada quando já existente
  currentAction: "idle", // "idle" | "editing" | "creating"

  // Cache de filtros/ordenadores por coluna
  sorters: {},
};

// =====================
// Helpers de datas/prazos
// =====================

function parseDateInput(yyyy_mm_dd) {
  // Converte "2025-08-24" (string) para Date (local) às 00:00
  if (!yyyy_mm_dd) return null;
  const [y, m, d] = yyyy_mm_dd.split("-").map(x => parseInt(x, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return isNaN(dt.getTime()) ? null : dt;
}

function formatDate(d) {
  // Exibe data no formato DD/MM/AAAA
  if (!d) return "";
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return "";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function addDays(date, days) {
  const dt = new Date(date);
  dt.setDate(dt.getDate() + days);
  return dt;
}

// Calcula o "Prazo Regional" (60 dias) considerando eventos de sobrestado
function computePrazoRegional(processo, historico) {
  // Regra:
  // - Prazo corre por 60 dias a partir de "1ª Entrada Regional" (entrada_regional).
  // - Se houver status "Sobrestado Documental" ou "Sobrestado Técnico", o prazo fica pausado
  //   e é reiniciado (60 dias) a partir da data de saída do sobrestado (quando houve mudança
  //   do status "Sobrestado ..." para outro).
  // - Se o status atual for "Sobrestado ...", exibir "Sobrestado".
  // Observação: a SPA exibe "Sobrestado" diretamente na lista quando status for sobrestado.

  const st = (processo?.status || "").toLowerCase();
  const isSobrestado = st.includes("sobrestado");

  // Se atual está sobrestado, exibe "Sobrestado"
  if (isSobrestado) return "Sobrestado";

  // Verifica a data base: a última "saída de sobrestado" ou a "entrada_regional"
  let base = processo?.entrada_regional ? new Date(processo.entrada_regional) : null;
  if (!base) return ""; // sem entrada, sem prazo

  // Percorre histórico por ordem cronológica (changed_at asc)
  const hist = [...(historico || [])].sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));

  // Estamos "dentro" de sobrestado?
  let inHold = false;
  let holdStartedAt = null;

  for (const ev of hist) {
    const ns = (ev.new_status || "").toLowerCase();

    // Entrada em sobrestado
    if (ns.includes("sobrestado")) {
      inHold = true;
      holdStartedAt = new Date(ev.changed_at);
      continue;
    }
    // Saída de sobrestado (estávamos em hold e mudou para outro status)
    if (inHold && !ns.includes("sobrestado")) {
      // Reinicia prazo a partir da "saída do hold"
      const saiuEm = new Date(ev.changed_at);
      base = saiuEm;
      inHold = false;
      holdStartedAt = null;
    }
  }

  // Caso esteja em hold até agora, exibe "Sobrestado" (mas acima já teríamos retornado)
  // De qualquer forma, aqui reforçamos:
  if (inHold) return "Sobrestado";

  // Calcula base + 60
  const prazo = addDays(base, 60);
  return formatDate(prazo);
}

// =====================
// Helpers de NUP (form)
// =====================

// Mantém apenas dígitos e limita a 17
function onlyDigits17(v) {
  return (v || "").replace(/\D/g, "").slice(0, 17);
}

// Ao digitar, formata parcialmente como NUP 00000.000000/0000-00
function maskNUPProgressive(vdigits) {
  const v = onlyDigits17(vdigits);
  // 5-6-4-2
  let r = v;
  if (v.length > 5)   r = v.slice(0, 5) + "." + v.slice(5);
  if (v.length > 11)  r = r.slice(0, 12) + "." + r.slice(12);
  if (v.length > 17)  r = r.slice(0, 19) + "/" + r.slice(19);
  if (v.length > 21)  r = r.slice(0, 24) + "-" + r.slice(24);
  // Acima é agressivo ao contar inserções; para simplicidade progressiva, fazemos outra forma:
  const d = (v || "");
  const p1 = d.slice(0,5);
  const p2 = d.slice(5,11);
  const p3 = d.slice(11,15);
  const p4 = d.slice(15,17);
  const a = [];
  if (p1) a.push(p1);
  if (p2) a.push(p2);
  let s = a.length > 1 ? a[0]+"."+a[1] : (a[0]||"");
  if (p3) s = (s ? s+"/" : "") + p3;
  if (p4) s = s + "-" + p4;
  return s;
}

// =====================
// Supabase helpers
// =====================

async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// =====================
// Renderização de UI
// =====================

function cssOnce() {
  if (document.getElementById("processos-css")) return;
  const st = document.createElement("style");
  st.id = "processos-css";
  st.textContent = `
    /* Layout principal (form em 1 linha; área dividida em 65% processos / 35% histórico) */
    .proc-wrap { display:flex; flex-direction:column; gap:8px; width:100%; height:calc(100vh - 120px); }
    .proc-title { margin:0; font-size:18px; }
    .proc-form { display:flex; flex-wrap:wrap; align-items:flex-end; gap:8px; width:100%; }
    .proc-form > div { display:flex; flex-direction:column; }
    .proc-form label { font-size:12px; margin-bottom:4px; }

    .proc-rows { display:flex; gap:8px; width:100%; height:100%; overflow:hidden; }
    .proc-left  { width:65%; height:100%; display:flex; flex-direction:column; }
    .proc-right { width:35%; height:100%; display:flex; flex-direction:column; }

    /* Tabela de processos */
    .proc-table-wrap { flex:1; min-height:0; overflow:auto; } /* rolagem vertical interna */
    .proc-table { width:100%; border-collapse:collapse; table-layout:fixed; }
    .proc-table th, .proc-table td {
      border-bottom:1px solid #ddd; padding:6px; font-size:12px; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .proc-table thead th { position:sticky; top:0; background:#fff; z-index:1; }
    /* Larguras específicas: sem rolagem lateral */
    .col-nup { width: 165px; } /* suficiente para 00000.000000/0000-00 */
    .col-tipo { width: 120px; }
    .col-entrada { width: 130px; } /* 1ª Entrada Regional (em duas linhas no header) */
    .col-status { width: 160px; }
    .col-prazo { width: 120px; }   /* Prazo Regional (em duas linhas no header) */
    .col-atualizado { width: 130px; }
    .col-por { width: 160px; }
    .col-acoes { width: 120px; }

    .sort-wrap { display:flex; flex-direction:column; gap:2px; align-items:center; }
    .sort-wrap button { height:18px; padding:0 4px; line-height:18px; font-size:10px; }

    /* Histórico à direita */
    .hist-wrap { flex:1; min-height:0; overflow:auto; }
    .hist-table { width:100%; border-collapse:collapse; table-layout:fixed; }
    .hist-table th, .hist-table td {
      border-bottom:1px solid #ddd; padding:6px; font-size:12px; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .hist-table thead th { position:sticky; top:0; background:#fff; z-index:1; }
    .hist-col-dh { width: 150px; } /* mais estreita conforme pedido */
    .hist-col-acao { width: 220px; }
    .hist-col-por { width: 200px; }

    /* Botões menores */
    .btn { height:32px; }
  `;
  document.head.appendChild(st);
}

function render(container) {
  cssOnce();

  container.innerHTML = `
    <div class="proc-wrap">
      <h3 class="proc-title">Gestão de Processos</h3>

      <div class="proc-form">
        <div>
          <label>Insira o NUP do Processo</label>
          <input id="nup-input" placeholder="00000.000000/0000-00" />
        </div>
        <div><label>&nbsp;</label><button id="btn-buscar" class="btn">Buscar</button></div>
        <div><label>&nbsp;</label><button id="btn-limpar-nup" class="btn">Limpar</button></div>

        <div>
          <label>Tipo</label>
          <select id="tipo-select" disabled>
            <option value="">Selecione</option>
            <option>PDIR</option>
            <option>Inscrição/Alteração</option>
            <option>Exploração</option>
            <option>OPEA</option>
          </select>
        </div>

        <div>
          <label>1ª Entrada Regional</label>
          <input id="entrada-input" type="date" disabled />
        </div>

        <div>
          <label>Status</label>
          <select id="status-select" disabled>
            <option value="">Selecione</option>
            <option>Em Tratamento</option>
            <option>Finalizado</option>
            <option>Sobrestado Documental</option>
            <option>Sobrestado Técnico</option>
          </select>
        </div>

        <div><label>&nbsp;</label><button id="btn-salvar" class="btn" disabled>Salvar</button></div>
        <div><label>&nbsp;</label><button id="btn-excluir" class="btn" disabled>Excluir</button></div>
      </div>

      <div class="proc-rows">
        <div class="proc-left">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <h4 style="margin:4px 0;">Processos</h4>
            <div id="list-msg" class="small"></div>
          </div>

          <div class="proc-table-wrap">
            <table class="proc-table">
              <thead>
                <tr>
                  <th class="col-nup">
                    <div>NUP</div>
                    <div class="sort-wrap">
                      <button data-sort-col="nup" data-sort-dir="asc">▲</button>
                      <button data-sort-col="nup" data-sort-dir="desc">▼</button>
                    </div>
                  </th>
                  <th class="col-tipo">
                    <div>Tipo</div>
                    <div class="sort-wrap">
                      <button data-sort-col="tipo" data-sort-dir="asc">▲</button>
                      <button data-sort-col="tipo" data-sort-dir="desc">▼</button>
                    </div>
                  </th>
                  <th class="col-entrada">
                    <div>1ª Entrada<br/>Regional</div>
                    <div class="sort-wrap">
                      <button data-sort-col="entrada_regional" data-sort-dir="asc">▲</button>
                      <button data-sort-col="entrada_regional" data-sort-dir="desc">▼</button>
                    </div>
                  </th>
                  <th class="col-status">
                    <div>Status</div>
                    <div class="sort-wrap">
                      <button data-sort-col="status" data-sort-dir="asc">▲</button>
                      <button data-sort-col="status" data-sort-dir="desc">▼</button>
                    </div>
                  </th>
                  <th class="col-prazo">
                    <div>Prazo<br/>Regional</div>
                    <div class="sort-wrap">
                      <button data-sort-col="prazo_regional" data-sort-dir="asc">▲</button>
                      <button data-sort-col="prazo_regional" data-sort-dir="desc">▼</button>
                    </div>
                  </th>
                  <th class="col-atualizado">
                    <div>Atualizado em</div>
                    <div class="sort-wrap">
                      <button data-sort-col="updated_at" data-sort-dir="asc">▲</button>
                      <button data-sort-col="updated_at" data-sort-dir="desc">▼</button>
                    </div>
                  </th>
                  <th class="col-por">
                    <div>Atualizado por</div>
                    <div class="sort-wrap">
                      <button data-sort-col="atualizado_por" data-sort-dir="asc">▲</button>
                      <button data-sort-col="atualizado_por" data-sort-dir="desc">▼</button>
                    </div>
                  </th>
                  <th class="col-acoes"><div>Ações</div></th>
                </tr>
              </thead>
              <tbody id="tb-lista"></tbody>
            </table>
          </div>
        </div>

        <div class="proc-right">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <h4 id="hist-title" style="margin:4px 0;">Histórico</h4>
            <div id="hist-msg" class="small"></div>
          </div>

          <div class="hist-wrap">
            <table class="hist-table">
              <thead>
                <tr>
                  <th class="hist-col-dh">Data/Hora</th>
                  <th class="hist-col-acao">Ação</th>
                  <th class="hist-col-por">Por</th>
                </tr>
              </thead>
              <tbody id="tb-hist"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

// =====================
// Supabase: Data Access
// =====================

// Paginação: carrega a primeira página (ordenada por updated_at desc, id desc)
async function fetchFirstPage() {
  state.isFetching = true;
  state.hasMore = true;
  state.lastCursor = null;
  state.allList = [];

  const { data, error } = await supabase
    .from("processos")
    .select("*")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(state.pageSize);

  state.isFetching = false;
  if (error) throw error;

  state.allList = data || [];
  if (!data || data.length < state.pageSize) {
    state.hasMore = false;
  } else {
    const last = data[data.length - 1];
    state.lastCursor = { updated_at: last.updated_at, id: last.id };
  }

  // Mapeia para view data
  recomputeViewData();
}

// Próximas páginas (cursor: < updated_at, depois < id)
async function fetchNextPage() {
  if (!state.hasMore || state.isFetching || !state.lastCursor) return;
  state.isFetching = true;

  const { updated_at: cursorTime, id: cursorId } = state.lastCursor;
  const { data, error } = await supabase
    .from("processos")
    .select("*")
    .or(`and(updated_at.lt.${cursorTime},id.gte.00000000-0000-0000-0000-000000000000),and(updated_at.eq.${cursorTime},id.lt.${cursorId})`)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(state.pageSize);

  state.isFetching = false;
  if (error) throw error;

  const rows = data || [];
  state.allList = state.allList.concat(rows);

  if (rows.length < state.pageSize) {
    state.hasMore = false;
  } else {
    const last = rows[rows.length - 1];
    state.lastCursor = { updated_at: last.updated_at, id: last.id };
  }

  recomputeViewData();
}

// Busca processo por NUP (17 dígitos). Se achar, seleciona, carrega histórico e move a linha para o topo da lista.
async function findByNUP(nupDigits17) {
  if (!nupDigits17 || nupDigits17.length !== 17) {
    throw new Error("Informe o NUP com 17 algarismos.");
  }

  const { data, error } = await supabase
    .from("processos")
    .select("*")
    .eq("nup", nupDigits17)
    .single();

  if (error && error.code !== "PGRST116") { // PGRST116: no rows
    throw error;
  }

  if (!data) return null;

  // Se foi encontrado, posiciona no topo da lista visual
  const idx = state.allList.findIndex(p => p.id === data.id);
  if (idx !== -1) {
    const [found] = state.allList.splice(idx, 1);
    state.allList.unshift(found);
  } else {
    // Se não estava carregado (página não tinha), coloca como primeiro mesmo assim
    state.allList.unshift(data);
  }

  // Define seleção e carrega histórico
  state.selected = data;
  await getHistorico(data.id);

  // Atualiza viewData
  recomputeViewData();

  return data;
}

// Cria processo novo
async function createProcesso(payload) {
  const { data, error } = await supabase
    .from("processos")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Atualiza apenas status
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

// Exclui processo (e o histórico é removido pelo ON DELETE CASCADE)
async function deleteProcesso(id) {
  const { error } = await supabase
    .from("processos")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// Carrega histórico do processo (ordenado por changed_at desc)
async function getHistorico(id) {
  const { data, error } = await supabase
    .from("status_history")
    .select("*")
    .eq("processo_id", id)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  state.historico = data || [];
}

// =====================
// Mapeamento p/ View
// =====================

function recomputeViewData() {
  // Ordenação visual (client-side) baseada em state.order
  const { col, dir } = state.order;
  const asc = dir === "asc";

  // Prepara linhas para a tabela
  const list = (state.allList || []).map(row => {
    const p = { ...row };

    // "Prazo Regional" para exibição
    const prazo =
      (p.status || "").toLowerCase().includes("sobrestado")
        ? "Sobrestado"
        : computePrazoRegional(p, state.selected && state.selected.id === p.id ? state.historico : []);

    // "Atualizado por" (email simples) — se quiser exibir nome, precisará buscar profiles
    let atualizado_por = "";
    if (p.modificado_por) {
      // A SPA mostra e-mail do autor via histórico; aqui deixamos placeholder (será sobrescrito ao clicar)
      atualizado_por = ""; 
    }

    return {
      id: p.id,
      nup: p.nup,
      tipo: p.tipo,
      entrada_regional: p.entrada_regional ? formatDate(p.entrada_regional) : "",
      status: p.status,
      prazo_regional: prazo,
      updated_at: p.updated_at ? formatDate(p.updated_at) : "",
      atualizado_por,
      raw: p,
    };
  });

  // Ordena (client-side)
  list.sort((a, b) => {
    const va = a[col] || "";
    const vb = b[col] || "";
    if (col === "updated_at" || col === "entrada_regional") {
      // datas no formato DD/MM/AAAA — normaliza para AAAA-MM-DD para comparar
      const na = va ? va.split("/").reverse().join("-") : "";
      const nb = vb ? vb.split("/").reverse().join("-") : "";
      return asc ? (na.localeCompare(nb)) : (nb.localeCompare(na));
    }
    return asc ? (String(va).localeCompare(String(vb))) : (String(vb).localeCompare(String(va)));
  });

  state.viewData = list;
  renderList();
  renderHistTitle();
  renderHistorico();
}

// =====================
// Render: Lista
// =====================

function renderList() {
  const $tb = document.getElementById("tb-lista");
  const $msg = document.getElementById("list-msg");
  if (!$tb) return;

  const rows = state.viewData || [];

  if (!rows.length) {
    $tb.innerHTML = `
      <tr><td colspan="8" style="text-align:center; padding:12px;">Nenhum processo encontrado.</td></tr>
    `;
    $msg.textContent = "";
    return;
  }

  $tb.innerHTML = rows.map(v => `
    <tr data-id="${v.id}" class="row-proc">
      <td class="col-nup">${formatNUP(v.nup)}</td>
      <td class="col-tipo">${v.tipo || ""}</td>
      <td class="col-entrada">${v.entrada_regional || ""}</td>
      <td class="col-status">${v.status || ""}</td>
      <td class="col-prazo">${v.prazo_regional || ""}</td>
      <td class="col-atualizado">${v.updated_at || ""}</td>
      <td class="col-por">${v.atualizado_por || ""}</td>
      <td class="col-acoes"><button class="btn btn-ver">Ver</button></td>
    </tr>
  `).join("");

  $msg.textContent = `${rows.length} processo(s) em memória. Role para carregar mais.`;

  // Bind "Ver" e clique na linha
  document.querySelectorAll(".row-proc .btn-ver").forEach(btn => {
    btn.onclick = async (e) => {
      const tr = e.target.closest("tr");
      const id = tr?.getAttribute("data-id");
      if (!id) return;
      const found = state.allList.find(p => p.id === id);
      if (found) {
        state.selected = found;
        // move para o topo
        const idx = state.allList.findIndex(p => p.id === id);
        if (idx !== -1) {
          const [row] = state.allList.splice(idx, 1);
          state.allList.unshift(row);
        }
        await getHistorico(found.id);
        recomputeViewData();
        fillFormFromSelected();
      }
    };
  });

  // Clique na linha também seleciona
  document.querySelectorAll(".row-proc").forEach(tr => {
    tr.onclick = async (e) => {
      if ((e.target || {}).classList?.contains("btn-ver")) return;
      const id = tr.getAttribute("data-id");
      const found = state.allList.find(p => p.id === id);
      if (found) {
        state.selected = found;
        // move para o topo
        const idx = state.allList.findIndex(p => p.id === id);
        if (idx !== -1) {
          const [row] = state.allList.splice(idx, 1);
          state.allList.unshift(row);
        }
        await getHistorico(found.id);
        recomputeViewData();
        fillFormFromSelected();
      }
    };
  });

  // Scroll infinito: ao chegar perto do fim, carrega próxima página
  const wrap = document.querySelector(".proc-table-wrap");
  if (wrap) {
    wrap.onscroll = async () => {
      if (state.isFetching || !state.hasMore) return;
      const nearBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 200;
      if (nearBottom) {
        try {
          await fetchNextPage();
        } catch (e) {
          console.error("Erro ao paginar:", e);
        }
      }
    };
  }
}

// =====================
// Render: Histórico
// =====================

function renderHistTitle() {
  const $title = document.getElementById("hist-title");
  if (!$title) return;
  if (!state.selected) {
    $title.textContent = `Histórico`;
    return;
  }
  const nup = state.selected?.nup || "";
  $title.textContent = `Histórico — ${formatNUP(nup)}`;
}

function renderHistorico() {
  const $tb = document.getElementById("tb-hist");
  const $msg = document.getElementById("hist-msg");
  if (!$tb) return;

  if (!state.selected) {
    $tb.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:12px;">Nenhum processo selecionado.</td></tr>`;
    $msg.textContent = "";
    return;
  }

  const rows = (state.historico || []).map(h => ({
    ...h,
    when: h.changed_at ? new Date(h.changed_at) : null,
  }));

  if (!rows.length) {
    $tb.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:12px;">Sem histórico.</td></tr>`;
    $msg.textContent = "";
    return;
  }

  const fmtDH = (d) => {
    if (!d) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  };

  $tb.innerHTML = rows.map(h => {
    const acao = (h.old_status ? `Status: ${h.old_status} → ${h.new_status}` : `Criação: ${h.new_status}`);
    const por  = h.changed_by_email || "(desconhecido)";
    return `
      <tr>
        <td class="hist-col-dh">${fmtDH(h.when)}</td>
        <td class="hist-col-acao">${acao}</td>
        <td class="hist-col-por">${por}</td>
      </tr>
    `;
  }).join("");

  $msg.textContent = `${rows.length} registro(s).`;
}

// =====================
// Formulário
// =====================

function bindForm(container) {
  const $nup = container.querySelector("#nup-input");
  const $btnBuscar = container.querySelector("#btn-buscar");
  const $btnLimparNUP = container.querySelector("#btn-limpar-nup");
  const $tipo = container.querySelector("#tipo-select");
  const $entrada = container.querySelector("#entrada-input");
  const $status = container.querySelector("#status-select");
  const $salvar = container.querySelector("#btn-salvar");
  const $excluir = container.querySelector("#btn-excluir");

  // Regras:
  // - Ao carregar: apenas NUP ativo, demais campos bloqueados e vazios
  // - Clicar "Buscar":
  //   * Se encontrar processo: tipo/entrada exibem valores e bloqueados; status habilitado
  //   * Se não encontrar: pergunta se cria; se "Não" limpa NUP; se "Sim" habilita campos e salva exige tudo preenchido
  // - Botão "Excluir": disponível quando tiver processo encontrado
  // - "Salvar": habilita quando status mudar (processo existente) ou quando criando (todos campos obrigatórios)

  function resetForm(keepNUP=false) {
    if (!keepNUP) {
      state.searchNUP = "";
      $nup.value = "";
    }
    $tipo.value = "";
    $entrada.value = "";
    $status.value = "";
    $tipo.disabled = true;
    $entrada.disabled = true;
    $status.disabled = true;
    $salvar.disabled = true;
    $excluir.disabled = true;

    state.selected = null;
    state.historico = [];
    renderHistTitle();
    renderHistorico();
  }

  // Máscara de digitação do NUP
  $nup.addEventListener("input", (e) => {
    const raw = e.target.value;
    const digits = onlyDigits17(raw);
    state.searchNUP = digits;
    e.target.value = maskNUPProgressive(digits);
  });

  // Buscar
  $btnBuscar.onclick = async () => {
    const d = state.searchNUP;
    if (!d || d.length !== 17) {
      alert("Informe o NUP com 17 algarismos.");
      return;
    }
    try {
      const found = await findByNUP(d);
      if (!found) {
        if (confirm("Processo não encontrado, gostaria de criar?")) {
          // habilita criação
          state.currentAction = "creating";
          $tipo.disabled = false;
          $entrada.disabled = false;
          $status.disabled = false;
          $salvar.disabled = false;
          $excluir.disabled = true;

          // limpa campos
          $tipo.value = "";
          $entrada.value = "";
          $status.value = "";
        } else {
          resetForm(false); // limpa inclusive o NUP
        }
        return;
      }

      // Encontrado → preenche e trava tipo/entrada; habilita status
      state.currentAction = "editing";
      fillFormFromSelected();
      $salvar.disabled = true; // só habilitar se status mudar
      $excluir.disabled = false;

      $tipo.disabled = true;
      $entrada.disabled = true;
      $status.disabled = false;

    } catch (e) {
      alert("Erro ao buscar: " + e.message);
    }
  };

  // Limpar NUP
  $btnLimparNUP.onclick = () => {
    resetForm(false);
  };

  // Salvar
  $salvar.onclick = async () => {
    if (state.currentAction === "creating") {
      // precisa de todos os campos
      const digits = state.searchNUP;
      const tipo = $tipo.value;
      const entrada = $entrada.value;
      const status = $status.value;
      if (!digits || digits.length !== 17 || !tipo || !entrada || !status) {
        alert("Preencha NUP (17 dígitos), Tipo, 1ª Entrada Regional e Status.");
        return;
      }
      const payload = {
        nup: digits,
        tipo,
        entrada_regional: entrada,
        status,
      };
      try {
        state.isSaving = true;
        const row = await createProcesso(payload);

        // insere no topo e seleciona
        state.allList.unshift(row);
        state.selected = row;
        await getHistorico(row.id);

        // bloqueia tipo/entrada; status liberado
        $tipo.disabled = true;
        $entrada.disabled = true;
        $status.disabled = false;
        state.currentAction = "editing";
        recomputeViewData();
        fillFormFromSelected();

      } catch (e) {
        alert("Erro ao criar: " + e.message);
      } finally {
        state.isSaving = false;
      }
      return;
    }

    if (state.currentAction === "editing" && state.selected) {
      const currentStatus = state.selected.status || "";
      const newStatus = $status.value || "";
      if (!newStatus) {
        alert("Selecione um status.");
        return;
      }
      if (newStatus === currentStatus) {
        alert("O status não foi alterado.");
        return;
      }
      try {
        state.isSaving = true;
        const up = await updateStatus(state.selected.id, newStatus);
        // Atualiza na lista
        const idx = state.allList.findIndex(p => p.id === up.id);
        if (idx !== -1) state.allList[idx] = up; else state.allList.unshift(up);
        state.selected = up;
        await getHistorico(up.id);
        recomputeViewData();
        fillFormFromSelected();
      } catch (e) {
        alert("Erro ao atualizar status: " + e.message);
      } finally {
        state.isSaving = false;
      }
    }
  };

  // Mudança de status → habilita Salvar (somente quando em edição)
  $status.addEventListener("change", () => {
    if (state.currentAction === "editing" && state.selected) {
      const current = state.selected.status || "";
      const next = $status.value || "";
      document.getElementById("btn-salvar").disabled = (current === next);
    }
  });

  // Excluir
  $excluir.onclick = async () => {
    if (!state.selected) return;
    if (!confirm("Confirma excluir o processo selecionado? Esta ação não pode ser desfeita.")) return;
    try {
      state.isDeleting = true;
      await deleteProcesso(state.selected.id);
      // Remove da lista em memória
      state.allList = state.allList.filter(p => p.id !== state.selected.id);
      state.selected = null;
      state.historico = [];
      recomputeViewData();
      resetForm(true); // mantém o NUP digitado
    } catch (e) {
      alert("Erro ao excluir: " + e.message);
    } finally {
      state.isDeleting = false;
    }
  };

  // Inicial: apenas NUP habilitado
  resetForm(true);
}

function fillFormFromSelected() {
  const sel = state.selected;
  if (!sel) return;
  const $nup = document.getElementById("nup-input");
  const $tipo = document.getElementById("tipo-select");
  const $entrada = document.getElementById("entrada-input");
  const $status = document.getElementById("status-select");
  const $salvar = document.getElementById("btn-salvar");
  const $excluir = document.getElementById("btn-excluir");

  // Mostra NUP mascarado no input, mas mantém state.searchNUP apenas dígitos
  state.searchNUP = (sel.nup || "").replace(/\D/g, "").slice(0,17);
  $nup.value = maskNUPProgressive(state.searchNUP);

  $tipo.value = sel.tipo || "";
  $entrada.value = sel.entrada_regional ? String(sel.entrada_regional).slice(0,10) : "";
  $status.value = sel.status || "";

  // Ao carregar um existente: tipo/entrada bloqueados; status editável
  $tipo.disabled = true;
  $entrada.disabled = true;
  $status.disabled = false;
  $salvar.disabled = true; // só habilita quando modificar status
  $excluir.disabled = false;
}

// =====================
// Ordenação visual
// =====================

function bindSorters() {
  document.querySelectorAll(".sort-wrap button").forEach(btn => {
    btn.onclick = () => {
      const col = btn.getAttribute("data-sort-col");
      const dir = btn.getAttribute("data-sort-dir");
      state.order = { col, dir };
      recomputeViewData();
    };
  });
}

// =====================
// Export do módulo
// =====================

export default {
  id: "processos",
  title: "Processos",
  route: "#/processos",
  async view(container) {
    render(container);
    bindForm(container);
    bindSorters();

    // Inicialização
    await fetchFirstPage();
  },
};
