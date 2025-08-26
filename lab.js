import { supabase } from "./supabaseClient.js";

const $ = (s) => document.querySelector(s);
const msg = $("#msg");
let proc = null;

$("#btn-load").onclick = async () => {
  msg.textContent = "Carregando...";
  const nup = $("#nup").value.trim();
  const { data, error } = await supabase.from("processos").select("*").eq("nup", nup).maybeSingle();
  if (error || !data) { msg.textContent = "Processo não encontrado"; proc=null; renderTasks([]); return; }
  proc = data; msg.textContent = `Processo #${proc.id} carregado.`;
  await refreshTasks();
};

$("#btn-aplicar").onclick = async () => {
  if (!proc) { msg.textContent = "Carregue um processo primeiro."; return; }
  const st = $("#novo-status").value;
  if (!st) { msg.textContent = "Escolha um status."; return; }
  msg.textContent = "Atualizando status...";
  const { error } = await supabase.from("processos").update({ status: st }).eq("id", proc.id);
  msg.textContent = error ? ("Erro: "+error.message) : "Status atualizado. Tarefas criadas se aplicável.";
  await refreshTasks();
};

document.querySelectorAll("[data-act='PARECER']").forEach(btn => {
  btn.onclick = async () => {
    if (!proc) { msg.textContent = "Carregue um processo primeiro."; return; }
    const org = btn.dataset.org;
    const { error } = await supabase.rpc("request_parecer", { p_processo_id: proc.id, p_orgao: org });
    msg.textContent = error ? ("Erro: "+error.message) : (`Parecer ${org} criado.`);
    await refreshTasks();
  };
});

$("#btn-sigad").onclick = async () => {
  if (!proc) { msg.textContent = "Carregue um processo primeiro."; return; }
  const { error } = await supabase.rpc("sigad_start", { p_processo_id: proc.id, p_alvos: ['COMAE','COMGAP'], p_obs: 'Teste Lab' });
  msg.textContent = error ? ("Erro: "+error.message) : "Pipeline SIGAD criado.";
  await refreshTasks();
};

async function refreshTasks() {
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

    // Controles para "flags" (needs_input)
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
      <div class="row" style="display:grid; grid-template-columns: 18ch 1fr 12ch 20ch 16ch 1.5fr; gap:8px; padding:6px 0; border-bottom:1px solid #eee;">
        <div><b>${t.code}</b></div>
        <div>${t.title}</div>
        <div>${t.status}</div>
        <div>${started}</div>
        <div>${due}</div>
        <div>${controls}</div>
      </div>
    `;
  }).join("");

  // Bind dos botões/inputs
  el.querySelectorAll("[data-x='SOB_TIPO']").forEach(b => {
    b.onclick = async () => {
      const id = Number(b.dataset.id), val = b.dataset.v;
      const { error } = await supabase.rpc("task_set_sobrestado_tipo", { p_task_id: id, p_tipo: val });
      msg.textContent = error ? ("Erro: "+error.message) : ("Tipo do sobrestado definido: "+val);
      await refreshTasks();
    };
  });

  el.querySelectorAll("[data-x='SET_DATA']").forEach(b => {
    b.onclick = async () => {
      const id = Number(b.dataset.id);
      const code = b.dataset.code;
      const inp = el.querySelector(`input[data-x='DATA'][data-id='${id}']`);
      if (!inp.value) { msg.textContent = "Informe a data/hora."; return; }
      const iso = new Date(inp.value).toISOString();
      if (code === "SOBRESTADO_DATA_CIENCIA") {
        const { error } = await supabase.rpc("task_set_sobrestado_data_ciencia", { p_task_id: id, p_data: iso });
        msg.textContent = error ? ("Erro: "+error.message) : "Data de ciência salva (Sobrestado).";
      } else {
        const { error } = await supabase.rpc("task_set_data_ciencia", { p_task_id: id, p_data: iso });
        msg.textContent = error ? ("Erro: "+error.message) : "Data de ciência salva.";
      }
      await refreshTasks();
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
    };
  });
}
