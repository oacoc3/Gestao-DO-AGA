// modules/administracao.js
// Módulo Administração — usa Netlify Function /.netlify/functions/adminUsers
// Ajuste principal: TODAS as requisições agora enviam o token (Authorization: Bearer …)

import { supabase } from "../supabaseClient.js";

// ===============================
//  Utilitários
// ===============================

// helper de query (falha com mensagem amigável se não encontrar)
function q(sel) {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Elemento não encontrado: ${sel}`);
  return el;
}

// Envia o token do usuário logado em TODAS as chamadas à Function
async function authFetch(input, init = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || !session.access_token) {
    throw new Error("Não autenticado.");
  }

  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${session.access_token}`);

  // Se houver body e não definiram Content-Type, define JSON
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Desabilita cache para evitar lista “memorizada”
  headers.set("Cache-Control", "no-store");

  return fetch(input, { ...init, headers });
}

function toast(msg) {
  alert(msg);
}

// Formata/normaliza textos simples
function trimOrNull(v) {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

// ===============================
//  Mapeamento de elementos da tela
//  (ajuste aqui se seus IDs forem diferentes)
// ===============================

const $posto   = () => q("#admPosto");         // input Posto/Graduação
const $guerra  = () => q("#admGuerra");        // input Nome de Guerra
const $nome    = () => q("#admNome");          // input Nome completo
const $email   = () => q("#admEmail");         // input E-mail
const $perfil  = () => q("#admPerfil");        // select Perfil
const $senha   = () => q("#admSenha");         // input Senha inicial (opcional)

const $btnNovo   = () => q("#admBtnNovo");     // botão Novo
const $btnCriar  = () => q("#admBtnCriar");    // botão Criar
const $btnReset  = () => q("#admBtnReset");    // botão Enviar link de redefinição
const $btnExc    = () => q("#admBtnExcluir");  // botão Excluir

const $tbody     = () => q("#admUsersBody");   // <tbody> da lista de usuários
const $btnPrev   = () => q("#admBtnPrev");     // ← Anterior
const $btnNext   = () => q("#admBtnNext");     // Próxima →

// ===============================
//  Estado simples do módulo
// ===============================

const state = {
  page: 1,
  size: 50,
  // usuário atualmente selecionado na lista (preenche o formulário)
  selected: null, // { id, email, perfil, posto_graduacao, nome_guerra, full_name }
};

// ===============================
//  Carregar lista / renderização
// ===============================

async function carregarLista() {
  const url = `/.netlify/functions/adminUsers?page=${state.page}&size=${state.size}`;
  const resp = await authFetch(url);
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Falha ao carregar usuários: ${resp.status} ${txt}`);
  }
  const json = await resp.json();
  renderLista(json.data || []);
}

function renderLista(rows) {
  const tb = $tbody();
  tb.innerHTML = "";

  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td colspan="5" style="text-align:center; opacity:.7;">Nenhum usuário encontrado.</td>
    `;
    tb.appendChild(tr);
    return;
  }

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.dataset.id = r.id;
    tr.dataset.email = r.email || "";
    tr.dataset.perfil = r.perfil || "";
    tr.dataset.posto = r.posto_graduacao || "";
    tr.dataset.guerra = r.nome_guerra || "";
    tr.dataset.nome = r.full_name || "";

    tr.innerHTML = `
      <td>${r.email ?? ""}</td>
      <td>${r.perfil ?? ""}</td>
      <td>${r.posto_graduacao ?? ""}</td>
      <td>${r.nome_guerra ?? ""}</td>
      <td>${r.full_name ?? ""}</td>
    `;

    tr.addEventListener("click", () => {
      state.selected = {
        id: tr.dataset.id,
        email: tr.dataset.email,
        perfil: tr.dataset.perfil,
        posto_graduacao: tr.dataset.posto,
        nome_guerra: tr.dataset.guerra,
        full_name: tr.dataset.nome,
      };
      preencherFormulario(state.selected);
    });

    tb.appendChild(tr);
  }
}

function preencherFormulario(u) {
  $posto().value  = u.posto_graduacao || "";
  $guerra().value = u.nome_guerra || "";
  $nome().value   = u.full_name || "";
  $email().value  = u.email || "";
  $perfil().value = u.perfil || "Visitante";
  $senha().value  = "";
}

// limpa formulário e seleção
function novo() {
  state.selected = null;
  $posto().value = "";
  $guerra().value = "";
  $nome().value = "";
  $email().value = "";
  $perfil().value = "Visitante";
  $senha().value = "";
  // foca no e-mail (campo mais importante para criar)
  $email().focus();
}

// ===============================
//  Ações: criar / atualizar / excluir / reset
// ===============================

