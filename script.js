/**
 * ============================================================================
 * THALES Information Systems - Sistema de Inventário (front-end)
 * ============================================================================
 * Este arquivo controla toda a interface: login, inventário, histórico,
 * gráfico e exportações. Os dados ficam em uma planilha Google, acessada
 * pelo Google Apps Script (ver apps-script/Code.gs).
 *
 * Organização do arquivo:
 *   1. Configuração e estado global
 *   2. Utilitários
 *   3. Comunicação com o servidor
 *   4. Autenticação (login, código de segurança, primeiro acesso, logout)
 *   5. Abas e gráfico
 *   6. Inventário (listagem, cadastro, edição, remoção)
 *   7. Histórico de movimentações
 *   8. Filtros de busca
 *   9. Exportação (Excel e PDF)
 *  10. Eventos da página
 * ============================================================================
 */
 
/* ==========================================================================
 * 1. CONFIGURAÇÃO E ESTADO GLOBAL
 * ========================================================================== */
 
/** URL da implantação (Web App) do Google Apps Script. */
const GAS_URL = "https://script.google.com/macros/s/AKfycbxAvmBtLUPQpeiJepc6xYhB-2vH60TnJUBnmVDtgaQcIBj124BpYSB3sH6bu3zRY6ubjA/exec";
 
/** Token de sessão devolvido pelo servidor no login. Vai em toda requisição. */
let token = null;
 
/** Dados do utilizador logado ({ nome }). */
let usuarioAtual = null;
 
/** Cópia do item antes da edição; usada para listar o que mudou no histórico. */
let itemEmEdicao = null;
 
/** Instância atual do gráfico Chart.js (destruída antes de redesenhar). */
let meuGraficoStatus = null;
 
/** Cópia local do inventário; evita novas requisições a cada filtro/edição. */
let dadosInventarioGlobal = [];
 
/** Item que aguarda a confirmação da senha no modal de remoção. */
let itemParaDeletarTemp = null;
 
/* ==========================================================================
 * 2. UTILITÁRIOS
 * ========================================================================== */
 
/**
 * Escapa caracteres especiais de HTML. Todo texto vindo da planilha passa por
 * aqui antes de ir para a tela, impedindo que alguém injete scripts (XSS).
 * @param {*} s Valor a ser escapado.
 * @returns {string} Texto seguro para uso em innerHTML.
 */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
 
/** Texto sem espaços nas pontas e em minúsculas (comparações de nomes). */
const low = s => String(s || "").trim().toLowerCase();
 
