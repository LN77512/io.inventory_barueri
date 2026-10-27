const GAS_URL = "https://script.google.com/macros/s/AKfycbx6ubLw4yvvBwA-CoOv2UGraSuCUEidoyWX9W4TIEw8mp6NKXpHh7yLF31DHYUV6KRH/exec";

let token = null;
let usuarioAtual = null;
let itemEmEdicao = null;
let meuGraficoStatus = null;
let dadosInventarioGlobal = [];
let itemParaDeletarTemp = null;

/* ---------- Utilitários ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const low = s => String(s || "").trim().toLowerCase();
const norm = s => low(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const chaveDe = i => `${low(i.nome)}_${low(i.marca)}_${low(i.modelo)}`;
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const el = id => document.getElementById(id);
const mostrar = id => { el(id).style.display = "flex"; };
const esconder = id => { el(id).style.display = "none"; };

function formatarDataExibicao(valor) {
  const str = String(valor || "");
  if (str.includes("T")) {
    const p = str.split("T")[0].split("-");
    if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
  }
  return str;
}

function formatarHoraExibicao(valor) {
  const str = String(valor || "");
  if (str.includes("T")) {
    const p = str.split("T")[1];
    if (p) return p.substring(0, 5);
  }
  return str;
}

/* ---------- Comunicação com o servidor ---------- */
async function api(payload) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, token })
  });
  const r = await res.json();
  if (r.erro === "nao_autorizado" && payload.action !== "LOGIN") {
    alert("Sessão expirada. Faça login novamente.");
    logout();
    throw new Error("sessao");
  }
  return r;
}

async function listar(sheet) {
  const res = await fetch(`${GAS_URL}?sheet=${sheet}&token=${encodeURIComponent(token || "")}`);
  const r = await res.json();
  if (r && r.erro === "nao_autorizado") {
    alert("Sessão expirada. Faça login novamente.");
    logout();
    throw new Error("sessao");
  }
  return r;
}

/* ---------- Logout automático por inatividade ---------- */
const INATIVIDADE_MS = 15 * 60 * 1000; // 15 minutos sem mexer no sistema
let timerInatividade = null;

function reiniciarTimerInatividade() {
  clearTimeout(timerInatividade);
  if (!token) return;
  timerInatividade = setTimeout(() => {
    alert("Sessão encerrada por inatividade. Faça login novamente.");
    logout();
  }, INATIVIDADE_MS);
}
["click", "keydown", "mousemove", "touchstart"].forEach(ev =>
  document.addEventListener(ev, reiniciarTimerInatividade, { passive: true }));

/* ---------- Login ---------- */
async function tentarLoginDireto() {
  const usuario = el("usr-field").value.trim();
  const senha = el("pwd-field").value.trim();
  if (!usuario || !senha) {
    alert("Por favor, preencha o utilizador e a palavra-passe.");
    return;
  }
  try {
    const r = await api({ action: "LOGIN", usuario, senha });
    if (!r.ok) {
      alert(r.erro === "bloqueado"
        ? "Muitas tentativas incorretas. Aguarde 5 minutos."
        : "Utilizador ou palavra-passe incorretos.");
      return;
    }
    token = r.token;
    usuarioAtual = { nome: r.nome };
    esconder("login-modal");
    if (r.primeiroAcesso) mostrar("security-code-modal");
    else iniciarSessao();
  } catch (err) {
    console.error("Erro ao autenticar:", err);
    alert("Erro de comunicação com o servidor.");
  }
}

async function validarCodigoSeguranca(event) {
  if (event) event.preventDefault();
  const codigo = el("sec-code-field").value.trim();
  if (!codigo) {
    alert("Por favor, insira o código de segurança.");
    return;
  }
  try {
    const r = await api({ action: "VALIDAR_CODIGO", codigo });
    if (r.valido === true) {
      esconder("security-code-modal");
      mostrar("first-access-modal");
    } else {
      alert("Código de segurança incorreto! Acesso negado.");
      el("sec-code-field").value = "";
    }
  } catch (err) {
    if (err.message !== "sessao") alert("Erro de comunicação com o servidor.");
  }
}

