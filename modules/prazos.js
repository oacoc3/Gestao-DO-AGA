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

async function fetchPareceresPendentes() {
  await ensureSession();
  const { data, error } = await supabase
    .from("processos")
    .select("nup")
    .overlaps("pareceres_pendentes", ["ATM", "DT", "CGNA"]);
  if (error) throw error;
  return data || [];
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
      <table class="table">
        <thead>
          <tr><th>NUP</th><th>Prazo</th></tr>
        </thead>
        <tbody id="body-${cat.code}">${rows}</tbody>
      </table>
    </div>
  `;
}

function listTemplate(cat) {
  const rows =
    cat.items
      .map((r) => `<tr><td>${r.nup || ""}</td></tr>`)
      .join("") || `<tr><td>Nenhum registro.</td></tr>`;
  return `
    <div class="card prazo-card" id="card-${cat.code}">
      <h2>${cat.title}</h2>
      <table class="table">
        <thead><tr><th>NUP</th></tr></thead>
        <tbody id="body-${cat.code}">${rows}</tbody>
      </table>
    </div>
  `;
}

export default {
  id: "prazos",
  title: "Prazos",
  route: "#/prazos",
  async view(container) {
    container.innerHTML = `<div class="container" id="prazos-root"></div>`;
    const root = container.querySelector("#prazos-root");

    try {
      await ensureSession();
      const [taskRes, prazoRegional, parecerPendentes] = await Promise.all([
        supabase
          .from("process_tasks")
          .select("code, due_at, processos(nup)")
          .or("code.ilike.PARECER_%,code.eq.SIGADAER_EXPEDIDO")
          .is("started_at", null)
          .order("due_at", { ascending: true }),
        fetchPrazoRegional(),
        fetchPareceresPendentes(),
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
        listTemplate({
          code: "PARECERES_PENDENTES",
          title: "Pareceres Pendentes",
          items: parecerPendentes,
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