/** Igual a low(), mas também remove acentos (buscas e status). */
const norm = s => low(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
 
/**
 * Chave que identifica um "grupo" de equipamento (nome + marca + modelo).
 * Linhas com a mesma chave compartilham o mesmo Estoque Total.
 */
const chaveDe = i => `${low(i.nome)}_${low(i.marca)}_${low(i.modelo)}`;
 
/** Gera um ID curto e praticamente único (data/hora + sufixo aleatório). */
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
 
/** Atalho para document.getElementById. */
const el = id => document.getElementById(id);
 
/** Abre um modal (usa flex para centralizar). */
const mostrar = id => { el(id).style.display = "flex"; };
 
/** Fecha um modal. */
const esconder = id => { el(id).style.display = "none"; };
 
/**
 * Converte datas ISO vindas da planilha (2026-10-23T03:00:00.000Z)
 * para o formato brasileiro dd/mm/aaaa. Textos que não são ISO ficam como estão.
 * @param {*} valor Valor da coluna "data".
 * @returns {string}
 */
function formatarDataExibicao(valor) {
  const str = String(valor || "");
  if (str.includes("T")) {
    const p = str.split("T")[0].split("-");
    if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
  }
  return str;
}
 
/**
 * Extrai HH:MM de horas ISO vindas da planilha. Textos que não são ISO
 * (ex.: "12:43") ficam como estão.
 * @param {*} valor Valor da coluna "hora".
 * @returns {string}
 */
function formatarHoraExibicao(valor) {
  const str = String(valor || "");
  if (str.includes("T")) {
    const p = str.split("T")[1];
    if (p) return p.substring(0, 5);
  }
  return str;
}
 
/* ==========================================================================
 * 3. COMUNICAÇÃO COM O SERVIDOR
 * ========================================================================== */
 
/**
 * Envia um comando ao servidor (POST). O token é anexado automaticamente.
 * Se o servidor responder "nao_autorizado" (sessão vencida), o utilizador é
 * deslogado e a função lança o erro "sessao" para interromper o fluxo.
 *
 * O Content-Type "text/plain" é proposital: evita a requisição de
 * pré-verificação (CORS preflight), que o Apps Script não suporta.
 *
 * @param {Object} payload Dados da requisição (deve conter "action").
 * @returns {Promise<Object>} Resposta JSON do servidor.
 */
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
 
/**
 * Lê todas as linhas de uma planilha (GET). Só aceita "inventario" e
 * "historico"; a lista de utilizadores nunca é enviada ao navegador.
 * @param {string} sheet Nome da aba da planilha.
 * @returns {Promise<Array|Object>} Lista de registros (ou objeto com "erro").
 */
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
 
/* ==========================================================================
 * 4. AUTENTICAÇÃO
 * Fluxo normal:      Login -> Sistema.
 * Fluxo 1º acesso:   Login -> Código de segurança -> Definir credenciais -> Sistema.
 * ========================================================================== */
 
/**
 * Envia utilizador e senha ao servidor. Em caso de sucesso, guarda o token e
 * segue para o sistema ou para o código de segurança (primeiro acesso).
 */
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
 
/**
 * Valida o código de segurança do primeiro acesso (conferido no servidor).
 * Se estiver correto, abre o modal para criar o utilizador e a senha.
 * @param {Event} event Evento de envio do formulário.
 */
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
 
/**
 * Salva o novo utilizador e a nova senha definidos no primeiro acesso.
 * O servidor guarda a senha criptografada (hash) e rejeita nomes repetidos.
 * @param {Event} event Evento de envio do formulário.
 */
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
 
/** Mostra o sistema, exibe o nome do utilizador e carrega os dados. */
function iniciarSessao() {
  ["login-modal", "security-code-modal", "first-access-modal"].forEach(esconder);
  el("app-container").style.display = "block";
  el("logged-user-name").textContent = usuarioAtual.nome;
  el("logged-user-role").textContent = "Administrador";
  carregarItens();
  carregarHistorico();
}
 
/**
 * Encerra a sessão: apaga token e dados da memória e da tela e volta ao login.
 * Também é chamada automaticamente quando a sessão expira.
 */
function logout() {
  token = null;
  usuarioAtual = null;
  dadosInventarioGlobal = [];
  el("inventory-body").innerHTML = "";
  el("history-body").innerHTML = "";
  el("app-container").style.display = "none";
  esconder("security-code-modal");
  esconder("first-access-modal");
  mostrar("login-modal");
  ["usr-field", "pwd-field", "sec-code-field", "new-usr-field", "new-pwd-field"]
    .forEach(id => { el(id).value = ""; });
}
 
/* ==========================================================================
 * 5. ABAS E GRÁFICO
 * ========================================================================== */
 
/**
 * Alterna entre as abas "Inventário" e "Histórico".
 * Ao abrir o histórico, a lista é recarregada do servidor.
 * @param {"inventario"|"historico"} aba Aba que deve ficar visível.
 */
function mudarAba(aba) {
  const inv = aba === "inventario";
  el("visao-inventario").style.display = inv ? "block" : "none";
  el("visao-historico").style.display = inv ? "none" : "block";
  el("tab-inv-btn").classList.toggle("active", inv);
  el("tab-hist-btn").classList.toggle("active", !inv);
  if (!inv) carregarHistorico();
}
 
/** Abre o modal do gráfico e o desenha com os dados atuais. */
function abrirModalGrafico() {
  mostrar("chart-modal");
  atualizarDashboard(dadosInventarioGlobal);
}
 
/** Fecha o modal do gráfico. */
function fecharModalGrafico() {
  esconder("chart-modal");
}
 
/**
 * Agrupa o inventário por equipamento (nome + marca + modelo) e calcula,
 * para cada grupo:
 *   - estoque: maior "Estoque Total" encontrado nas linhas do grupo;
 *   - uso:     soma das quantidades com status diferente de Disponível/Manutenção;
 *   - manut:   soma das quantidades com status Manutenção.
 * Linhas "Disponível" não contam como ocupadas.
 * Esta função é a base do alerta de estoque crítico e do gráfico.
 *
 * @param {Array<Object>} data Linhas do inventário.
 * @returns {Object} Mapa { chaveDoGrupo: { estoque, uso, manut } }.
 */
function agrupar(data) {
  const g = {};
 
  data.forEach(item => {
    if (!low(item.nome)) return; // ignora linhas sem nome
 
    const x = (g[chaveDe(item)] ||= { estoque: 0, uso: 0, manut: 0 });
    const q = parseInt(item.quantidade) || 0;
    const st = norm(item.status);
 
    x.estoque = Math.max(x.estoque, parseInt(item.quantidade_estoque) || 0);
    if (st.includes("manutencao")) x.manut += q;
    else if (!st.includes("disponivel")) x.uso += q;
  });
 
  return g;
}
 
/**
 * Desenha o gráfico de rosca (Disponível / Em Uso / Manutenção).
 * Disponível = Estoque Total - (Em Uso + Manutenção), nunca menor que zero.
 * @param {Array<Object>} data Linhas do inventário.
 */
function atualizarDashboard(data) {
  const ctx = el("statusChart");
  if (!ctx) return;
 
  let disp = 0, uso = 0, man = 0;
  Object.values(agrupar(data)).forEach(g => {
    disp += Math.max(0, g.estoque - g.uso - g.manut);
    uso += g.uso;
    man += g.manut;
  });
 
  // Um canvas só aceita um gráfico por vez: destrói o anterior.
  if (meuGraficoStatus) meuGraficoStatus.destroy();
 
  meuGraficoStatus = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: [`Disponível (${disp})`, `Em Uso (${uso})`, `Manutenção (${man})`],
      datasets: [{
        data: [disp, uso, man],
        backgroundColor: ["#28a745", "#002b5c", "#fd7e14"]
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        title: {
          display: true,
          text: `Proporção por Quantidade (Total: ${disp + uso + man} peças)`
        }
      }
    }
  });
}
 