async function salvarNovaCredencial(event) {
  if (event) event.preventDefault();
  const novoUsuario = el("new-usr-field").value.trim();
  const novaSenha = el("new-pwd-field").value.trim();
  if (!novoUsuario || !novaSenha) {
    alert("Por favor, preencha o utilizador e a nova palavra-passe.");
    return;
  }
  if (novaSenha.length < 6) {
    alert("A palavra-passe deve ter pelo menos 6 caracteres.");
    return;
  }
  try {
    const r = await api({ action: "SET_CREDENCIAIS", novoUsuario, novaSenha });
    if (r.ok) {
      usuarioAtual = { nome: r.nome };
      esconder("first-access-modal");
      iniciarSessao();
    } else if (r.erro === "usuario_existe") {
      alert("Esse nome de utilizador já existe. Escolha outro.");
    } else {
      alert("Não foi possível salvar as credenciais.");
    }
  } catch (err) {
    if (err.message !== "sessao") alert("Erro de comunicação com o servidor.");
  }
}

function iniciarSessao() {
  sessionStorage.setItem("thales_sessao", JSON.stringify({ token, nome: usuarioAtual.nome }));
  reiniciarTimerInatividade();
  ["login-modal", "security-code-modal", "first-access-modal"].forEach(esconder);
  el("app-container").style.display = "block";
  el("logged-user-name").textContent = usuarioAtual.nome;
  el("logged-user-role").textContent = "Administrador";
  carregarItens();
  carregarHistorico();
}

function logout() {
  sessionStorage.removeItem("thales_sessao");
  clearTimeout(timerInatividade);
  token = null;
  usuarioAtual = null;
  dadosInventarioGlobal = [];
  el("inventory-body").innerHTML = "";
  el("history-body").innerHTML = "";
  paginar("inv");
  paginar("hist");
  el("app-container").style.display = "none";
  esconder("security-code-modal");
  esconder("first-access-modal");
  mostrar("login-modal");
  ["usr-field", "pwd-field", "sec-code-field", "new-usr-field", "new-pwd-field"].forEach(id => { el(id).value = ""; });
}

/* ---------- Abas e gráfico ---------- */
function mudarAba(aba) {
  const inv = aba === "inventario";
  el("visao-inventario").style.display = inv ? "block" : "none";
  el("visao-historico").style.display = inv ? "none" : "block";
  el("tab-inv-btn").classList.toggle("active", inv);
  el("tab-hist-btn").classList.toggle("active", !inv);
  if (!inv) carregarHistorico();
}

function abrirModalGrafico() {
  mostrar("chart-modal");
  atualizarDashboard(dadosInventarioGlobal);
}

function fecharModalGrafico() {
  esconder("chart-modal");
}

// Agrupa por nome+marca+modelo: estoque total, em uso e em manutenção
function agrupar(data) {
  const g = {};
  data.forEach(item => {
    if (!low(item.nome)) return;
    const x = (g[chaveDe(item)] ||= { estoque: 0, uso: 0, manut: 0 });
    const q = parseInt(item.quantidade) || 0;
    x.estoque = Math.max(x.estoque, parseInt(item.quantidade_estoque) || 0);
    const st = norm(item.status);
    if (st.includes("manutencao")) x.manut += q;
    else if (!st.includes("disponivel")) x.uso += q;
  });
  return g;
}

function atualizarDashboard(data) {
  const ctx = el("statusChart");
  if (!ctx) return;
  let disp = 0, uso = 0, man = 0;
  Object.values(agrupar(data)).forEach(g => {
    disp += Math.max(0, g.estoque - g.uso - g.manut);
    uso += g.uso;
    man += g.manut;
  });
  if (meuGraficoStatus) meuGraficoStatus.destroy();
  meuGraficoStatus = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: [`Disponível (${disp})`, `Em Uso (${uso})`, `Manutenção (${man})`],
      datasets: [{ data: [disp, uso, man], backgroundColor: ["#28a745", "#002b5c", "#fd7e14"] }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        title: { display: true, text: `Proporção por Quantidade (Total: ${disp + uso + man} peças)` }
      }
    }
  });
}

