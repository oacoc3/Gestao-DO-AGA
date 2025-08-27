import { supabase, ensureSession } from "../supabaseClient.js";

const CATEGORIAS = [
  { code: "PARECER_ATM", title: "Pareceres ATM" },
  { code: "PARECER_DT", title: "Pareceres DT" },
  { code: "PARECER_CGNA", title: "Pareceres CGNA" },
  { code: "PARECER_COMPREP", title: "Pareceres COMPREP" },
  { code: "PARECER_COMGAP", title: "Pareceres COMGAP" },
  { code: "TERMINO_OBRA", title: "Término de Obra" },
  { code: "REBAIXAMENTO_REMOCAO", title: "Rebaixamento/Remoção" },
  { code: "MEDIDAS_MITIGADORAS", title: "Medidas Mitigadoras" },
];

function tableTemplate(cat) {
  return `
    <div class="card prazo-card" id="card-${cat.code}">
      <h2>${cat.title}</h2>
      <table class="table">
        <thead>
          <tr><th>NUP</th><th>Prazo</th></tr>
        </thead>
        <tbody id="body-${cat.code}"><tr><td colspan="2">Carregando...</td></tr></tbody>
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
    root.innerHTML = CATEGORIAS.map(tableTemplate).join("");

    await Promise.all(
      CATEGORIAS.map(async (cat) => {
        const tbody = root.querySelector(`#body-${cat.code}`);
        try {
          await ensureSession();
          const { data, error } = await supabase
            .from("process_tasks")
            .select("due_at, processos(nup)")
            .eq("code", cat.code)
            .is("done_at", null)
            .order("due_at", { ascending: true });
          if (error) throw error;
          if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="2">Nenhum registro.</td></tr>`;
            return;
          }
          tbody.innerHTML = data
            .map((r) => {
              const nup = r.processos?.nup || "";
              const prazo = r.due_at ? new Date(r.due_at).toLocaleDateString() : "";
              return `<tr><td>${nup}</td><td>${prazo}</td></tr>`;
            })
            .join("");
        } catch (e) {
          tbody.innerHTML = `<tr><td colspan="2">Erro: ${e.message}</td></tr>`;
        }
      })
    );
  },
};