async function criar() {
  const payload = {
    email: trimOrNull($email().value),
    perfil: ($perfil().value || "Visitante").trim(),
    posto_graduacao: trimOrNull($posto().value),
    nome_guerra: trimOrNull($guerra().value),
    full_name: trimOrNull($nome().value),
    password: trimOrNull($senha().value) || undefined,
  };

  if (!payload.email) {
    toast("Informe o e-mail.");
    $email().focus();
    return;
  }

  // Se existe seleção, interpretamos como ATUALIZAÇÃO
  if (state.selected?.id) {
    await atualizarSelecionado({
      id: state.selected.id,
      email: payload.email,
      perfil: payload.perfil,
      posto_graduacao: payload.posto_graduacao,
      nome_guerra: payload.nome_guerra,
      full_name: payload.full_name,
    });
    return;
  }

  // Criação
  const resp = await authFetch("/.netlify/functions/adminUsers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json?.error || "Erro ao criar usuário.");
  }

  toast("Usuário criado.");
  await carregarLista();
  novo();
}

async function atualizarSelecionado(upd) {
  if (!upd.id) {
    toast("Nenhum usuário selecionado.");
    return;
  }
  const resp = await authFetch("/.netlify/functions/adminUsers", {
    method: "PUT",
    body: JSON.stringify(upd)
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json?.error || "Erro ao atualizar.");
  }
  toast("Usuário atualizado.");
  await carregarLista();
}

async function excluir() {
  if (!state.selected?.id) {
    toast("Selecione um usuário na lista.");
    return;
  }
  if (!confirm("Excluir este usuário?")) return;

  const resp = await authFetch("/.netlify/functions/adminUsers", {
    method: "DELETE",
    body: JSON.stringify({ id: state.selected.id })
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json?.error || "Erro ao excluir.");
  }

  toast("Usuário excluído.");
  await carregarLista();
  novo();
}

async function enviarLinkRedefinicao() {
  const email = trimOrNull($email().value);
  if (!email) {
    toast("Informe o e-mail para enviar o link.");
    return;
  }
  const resp = await authFetch("/.netlify/functions/adminUsers?action=reset", {
    method: "POST",
    body: JSON.stringify({ email })
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json?.error || "Erro ao solicitar redefinição.");
  }
  toast("Se o SMTP estiver configurado no Supabase, o e-mail de redefinição será enviado.");
}

// ===============================
//  Paginação
// ===============================

async function paginaAnterior() {
  if (state.page > 1) {
    state.page -= 1;
    await carregarLista();
  }
}

async function proximaPagina() {
  state.page += 1;
  await carregarLista();
}

// ===============================
//  Inicialização do módulo
// ===============================

async function initAdministracao() {
  // Liga botões
  $btnNovo().addEventListener("click", () => novo());
  $btnCriar().addEventListener("click", async () => {
    try { await criar(); } catch (e) { toast("Erro: " + (e.message || e)); }
  });
  $btnExc().addEventListener("click", async () => {
    try { await excluir(); } catch (e) { toast("Erro: " + (e.message || e)); }
  });
  $btnReset().addEventListener("click", async () => {
    try { await enviarLinkRedefinicao(); } catch (e) { toast("Erro: " + (e.message || e)); }
  });

  $btnPrev().addEventListener("click", async () => {
    try { await paginaAnterior(); } catch (e) { toast("Erro: " + (e.message || e)); }
  });
  $btnNext().addEventListener("click", async () => {
    try { await proximaPagina(); } catch (e) { toast("Erro: " + (e.message || e)); }
  });

  // Estado inicial
  state.page = 1;
  state.selected = null;

  // carrega primeira página
  try {
    await carregarLista();
  } catch (e) {
    // Caso não autenticado ou sem permissão, a mensagem aparece aqui
    toast("Erro: " + (e.message || e));
  }
}

export default {
  id: "administracao",
  title: "Administração",
  route: "#/administracao",
  async view(container) {
    container.innerHTML = `
      <div class="container adm-mod">
        <div class="card">
          <h3>Administração de usuários</h3>
          <div class="adm-form">
            <input id="admPosto" placeholder="Posto/Graduação" />
            <input id="admGuerra" placeholder="Nome de Guerra" />
            <input id="admNome" placeholder="Nome completo" />
            <input id="admEmail" placeholder="E-mail" />
            <select id="admPerfil">
              <option value="Visitante">Visitante</option>
              <option value="Administrador">Administrador</option>
            </select>
            <input id="admSenha" type="password" placeholder="Senha inicial" />
          </div>
          <div class="adm-actions">
            <button id="admBtnNovo">Novo</button>
            <button id="admBtnCriar">Criar/Atualizar</button>
            <button id="admBtnReset">Enviar link</button>
            <button id="admBtnExcluir">Excluir</button>
          </div>
          <table class="adm-grid">
            <thead>
              <tr>
                <th>Email</th>
                <th>Perfil</th>
                <th>Posto</th>
                <th>Guerra</th>
                <th>Nome</th>
              </tr>
            </thead>
            <tbody id="admUsersBody"></tbody>
          </table>
          <div class="adm-pager">
            <button id="admBtnPrev">&larr; Anterior</button>
            <button id="admBtnNext">Próxima &rarr;</button>
          </div>
        </div>
      </div>
    `;

    await initAdministracao();
  },
};
