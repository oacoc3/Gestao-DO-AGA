import { supabase, ensureSession } from "../supabaseClient.js";

const TITLES = {
  PARECER_ATM: "Pareceres ATM",
  PARECER_DT: "Pareceres DT",
  PARECER_CGNA: "Pareceres CGNA",
  PARECER_COMPREP: "Pareceres COMPREP",
  PARECER_COMGAP: "Pareceres COMGAP",
  SIGADAER_EXPEDIDO: "SIGADAER Expedidos",
};

function tableTemplate(cat) {
  const rows = cat.items
    .map((r) => {
      const nup = r.processos?.nup || "";
      const prazo = r.due_at ? new Date(r.due_at).toLocaleDateString() : "";
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

export default {
  id: "prazos",
  title: "Prazos",
  route: "#/prazos",
  async view(container) {
    container.innerHTML = `<div class="container" id="prazos-root"></div>`;
    const root = container.querySelector("#prazos-root");

    try {
      await ensureSession();
      const { data, error } = await supabase
        .from("process_tasks")
        .select("code, due_at, processos(nup)")
        .or("code.ilike.PARECER_%,code.eq.SIGADAER_EXPEDIDO")
        .is("received_at", null)
        .order("due_at", { ascending: true });
      if (error) throw error;
      if (!data || data.length === 0) {
        root.innerHTML = `<p>Nenhum registro.</p>`;
        return;
      }
      const grouped = data.reduce((acc, r) => {
        (acc[r.code] ||= []).push(r);
        return acc;
      }, {});
      root.innerHTML = Object.entries(grouped)
        .map(([code, items]) => tableTemplate({ code, title: TITLES[code] || code, items }))
        .join("");
    } catch (e) {
      root.innerHTML = `<p>Erro: ${e.message}</p>`;
    }
  },
};
