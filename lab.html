// Siglas (expansões):
// - RLS: Row Level Security (segurança por linha no banco)
// - RPC: Remote Procedure Call (chamar função SQL do servidor)
// - UTC: Coordinated Universal Time (fuso padrão)

import { supabase } from "./supabaseClient.js";

const $ = (s) => document.querySelector(s);
const msg = $("#msg");

let proc = null;           // processo carregado (lado esquerdo)
let selectedRowId = null;  // id selecionado na lista (direita)

/* =========================
   Util: máscara NUP (idêntica à do módulo oficial)
   ========================= */
function onlyDigits17(v){ return (v||"").replace(/\D/g, "").slice(0,17); }
function maskNUP(d){
  const s = onlyDigits17(d), len = s.length;
  if (len===0) return "";
  if (len<=5) return s;
  if (len<=11) return s.slice(0,5)+"."+s.slice(5);
  if (len<=15) return s.slice(0,5)+"."+s.slice(5,11)+"/"+s.slice(11);
  return s.slice(0,5)+"."+s.slice(5,11)+"/"+s.slice(11,15)+"-"+s.slice(15,17);
}

/* =========================
   Carregar processo por NUP (lado esquerdo)
   ========================= */
$("#btn-load").onclick = async () => {
  msg.textContent = "Carregando...";
  const nup = $("#nup").value.trim();
  const { data, error } = await supabase.from("processos").select("*").eq("nup", nup).maybeSingle();
  if (error || !data) { msg.textContent = "Processo não encontrado."; proc=null; renderTasks([]); return; }
  proc = data; selectedRowId = data.id;
  highlightSelectedRow();
  msg.textContent = `Processo #${proc.id} carregado.`;
  await refreshTasks();
};

/* =========================
   Mudar status do processo carregado
   ========================= */
$("#btn-aplicar").onclick = async () => {
  if (!proc) { msg.textContent = "Carregue/seleciona um processo primeiro."; return; }
  const st = $("#novo-status").value;
  if (!st) { msg.textContent = "Escolha um status."; return; }
  msg.textContent = "Atualizando status...";
  const { error } = await supabase.from("processos").update({ status: st }).eq("id", proc.id);
  msg.textContent = error ? ("Erro: "+error.message) : "Status atualizado. Tarefas criadas se aplicável.";
  await refreshTasks();
};

/* =========================
   Ações rápidas: pareceres e SIGAD
   ========================= */
document.querySelectorAll("[data-act='PARECER']").forEach(btn => {
  btn.onclick = async () => {
    if (!proc) { msg.textContent = "Selecione um processo."; return; }
    const org = btn.dataset.org;
    const { error } = await supabase.rpc("request_parecer", { p_processo_id: proc.id, p_orgao: org });
    msg.textContent = error ? ("Erro: "+error.message) : (`Parecer ${org} criado.`);
    await refreshTasks();
  };
});
$("#btn-sigad").onclick = async () => {
  if (!proc) { msg.textContent = "Selecione um processo."; return; }
  const { error } = await supabase.rpc("sigad_start", { p_processo_id: proc.id, p_alvos: ['COMAE','COMGAP'], p_obs: 'Teste Lab' });
  msg.textContent = error ? ("Erro: "+error.message) : "Pipeline SIGAD criado.";
  await refreshTasks();
};

/* =========================
   Tarefas do processo (lado esquerdo)
   ========================= */
async function refreshTasks() {
  if (!proc) { renderTasks([]); return; }
  const { data, error } = await supabase
    .from("process_tasks")
    .select("*")
    .eq("processo_id", proc.id)
    .order("created_at", { ascending: false });
  if (error) { msg.textContent = "Erro ao listar tarefas: "+error.message; return; }
  renderTasks(data);
}

