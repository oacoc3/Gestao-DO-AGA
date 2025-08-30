// modules/dashboard.js
import { supabase, ensureSession } from "../supabaseClient.js";

const STATUS = [
  "Análise Documental",
  "Análise ICA",
  "Análise Téc. Prel.",
  "Análise Técnica",
  "Análise GABAER",
  "Confecção de Doc.",
  "Revisão OACO",
  "Aprovação",
  "Sobrestado",
  "Publicação de Portaria",
  "Arquivado",
];

const DIA_MS = 24 * 60 * 60 * 1000;

function ensureCSS() {
  if (document.getElementById("dash-css")) return;
  const style = document.createElement("style");
  style.id = "dash-css";
  style.textContent = `
    .dash-container{display:flex;flex-wrap:wrap;gap:24px;justify-content:center;padding:16px;}
    .ring{display:flex;flex-direction:column;align-items:center;font-size:12px;}
    .ring svg{width:80px;height:80px;}
    .ring .bg{fill:none;stroke:#eee;stroke-width:3.8;}
    .ring .meter{fill:none;stroke:#007bff;stroke-width:3.8;stroke-linecap:round;transform:rotate(-90deg);transform-origin:50% 50%;}
    .ring .count{text-anchor:middle;font-size:14px;dominant-baseline:middle;}
    .ring .label{text-align:center;margin-top:4px;}
    .ring .avg{font-size:10px;display:block;}
  `;
  document.head.appendChild(style);
}

function ringTemplate(stat, maxAvg) {
  const percent = maxAvg ? Math.min(100, (stat.avgDays / maxAvg) * 100) : 0;
  return `
    <div class="ring">
      <svg viewBox="0 0 36 36">
        <path class="bg" d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831" />
        <path class="meter" stroke-dasharray="${percent},100" d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831" />
        <text x="18" y="20" class="count">${stat.count}</text>
      </svg>
      <div class="label">${stat.status}<span class="avg">${Math.round(stat.avgDays)}d</span></div>
    </div>
  `;
}

export default {
  id: "dashboard",
  title: "Início",
  route: "#/dashboard",
  async view(container) {
    ensureCSS();
    container.innerHTML = `<div class="container"><div id="dash-root" class="dash-container"></div></div>`;
    const root = container.querySelector("#dash-root");
    try {
      await ensureSession();
      const { data: processos, error } = await supabase
        .from("processos")
        .select("id,status");
      if (error) throw error;
      const ids = processos.map((p) => p.id);
      let hist = [];
      if (ids.length) {
        const { data: histData, error: e2 } = await supabase
          .from("status_history")
          .select("processo_id,new_status,changed_at")
          .in("processo_id", ids)
          .order("changed_at", { ascending: false });
        if (e2) throw e2;
        hist = histData || [];
      }
      const lastChange = new Map();
      hist.forEach((h) => {
        if (!lastChange.has(h.processo_id)) lastChange.set(h.processo_id, h);
      });
      const now = new Date();
      const stats = STATUS.map((s) => {
        const procs = processos.filter((p) => p.status === s);
        const count = procs.length;
        let total = 0;
        procs.forEach((p) => {
          const hc = lastChange.get(p.id);
          if (hc) total += (now - new Date(hc.changed_at)) / DIA_MS;
        });
        const avg = count ? total / count : 0;
        return { status: s, count, avgDays: avg };
      });
      const maxAvg = Math.max(...stats.map((s) => s.avgDays), 1);
      root.innerHTML = stats.map((s) => ringTemplate(s, maxAvg)).join("");
    } catch (e) {
      root.innerHTML = `<p>Erro: ${e.message}</p>`;
    }
  },
};