/* ---------- Inventário ---------- */
function processarEExibirDados(data) {
  dadosInventarioGlobal = data;
  data.sort((a, b) =>
    low(a.nome).localeCompare(low(b.nome)) ||
    low(a.marca).localeCompare(low(b.marca)) ||
    low(a.modelo).localeCompare(low(b.modelo)));

  const tbody = el("inventory-body");
  tbody.innerHTML = "";
  const grupos = agrupar(data);
  let temCritico = false;

  data.forEach(item => {
    if (!low(item.nome)) return;
    const g = grupos[chaveDe(item)];
    const critico = g.estoque - g.uso - g.manut <= 5;
    if (critico) temCritico = true;

    const tr = document.createElement("tr");
    if (critico) tr.classList.add("linha-critica");
    tr.innerHTML = `
      <td>${esc(item.nome)} ${critico ? '<span class="badge-critico">Crítico</span>' : ""}</td>
      <td>${esc(item.marca)}</td>
      <td>${esc(item.modelo)}</td>
      <td>${esc(item.quantidade || "0")}</td>
      <td>${esc(g.estoque || "0")}</td>
      <td>${esc(item.status)}</td>
      <td>${esc(item.responsavel)}</td>
      <td>${esc(formatarDataExibicao(item.data))}</td>
      <td>${esc(formatarHoraExibicao(item.hora))}</td>
      <td class="col-acoes">
        <button class="btn-editar" data-acao="editar" data-id="${esc(item.id)}">Editar</button>
        <button class="btn-remover" data-acao="remover" data-id="${esc(item.id)}">Remover</button>
      </td>`;
    tbody.appendChild(tr);
  });

  const alerta = el("alerta-estoque");
  if (alerta) {
    alerta.style.display = temCritico ? "block" : "none";
    if (temCritico) alerta.innerHTML = "⚠️ <strong>Atenção! Existem produtos com o estoque disponível no limite crítico.</strong>";
  }

  filtrarTabela();
  if (el("chart-modal").style.display === "flex") atualizarDashboard(dadosInventarioGlobal);
}

async function carregarItens() {
  try {
    const data = await listar("inventario");
    if (!Array.isArray(data)) return console.error("Dados inválidos:", data);
    processarEExibirDados(data);
  } catch (err) {
    if (err.message !== "sessao") console.error("Erro ao carregar inventário:", err);
  }
}