function renderTasks(tasks) {
  const el = $("#tasks");
  if (!tasks.length) { el.innerHTML = "<p>Nenhuma tarefa.</p>"; return; }

  el.innerHTML = tasks.map(t => {
    const started = t.started_at ? new Date(t.started_at).toLocaleString() : "";
    const due = t.due_at ? new Date(t.due_at).toLocaleDateString() : "";
    let controls = "";

    if (t.needs_input) {
      if (t.input_key === "sobrestado_tipo") {
        controls = `
          <button data-x="SOB_TIPO" data-id="${t.id}" data-v="Tecnico">Definir Técnico</button>
          <button data-x="SOB_TIPO" data-id="${t.id}" data-v="Documental">Definir Documental</button>
        `;
      } else if (t.input_key === "data_ciencia") {
        controls = `
          <input type="datetime-local" data-x="DATA" data-id="${t.id}" />
          <button data-x="SET_DATA" data-id="${t.id}" data-code="${t.code}">Salvar</button>
        `;
      } else if (t.input_key === "prazo_termino_obra") {
        controls = `
          <input type="date" data-x="PTO" data-id="${t.id}" />
          <button data-x="SET_PTO" data-id="${t.id}">Salvar</button>
        `;
      } else if (t.input_key === "sigad_expedicao") {
        controls = `
          <input type="datetime-local" data-x="SIGAD" data-id="${t.id}" />
          <button data-x="SET_SIGAD" data-id="${t.id}">Salvar</button>
        `;
      }
    }

    return `
      <div class="row-task">
        <div><b>${t.code}</b></div>
        <div>${t.title}</div>
        <div>${t.status}</div>
        <div>${started}</div>
        <div>${due}</div>
        <div>${controls}</div>
      </div>
    `;
  }).join("");

  // binds (flags)
  el.querySelectorAll("[data-x='SOB_TIPO']").forEach(b => {
    b.onclick = async () => {
      const id = Number(b.dataset.id), val = b.dataset.v;
      const { error } = await supabase.rpc("task_set_sobrestado_tipo", { p_task_id: id, p_tipo: val });
      msg.textContent = error ? ("Erro: "+error.message) : ("Sobrestado ⇒ tipo: "+val);
      await refreshTasks();
      await refreshListPreservandoScroll(); // lista da direita pode ganhar nova task/prazo
    };
  });

  el.querySelectorAll("[data-x='SET_DATA']").forEach(b => {
    b.onclick = async () => {
      const id = Number(b.dataset.id);
      const code = b.dataset.code;
      const inp = el.querySelector(`input[data-x='DATA'][data-id='${id}']`);
      if (!inp.value) { msg.textContent = "Informe a data/hora."; return; }
      const iso = new Date(inp.value).toISOString();
      let error;
      if (code === "SOBRESTADO_DATA_CIENCIA") {
        ({ error } = await supabase.rpc("task_set_sobrestado_data_ciencia", { p_task_id: id, p_data: iso }));
      } else {
        ({ error } = await supabase.rpc("task_set_data_ciencia", { p_task_id: id, p_data: iso }));
      }
      msg.textContent = error ? ("Erro: "+error.message) : "Data registrada.";
      await refreshTasks();
      await refreshListPreservandoScroll();
    };
  });

  el.querySelectorAll("[data-x='SET_PTO']").forEach(b => {
    b.onclick = async () => {
      const id = Number(b.dataset.id);
      const inp = el.querySelector(`input[data-x='PTO'][data-id='${id}']`);
      if (!inp.value) { msg.textContent = "Informe a data."; return; }
      const { error } = await supabase.rpc("task_set_prazo_termino_obra", { p_task_id: id, p_data: inp.value });
      msg.textContent = error ? ("Erro: "+error.message) : "Prazo do Término de Obra definido.";
      await refreshTasks();
      await refreshListPreservandoScroll();
    };
  });

  el.querySelectorAll("[data-x='SET_SIGAD']").forEach(b => {
    b.onclick = async () => {
      const id = Number(b.dataset.id);
      const inp = el.querySelector(`input[data-x='SIGAD'][data-id='${id}']`);
      if (!inp.value) { msg.textContent = "Informe a data/hora de expedição."; return; }
      const iso = new Date(inp.value).toISOString();
      const { error } = await supabase.rpc("sigad_set_expedicao", { p_task_id: id, p_data: iso });
      msg.textContent = error ? ("Erro: "+error.message) : "Expedição SIGAD registrada e pareceres externos criados.";
      await refreshTasks();
      await refreshListPreservandoScroll();
    };
  });
}

