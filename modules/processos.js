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

// ========= Utilitários: NUP =========

function onlyDigits17(value) {
  return (value || "").replace(/\D/g, "").slice(0, 17);
}
function maskNUP(digits) {
  const d = onlyDigits17(digits);
  const len = d.length;
  if (len === 0) return "";
  if (len <= 5) return d;
  if (len <= 11) return d.slice(0, 5) + "." + d.slice(5);
  if (len <= 15) return d.slice(0, 5) + "." + d.slice(5, 11) + "/" + d.slice(11);
  return d.slice(0, 5) + "." + d.slice(5, 11) + "/" + d.slice(11, 15) + "-" + d.slice(15, 17);
}
const isFullNUP = (v) => onlyDigits17(v).length === 17;

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
    .select("processo_id, old_status, new_status, changed_at")
    .in("processo_id", ids);
  if (error) throw error;
  return data;
}

// ========= Cálculo do Prazo Regional (SPA) =========

const SOBRESTADOS = new Set(["Sobrestado Técnico", "Sobrestado Documental"]);
const DIA_MS = 24 * 60 * 60 * 1000;

function calcularPrazosMapa(processos, historicos) {
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
    prazos.set(p.id, base ? new Date(base.getTime() + 60 * DIA_MS).toISOString().slice(0, 10) : "");
  }
  return prazos;
}

// ========= CSS do módulo (layout, sticky headers, larguras 30%/70%) =========

function ensureLayoutCSS() {
  if (document.getElementById("proc-two-pane-css")) return;
  const style = document.createElement("style");
  style.id = "proc-two-pane-css";
  style.textContent = `
    /* Módulo ocupa a área útil visível; sem rolagem global */
    .proc-mod { display:flex; flex-direction:column; overflow:hidden; }

    /* Formulário 100% largura e mais compacto (altura menor) */
    .proc-form-card { flex:0 0 auto; padding-top:8px; padding-bottom:8px; }
    .proc-form-row { display:flex; align-items:flex-end; gap:8px; flex-wrap:nowrap; overflow:auto; }
    .proc-form-row > div { display:flex; flex-direction:column; }
    .proc-form-row label { font-size:0.95rem; margin-bottom:2px; }
    .proc-form-row input, .proc-form-row select, .proc-form-row button { height:34px; }

    /* Área dividida em duas metades com proporções 30% (histórico) / 70% (lista) */
    .proc-split { display:flex; gap:10px; overflow:hidden; }
    .proc-pane { min-width:0; display:flex; flex-direction:column; overflow:hidden; }
    .hist-pane { flex:0 0 30%; }
    .grid-pane { flex:1 1 70%; }
    .pane-title { margin:0 0 8px 0; }
    .pane-body { flex:1 1 auto; min-height:0; overflow:auto; }

    /* Lista (direita) – rolagem vertical interna, cabeçalho fixo, sem filtros */
    .grid-pane .table { width:100%; table-layout:fixed; border-collapse:collapse; }
    .grid-pane th, .grid-pane td { font-size:12px; padding:4px 6px; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .grid-pane select { font-size:12px; }
    .grid-scroll { height:100%; overflow:auto; position:relative; }
    .grid-scroll thead th { position:sticky; top:0; background:#fff; z-index:3; }

    /* Histórico (esquerda) – cabeçalho fixo e rolagem vertical interna */
    .hist-pane .table { width:100%; table-layout:fixed; border-collapse:collapse; }
    .hist-pane th, .hist-pane td { font-size:12px; padding:4px 6px; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .hist-scroll thead th { position:sticky; top:0; background:#fff; z-index:2; border-bottom:1px solid #ddd; }

    /* Linha selecionada na lista */
    .row-selected { outline:2px solid #999; }
  `;
  document.head.appendChild(style);
}

// ========= Helpers de ordenação =========

function arrowFor(col, sort) {
  if (sort.key !== col) return "";
  return sort.dir === "asc" ? " ▲" : " ▼";
}

// ========= Tabela (sem linha de filtros e sem coluna de “Histórico”) =========