/* ==========================================================================
 * 6. INVENTÁRIO
 * ========================================================================== */
 
/**
 * Ordena os dados, monta a tabela, marca itens críticos, atualiza o alerta
 * geral e reaplica a busca. É chamada sempre que o inventário muda.
 * Regra: um equipamento é CRÍTICO quando (Estoque Total - Em Uso - Manutenção) <= 5.
 *
 * @param {Array<Object>} data Linhas do inventário (ordenadas no local).
 */
function processarEExibirDados(data) {
  dadosInventarioGlobal = data;
 
  // Ordem alfabética: nome, depois marca, depois modelo.
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
 
    // Os botões usam data-id (tratado em "Eventos da página") em vez de
    // onclick, para que nomes com aspas não quebrem o HTML.
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
 
  // Aviso geral no topo da tela.
  const alerta = el("alerta-estoque");
  if (alerta) {
    alerta.style.display = temCritico ? "block" : "none";
    if (temCritico) {
      alerta.innerHTML = "⚠️ <strong>Atenção! Existem produtos com o estoque disponível no limite crítico.</strong>";
    }
  }
 
  filtrarTabela();
 
  // Se o gráfico estiver aberto, mantém-no sincronizado.
  if (el("chart-modal").style.display === "flex") atualizarDashboard(dadosInventarioGlobal);
}
 