function prepararEdicao(id) {
  const item = dadosInventarioGlobal.find(i => String(i.id) === String(id));
  if (!item) return;
  const g = agrupar(dadosInventarioGlobal)[chaveDe(item)];
  itemEmEdicao = {
    nome: String(item.nome ?? "").trim(),
    marca: String(item.marca ?? "").trim(),
    modelo: String(item.modelo ?? "").trim(),
    quantidade: String(item.quantidade ?? "0").trim(),
    quantidade_estoque: String(g ? g.estoque : "0"),
    status: String(item.status ?? "").trim(),
    responsavel: String(item.responsavel ?? "").trim()
  };
  el("item-id").value = id;
  Object.keys(itemEmEdicao).forEach(k => { el(k).value = itemEmEdicao[k]; });

  const btn = el("btn-submit");
  btn.textContent = "Atualizar";
  btn.style.backgroundColor = "#ffc107";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function salvarItem(event) {
  if (event) event.preventDefault();
  const v = id => el(id).value.trim();
  const idExistente = v("item-id");
  const campos = {
    nome: v("nome"), marca: v("marca"), modelo: v("modelo"), quantidade: v("quantidade"),
    quantidade_estoque: v("quantidade_estoque"), status: v("status"), responsavel: v("responsavel")
  };

  // Bloqueia se (em uso + manutenção) passar do estoque total do grupo
  const chaveGrupo = chaveDe(campos);
  const simulado = dadosInventarioGlobal
    .filter(i => String(i.id) !== String(idExistente))
    .map(i => ({ ...i }))
    .concat([{ ...campos }]);
  simulado.forEach(i => {
    if (chaveDe(i) === chaveGrupo) i.quantidade_estoque = campos.quantidade_estoque;
  });
  const gSim = agrupar(simulado)[chaveGrupo];
  if (gSim && gSim.uso + gSim.manut > gSim.estoque) {
    alert(`Não foi possível salvar: há ${gSim.uso + gSim.manut} unidade(s) em uso ou manutenção, mas o estoque total é ${gSim.estoque}. Ajuste a quantidade ou o estoque.`);
    return;
  }

  const antigo = itemEmEdicao;
  const agora = new Date();
  const registro = {
    id: idExistente || novoId(),
    ...campos,
    data: agora.toLocaleDateString("pt-BR"),
    hora: agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  };
  resetarFormulario();

  // Atualiza a tela na hora (otimista) e propaga o estoque para o grupo todo
  if (idExistente) {
    const idx = dadosInventarioGlobal.findIndex(i => String(i.id) === String(idExistente));
    if (idx !== -1) Object.assign(dadosInventarioGlobal[idx], registro);
  } else {
    dadosInventarioGlobal.unshift({ ...registro });
  }
  dadosInventarioGlobal.forEach(i => {
    if (chaveDe(i) === chaveDe(campos)) i.quantidade_estoque = campos.quantidade_estoque;
  });
  processarEExibirDados(dadosInventarioGlobal);

  try {
    const r = await api({ action: idExistente ? "UPDATE" : "ADD", sheet: "inventario", id: registro.id, data: registro });
    if (r.erro) throw new Error(r.erro);
    await api({ action: "ESTOQUE_GRUPO", nome: campos.nome, marca: campos.marca, modelo: campos.modelo, estoque: campos.quantidade_estoque });

    if (idExistente) {
      const rotulos = { nome: "Nome", marca: "Marca", modelo: "Modelo", quantidade: "Qtd", quantidade_estoque: "Estoque", status: "Status", responsavel: "Resp" };
      const alt = antigo
        ? Object.keys(rotulos).filter(k => String(antigo[k]) !== campos[k]).map(k => `${rotulos[k]}: ${antigo[k]} ➔ ${campos[k]}`)
        : [];
      registrarHistorico("ALTERAÇÃO", campos.nome, campos.modelo, alt.length ? alt.join(" | ") : "Item atualizado");
    } else {
      registrarHistorico("ADICIONOU", campos.nome, campos.modelo, `Qtd Inicial: ${campos.quantidade}, Estoque: ${campos.quantidade_estoque}, Status: ${campos.status}`);
    }
  } catch (err) {
    if (err.message !== "sessao") alert("Erro ao salvar no servidor. Os dados serão recarregados.");
  }
  carregarItens();
}

function removerItem(id) {
  const item = dadosInventarioGlobal.find(i => String(i.id) === String(id));
  if (!item) return;
  itemParaDeletarTemp = { id, nomeItem: item.nome, modeloItem: item.modelo };
  el("delete-modal-subtitle").textContent = `Insira a palavra-passe para remover o item "${item.nome}".`;
  el("delete-pwd-field").value = "";
  mostrar("delete-modal");
  el("delete-pwd-field").focus();
}

function fecharModalDelecao() {
  esconder("delete-modal");
  itemParaDeletarTemp = null;
}

async function confirmarRemocaoModal(event) {
  if (event) event.preventDefault();
  if (!itemParaDeletarTemp) return;
  const senhaRemocao = el("delete-pwd-field").value;
  const { id, nomeItem, modeloItem } = itemParaDeletarTemp;
  try {
    const r = await api({ action: "DELETE", sheet: "inventario", id, senhaRemocao });
    if (r.erro === "senha_incorreta") {
      alert("Palavra-passe incorreta! O item não foi removido.");
      el("delete-pwd-field").value = "";
      return;
    }
    if (r.erro) throw new Error(r.erro);
    fecharModalDelecao();
    dadosInventarioGlobal = dadosInventarioGlobal.filter(i => String(i.id) !== String(id));
    processarEExibirDados(dadosInventarioGlobal);
    registrarHistorico("REMOVEU", nomeItem, modeloItem, "Item removido do inventário");
    alert(`O item "${nomeItem}" foi removido com sucesso.`);
  } catch (err) {
    if (err.message !== "sessao") alert("Erro ao remover o item.");
  }
}

function resetarFormulario() {
  el("inventory-form").reset();
  el("item-id").value = "";
  itemEmEdicao = null;
  const btn = el("btn-submit");
  btn.textContent = "Adicionar";
  btn.style.backgroundColor = "#28a745";
}

/* ---------- Histórico ---------- */
async function registrarHistorico(acao, nomeItem, modeloItem, detalhes) {
  const agora = new Date();
  try {
    await api({
      action: "ADD", sheet: "historico",
      data: {
        id: novoId(), acao, item: nomeItem, modelo: modeloItem || "", detalhes,
        data: agora.toLocaleDateString("pt-BR"),
        hora: agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      }
    });
    carregarHistorico();
  } catch (err) {
    if (err.message !== "sessao") console.error("Erro ao gravar histórico:", err);
  }
}

async function carregarHistorico() {
  try {
    const dados = await listar("historico");
    const tbody = el("history-body");
    tbody.innerHTML = "";
    if (Array.isArray(dados)) {
      dados.reverse().forEach(h => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${esc(formatarDataExibicao(h.data))} ${esc(formatarHoraExibicao(h.hora))}</td>
          <td><strong>${esc(h.usuario)}</strong></td>
          <td>${esc(h.acao)}</td>
          <td>${esc(h.item)}</td>
          <td>${esc(h.modelo)}</td>
          <td>${esc(h.detalhes)}</td>`;
        tbody.appendChild(tr);
      });
    }
    filtrarHistorico();
  } catch (err) {
    if (err.message !== "sessao") console.error("Erro ao carregar histórico:", err);
  }
}

/* ---------- Paginação ---------- */
const PAG = {
  inv: { corpo: "inventory-body", pagina: 1, tam: 25, sig: "" },
  hist: { corpo: "history-body", pagina: 1, tam: 25, sig: "" }
};

(function () {
  const estilo = document.createElement("style");
  estilo.textContent = "@media print{.paginacao{display:none!important}}";
  document.head.appendChild(estilo);
})();

function garantirPaginador(tipo) {
  let div = el(`pager-${tipo}`);
  if (div) return div;
  div = document.createElement("div");
  div.id = `pager-${tipo}`;
  div.className = "paginacao";
  div.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;font-size:0.9em;color:#495057;";
  div.innerHTML = `
    <span class="pag-info"></span>
    <span style="display:flex;align-items:center;gap:8px;">
      <label>Linhas: <select class="pag-tam"><option>10</option><option selected>25</option><option>50</option><option>100</option></select></label>
      <button type="button" class="pag-ant" style="padding:6px 12px;cursor:pointer;">Anterior</button>
      <span class="pag-num"></span>
      <button type="button" class="pag-prox" style="padding:6px 12px;cursor:pointer;">Próxima</button>
    </span>`;
  el(PAG[tipo].corpo).closest(".table-responsive").after(div);
  div.querySelector(".pag-ant").addEventListener("click", () => { PAG[tipo].pagina--; paginar(tipo); });
  div.querySelector(".pag-prox").addEventListener("click", () => { PAG[tipo].pagina++; paginar(tipo); });
  div.querySelector(".pag-tam").addEventListener("change", e => {
    PAG[tipo].tam = parseInt(e.target.value);
    PAG[tipo].pagina = 1;
    paginar(tipo);
  });
  return div;
}

// Mostra só as linhas da página atual (entre as que passaram no filtro)
function paginar(tipo) {
  const p = PAG[tipo];
  const linhas = Array.from(el(p.corpo).rows);
  const aprovadas = linhas.filter(tr => tr.dataset.filtrado !== "1");
  const total = aprovadas.length;
  const paginas = Math.max(1, Math.ceil(total / p.tam));
  p.pagina = Math.min(Math.max(1, p.pagina), paginas);
  const ini = (p.pagina - 1) * p.tam;
  const fim = ini + p.tam;

  linhas.forEach(tr => { tr.style.display = "none"; });
  aprovadas.slice(ini, fim).forEach(tr => { tr.style.display = ""; });

  const div = garantirPaginador(tipo);
  div.querySelector(".pag-info").textContent = total
    ? `Mostrando ${ini + 1} a ${Math.min(fim, total)} de ${total}`
    : "Nenhum registro";
  div.querySelector(".pag-num").textContent = `Página ${p.pagina} de ${paginas}`;
  div.querySelector(".pag-ant").disabled = p.pagina <= 1;
  div.querySelector(".pag-prox").disabled = p.pagina >= paginas;
}

// Na impressão do navegador, mostra todas as linhas filtradas
window.addEventListener("beforeprint", () => {
  Object.values(PAG).forEach(p => {
    Array.from(el(p.corpo).rows).forEach(tr => { tr.style.display = tr.dataset.filtrado === "1" ? "none" : ""; });
  });
});
window.addEventListener("afterprint", () => { paginar("inv"); paginar("hist"); });

/* ---------- Filtros ---------- */
function filtrarTabela() {
  const input = el("search-input");
  if (!input) return;
  const termo = norm(input.value);
  const p = PAG.inv;
  if (p.sig !== termo) { p.sig = termo; p.pagina = 1; } // filtro mudou: volta para a página 1
  Array.from(el("inventory-body").rows).forEach(tr => {
    tr.dataset.filtrado = norm(tr.textContent).includes(termo) ? "" : "1";
  });
  paginar("inv");
}

function filtrarHistorico() {
  const termo = norm(el("search-history-input")?.value);
  const ini = el("filtro-data-inicio")?.value || "";
  const fim = el("filtro-data-fim")?.value || "";
  const p = PAG.hist;
  const sig = `${termo}|${ini}|${fim}`;
  if (p.sig !== sig) { p.sig = sig; p.pagina = 1; }

  Array.from(el("history-body").rows).forEach(tr => {
    const cols = tr.cells;
    if (!cols.length) return;
    let okData = true;
    if (ini || fim) {
      const d = cols[0].textContent.trim().split(" ")[0].split("/");
      if (d.length === 3) {
        const iso = `${d[2]}-${d[1]}-${d[0]}`;
        if ((ini && iso < ini) || (fim && iso > fim)) okData = false;
      }
    }
    tr.dataset.filtrado = norm(tr.textContent).includes(termo) && okData ? "" : "1";
  });
  paginar("hist");
}

/* ---------- Exportação ---------- */
function exportarExcel() {
  const inv = el("visao-inventario").style.display !== "none";
  const tbody = el(inv ? "inventory-body" : "history-body");
  const dados = [inv
    ? ["Nome", "Marca", "Modelo", "Quantidade", "Estoque Total", "Status", "Responsável", "Data", "Hora"]
    : ["Data/Hora", "Utilizador", "Ação", "Item", "Modelo", "Detalhes"]];

  Array.from(tbody.rows).forEach(tr => {
    if (tr.dataset.filtrado === "1") return;
    const cols = Array.from(tr.cells).slice(0, inv ? -1 : undefined);
    dados.push(cols.map(td => td.textContent.replace("Crítico", "").trim()));
  });

  const ws = XLSX.utils.aoa_to_sheet(dados);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, inv ? "Inventário" : "Histórico");
  XLSX.writeFile(wb, `${inv ? "Inventario" : "Historico"}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportarPDF() {
  // Se a biblioteca de PDF não carregou, usa a impressão do navegador
  if (!window.jspdf) { window.print(); return; }

  const inv = el("visao-inventario").style.display !== "none";
  const tbody = el(inv ? "inventory-body" : "history-body");
  const cabecalho = inv
    ? ["Nome", "Marca", "Modelo", "Qtd", "Estoque Total", "Status", "Responsável", "Data", "Hora"]
    : ["Data/Hora", "Utilizador", "Ação", "Item", "Modelo", "Detalhes"];

  const corpo = [];
  const criticos = [];
  Array.from(tbody.rows).forEach(tr => {
    if (tr.dataset.filtrado === "1") return;
    const cols = Array.from(tr.cells).slice(0, inv ? -1 : undefined);
    corpo.push(cols.map(td => td.textContent.replace("Crítico", "").replace(/➔/g, "->").trim()));
    criticos.push(tr.classList.contains("linha-critica"));
  });

  if (!corpo.length) {
    alert("Não há dados para exportar com os filtros atuais.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const agora = new Date();
  const geradoEm = `${agora.toLocaleDateString("pt-BR")} ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const titulo = inv ? "Inventário de Equipamentos" : "Histórico de Movimentações";

  doc.autoTable({
    head: [cabecalho],
    body: corpo,
    startY: 28,
    margin: { top: 28, left: 10, right: 10, bottom: 14 },
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [0, 43, 92], textColor: 255 },
    didParseCell: d => {
      if (inv && d.section === "body" && criticos[d.row.index]) {
        d.cell.styles.fillColor = [248, 215, 218];
        d.cell.styles.textColor = [132, 32, 41];
      }
    },
    didDrawPage: d => {
      const largura = doc.internal.pageSize.getWidth();
      const altura = doc.internal.pageSize.getHeight();
      doc.setTextColor(0, 43, 92);
      doc.setFontSize(15);
      doc.text("THALES Information Systems", 10, 13);
      doc.setFontSize(11);
      doc.setTextColor(60);
      doc.text(titulo, 10, 20);
      doc.setFontSize(9);
      doc.text(`Gerado em ${geradoEm} por ${usuarioAtual ? usuarioAtual.nome : "-"}`, largura - 10, 13, { align: "right" });
      doc.text(`Total de registros: ${corpo.length}`, largura - 10, 20, { align: "right" });
      doc.setDrawColor(0, 43, 92);
      doc.line(10, 23, largura - 10, 23);
      doc.setFontSize(8);
      doc.text(`Página ${doc.internal.getNumberOfPages()}`, largura / 2, altura - 6, { align: "center" });
    }
  });

  doc.save(`${inv ? "Inventario" : "Historico"}_${agora.toISOString().slice(0, 10)}.pdf`);
}

/* ---------- Eventos ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  el("search-input")?.addEventListener("input", filtrarTabela);
  el("search-history-input")?.addEventListener("input", filtrarHistorico);

  // Botões Editar/Remover (sem onclick inline, sem risco de quebrar com aspas)
  el("inventory-body").addEventListener("click", e => {
    const btn = e.target.closest("button[data-acao]");
    if (!btn) return;
    if (btn.dataset.acao === "editar") prepararEdicao(btn.dataset.id);
    else if (btn.dataset.acao === "remover") removerItem(btn.dataset.id);
  });

  // Enter no campo de senha faz login
  el("pwd-field")?.addEventListener("keydown", e => { if (e.key === "Enter") tentarLoginDireto(); });

  // Restaura o login salvo, se ainda for válido
  try {
    const salvo = JSON.parse(sessionStorage.getItem("thales_sessao") || "null");
    if (salvo && salvo.token) {
      const res = await fetch(`${GAS_URL}?sheet=inventario&token=${encodeURIComponent(salvo.token)}`);
      const r = await res.json();
      if (Array.isArray(r)) {
        token = salvo.token;
        usuarioAtual = { nome: salvo.nome };
        iniciarSessao();
      } else {
        sessionStorage.removeItem("thales_sessao");
      }
    }
  } catch (err) {
    sessionStorage.removeItem("thales_sessao");
  }
});