function viewTabela(listView, sort, STATUS) {
  const th = (key, label) => `<th data-sort-key="${key}" style="cursor:pointer">${label}${arrowFor(key, sort)}</th>`;

  return `
    <div class="grid-scroll">
      <table class="table">
        <colgroup>
          <col style="width:18%">
          <col style="width:12%">
          <col style="width:20%">
          <col style="width:14%">
          <col style="width:14%">
          <col style="width:22%">
        </colgroup>
        <thead>
          <tr>
            ${th("nup","NUP")}
            ${th("tipo","Tipo")}
            ${th("status","Status")}
            ${th("entrada","1ª Entrada Regional")}
            ${th("prazo","Prazo Regional")}
            ${th("atualizado","Atualizado em")}
          </tr>
        </thead>
        <tbody>
          ${listView.map(v => `
            <tr data-id="${v.id}" data-nup="${v.nup}">
              <td>${v.nup}</td>
              <td>${v.tipo}</td>
              <td>
                <select class="status-select">
                  ${STATUS.map(s => `<option ${s===v.status?"selected":""}>${s}</option>`).join("")}
                </select>
              </td>
              <td>${v.entrada || ""}</td>
              <td>${v.prazoDisplay}</td>
              <td class="small">${v.atualizadoStr}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ========= Painel do Histórico =========

function viewHistorico(title, hist) {
  const rows = (hist || []).map(h => {
    const autor = h.changed_by_email || h.changed_by || "(desconhecido)";
    const quando = new Date(h.changed_at).toLocaleString();
    const de = h.old_status ?? "(criação)";
    const para = h.new_status ?? "(sem status)";
    return `<tr><td>${quando}</td><td>${de}</td><td>${para}</td><td>${autor}</td></tr>`;
  }).join("");
  return `
    <h3 class="pane-title">${title}</h3>
    <div class="pane-body hist-scroll">
      <table class="table">
        <colgroup>
          <col style="width:34%"><col style="width:22%"><col style="width:22%"><col style="width:22%">
        </colgroup>
        <thead>
          <tr><th>Data/Hora</th><th>De</th><th>Para</th><th>Por</th></tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="4">Sem histórico.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

// ========= Formulário (uma linha; sem título acima; rótulo alterado; sem botão Histórico) =========

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

// ========= Bind da tabela =========

function bindTabela(container, refresh, onPickRow) {
  container.querySelectorAll("tr[data-id]").forEach(tr => {
    const id = tr.getAttribute("data-id");
    const nup = tr.getAttribute("data-nup");
    const select = tr.querySelector(".status-select");

    // Alteração de status direto na lista
    select.addEventListener("change", async (ev) => {
      ev.stopPropagation();
      try { await updateStatus(id, select.value); await refresh(); }
      catch (e) { alert("Erro ao atualizar status: " + e.message); }
    });

    // Clique na linha: seleciona processo no formulário + histórico
    tr.addEventListener("click", async () => {
      onPickRow(id);
      try {
        container.querySelectorAll("tbody tr").forEach(r => r.classList.remove("row-selected"));
        tr.classList.add("row-selected");
        const hist = await getHistorico(id);
        const pane = document.getElementById("hist-pane");
        pane.innerHTML = viewHistorico(`Histórico — ${nup}`, hist);
      } catch (e) { alert("Erro ao carregar histórico: " + e.message); }
    });
  });
}

// ========= Módulo =========

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
            <div id="grid">Carregando...</div>
          </div>
        </div>
      </div>
    `;

    // Refs
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

    // Estado
    let currentAction = null;   // 'update' | 'create' | null
    let currentRowId = null;
    let originalStatus = null;
    let pendingNup = "";
    let currentNupMasked = "";

    let allList = [];
    let prazosMap = new Map();
    let viewData = [];

    const sort = { key:"atualizado", dir:"desc" };

    // NUP máscara
    $nup.addEventListener("input", () => { $nup.value = maskNUP(onlyDigits17($nup.value)); });

    function resetForm(clearNup=false) {
      $msg.textContent = "";
      if (clearNup) $nup.value = "";
      $tipo.value = ""; $entrada.value = ""; $status.value = "";
      $tipo.disabled = true; $entrada.disabled = true; $status.disabled = true;
      $salvar.disabled = true; $excluir.disabled = true;
      currentAction = null; currentRowId = null; originalStatus = null; pendingNup = ""; currentNupMasked = "";
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

    // ViewData
    function buildViewData() {
      viewData = allList.map(r => {
        const prazoStr = SOBRESTADOS.has(r.status) ? "Sobrestado" : (prazosMap.get(r.id) || "");
        return {
          id: r.id,
          nup: r.nup, tipo: r.tipo, status: r.status,
          entrada: r.entrada_regional || "",
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
          case "atualizado": return v.atualizado ?? 0;
          default: return "";
        }
      };
      const arr = viewData.slice();
      arr.sort((a,b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
      return arr;
    }
    function renderGrid() {
      const view = applySort();
      gridWrap.innerHTML = viewTabela(view, sort, STATUS);
      bindTabela(gridWrap, refresh, onPickRowFromList);
      // Ordenação por clique no cabeçalho
      gridWrap.querySelectorAll("th[data-sort-key]").forEach(th => {
        th.addEventListener("click", () => {
          const key = th.getAttribute("data-sort-key");
          if (sort.key === key) sort.dir = sort.dir === "asc" ? "desc" : "asc";
          else { sort.key = key; sort.dir = "asc"; }
          renderGrid();
        });
      });
      if (currentRowId) {
        const tr = gridWrap.querySelector(`tr[data-id="${currentRowId}"]`);
        if (tr) tr.classList.add("row-selected");
      }
    }
    function onPickRowFromList(id) {
      const row = allList.find(r => String(r.id) === String(id));
      if (!row) return;
      setUpdateMode(row);
      $nup.value = row.nup;
      currentRowId = row.id;
    }

    // Formulário
    $buscar.addEventListener("click", async () => {
      if (!isFullNUP($nup.value)) {
        $msg.textContent = "Informe um NUP completo (17 dígitos)."; $nup.focus(); return;
      }
      const nupMasked = maskNUP(onlyDigits17($nup.value));
      $msg.textContent = "Buscando...";
      try {
        const row = await getProcessoByNup(nupMasked);
        if (row) {
          setUpdateMode(row); currentRowId = row.id;
          renderGrid(); // destaca linha
          const hist = await getHistorico(row.id);
          histPane.innerHTML = viewHistorico(`Histórico — ${row.nup}`, hist);
        } else {
          perguntaCriar((decisao) => {
            if (decisao) setCreateMode(nupMasked);
            else { resetForm(true); histPane.innerHTML = viewHistorico("Histórico", []); $nup.focus(); }
          });
        }
      } catch (e) { $msg.textContent = "Erro ao buscar: " + e.message; }
    });
    $limpar.addEventListener("click", () => {
      resetForm(true); histPane.innerHTML = viewHistorico("Histórico", []); $msg.textContent = "NUP limpo."; $nup.focus();
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

    // Carregar lista
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

    resetForm();
    await refresh();
  },
};