/** Busca o inventário no servidor e atualiza a tela. */
async function carregarItens() {
  try {
    const data = await listar("inventario");
    if (!Array.isArray(data)) return console.error("Dados inválidos:", data);
    processarEExibirDados(data);
  } catch (err) {
    if (err.message !== "sessao") console.error("Erro ao carregar inventário:", err);
  }
}
 
/**
 * Carrega um item no formulário para edição e muda o botão para "Atualizar".
 * O "Estoque Total" exibido é o do grupo (igual ao mostrado na tabela).
 * @param {string} id ID do item a editar.
 */
function prepararEdicao(id) {
  const item = dadosInventarioGlobal.find(i => String(i.id) === String(id));
  if (!item) return;
 
  const g = agrupar(dadosInventarioGlobal)[chaveDe(item)];
 
  // Guarda o estado original para comparar ao salvar (histórico de alterações).
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
  // As chaves de itemEmEdicao têm o mesmo nome dos campos do formulário.
  Object.keys(itemEmEdicao).forEach(k => { el(k).value = itemEmEdicao[k]; });
 
  const btn = el("btn-submit");
  btn.textContent = "Atualizar";
  btn.style.backgroundColor = "#ffc107";
  window.scrollTo({ top: 0, behavior: "smooth" });
}
 
/**
 * Cadastra um item novo ou atualiza um existente (se "item-id" estiver preenchido).
 *
 * Passos:
 *   1. Lê o formulário e monta o registro.
 *   2. Atualiza a tela imediatamente (atualização otimista).
 *   3. Envia ao servidor e propaga o Estoque Total para todo o grupo.
 *   4. Registra a ação no histórico.
 *   5. Recarrega os dados do servidor (corrige a tela se algo falhou).
 *
 * @param {Event} event Evento de envio do formulário.
 */
async function salvarItem(event) {
  if (event) event.preventDefault();
 
  const v = id => el(id).value.trim();
  const idExistente = v("item-id");
  const campos = {
    nome: v("nome"),
    marca: v("marca"),
    modelo: v("modelo"),
    quantidade: v("quantidade"),
    quantidade_estoque: v("quantidade_estoque"),
    status: v("status"),
    responsavel: v("responsavel")
  };
  const antigo = itemEmEdicao;
  const agora = new Date();
  const registro = {
    id: idExistente || novoId(),
    ...campos,
    data: agora.toLocaleDateString("pt-BR"),
    hora: agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  };
 
  resetarFormulario();
 
  // Passo 2: atualização otimista da tela.
  if (idExistente) {
    const idx = dadosInventarioGlobal.findIndex(i => String(i.id) === String(idExistente));
    if (idx !== -1) Object.assign(dadosInventarioGlobal[idx], registro);
  } else {
    dadosInventarioGlobal.unshift({ ...registro });
  }
  // Todas as linhas do mesmo equipamento passam a ter o mesmo Estoque Total.
  dadosInventarioGlobal.forEach(i => {
    if (chaveDe(i) === chaveDe(campos)) i.quantidade_estoque = campos.quantidade_estoque;
  });
  processarEExibirDados(dadosInventarioGlobal);
 
  // Passos 3 e 4: servidor + histórico.
  try {
    const r = await api({
      action: idExistente ? "UPDATE" : "ADD",
      sheet: "inventario",
      id: registro.id,
      data: registro
    });
    if (r.erro) throw new Error(r.erro);
 
    await api({
      action: "ESTOQUE_GRUPO",
      nome: campos.nome,
      marca: campos.marca,
      modelo: campos.modelo,
      estoque: campos.quantidade_estoque
    });
 
    if (idExistente) {
      // Lista apenas os campos que mudaram, ex.: "Estoque: 30 ➔ 50".
      const rotulos = {
        nome: "Nome", marca: "Marca", modelo: "Modelo", quantidade: "Qtd",
        quantidade_estoque: "Estoque", status: "Status", responsavel: "Resp"
      };
      const alt = antigo
        ? Object.keys(rotulos)
            .filter(k => String(antigo[k]) !== campos[k])
            .map(k => `${rotulos[k]}: ${antigo[k]} ➔ ${campos[k]}`)
        : [];
      registrarHistorico("ALTERAÇÃO", campos.nome, campos.modelo, alt.length ? alt.join(" | ") : "Item atualizado");
    } else {
      registrarHistorico(
        "ADICIONOU", campos.nome, campos.modelo,
        `Qtd Inicial: ${campos.quantidade}, Estoque: ${campos.quantidade_estoque}, Status: ${campos.status}`
      );
    }
  } catch (err) {
    if (err.message !== "sessao") alert("Erro ao salvar no servidor. Os dados serão recarregados.");
  }
 
  // Passo 5.
  carregarItens();
}
 
