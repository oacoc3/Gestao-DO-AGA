// modules/prazos.js
import { supabase, ensureSession } from "../supabaseClient.js";

const TITLES = {
  PARECER_ATM: "Pareceres ATM",
  PARECER_DT: "Pareceres DT",
  PARECER_CGNA: "Pareceres CGNA",
  PARECER_COMPREP: "Pareceres COMPREP",
  PARECER_COMGAP: "Pareceres COMGAP",
  SIGADAER_EXPEDIDO: "SIGADAER Expedidos",
};

const SOBRESTADOS = new Set(["Sobrestado"]);
const DIA_MS = 24 * 60 * 60 * 1000;

function calcularPrazoRegional(p, hist = []) {
  if (SOBRESTADOS.has(p.status)) return "Sobrestado";
  let base = p.entrada_regional ? new Date(p.entrada_regional) : null;
  for (const h of hist) {
    const saiuDeSob =
      SOBRESTADOS.has(h.old_status) && !SOBRESTADOS.has(h.new_status);
    if (saiuDeSob) {
      const t = new Date(h.changed_at);
      if (!base || t > base) base = t;
    }
  }
  return base
    ? new Date(base.getTime() + 60 * DIA_MS).toISOString().slice(0, 10)
    : "";
}

async function fetchPrazoRegional() {
  await ensureSession();
  const { data: processos, error } = await supabase
    .from("processos")
    .select("id, nup, entrada_regional, status");
  if (error) throw error;

  const ids = processos.map((p) => p.id);
  let historicos = [];
  if (ids.length) {
    const { data: hist, error: e2 } = await supabase
      .from("status_history")
      .select("processo_id, old_status, new_status, changed_at")
      .in("processo_id", ids);
    if (e2) throw e2;
    historicos = hist || [];
  }

  const histMap = new Map();
  historicos.forEach((h) => {
    const arr = histMap.get(h.processo_id) || [];
    arr.push(h);
    histMap.set(h.processo_id, arr);
  });

  return processos.map((p) => {
    const prazo = calcularPrazoRegional(p, histMap.get(p.id) || []);
    return { processos: { nup: p.nup }, due_at: prazo };
  });
}

async function fetchPareceres(tipo) {
  await ensureSession();
  const { data: processos, error } = await supabase
    .from("processos")
    .select("id, nup")
    .contains("pareceres_pendentes", [tipo]);
  if (error) throw error;

  const ids = processos.map((p) => p.id);
  let historicos = [];
  if (ids.length) {
    const { data: hist, error: e2 } = await supabase
      .from("status_history")
      .select("processo_id, changed_at")
      .contains("parecer_solicitado", [tipo])
      .in("processo_id", ids)
      .order("changed_at", { ascending: false });
    if (e2) throw e2;
    historicos = hist || [];
  }

  const histMap = new Map();
  historicos.forEach((h) => {
    if (!histMap.has(h.processo_id)) histMap.set(h.processo_id, h.changed_at);
  });

  return processos.map((p) => {
    const base = histMap.get(p.id);
    const prazo = base
      ? new Date(new Date(base).setHours(0, 0, 0, 0) + 11 * DIA_MS)
          .toISOString()
          .slice(0, 10)
      : "";
    return { processos: { nup: p.nup }, due_at: prazo };
  });
}

async function fetchComunicacoes(tipo, prazoDias) {
  await ensureSession();
  const { data: processos, error } = await supabase
    .from("processos")
    .select("id, nup")
    .or(
      `comunicacoes_pendentes.cs.{${tipo}},pareceres_pendentes.cs.{${tipo}}`
    );
  if (error) throw error;

  const ids = processos.map((p) => p.id);
  let historicos = [];
  if (ids.length) {
    const { data: hist, error: e2 } = await supabase
      .from("status_history")
      .select("processo_id, changed_at")
      .or(
        `comunicacao_expedida.cs.{${tipo}},parecer_expedido.cs.{${tipo}}`
      )
      .in("processo_id", ids)
      .order("changed_at", { ascending: false });
    if (e2) throw e2;
    historicos = hist || [];
  }

  const histMap = new Map();
  historicos.forEach((h) => {
    if (!histMap.has(h.processo_id)) histMap.set(h.processo_id, h.changed_at);
  });

  return processos.map((p) => {
    const base = histMap.get(p.id);
    const prazo = base
      ? new Date(
          new Date(base).setHours(0, 0, 0, 0) + prazoDias * DIA_MS
        )
          .toISOString()
          .slice(0, 10)
      : "";
    return { processos: { nup: p.nup }, due_at: prazo };
  });
}