/* ========================================================
   METADE DIREITA — Lista de processos com scroll interno
   ======================================================== */

const plBody = $("#pl-body");
const listWrap = $("#proc-list");
let cursor = null;   // { updated_at, id }
let loading = false;
let hasNext = true;

function fmtDate(ts){
  if (!ts) return "";
  try{ return new Date(ts).toLocaleString(); }catch{ return ts; }
}

function renderRows(rows, {append=false} = {}){
  const html = rows.map(r => `
    <div class="pl-row" data-id="${r.id}">
      <div title="${r.nup||""}">${r.nup||""}</div>
      <div>${r.tipo||""}</div>
      <div title="${r.status||""}">${r.status||""}</div>
      <div>${r.entrada_regional||""}</div>
      <div>${fmtDate(r.updated_at)}</div>
    </div>
  `).join("");

  if (append) plBody.insertAdjacentHTML("beforeend", html);
  else plBody.innerHTML = html;

  // bind de clique
  plBody.querySelectorAll(".pl-row").forEach(row => {
    row.onclick = async () => {
      const id = Number(row.dataset.id);
      selectedRowId = id;
      highlightSelectedRow();
      const { data, error } = await supabase.from("processos").select("*").eq("id", id).single();
      if (error) { msg.textContent = "Erro ao abrir processo: "+error.message; return; }
      proc = data;
      $("#nup").value = proc.nup || "";
      await refreshTasks();
    };
  });

  highlightSelectedRow();
}

function highlightSelectedRow(){
  plBody.querySelectorAll(".pl-row").forEach(r => r.classList.toggle("selected", Number(r.dataset.id)===Number(selectedRowId)));
}

async function fetchFirstPage(){
  loading = true;
  try{
    const { data, nextCursor } = await fetchPageByCursor(null);
    cursor = nextCursor;
    hasNext = !!nextCursor && (data?.length||0) > 0;
    renderRows(data||[], {append:false});
  } finally { loading = false; }
}

async function fetchNextPage(){
  if (!hasNext || loading) return;
  loading = true;
  try{
    const { data, nextCursor } = await fetchPageByCursor(cursor);
    cursor = nextCursor;
    hasNext = !!nextCursor && (data?.length||0) > 0;
    renderRows(data||[], {append:true});
  } finally { loading = false; }
}

async function refreshListPreservandoScroll(){
  const sc = listWrap.scrollTop;
  await fetchFirstPage();
  listWrap.scrollTop = sc;
}

/* Consulta paginada por "keyset" (updated_at desc, id desc),
   igual à estratégia do seu módulo oficial, para evitar OFFSET pesado */
const PAGE_SIZE = 200;
async function fetchPageByCursor(cur){
  if (!cur){
    const { data, error } = await supabase
      .from("processos")
      .select("*")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);
    if (error) throw error;
    return pack(data||[]);
  } else {
    const { data: part1, error: e1 } = await supabase
      .from("processos")
      .select("*")
      .lt("updated_at", cur.updated_at)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);
    if (e1) throw e1;

    const remain = Math.max(0, PAGE_SIZE - (part1?.length || 0));
    let part2 = [];
    if (remain > 0){
      const { data: eqdata, error: e2 } = await supabase
        .from("processos")
        .select("*")
        .eq("updated_at", cur.updated_at)
        .lt("id", cur.id)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(remain);
      if (e2) throw e2;
      part2 = eqdata || [];
    }
    const rows = [...(part1||[]), ...part2];
    return pack(rows);
  }

  function pack(rows){
    const nextCursor = rows.length
      ? { updated_at: rows[rows.length-1].updated_at, id: rows[rows.length-1].id }
      : null;
    return { data: rows, nextCursor };
  }
}

/* Scroll interno da lista (direita) */
listWrap.addEventListener("scroll", async () => {
  const nearBottom = listWrap.scrollTop + listWrap.clientHeight >= listWrap.scrollHeight - 200;
  if (nearBottom) await fetchNextPage();
});

/* Boot: carregar primeira página ao abrir o Lab */
await fetchFirstPage();