/**
 * Abre o modal que pede a senha de remoção.
 * @param {string} id ID do item a remover.
 */
function removerItem(id) {
  const item = dadosInventarioGlobal.find(i => String(i.id) === String(id));
  if (!item) return;
 
  itemParaDeletarTemp = { id, nomeItem: item.nome, modeloItem: item.modelo };
  el("delete-modal-subtitle").textContent = `Insira a palavra-passe para remover o item "${item.nome}".`;
  el("delete-pwd-field").value = "";
  mostrar("delete-modal");
  el("delete-pwd-field").focus();
}
 
/** Cancela a remoção e fecha o modal de confirmação. */
function fecharModalDelecao() {
  esconder("delete-modal");
  itemParaDeletarTemp = null;
}
 
/**
 * Envia a senha de remoção ao servidor. Só se ela estiver correta o item é
 * apagado da planilha e da tela, e a ação é registrada no histórico.
 * @param {Event} event Evento de envio do formulário.
 */
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
 
/** Limpa o formulário e devolve o botão ao estado "Adicionar". */
function resetarFormulario() {
  el("inventory-form").reset();
  el("item-id").value = "";
  itemEmEdicao = null;
 
  const btn = el("btn-submit");
  btn.textContent = "Adicionar";
  btn.style.backgroundColor = "#28a745";
}
 
/* ==========================================================================
 * 7. HISTÓRICO DE MOVIMENTAÇÕES
 * ========================================================================== */
 
/**
 * Grava uma ação (ADICIONOU, ALTERAÇÃO ou REMOVEU) no histórico.
 * O nome do utilizador NÃO é enviado: o servidor o define pela sessão,
 * impedindo falsificação.
 *
 * @param {string} acao       Tipo da ação.
 * @param {string} nomeItem   Nome do equipamento.
 * @param {string} modeloItem Modelo do equipamento.
 * @param {string} detalhes   Descrição do que aconteceu/mudou.
 */
async function registrarHistorico(acao, nomeItem, modeloItem, detalhes) {
  const agora = new Date();
 
  try {
    await api({
      action: "ADD",
      sheet: "historico",
      data: {
        id: novoId(),
        acao,
        item: nomeItem,
        modelo: modeloItem || "",
        detalhes,
        data: agora.toLocaleDateString("pt-BR"),
        hora: agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      }
    });
    carregarHistorico();
  } catch (err) {
    if (err.message !== "sessao") console.error("Erro ao gravar histórico:", err);
  }
}
 
/** Busca o histórico no servidor e monta a tabela (mais recentes primeiro). */
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
 
/* ==========================================================================
 * 8. FILTROS DE BUSCA
 * Os filtros só escondem linhas (display: none); nada é apagado.
 * As exportações respeitam o que está visível.
 * ========================================================================== */
 