function ensureLayoutCSS() {
  if (document.getElementById("prazos-css")) return;
  const style = document.createElement("style");
  style.id = "prazos-css";
  style.textContent = `
    html, body { overflow:hidden; }
    .prazos-mod { display:flex; height:100%; overflow:hidden; padding:8px; }
    #prazos-root { flex:1 1 auto; display:flex; gap:8px; overflow:hidden; }
    #prazos-root .prazo-card { flex:1 1 0; min-width:0; display:flex; flex-direction:column; }
    .prazo-card h2 { margin:0 0 8px 0; }
    .prazo-body { flex:1 1 auto; min-height:0; overflow-y:auto; }
    .prazo-card .table { width:100%; border-collapse:collapse; }
    .prazo-card .table th,
    .prazo-card .table td {
      border:1px solid #eee;
      padding:4px 6px;
      font-size:12px;
      text-align:center;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
  `;
  document.head.appendChild(style);
}

function applyHeights(mod) {
  const top = mod.getBoundingClientRect().top;
  mod.style.height = window.innerHeight - top - 12 + "px";
}

function tableTemplate(cat) {
  const rows =
    cat.items
      .map((r) => {
        const nup = r.processos?.nup || "";
        const prazo = r.due_at
          ? isNaN(Date.parse(r.due_at))
            ? r.due_at
            : new Date(r.due_at).toLocaleDateString()
          : "";
        return `<tr><td>${nup}</td><td>${prazo}</td></tr>`;
      })
      .join("") || `<tr><td colspan="2">Nenhum registro.</td></tr>`;
  return `
    <div class="card prazo-card" id="card-${cat.code}">
      <h2>${cat.title}</h2>
      <div class="prazo-body">
        <table class="table">
          <thead>
            <tr><th>NUP</th><th>Prazo</th></tr>
          </thead>
          <tbody id="body-${cat.code}">${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

export default {
  id: "prazos",
  title: "Prazos",
  route: "#/prazos",
  async view(container) {
    ensureLayoutCSS();
    container.innerHTML = `<div class="prazos-mod"><div id="prazos-root"></div></div>`;
    const mod = container.querySelector(".prazos-mod");
    const root = container.querySelector("#prazos-root");
    const resize = () => applyHeights(mod);
    window.addEventListener("resize", resize);
    resize();

    try {
      await ensureSession();
      const [
        taskRes,
        prazoRegional,
        parecerATM,
        parecerDT,
        parecerCGNA,
        parecerCOMGAP,
        parecerCOMPREP,
        parecerCOMAE,
        respostaGABAER,
      ] = await Promise.all([
        supabase
          .from("process_tasks")
          .select("code, due_at, processos(nup)")
          .or("code.ilike.PARECER_%,code.eq.SIGADAER_EXPEDIDO")
          .is("started_at", null)
          .order("due_at", { ascending: true }),
        fetchPrazoRegional(),
        fetchPareceres("ATM"),
        fetchPareceres("DT"),
        fetchPareceres("CGNA"),
        fetchComunicacoes("COMGAP", 90),
        fetchComunicacoes("COMPREP", 30),
        fetchComunicacoes("COMAE", 30),
        fetchComunicacoes("GABAER", 30),
      ]);
      if (taskRes.error) throw taskRes.error;

      const grouped = (taskRes.data || []).reduce((acc, r) => {
        (acc[r.code] ||= []).push(r);
        return acc;
      }, {});

      const cards = Object.entries(grouped).map(([code, items]) =>
        tableTemplate({ code, title: TITLES[code] || code, items })
      );

      cards.push(
        tableTemplate({
          code: "PARECERES_ATM",
          title: "Pareceres ATM",
          items: parecerATM,
        })
      );
      cards.push(
        tableTemplate({
          code: "PARECERES_DT",
          title: "Pareceres DT",
          items: parecerDT,
        })
      );
      cards.push(
        tableTemplate({
          code: "PARECERES_CGNA",
          title: "Pareceres CGNA",
          items: parecerCGNA,
        })
      );

      cards.push(
        tableTemplate({
          code: "PARECERES_COMGAP",
          title: "Pareceres COMGAP",
          items: parecerCOMGAP,
        })
      );
      cards.push(
        tableTemplate({
          code: "PARECERES_COMPREP",
          title: "Pareceres COMPREP",
          items: parecerCOMPREP,
        })
      );
      cards.push(
        tableTemplate({
          code: "PARECERES_COMAE",
          title: "Pareceres COMAE",
          items: parecerCOMAE,
        })
      );
      cards.push(
        tableTemplate({
          code: "RESPOSTA_GABAER",
          title: "Resposta GABAER",
          items: respostaGABAER,
        })
      );

      cards.push(
        tableTemplate({
          code: "PRAZO_REGIONAL",
          title: "Prazo Regional",
          items: prazoRegional,
        })
      );

      root.innerHTML = cards.join("");
    } catch (e) {
      root.innerHTML = `<p>Erro: ${e.message}</p>`;
    }
  },
};