/** Filtra o inventário pelo texto digitado (qualquer coluna, sem acentos). */
function filtrarTabela() {
  const input = el("search-input");
  if (!input) return;
 
  const termo = norm(input.value);
  Array.from(el("inventory-body").rows).forEach(tr => {
    tr.style.display = norm(tr.textContent).includes(termo) ? "" : "none";
  });
}
 
/**
 * Filtra o histórico por texto e por período (De/Até). As datas da tabela
 * (dd/mm/aaaa) são convertidas para aaaa-mm-dd para comparar com os campos
 * de data do navegador.
 */
function filtrarHistorico() {
  const termo = norm(el("search-history-input")?.value);
  const ini = el("filtro-data-inicio")?.value || "";
  const fim = el("filtro-data-fim")?.value || "";
 
  Array.from(el("history-body").rows).forEach(tr => {
    const cols = tr.cells;
    if (!cols.length) return;
 
    let okData = true;
    if (ini || fim) {
      const p = cols[0].textContent.trim().split(" ")[0].split("/");
      if (p.length === 3) {
        const iso = `${p[2]}-${p[1]}-${p[0]}`;
        if ((ini && iso < ini) || (fim && iso > fim)) okData = false;
      }
    }
 
    tr.style.display = norm(tr.textContent).includes(termo) && okData ? "" : "none";
  });
}
 
/* ==========================================================================
 * 9. EXPORTAÇÃO
 * ========================================================================== */
 
/**
 * Exporta para Excel a tabela da aba aberta (Inventário ou Histórico),
 * apenas com as linhas visíveis (respeita busca e filtros).
 * No inventário, a coluna "Ações" não é exportada.
 */
function exportarExcel() {
  const inv = el("visao-inventario").style.display !== "none";
  const tbody = el(inv ? "inventory-body" : "history-body");
 
  const dados = [inv
    ? ["Nome", "Marca", "Modelo", "Quantidade", "Estoque Total", "Status", "Responsável", "Data", "Hora"]
    : ["Data/Hora", "Utilizador", "Ação", "Item", "Modelo", "Detalhes"]];
 
  Array.from(tbody.rows).forEach(tr => {
    if (tr.style.display === "none") return;
    const cols = Array.from(tr.cells).slice(0, inv ? -1 : undefined);
    dados.push(cols.map(td => td.textContent.replace("Crítico", "").trim()));
  });
 
  const ws = XLSX.utils.aoa_to_sheet(dados);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, inv ? "Inventário" : "Histórico");
  XLSX.writeFile(wb, `${inv ? "Inventario" : "Historico"}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
 
/** Abre a impressão do navegador (o CSS de impressão monta o layout do PDF). */
function exportarPDF() {
  window.print();
}
 
/* ==========================================================================
 * 10. EVENTOS DA PÁGINA
 * ========================================================================== */
 
document.addEventListener("DOMContentLoaded", () => {
  // Busca em tempo real enquanto o utilizador digita.
  el("search-input")?.addEventListener("input", filtrarTabela);
  el("search-history-input")?.addEventListener("input", filtrarHistorico);
 
  // Um único "ouvinte" na tabela trata todos os botões Editar/Remover,
  // inclusive os de linhas criadas depois (delegação de eventos).
  el("inventory-body").addEventListener("click", e => {
    const btn = e.target.closest("button[data-acao]");
    if (!btn) return;
 
    if (btn.dataset.acao === "editar") prepararEdicao(btn.dataset.id);
    else if (btn.dataset.acao === "remover") removerItem(btn.dataset.id);
  });
 
  // Tecla Enter no campo de senha equivale a clicar em "Entrar".
  el("pwd-field")?.addEventListener("keydown", e => {
    if (e.key === "Enter") tentarLoginDireto();
  });
});
 
