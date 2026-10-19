'use strict';

/* =========================================================================
   CONFIGURAÇÃO
   ========================================================================= */
const CONFIG = {
  proxy: 'api/tse',                              // função da Vercel; '' = acessar o TSE direto do navegador
  dados: 'data',                                 // arquivos já baixados e versionados no GitHub
  base: 'https://resultados.tse.jus.br/oficial', // usado no modo direto
  pollSegundos: 60,                              // atualização do 2º turno
  paralelo: 6,                                   // requisições simultâneas
};

// Códigos publicados pelo TSE (página "Informações técnicas sobre a divulgação de resultados")
const ELEICOES = {
  atual:    { ano: 2026, ciclo: 'ele2026', fed: [6257, 6258], est: [6259, 6260], fmt: 'u' },
  anterior: { ano: 2022, ciclo: 'ele2022', fed: [544, 545],  est: [546, 547],  fmt: 'r' },
};

const CARGOS = { 1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Deputado federal', 7: 'Deputado estadual', 8: 'Deputado distrital' };
const PROPORCIONAIS = new Set([6, 7, 8]);

const REGIOES = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];

// df = cadeiras na Câmara (mantidas para 2026 por decisão do STF). pos = posição no cartograma.
const UFS = [
  ['AC', 'Acre', 'Norte', 8, 0, 2], ['AL', 'Alagoas', 'Nordeste', 9, 5, 3],
  ['AM', 'Amazonas', 'Norte', 8, 1, 1], ['AP', 'Amapá', 'Norte', 8, 3, 0],
  ['BA', 'Bahia', 'Nordeste', 39, 3, 3], ['CE', 'Ceará', 'Nordeste', 22, 4, 1],
  ['DF', 'Distrito Federal', 'Centro-Oeste', 8, 2, 4], ['ES', 'Espírito Santo', 'Sudeste', 10, 4, 4],
  ['GO', 'Goiás', 'Centro-Oeste', 17, 2, 3], ['MA', 'Maranhão', 'Nordeste', 18, 3, 1],
  ['MG', 'Minas Gerais', 'Sudeste', 53, 3, 4], ['MS', 'Mato Grosso do Sul', 'Centro-Oeste', 8, 1, 4],
  ['MT', 'Mato Grosso', 'Centro-Oeste', 8, 1, 3], ['PA', 'Pará', 'Norte', 17, 2, 1],
  ['PB', 'Paraíba', 'Nordeste', 12, 5, 2], ['PE', 'Pernambuco', 'Nordeste', 25, 4, 2],
  ['PI', 'Piauí', 'Nordeste', 10, 3, 2], ['PR', 'Paraná', 'Sul', 30, 1, 5],
  ['RJ', 'Rio de Janeiro', 'Sudeste', 46, 3, 5], ['RN', 'Rio Grande do Norte', 'Nordeste', 8, 5, 1],
  ['RO', 'Rondônia', 'Norte', 8, 1, 2], ['RR', 'Roraima', 'Norte', 8, 2, 0],
  ['RS', 'Rio Grande do Sul', 'Sul', 31, 1, 7], ['SC', 'Santa Catarina', 'Sul', 16, 1, 6],
  ['SE', 'Sergipe', 'Nordeste', 8, 4, 3], ['SP', 'São Paulo', 'Sudeste', 70, 2, 5],
  ['TO', 'Tocantins', 'Norte', 8, 2, 2],
].map(([sg, nm, rg, df, x, y]) => ({ sg, nm, rg, df, x, y, de: sg === 'DF' ? 24 : (df <= 12 ? df * 3 : 36 + df - 12) }));
const UF = Object.fromEntries(UFS.map(u => [u.sg, u]));
const EXTERIOR = { sg: 'ZZ', nm: 'Exterior', x: 5, y: 7 };

/* =========================================================================
   UTILITÁRIOS
   ========================================================================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, l) => String(n).padStart(l, '0');
const fN = n => Math.round(n || 0).toLocaleString('pt-BR');
const fP = (n, d = 2) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
const fD = (n, d = 2, suf = ' p.p.', neutro = false) => {
  if (n == null || isNaN(n)) return '—';
  const s = (n > 0 ? '+' : '') + n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + suf;
  return neutro ? s : `<span class="${n > 0 ? 'delta-pos' : n < 0 ? 'delta-neg' : ''}">${s}</span>`;
};
const fDi = n => (n == null ? '—' : `<span class="${n > 0 ? 'delta-pos' : n < 0 ? 'delta-neg' : ''}">${n > 0 ? '+' : ''}${n}</span>`);

function num(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  return parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0;
}

const PALETA = ['#009739', '#012169', '#E0B800', '#2F6FD6', '#00612A', '#8A6D00', '#4FAE6E', '#5B7BC7',
  '#9BCF5A', '#1E3F7A', '#C99A00', '#7FB9E6', '#2E7D5B', '#A9B7D6', '#D9C46A', '#5F6F8F'];
const cores = new Map();
function cor(chave) {
  if (!chave || chave === '—') return '#9AA5B1';
  if (!cores.has(chave)) cores.set(chave, cores.size < PALETA.length ? PALETA[cores.size] : '#9AA5B1');
  return cores.get(chave);
}
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function misturar(h, alfa) { // mistura com branco
  const [r, g, b] = hexRgb(h); const m = c => Math.round(c * alfa + 255 * (1 - alfa));
  return '#' + [m(r), m(g), m(b)].map(c => pad(c.toString(16), 2)).join('');
}
function textoSobre(h) { const [r, g, b] = hexRgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0c1f46' : '#ffffff'; }

/* =========================================================================
   ACESSO AOS ARQUIVOS DO TSE
   ========================================================================= */
const memoria = new Map();     // caminho -> { t, dados | erro, prom }
let MANIFESTO = new Set();     // caminhos disponíveis em data/ (gerado pelo GitHub Actions)
const registro = [];           // diagnóstico

function registrar(caminho, status, origem) {
  registro.unshift({ h: new Date().toLocaleTimeString('pt-BR'), caminho, status, origem });
  if (registro.length > 80) registro.pop();
}

async function obterJSON(caminho, ttlMs) {
  const agora = Date.now();
  const c = memoria.get(caminho);
  if (c?.prom) return c.prom;
  if (c && agora - c.t < (c.erro ? 10 * 60e3 : ttlMs)) { if (c.erro) throw c.erro; return c.dados; }

  const local = MANIFESTO.has(caminho);
  const origem = local ? 'github' : CONFIG.proxy ? 'vercel' : 'direto';
  const url = local ? `${CONFIG.dados}/${caminho}`
    : CONFIG.proxy ? `${CONFIG.proxy}?p=${encodeURIComponent(caminho)}` : `${CONFIG.base}/${caminho}`;
  const prom = (async () => {
    let res;
    try { res = await fetch(url, { cache: 'no-store' }); }
    catch (e) {
      registrar(caminho, 'falha de rede', origem);
      const err = new Error('Não foi possível acessar o TSE.'); err.tipo = 'rede'; throw err;
    }
    registrar(caminho, res.status, origem + (res.headers.get('X-Cache') ? ' ' + res.headers.get('X-Cache') : ''));
    if (res.status === 404 || res.status === 403) {
      const err = new Error('Arquivo ainda não publicado.'); err.tipo = '404';
      memoria.set(caminho, { t: Date.now(), erro: err }); throw err;
    }
    if (!res.ok) { const err = new Error(`TSE respondeu HTTP ${res.status}.`); err.tipo = 'http'; throw err; }
    const dados = await res.json();
    memoria.set(caminho, { t: Date.now(), dados });
    return dados;
  })();
  memoria.set(caminho, { ...(c || {}), prom });
  try { return await prom; }
  finally { const atual = memoria.get(caminho); if (atual?.prom === prom) delete atual.prom; if (atual && !atual.t) memoria.delete(caminho); }
}

const eleicaoDe = (ed, cargo, turno) => (cargo === 1 ? ed.fed : ed.est)[turno - 1];

function caminhoResultado(ed, cargo, turno, abr, mun = '', fmt = ed.fmt) {
  const ele = eleicaoDe(ed, cargo, turno);
  const a = abr.toLowerCase();
  const nome = `${a}${mun}-c${pad(cargo, 4)}-e${pad(ele, 6)}`;
  return fmt === 'r'
    ? `${ed.ciclo}/${ele}/dados-simplificados/${a}/${nome}-r.json`
    : `${ed.ciclo}/${ele}/dados/${a}/${nome}-u.json`;
}

function ttlDe(ed, turno) {
  if (ed === ELEICOES.anterior) return 6 * 3600e3;
  return turno === 2 ? 40e3 : 10 * 60e3;
}

// 2022 foi publicado no formato antigo (-r.json). Testa uma vez qual formato responde.
let sondagem2022 = null;
function sondarFormato(ed) {
  if (ed !== ELEICOES.anterior) return Promise.resolve();
  if (!sondagem2022) {
    sondagem2022 = obterJSON(caminhoResultado(ed, 1, 1, 'BR', '', 'r'), ttlDe(ed, 1))
      .then(() => { ed.fmt = 'r'; })
      .catch(() => obterJSON(caminhoResultado(ed, 1, 1, 'BR', '', 'u'), ttlDe(ed, 1)).then(() => { ed.fmt = 'u'; }))
      .catch(() => { ed.indisponivel = true; });
  }
  return sondagem2022;
}

async function carregarResultado(ed, cargo, turno, abr, mun = '') {
  if (abr === 'DF' && cargo === 7) cargo = 8;
  await sondarFormato(ed);
  if (ed.indisponivel) { const e = new Error('Dados de 2022 indisponíveis.'); e.tipo = '404'; throw e; }
  const bruto = await obterJSON(caminhoResultado(ed, cargo, turno, abr, mun), ttlDe(ed, turno));
  return normalizar(bruto, { abr, mun, cargo, turno, ano: ed.ano });
}

async function lote(itens, fn, aoProgredir) {
  const saida = new Array(itens.length); let i = 0, feitos = 0;
  async function trabalhador() {
    while (i < itens.length) {
      const k = i++;
      try { saida[k] = await fn(itens[k], k); } catch { saida[k] = null; }
      feitos++; aoProgredir && aoProgredir(feitos, itens.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONFIG.paralelo, itens.length) }, trabalhador));
  return saida;
}

/* =========================================================================
   NORMALIZAÇÃO (formato unificado 2024/2026 e formato simplificado 2022)
   ========================================================================= */
function partidoDaColigacao(cc) {
  // 2022: "PL - PL / PP / REPUBLICANOS" ou "FE BRASIL(PT/PC do B/PV) - ..." — usa a 1ª sigla reconhecível
  if (!cc) return '—';
  const esquerda = cc.split(' - ')[0].trim();
  if (esquerda && esquerda.length <= 14 && !/\s{2,}/.test(esquerda)) return esquerda;
  const m = cc.match(/\b([A-Z][A-Za-z ]{1,12}?)\b(?=\s*[\/(]|$)/);
  return m ? m[1].trim() : esquerda || '—';
}

function candidato(c, partido, agrupamento) {
  const st = c.st || '';
  return {
    nome: c.nmu || c.nm || '',
    nomeCompleto: c.nm || '',
    numero: String(c.n ?? ''),
    partido: partido || '—',
    agr: agrupamento || '',
    votos: num(c.vap),
    pct: num(c.pvap),
    st,
    eleito: c.e === 's' || (/^eleito/i.test(st)),
    segundo: /2\s*[ºo°]?\s*turno/i.test(st),
    valido: !c.dvt || /v[aá]lido/i.test(c.dvt),
  };
}

function normalizar(raw, meta) {
  const r = { ...meta, cands: [], vagas: 0 };
  if (raw && Array.isArray(raw.carg)) {
    const s = raw.s || {}, e = raw.e || {}, v = raw.v || {};
    Object.assign(r, {
      secTot: num(s.ts), secTotz: num(s.st), pst: num(s.pst),
      eleitorado: num(e.te ?? e.qt ?? e.e), comp: num(e.c), pcomp: num(e.pc), abst: num(e.a), pabst: num(e.pa),
      vv: num(v.vv), vb: num(v.vb), pvb: num(v.pvb), vn: num(v.tvn ?? v.vn), pvn: num(v.ptvn ?? v.pvn),
      final: raw.tf === 's' || raw.and === 'f',
      hora: [raw.dt || raw.dg, raw.ht || raw.hg].filter(Boolean).join(' '),
    });
    for (const cg of raw.carg) {
      r.vagas = num(cg.vag) || r.vagas;
      for (const ag of cg.agr || []) {
        const nomeAgr = ag.nm || ag.nmf || ag.sg || '';
        for (const p of ag.par || []) for (const c of p.cand || []) r.cands.push(candidato(c, p.sg, nomeAgr));
      }
    }
  } else if (raw && Array.isArray(raw.cand)) {
    Object.assign(r, {
      secTot: num(raw.s), secTotz: num(raw.st), pst: num(raw.pst),
      eleitorado: num(raw.e), comp: num(raw.c), pcomp: num(raw.pc), abst: num(raw.a), pabst: num(raw.pa),
      vv: num(raw.vv), vb: num(raw.vb), pvb: num(raw.pvb), vn: num(raw.tvn ?? raw.vn), pvn: num(raw.ptvn ?? raw.pvn),
      final: raw.tf === 's' || raw.and === 'f' || num(raw.pst) >= 100,
      hora: [raw.dg, raw.hg].filter(Boolean).join(' '),
    });
    for (const c of raw.cand) {
      const cc = c.cc || '';
      r.cands.push(candidato(c, partidoDaColigacao(cc), cc.includes(' - ') ? cc.split(' - ').slice(1).join(' - ') : ''));
    }
  } else {
    r.formatoDesconhecido = true;
  }
  const totalValidos = r.vv || r.cands.reduce((a, c) => a + (c.valido ? c.votos : 0), 0);
  for (const c of r.cands) if (!c.pct && totalValidos) c.pct = c.votos / totalValidos * 100;
  if (!r.vv) r.vv = totalValidos;
  r.cands.sort((a, b) => b.votos - a.votos);
  r.vazio = r.secTotz === 0 && r.cands.every(c => c.votos === 0);
  return r;
}

function somarResumos(lista) {
  const ok = lista.filter(Boolean);
  const soma = k => ok.reduce((a, r) => a + (r[k] || 0), 0);
  const r = { secTot: soma('secTot'), secTotz: soma('secTotz'), eleitorado: soma('eleitorado'), comp: soma('comp'),
    abst: soma('abst'), vv: soma('vv'), vb: soma('vb'), vn: soma('vn'), vagas: soma('vagas'),
    final: ok.length > 0 && ok.every(x => x.final), hora: ok.map(x => x.hora).filter(Boolean).sort().pop() || '' };
  r.pst = r.secTot ? r.secTotz / r.secTot * 100 : 0;
  r.pcomp = r.eleitorado ? r.comp / r.eleitorado * 100 : 0;
  r.pabst = r.eleitorado ? r.abst / r.eleitorado * 100 : 0;
  const totalVotos = r.vv + r.vb + r.vn;
  r.pvb = totalVotos ? r.vb / totalVotos * 100 : 0;
  r.pvn = totalVotos ? r.vn / totalVotos * 100 : 0;
  r.vazio = ok.every(x => x.vazio);
  return r;
}

function somarCandidatos(lista) { // mesmo candidato em várias UFs (presidente)
  const m = new Map(); let total = 0;
  for (const r of lista.filter(Boolean)) for (const c of r.cands) {
    const k = c.numero + '|' + c.nome;
    const o = m.get(k) || { ...c, votos: 0 };
    o.votos += c.votos; m.set(k, o); if (c.valido) total += c.votos;
  }
  return [...m.values()].map(c => ({ ...c, pct: total ? c.votos / total * 100 : 0 })).sort((a, b) => b.votos - a.votos);
}

function porPartido(cands, chave = 'partido') {
  const m = new Map(); let total = 0;
  for (const c of cands) {
    const k = c[chave] || '—';
    const o = m.get(k) || { nome: k, votos: 0, cands: 0, eleitos: 0, segundo: 0 };
    if (c.valido) { o.votos += c.votos; total += c.votos; }
    o.cands++; if (c.eleito) o.eleitos++; if (c.segundo) o.segundo++;
    m.set(k, o);
  }
  return [...m.values()].map(o => ({ ...o, pct: total ? o.votos / total * 100 : 0, sucesso: o.cands ? o.eleitos / o.cands * 100 : 0 }))
    .sort((a, b) => b.eleitos - a.eleitos || b.votos - a.votos);
}

const ufsDoEscopo = esc => esc === 'BR' ? UFS : esc.startsWith('R:') ? UFS.filter(u => u.rg === esc.slice(2)) : [UF[esc.slice(3)]];
const nomeEscopo = esc => esc === 'BR' ? 'Brasil' : esc.startsWith('R:') ? `Região ${esc.slice(2)}` : UF[esc.slice(3)].nm;

async function carregarEscopo(ed, cargo, turno, escopo, aoProgredir) {
  const ufs = ufsDoEscopo(escopo);
  let principal = null;
  if (cargo === 1 && escopo === 'BR') principal = await carregarResultado(ed, 1, turno, 'BR').catch(() => null);
  const partes = await lote(ufs, u => carregarResultado(ed, cargo, turno, u.sg), aoProgredir);
  const ok = partes.map((r, i) => r ? { uf: ufs[i].sg, r } : null).filter(Boolean);
  let resumo, cands;
  if (principal) { resumo = principal; cands = principal.cands.map(c => ({ ...c, uf: 'BR' })); }
  else if (ufs.length === 1) { resumo = ok[0]?.r || null; cands = (resumo?.cands || []).map(c => ({ ...c, uf: ufs[0].sg })); }
  else {
    resumo = somarResumos(ok.map(x => x.r));
    cands = cargo === 1 ? somarCandidatos(ok.map(x => x.r)).map(c => ({ ...c, uf: '' }))
      : ok.flatMap(x => x.r.cands.map(c => ({ ...c, uf: x.uf })));
  }
  return { ed, cargo, turno, escopo, ufs, partes: ok, falhas: ufs.length - ok.length, resumo, cands };
}

/* =========================================================================
   COMPONENTES VISUAIS
   ========================================================================= */
function carregandoHTML(msg = 'Buscando dados no TSE', prog) {
  const larg = prog ? `style="width:${(prog[0] / prog[1] * 100).toFixed(1)}%"` : '';
  return `<div class="carregando"><span>${esc(msg)}${prog ? ` (${prog[0]} de ${prog[1]})` : ''}</span>
    <div class="apuracao ${prog ? '' : 'indef'}"><i ${larg}></i></div></div>`;
}
function erroHTML(e) {
  return `<div class="aviso erro"><b>${esc(e.message || 'Erro ao carregar.')}</b>
    ${e.tipo === 'rede' ? ' Verifique se a função /api/tse está publicada na Vercel ou veja a aba Fontes e diagnóstico.' : ''}</div>`;
}

function estadoApuracao(r) {
  if (!r) return '';
  if (r.vazio) return '<span class="selo">Totalização ainda não começou</span>';
  return `<span class="estado">${r.final ? '<span class="selo final">Totalização final</span>' : '<span class="selo parcial">Parcial</span>'}
    <b>${fP(r.pst)}</b> das seções totalizadas${r.hora ? `, atualizado em ${esc(r.hora)}` : ''}</span>`;
}

function indicadoresHTML(r, extra = []) {
  if (!r) return '';
  const itens = [
    ['Seções totalizadas', fP(r.pst), r.secTot ? `${fN(r.secTotz)} de ${fN(r.secTot)}` : ''],
    ['Comparecimento', fP(r.pcomp), fN(r.comp)],
    ['Abstenção', fP(r.pabst), fN(r.abst)],
    ['Votos válidos', fN(r.vv), ''],
    ['Brancos', fP(r.pvb), fN(r.vb)],
    ['Nulos', fP(r.pvn), fN(r.vn)],
    ...extra,
  ];
  return `<dl class="indicadores">${itens.map(([t, v, s]) => `<div><dt>${t}</dt><dd>${v}${s ? `<small>${s}</small>` : ''}</dd></div>`).join('')}</dl>`;
}

function situacao(c) {
  const cls = c.eleito ? 'eleito' : c.segundo ? 'segundo' : /suplente/i.test(c.st) ? 'suplente' : '';
  return `<span class="sit ${cls}">${esc(c.st || (c.eleito ? 'Eleito' : '—'))}</span>`;
}

function barras(itens, { valor = i => i.pct, rotulo = i => fP(i.pct), max } = {}) {
  const m = max ?? Math.max(...itens.map(valor), 0.0001);
  return `<div class="barras">${itens.map(i => `<div class="barra"><span class="rot" title="${esc(i.nome)}">${esc(i.nome)}</span>
    <span class="trilho"><i style="width:${(valor(i) / m * 100).toFixed(2)}%;background:${i.cor || cor(i.nome)}"></i></span>
    <span class="val">${rotulo(i)}</span></div>`).join('')}</div>`;
}

const curto = t => { t = String(t || ''); return t.length > 10 ? t.slice(0, 9) + '.' : t; };
function cartograma(blocos, legenda = []) {
  const T = 62, G = 6, W = 6 * (T + G), H = 8 * (T + G);
  const g = blocos.map(b => {
    const fill = b.fill || 'var(--superficie-2)';
    const tc = b.fill ? textoSobre(b.fill) : 'var(--texto)';
    return `<g tabindex="0" role="button" data-uf="${b.sg}" aria-label="${esc(b.titulo || b.sg)}">
      <title>${esc(b.titulo || b.sg)}</title>
      <rect x="${b.x * (T + G)}" y="${b.y * (T + G)}" width="${T}" height="${T}" rx="7" fill="${fill}" stroke="var(--linha)"/>
      <text class="t1" x="${b.x * (T + G) + T / 2}" y="${b.y * (T + G) + 26}" text-anchor="middle" fill="${tc}">${b.sg}</text>
      <text class="t2" x="${b.x * (T + G) + T / 2}" y="${b.y * (T + G) + 44}" text-anchor="middle" fill="${tc}">${esc(curto(b.sub))}</text></g>`;
  }).join('');
  return `<svg class="cartograma" viewBox="-2 -2 ${W + 4} ${H + 4}" role="group" aria-label="Mapa por estado">${g}</svg>
    ${legenda.length ? `<div class="legenda">${legenda.map(l => `<span><i style="background:${l.cor}"></i>${esc(l.nome)}</span>`).join('')}</div>` : ''}`;
}

function hemiciclo(grupos, total, rotulo = 'cadeiras') {
  const linhas = Math.max(2, Math.round(Math.sqrt(total) / 2));
  const raios = Array.from({ length: linhas }, (_, i) => 0.42 + i * (0.58 / (linhas - 1)));
  const somaR = raios.reduce((a, b) => a + b, 0);
  let porLinha = raios.map(r => Math.round(total * r / somaR));
  porLinha[linhas - 1] += total - porLinha.reduce((a, b) => a + b, 0);
  const pts = [];
  raios.forEach((r, i) => {
    const n = porLinha[i];
    for (let j = 0; j < n; j++) {
      const ang = n === 1 ? Math.PI / 2 : Math.PI * (1 - j / (n - 1));
      pts.push({ ang, r, x: r * Math.cos(ang), y: -r * Math.sin(ang) });
    }
  });
  pts.sort((a, b) => b.ang - a.ang || a.r - b.r);
  const seq = [];
  for (const g of grupos) for (let k = 0; k < g.n; k++) seq.push(g.cor || cor(g.nome));
  const raioPonto = Math.min(0.58 / linhas * 0.42, (Math.PI * 0.42) / (porLinha[0] || 1) * 0.45);
  const circulos = pts.map((p, i) => `<circle cx="${p.x.toFixed(4)}" cy="${p.y.toFixed(4)}" r="${raioPonto.toFixed(4)}" fill="${seq[i] || 'var(--neutro)'}"/>`).join('');
  const preenchidas = Math.min(seq.length, total);
  return `<svg class="hemiciclo" viewBox="-1.06 -1.06 2.12 1.14" role="img" aria-label="${preenchidas} de ${total} ${rotulo}">
    ${circulos}<text class="hemi-total" x="0" y="-0.12" style="font-size:.2px">${preenchidas}</text>
    <text class="hemi-rot" x="0" y="0.02" style="font-size:.065px">de ${total} ${rotulo}</text></svg>`;
}

/* Tabelas com ordenação, “mostrar mais” e exportação CSV (padrão Excel pt-BR) */
const TABELAS = {};
function tabela(id, colunas, linhas, op = {}) {
  linhas.forEach((l, i) => { l.__i = i; });
  TABELAS[id] = { colunas, linhas, ordem: op.ordem || null, dir: op.dir || -1, limite: op.limite || 150, aoClicar: op.aoClicar, classe: op.classe || '' };
  return `<div id="tb-${id}">${tabelaInterna(id)}</div>`;
}
function valorCol(c, l) { return c.v ? c.v(l) : l[c.k]; }
function tabelaInterna(id) {
  const t = TABELAS[id];
  let linhas = t.linhas.slice();
  if (t.ordem) {
    const c = t.colunas.find(c => c.k === t.ordem);
    linhas.sort((a, b) => { const va = valorCol(c, a), vb = valorCol(c, b); return (va > vb ? 1 : va < vb ? -1 : 0) * t.dir; });
  }
  const vis = linhas.slice(0, t.limite);
  return `<div class="tbl-ferr"><span>${fN(linhas.length)} linhas</span><button class="btn" data-csv="${id}">Exportar CSV</button></div>
  <div class="tbl-rolagem"><table class="${t.classe}"><thead><tr>${t.colunas.map(c =>
    `<th class="${c.n ? 'n' : ''}" data-ordenar="${id}|${c.k}" ${t.ordem === c.k ? `aria-sort="${t.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${c.t}</th>`).join('')}</tr></thead>
  <tbody>${vis.map(l => `<tr ${t.aoClicar ? `data-ri="${id}|${l.__i}"` : ''}>${t.colunas.map(c =>
    `<td class="${c.n ? 'n' : ''}">${c.f ? c.f(l) : esc(valorCol(c, l))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  ${linhas.length > t.limite ? `<button class="btn mais" data-mais="${id}">Mostrar mais ${fN(Math.min(300, linhas.length - t.limite))}</button>` : ''}`;
}
function exportarCSV(id) {
  const t = TABELAS[id];
  const fmt = v => typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [t.colunas.map(c => fmt(c.csvT || c.t.replace(/<[^>]+>/g, ''))).join(';'),
    ...t.linhas.map(l => t.colunas.map(c => fmt(c.csv ? c.csv(l) : valorCol(c, l))).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `eleicoes-${id}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function abrirDialogo(titulo, html) { $('#dlg-titulo').textContent = titulo; $('#dlg-corpo').innerHTML = html; $('#dlg').showModal(); }

function colunasCandidatos(comUF) {
  return [
    { k: 'nome', t: 'Candidato', f: c => `<b>${esc(c.nome)}</b> <span class="nota">${esc(c.numero)}</span>` },
    { k: 'partido', t: 'Partido' },
    { k: 'agr', t: 'Federação ou coligação', f: c => `<span class="nota">${esc(c.agr)}</span>` },
    ...(comUF ? [{ k: 'uf', t: 'UF' }] : []),
    { k: 'votos', t: 'Votos', n: 1, f: c => fN(c.votos) },
    { k: 'pct', t: '% válidos', n: 1, f: c => fP(c.pct) },
    { k: 'st', t: 'Situação', f: situacao, v: c => c.st },
  ];
}

/* =========================================================================
   ESTADO E NAVEGAÇÃO
   ========================================================================= */
const S = { aba: 'aovivo', cargo: 1, escopo: 'BR', sub: 'candidatos', partido: '', busca: '',
  cmpCargo: 1, cmpEscopo: 'BR', cmpTurno: 1, bancada: 'camara', ufAsm: 'MG' };
let geracao = 0, timerPoll = null;

function opcoesEscopo(sel) {
  return `<option value="BR" ${sel === 'BR' ? 'selected' : ''}>Brasil</option>
    <optgroup label="Regiões">${REGIOES.map(r => `<option value="R:${r}" ${sel === 'R:' + r ? 'selected' : ''}>${r}</option>`).join('')}</optgroup>
    <optgroup label="Estados">${UFS.slice().sort((a, b) => a.nm.localeCompare(b.nm)).map(u => `<option value="UF:${u.sg}" ${sel === 'UF:' + u.sg ? 'selected' : ''}>${u.nm}</option>`).join('')}</optgroup>`;
}
function opcoesCargo(sel) {
  return [1, 3, 5, 6, 7].map(c => `<option value="${c}" ${+sel === c ? 'selected' : ''}>${c === 7 ? 'Deputado estadual ou distrital' : CARGOS[c]}</option>`).join('');
}

async function rotear() {
  const minha = ++geracao;
  clearInterval(timerPoll); timerPoll = null;
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === S.aba)));
  const el = $('#view');
  el.innerHTML = carregandoHTML();
  const obsoleto = () => minha !== geracao;
  try { await TELAS[S.aba](el, obsoleto); }
  catch (e) { if (!obsoleto()) el.innerHTML = erroHTML(e); console.error(e); }
}

/* =========================================================================
   TELA: 2º TURNO AO VIVO
   ========================================================================= */
async function telaAoVivo(el, obsoleto) {
  el.innerHTML = `<section class="placar bloco" id="vivo-pres">${carregandoHTML('Buscando o 2º turno para presidente')}</section>
    <section class="bloco" id="vivo-mapa"></section>
    <section class="bloco" id="vivo-gov"></section>
    <p class="nota">Esta página consulta o TSE a cada ${CONFIG.pollSegundos} segundos enquanto estiver aberta.</p>`;
  await atualizarAoVivo(obsoleto);
  if (!obsoleto()) timerPoll = setInterval(() => atualizarAoVivo(obsoleto).catch(console.error), CONFIG.pollSegundos * 1000);
}

function placar(r, titulo) {
  const [a, b] = r.cands.slice(0, 2).sort((x, y) => +x.numero - +y.numero);
  const total = (a?.votos || 0) + (b?.votos || 0);
  const pa = r.vazio ? 0 : (a?.pct || 0), pb = r.vazio ? 0 : (b?.pct || 0);
  const lado = (c, cls, p) => `<div class="lado ${cls}">
      <span class="meta">${esc(c.partido)} ${esc(c.numero)}</span>
      <span class="nome">${esc(c.nome)}</span>
      <span class="pct">${r.vazio ? '—' : fP(p, 2)}</span>
      <span class="meta">${r.vazio ? 'aguardando votos' : fN(c.votos) + ' votos'} ${c.eleito ? '<span class="eleito">Eleito</span>' : ''}</span></div>`;
  return `<div class="placar-topo"><h2>${esc(titulo)}</h2>${estadoApuracao(r)}</div>
    <div class="duelo">${a ? lado(a, 'a', pa) : ''}${b ? lado(b, 'b', pb) : ''}</div>
    <div class="cabo" aria-hidden="true"><i class="a" style="width:${pa}%"></i><i class="b" style="width:${pb}%"></i></div>
    <div class="apuracao" title="Seções totalizadas"><i style="width:${r.pst}%"></i></div>
    ${indicadoresHTML(r, total && !r.vazio ? [['Diferença', fN(Math.abs(a.votos - b.votos)), 'votos']] : [])}`;
}

async function atualizarAoVivo(obsoleto) {
  const ed = ELEICOES.atual;
  const br2 = await carregarResultado(ed, 1, 2, 'BR').catch(() => null);
  if (obsoleto()) return;
  const elPres = $('#vivo-pres'), elMapa = $('#vivo-mapa');

  if (br2 && br2.cands.length >= 2) {
    elPres.innerHTML = placar(br2, 'Presidente, 2º turno');
    const [a, b] = br2.cands.slice(0, 2).sort((x, y) => +x.numero - +y.numero);
    const corDe = c => c.numero === a.numero ? '#009739' : '#012169';
    const ufs = await lote([...UFS, EXTERIOR], u => carregarResultado(ed, 1, 2, u.sg));
    if (obsoleto()) return;
    const blocos = [...UFS, EXTERIOR].map((u, i) => {
      const r = ufs[i]; const lider = r && !r.vazio ? r.cands[0] : null;
      const margem = lider && r.cands[1] ? lider.pct - r.cands[1].pct : 0;
      return { ...u, fill: lider ? misturar(corDe(lider), Math.min(1, 0.35 + margem / 25)) : null,
        sub: lider ? fP(lider.pct, 1) : '—', titulo: `${u.nm}: ${lider ? `${lider.nome} ${fP(lider.pct)} com ${fP(r.pst, 1)} apurado` : 'sem dados'}` };
    });
    if (!$('#vivo-cart')) {
      elMapa.innerHTML = `<h3>Quem lidera em cada estado</h3><div class="mapa-wrap"><div><div id="vivo-cart"></div>
        <p class="nota">Cor mais forte indica vantagem maior. Clique em um estado para ver os números e os municípios.</p></div>
        <div id="vivo-uf"><p class="nota">Selecione um estado no mapa.</p></div></div>`;
    }
    $('#vivo-cart').innerHTML = cartograma(blocos, [{ nome: a.nome, cor: '#009739' }, { nome: b.nome, cor: '#012169' }]);
  } else {
    const br1 = await carregarResultado(ed, 1, 1, 'BR').catch(() => null);
    if (obsoleto()) return;
    const eleito = br1?.cands.find(c => c.eleito);
    elPres.innerHTML = `<h2>Presidente</h2><p class="nota">${eleito
      ? `Não há 2º turno para presidente: ${esc(eleito.nome)} (${esc(eleito.partido)}) foi eleito no 1º turno com ${fP(eleito.pct)} dos votos válidos.`
      : 'O arquivo do 2º turno para presidente ainda não foi publicado pelo TSE.'}</p>`;
    elMapa.innerHTML = '';
  }

  // Governadores: descobre pelo 1º turno quais estados têm 2º turno (evita requisições 404)
  const gov1 = await lote(UFS, u => carregarResultado(ed, 3, 1, u.sg));
  if (obsoleto()) return;
  const comSegundo = UFS.filter((u, i) => gov1[i]?.cands.some(c => c.segundo));
  const gov2 = await lote(comSegundo, u => carregarResultado(ed, 3, 2, u.sg));
  if (obsoleto()) return;
  const eleitos1 = UFS.map((u, i) => ({ u, c: gov1[i]?.cands.find(c => c.eleito) })).filter(x => x.c);

  $('#vivo-gov').innerHTML = `<h3>Governadores em 2º turno (${comSegundo.length} estados)</h3>
    ${comSegundo.length ? `<div class="cartoes">${comSegundo.map((u, i) => cartaoGov(u, gov2[i], gov1[UFS.indexOf(u)])).join('')}</div>` : '<p class="nota">Nenhum estado com 2º turno identificado.</p>'}
    ${eleitos1.length ? `<h3>Eleitos no 1º turno (${eleitos1.length})</h3><p class="nota">${eleitos1.map(x => `${x.u.sg}: ${esc(x.c.nome)} (${esc(x.c.partido)})`).join('; ')}.</p>` : ''}`;
}

function cartaoGov(u, r2, r1) {
  const base = r2 && r2.cands.length ? r2 : null;
  const cands = base ? base.cands.slice(0, 2) : (r1?.cands.filter(c => c.segundo) || []);
  const cs = ['#009739', '#012169'];
  const st = !base ? '<span class="selo">Aguardando</span>' : base.vazio ? '<span class="selo">Não começou</span>'
    : `<span class="selo ${base.final ? 'final' : 'parcial'}">${base.final ? 'Final' : fP(base.pst, 1) + ' apurado'}</span>`;
  return `<article class="cartao"><header><strong>${u.nm}</strong>${st}</header>
    ${cands.map((c, i) => `<div class="linha-cand"><span><b>${esc(c.nome)}</b> <span class="nota">${esc(c.partido)}</span>${c.eleito ? ' <span class="sit eleito">Eleito</span>' : ''}</span>
      <span>${base && !base.vazio ? fP(c.pct) : '—'}</span><span class="trilho"><i style="width:${base && !base.vazio ? c.pct : 0}%;background:${cs[i]}"></i></span></div>`).join('')}
    <p class="nota" style="margin:8px 0 0">${base && !base.vazio ? `${fN(base.cands[0]?.votos)} × ${fN(base.cands[1]?.votos)} votos` : ''}</p></article>`;
}

async function detalheUF(sg, cargo, turno, alvo) {
  const ed = ELEICOES.atual;
  alvo.innerHTML = carregandoHTML(`Carregando ${UF[sg]?.nm || 'Exterior'}`);
  const r = await carregarResultado(ed, cargo, turno, sg).catch(e => ({ erro: e }));
  if (r.erro) { alvo.innerHTML = erroHTML(r.erro); return; }
  alvo.innerHTML = `<h3 style="margin-top:0">${UF[sg]?.nm || 'Exterior'}</h3>${estadoApuracao(r)}
    ${barras(r.cands.slice(0, 6).map(c => ({ nome: c.nome, pct: c.pct, cor: cor(c.partido) })))}
    ${indicadoresHTML(r)}
    ${sg !== 'ZZ' ? `<div id="mun-${sg}"></div>` : ''}`;
  if (sg !== 'ZZ') painelMunicipios($(`#mun-${sg}`), ed, cargo, turno, sg);
}

/* =========================================================================
   MUNICÍPIOS (carregamento sob demanda)
   ========================================================================= */
async function listaMunicipios(ed, cargo, turno, uf) {
  const ele = eleicaoDe(ed, cargo === 8 ? 7 : cargo, turno);
  const cfg = await obterJSON(`${ed.ciclo}/${ele}/config/mun-e${pad(ele, 6)}-cm.json`, 6 * 3600e3);
  const abr = (cfg.abr || []).find(a => String(a.cd).toUpperCase() === uf);
  return (abr?.mu || []).map(m => ({ cd: pad(m.cd, 5), nm: m.nm }));
}

function painelMunicipios(alvo, ed, cargo, turno, uf) {
  alvo.innerHTML = `<h3>Municípios de ${esc(UF[uf].nm)}</h3>
    <p class="nota">Os resultados por município são carregados um a um. Na primeira vez pode levar alguns minutos em estados grandes; depois o cache do servidor acelera.</p>
    <button class="btn primario" data-carregar-mun>Carregar municípios</button><div class="mun-corpo"></div>`;
  alvo.querySelector('[data-carregar-mun]').addEventListener('click', async ev => {
    const btn = ev.currentTarget; btn.disabled = true;
    const corpo = alvo.querySelector('.mun-corpo');
    corpo.innerHTML = carregandoHTML('Buscando a lista de municípios');
    try {
      const muns = await listaMunicipios(ed, cargo, turno, uf);
      const res = await lote(muns, m => carregarResultado(ed, cargo, turno, uf, m.cd),
        (f, t) => { if (f % 5 === 0 || f === t) corpo.innerHTML = carregandoHTML('Carregando municípios', [f, t]); });
      btn.remove();
      renderMunicipios(corpo, muns, res, cargo, uf);
    } catch (e) { corpo.innerHTML = erroHTML(e); btn.disabled = false; }
  });
}

function renderMunicipios(corpo, muns, res, cargo, uf) {
  const prop = PROPORCIONAIS.has(cargo);
  const linhas = muns.map((m, i) => {
    const r = res[i]; if (!r || r.vazio) return null;
    const [c1, c2] = r.cands;
    const partidoTop = porPartido(r.cands).sort((a, b) => b.votos - a.votos)[0];
    return { nm: m.nm, r, lider: c1?.nome || '—', partido: c1?.partido || '—', pct: c1?.pct || 0,
      seg: c2?.nome || '', pct2: c2?.pct || 0, margem: (c1?.pct || 0) - (c2?.pct || 0),
      partidoTop: partidoTop?.nome || '—', pctPartido: partidoTop?.pct || 0, comp: r.pcomp, eleitorado: r.eleitorado };
  }).filter(Boolean);

  const chave = prop ? 'partidoTop' : 'partido';
  const vitorias = Object.entries(linhas.reduce((a, l) => (a[l[chave]] = (a[l[chave]] || 0) + 1, a), {}))
    .map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n);

  const id = `mun-${uf}-${cargo}`;
  corpo.innerHTML = `<p class="nota">${linhas.length} de ${muns.length} municípios com dados.</p>
    <h3>${prop ? 'Partido mais votado' : 'Partido do candidato mais votado'}: em quantos municípios</h3>
    ${barras(vitorias.slice(0, 12), { valor: v => v.n, rotulo: v => `${v.n} municípios` })}
    <h3>Resultado por município</h3>
    ${tabela(id, [
      { k: 'nm', t: 'Município', f: l => `<b>${esc(l.nm)}</b>` },
      { k: 'lider', t: 'Mais votado' }, { k: 'partido', t: 'Partido' },
      { k: 'pct', t: '%', n: 1, f: l => fP(l.pct) },
      { k: 'seg', t: '2º colocado' }, { k: 'pct2', t: '%', csvT: '% 2º', n: 1, f: l => fP(l.pct2) },
      { k: 'margem', t: 'Margem', n: 1, f: l => fP(l.margem, 1).replace('%', ' p.p.') },
      ...(prop ? [{ k: 'partidoTop', t: 'Partido mais votado' }, { k: 'pctPartido', t: '% partido', n: 1, f: l => fP(l.pctPartido) }] : []),
      { k: 'comp', t: 'Comparecimento', n: 1, f: l => fP(l.comp) },
      { k: 'eleitorado', t: 'Eleitorado', n: 1, f: l => fN(l.eleitorado) },
    ], linhas, { ordem: 'eleitorado', aoClicar: l => abrirDialogo(`${l.nm} (${uf})`, `${estadoApuracao(l.r)}${indicadoresHTML(l.r)}${tabela('dlg-' + id, colunasCandidatos(false), l.r.cands.map(c => ({ ...c })), { limite: 60 })}`) })}`;
}

/* =========================================================================
   TELA: ANÁLISE DO 1º TURNO
   ========================================================================= */
async function telaPrimeiro(el, obsoleto) {
  const ed = ELEICOES.atual;
  const escUF = S.escopo.startsWith('UF:');
  el.innerHTML = `<div class="controles">
      <label class="campo">Cargo<select data-s="cargo">${opcoesCargo(S.cargo)}</select></label>
      <label class="campo">Recorte<select data-s="escopo">${opcoesEscopo(S.escopo)}</select></label>
      <label class="campo">Partido<select data-s="partido" id="sel-partido"><option value="">Todos</option></select></label>
      <label class="campo">Buscar candidato<input type="search" data-s="busca" value="${esc(S.busca)}" placeholder="Nome ou número"></label>
    </div>
    <div class="sub" role="group" aria-label="Visão">${[['candidatos', 'Candidatos'], ['partidos', 'Partidos'], ['federacoes', 'Federações e coligações'],
      ['mapa', 'Mapa por estado'], ['municipios', 'Municípios']].map(([k, t]) => `<button data-sub="${k}" aria-pressed="${S.sub === k}">${t}</button>`).join('')}</div>
    <div id="p-corpo">${carregandoHTML()}</div>`;
  const corpo = $('#p-corpo');

  if (S.sub === 'mapa') {
    const d = await carregarEscopo(ed, S.cargo, 1, 'BR', (f, t) => !obsoleto() && (corpo.innerHTML = carregandoHTML('Carregando estados', [f, t])));
    if (obsoleto()) return;
    preencherPartidos(d.cands);
    corpo.innerHTML = mapaAnalise(d);
    return;
  }
  if (S.sub === 'municipios') {
    if (!escUF) { corpo.innerHTML = '<div class="aviso">Escolha um estado no campo Recorte para ver os municípios.</div>'; return; }
    corpo.innerHTML = '';
    painelMunicipios(corpo, ed, S.cargo, 1, S.escopo.slice(3));
    return;
  }

  const d = await carregarEscopo(ed, S.cargo, 1, S.escopo, (f, t) => !obsoleto() && t > 1 && (corpo.innerHTML = carregandoHTML('Carregando estados', [f, t])));
  if (obsoleto()) return;
  if (!d.resumo) { corpo.innerHTML = '<div class="aviso">O TSE não retornou dados para esse recorte.</div>'; return; }
  preencherPartidos(d.cands);

  let cands = d.cands;
  if (S.partido) cands = cands.filter(c => c.partido === S.partido);
  if (S.busca) { const b = S.busca.toLowerCase(); cands = cands.filter(c => c.nome.toLowerCase().includes(b) || c.numero.includes(b) || c.nomeCompleto.toLowerCase().includes(b)); }

  const vagas = d.resumo.vagas || (S.cargo === 6 ? d.ufs.reduce((a, u) => a + u.df, 0) : S.cargo === 7 ? d.ufs.reduce((a, u) => a + u.de, 0) : 0);
  const topo = `<div class="placar-topo"><h2>${S.cargo === 7 ? 'Deputado estadual ou distrital' : CARGOS[S.cargo]}, ${esc(nomeEscopo(S.escopo))}</h2>${estadoApuracao(d.resumo)}</div>
    ${indicadoresHTML(d.resumo, vagas ? [['Vagas em disputa', fN(vagas), '']] : [])}
    ${d.falhas ? `<div class="aviso">${d.falhas} estado(s) não responderam e ficaram de fora dos totais.</div>` : ''}`;

  if (S.sub === 'candidatos') {
    corpo.innerHTML = topo + tabela('cands', colunasCandidatos(d.ufs.length > 1 && S.cargo !== 1), cands, { ordem: 'votos', limite: 200 });
  } else {
    const chave = S.sub === 'federacoes' ? 'agr' : 'partido';
    const grupos = porPartido(cands, chave);
    const prop = PROPORCIONAIS.has(S.cargo);
    const ordenados = grupos.slice().sort((a, b) => b.votos - a.votos);
    corpo.innerHTML = topo + `<div class="grade-2">
      <div><h3>Votos ${chave === 'agr' ? 'por federação ou coligação' : 'por partido'}</h3>${barras(ordenados.slice(0, 15))}</div>
      <div><h3>${prop ? 'Eleitos' : 'Eleitos e 2º turno'}</h3>${barras(grupos.filter(g => g.eleitos || g.segundo).slice(0, 15),
        { valor: g => g.eleitos + g.segundo, rotulo: g => `${g.eleitos} eleitos${g.segundo ? `, ${g.segundo} no 2º turno` : ''}` }) || '<p class="nota">Nenhum eleito atribuído ainda.</p>'}</div></div>
      <h3>Tabela</h3>${tabela('part-' + chave, [
        { k: 'nome', t: chave === 'agr' ? 'Federação ou coligação' : 'Partido', f: g => `<b>${esc(g.nome)}</b>` },
        { k: 'votos', t: 'Votos', n: 1, f: g => fN(g.votos) }, { k: 'pct', t: '% válidos', n: 1, f: g => fP(g.pct) },
        { k: 'cands', t: 'Candidatos', n: 1 }, { k: 'eleitos', t: 'Eleitos', n: 1 }, ...(prop ? [] : [{ k: 'segundo', t: '2º turno', n: 1 }]),
        { k: 'sucesso', t: 'Taxa de eleição', n: 1, f: g => fP(g.sucesso, 1) },
      ], grupos, { ordem: 'votos' })}
      ${d.partes.length > 1 ? matrizUF(d, chave) : ''}`;
  }
}

function matrizUF(d, chave) {
  const prop = PROPORCIONAIS.has(d.cargo);
  const top = porPartido(d.partes.flatMap(p => p.r.cands), chave).sort((a, b) => b.votos - a.votos).slice(0, 10).map(g => g.nome);
  const linhas = d.partes.map(p => {
    const g = Object.fromEntries(porPartido(p.r.cands, chave).map(x => [x.nome, x]));
    const o = { uf: p.uf };
    top.forEach((n, i) => { o['p' + i] = prop ? (g[n]?.eleitos || 0) : (g[n]?.pct || 0); });
    return o;
  });
  const max = Math.max(...linhas.flatMap(l => top.map((_, i) => l['p' + i])), 1);
  const cel = v => `<span style="display:inline-block;min-width:58px;padding:2px 6px;border-radius:3px;background:${misturar('#009739', Math.max(0.06, v / max))};color:${v / max > 0.55 ? '#fff' : '#0c1f46'}">${prop ? v : fP(v, 1)}</span>`;
  return `<h3>Desempenho por estado (${prop ? 'eleitos' : '% dos votos válidos'})</h3>
    ${tabela('matriz-' + chave, [{ k: 'uf', t: 'UF', f: l => `<b>${l.uf}</b>` }, ...top.map((n, i) => ({ k: 'p' + i, t: esc(n), csvT: n, n: 1, f: l => cel(l['p' + i]) }))],
    linhas, { ordem: 'uf', dir: 1, limite: 30, classe: 'heat' })}`;
}

function mapaAnalise(d) {
  const prop = PROPORCIONAIS.has(d.cargo);
  const porUF = Object.fromEntries(d.partes.map(p => [p.uf, p.r]));
  const blocos = UFS.map(u => {
    const r = porUF[u.sg];
    if (!r || r.vazio) return { ...u, sub: '—', titulo: `${u.nm}: sem dados` };
    if (prop) {
      const g = porPartido(r.cands)[0];
      return { ...u, fill: cor(g.nome), sub: `${g.nome} ${g.eleitos}`, titulo: `${u.nm}: ${g.nome} com ${g.eleitos} eleitos` };
    }
    const c = r.cands[0];
    const k = d.cargo === 1 ? c.nome : c.partido;
    return { ...u, fill: cor(k), sub: d.cargo === 1 ? fP(c.pct, 1) : c.partido, titulo: `${u.nm}: ${c.nome} (${c.partido}) ${fP(c.pct)}` };
  });
  const legenda = [...cores.entries()].filter(([k, v]) => blocos.some(b => b.fill === v)).map(([nome, c]) => ({ nome, cor: c }));
  return `<div class="mapa-wrap"><div>${cartograma(blocos, legenda)}</div>
    <div><h3 style="margin-top:0">${prop ? 'Partido com mais eleitos' : d.cargo === 1 ? 'Candidato mais votado' : 'Partido do mais votado'} em cada estado</h3>
    <p class="nota">Clique em um estado para abrir a análise detalhada dele.</p>
    ${tabela('mapa', [{ k: 'sg', t: 'UF' }, { k: 'nm', t: 'Estado' }, { k: 'rg', t: 'Região' }, { k: 'res', t: 'Resultado', v: l => l.titulo.split(': ')[1] }],
      blocos.map(b => ({ ...b })), { ordem: 'rg', dir: 1, limite: 30 })}</div></div>`;
}

const partidosVistos = new Set();
function preencherPartidos(cands) {
  const sel = $('#sel-partido'); if (!sel) return;
  const lista = [...new Set(cands.map(c => c.partido))].sort();
  sel.innerHTML = `<option value="">Todos</option>${lista.map(p => `<option ${p === S.partido ? 'selected' : ''}>${esc(p)}</option>`).join('')}`;
  lista.forEach(p => partidosVistos.add(p));
}

/* =========================================================================
   TELA: CADEIRAS E BANCADAS
   ========================================================================= */
async function telaBancadas(el, obsoleto) {
  el.innerHTML = `<div class="sub" role="group" aria-label="Casa">${[['camara', 'Câmara dos Deputados'], ['senado', 'Senado'], ['assembleias', 'Assembleias estaduais'], ['governos', 'Governadores']]
    .map(([k, t]) => `<button data-bancada="${k}" aria-pressed="${S.bancada === k}">${t}</button>`).join('')}</div><div id="b-corpo">${carregandoHTML()}</div>`;
  const corpo = $('#b-corpo');
  const prog = msg => (f, t) => !obsoleto() && (corpo.innerHTML = carregandoHTML(msg, [f, t]));
  const A = ELEICOES.atual, P = ELEICOES.anterior;

  if (S.bancada === 'camara') {
    const atual = await lote(UFS, u => carregarResultado(A, 6, 1, u.sg), prog('Carregando bancadas de 2026'));
    const ant = await lote(UFS, u => carregarResultado(P, 6, 1, u.sg).catch(() => null), prog('Carregando bancadas de 2022'));
    if (obsoleto()) return;
    corpo.innerHTML = composicao('camara', 'Câmara dos Deputados', 513, atual, ant, 'cadeiras',
      'A distribuição de 513 cadeiras por estado foi mantida para 2026 por decisão do STF.') + matrizBancadaUF(atual);
  } else if (S.bancada === 'senado') {
    const s26 = await lote(UFS, u => carregarResultado(A, 5, 1, u.sg), prog('Carregando Senado 2026'));
    const s22 = await lote(UFS, u => carregarResultado(P, 5, 1, u.sg).catch(() => null), prog('Carregando Senado 2022'));
    if (obsoleto()) return;
    const conta = lista => porPartido(lista.filter(Boolean).flatMap(r => r.cands.filter(c => c.eleito)));
    const g26 = Object.fromEntries(conta(s26).map(g => [g.nome, g.eleitos]));
    const g22 = Object.fromEntries(conta(s22).map(g => [g.nome, g.eleitos]));
    const nomes = [...new Set([...Object.keys(g26), ...Object.keys(g22)])];
    const linhas = nomes.map(n => ({ nome: n, e26: g26[n] || 0, e22: g22[n] || 0, total: (g26[n] || 0) + (g22[n] || 0) })).sort((a, b) => b.total - a.total);
    const eleitos26 = s26.filter(Boolean).flatMap(r => r.cands.filter(c => c.eleito).map(c => ({ ...c, uf: r.abr })));
    corpo.innerHTML = `<div class="grade-2"><div><h2>Senado a partir de 2027</h2>
      ${hemiciclo(linhas.map(l => ({ nome: l.nome, n: l.total })), 81, 'senadores')}
      <p class="nota">Em 2026 foram renovadas 54 cadeiras (2 por estado). As outras 27 são dos eleitos em 2022, com mandato até 2031, contados pelo partido que tinham na eleição. Trocas de partido posteriores não aparecem nos arquivos do TSE.</p></div>
      <div><h3>Por partido</h3>${tabela('senado', [{ k: 'nome', t: 'Partido', f: l => `<b>${esc(l.nome)}</b>` }, { k: 'e26', t: 'Eleitos em 2026', n: 1 },
        { k: 'e22', t: 'Eleitos em 2022', n: 1 }, { k: 'total', t: 'Total', n: 1 }], linhas, { ordem: 'total' })}</div></div>
      <h3>Senadores eleitos em 2026 (${eleitos26.length} de 54)</h3>${tabela('sen26', colunasCandidatos(true), eleitos26, { ordem: 'uf', dir: 1, limite: 60 })}`;
  } else if (S.bancada === 'assembleias') {
    const uf = S.ufAsm;
    const [r26, r22] = await Promise.all([carregarResultado(A, 7, 1, uf), carregarResultado(P, 7, 1, uf).catch(() => null)]);
    if (obsoleto()) return;
    const sel = `<div class="controles"><label class="campo">Estado<select data-s="ufAsm">${UFS.slice().sort((a, b) => a.nm.localeCompare(b.nm))
      .map(u => `<option value="${u.sg}" ${u.sg === uf ? 'selected' : ''}>${u.nm}</option>`).join('')}</select></label></div>`;
    corpo.innerHTML = sel + composicao('asm-' + uf, uf === 'DF' ? 'Câmara Legislativa do DF' : `Assembleia Legislativa, ${UF[uf].nm}`,
      r26.vagas || UF[uf].de, [r26], [r22], 'cadeiras') +
      `<h3>Deputados eleitos</h3>${tabela('asm-el-' + uf, colunasCandidatos(false), r26.cands.filter(c => c.eleito), { ordem: 'votos', limite: 120 })}`;
  } else {
    const g1 = await lote(UFS, u => carregarResultado(A, 3, 1, u.sg), prog('Carregando governadores'));
    const pend = UFS.filter((u, i) => g1[i] && !g1[i].cands.some(c => c.eleito));
    const g2 = await lote(pend, u => carregarResultado(A, 3, 2, u.sg).catch(() => null));
    const p1 = await lote(UFS, u => carregarResultado(P, 3, 1, u.sg).catch(() => null), prog('Carregando governadores de 2022'));
    const pp = UFS.filter((u, i) => p1[i] && !p1[i].cands.some(c => c.eleito));
    const p2 = await lote(pp, u => carregarResultado(P, 3, 2, u.sg).catch(() => null));
    if (obsoleto()) return;
    const quem = (u, r1, l2, r2s) => {
      const e1 = r1?.cands.find(c => c.eleito); if (e1) return { c: e1, turno: '1º' };
      const k = l2.indexOf(u); const e2 = k >= 0 ? r2s[k]?.cands.find(c => c.eleito) : null;
      return e2 ? { c: e2, turno: '2º' } : null;
    };
    const linhas = UFS.map((u, i) => {
      const a = quem(u, g1[i], pend, g2), b = quem(u, p1[i], pp, p2);
      return { uf: u.sg, nm: u.nm, rg: u.rg, nome: a?.c.nome || 'Em disputa', partido: a?.c.partido || '', turno: a?.turno || '', pct: a?.c.pct || 0,
        nome22: b?.c.nome || '—', partido22: b?.c.partido || '', troca: a && b ? (a.c.partido !== b.c.partido ? 'Sim' : 'Não') : '' };
    });
    const cont = porPartido(linhas.filter(l => l.partido).map(l => ({ partido: l.partido, votos: 1, valido: true, eleito: true })));
    const cont22 = Object.fromEntries(porPartido(linhas.filter(l => l.partido22).map(l => ({ partido: l.partido22, votos: 1, valido: true, eleito: true }))).map(g => [g.nome, g.eleitos]));
    corpo.innerHTML = `<div class="grade-2"><div><h2>Governadores eleitos</h2>${cartograma(UFS.map(u => {
        const l = linhas.find(x => x.uf === u.sg); return { ...u, fill: l.partido ? cor(l.partido) : null, sub: l.partido || 'disputa', titulo: `${u.nm}: ${l.nome} ${l.partido}` };
      }), cont.map(g => ({ nome: g.nome, cor: cor(g.nome) })))}</div>
      <div><h3 style="margin-top:0">Estados governados por partido</h3>${barras(cont.map(g => ({ ...g, n: g.eleitos })), { valor: g => g.n, rotulo: g => `${g.n} (2022: ${cont22[g.nome] || 0})` })}</div></div>
      <h3>Por estado</h3>${tabela('gov', [{ k: 'nm', t: 'Estado', f: l => `<b>${esc(l.nm)}</b>` }, { k: 'nome', t: 'Eleito em 2026' }, { k: 'partido', t: 'Partido' },
        { k: 'turno', t: 'Turno' }, { k: 'pct', t: '%', n: 1, f: l => l.pct ? fP(l.pct) : '' }, { k: 'nome22', t: 'Eleito em 2022' }, { k: 'partido22', t: 'Partido em 2022' },
        { k: 'troca', t: 'Mudou o partido?' }], linhas, { ordem: 'nm', dir: 1, limite: 30 })}`;
  }
}

function composicao(id, titulo, total, atual, anterior, rot, nota = '') {
  const el26 = porPartido(atual.filter(Boolean).flatMap(r => r.cands)).filter(g => g.eleitos);
  const el22 = Object.fromEntries(porPartido(anterior.filter(Boolean).flatMap(r => r.cands)).map(g => [g.nome, g.eleitos]));
  const tem22 = anterior.some(Boolean);
  const totVotos = el26.reduce((a, g) => a + g.votos, 0);
  const linhas = el26.map(g => ({ ...g, ant: el22[g.nome] || 0, delta: g.eleitos - (el22[g.nome] || 0), pctCad: g.eleitos / total * 100 }));
  for (const [n, v] of Object.entries(el22)) if (v && !linhas.find(l => l.nome === n)) linhas.push({ nome: n, eleitos: 0, ant: v, delta: -v, votos: 0, pct: 0, pctCad: 0 });
  const atribuídas = el26.reduce((a, g) => a + g.eleitos, 0);
  return `<div class="grade-2"><div><h2>${esc(titulo)}</h2>${hemiciclo(el26.map(g => ({ nome: g.nome, n: g.eleitos })), total, rot)}
      <div class="legenda">${el26.slice(0, 14).map(g => `<span><i style="background:${cor(g.nome)}"></i>${esc(g.nome)} ${g.eleitos}</span>`).join('')}</div>
      <p class="nota">${atribuídas < total ? `${atribuídas} de ${total} cadeiras já têm eleito atribuído pelo TSE. ` : ''}${esc(nota)}</p></div>
    <div><h3 style="margin-top:0">Bancada por partido${tem22 ? ' e variação desde 2022' : ''}</h3>${tabela(id, [
      { k: 'nome', t: 'Partido', f: g => `<b>${esc(g.nome)}</b>` }, { k: 'eleitos', t: 'Cadeiras', n: 1 },
      { k: 'pctCad', t: '% da casa', n: 1, f: g => fP(g.pctCad, 1) },
      ...(tem22 ? [{ k: 'ant', t: '2022', n: 1 }, { k: 'delta', t: 'Variação', n: 1, f: g => fDi(g.delta) }] : []),
      { k: 'pct', t: '% votos nominais', n: 1, f: g => fP(g.pct) },
    ], linhas, { ordem: 'eleitos', limite: 40 })}</div></div>`;
}

function matrizBancadaUF(atual) {
  const geral = porPartido(atual.filter(Boolean).flatMap(r => r.cands)).filter(g => g.eleitos).slice(0, 10).map(g => g.nome);
  const linhas = UFS.map((u, i) => {
    const g = Object.fromEntries(porPartido(atual[i]?.cands || []).map(x => [x.nome, x.eleitos]));
    const o = { uf: u.sg, vagas: atual[i]?.vagas || u.df };
    geral.forEach((n, k) => { o['p' + k] = g[n] || 0; });
    o.outros = o.vagas - geral.reduce((a, n) => a + (g[n] || 0), 0);
    return o;
  });
  return `<h3>Bancadas por estado</h3>${tabela('camara-uf', [{ k: 'uf', t: 'UF', f: l => `<b>${l.uf}</b>` }, { k: 'vagas', t: 'Vagas', n: 1 },
    ...geral.map((n, k) => ({ k: 'p' + k, t: esc(n), csvT: n, n: 1, f: l => l['p' + k] || '' })), { k: 'outros', t: 'Outros ou a definir', n: 1 }],
    linhas, { ordem: 'vagas', limite: 30 })}`;
}

/* =========================================================================
   TELA: COMPARAR COM 2022
   ========================================================================= */
async function telaComparativo(el, obsoleto) {
  el.innerHTML = `<div class="controles">
      <label class="campo">Cargo<select data-s="cmpCargo">${opcoesCargo(S.cmpCargo)}</select></label>
      <label class="campo">Recorte<select data-s="cmpEscopo">${opcoesEscopo(S.cmpEscopo)}</select></label>
      <label class="campo">Turno<select data-s="cmpTurno"><option value="1" ${S.cmpTurno == 1 ? 'selected' : ''}>1º turno</option>
        <option value="2" ${S.cmpTurno == 2 ? 'selected' : ''} ${[1, 3].includes(+S.cmpCargo) ? '' : 'disabled'}>2º turno</option></select></label>
    </div><div id="c-corpo">${carregandoHTML()}</div>`;
  const corpo = $('#c-corpo');
  const cargo = +S.cmpCargo, turno = [1, 3].includes(cargo) ? +S.cmpTurno : 1;
  const [a, p] = await Promise.all([
    carregarEscopo(ELEICOES.atual, cargo, turno, S.cmpEscopo, (f, t) => !obsoleto() && t > 1 && (corpo.innerHTML = carregandoHTML('Carregando 2026', [f, t]))),
    carregarEscopo(ELEICOES.anterior, cargo, turno, S.cmpEscopo),
  ]);
  if (obsoleto()) return;
  if (!p.resumo || ELEICOES.anterior.indisponivel) {
    corpo.innerHTML = `<div class="aviso">Os arquivos de 2022 não responderam no servidor de divulgação do TSE. Para comparar, use o Portal de Dados Abertos (votação por partido e candidato de 2022) e importe os CSVs.</div>`;
    return;
  }
  if (!a.resumo) { corpo.innerHTML = '<div class="aviso">Sem dados de 2026 para esse recorte e turno.</div>'; return; }

  const ra = a.resumo, rp = p.resumo;
  const metricas = [['Comparecimento', 'pcomp'], ['Abstenção', 'pabst'], ['Brancos', 'pvb'], ['Nulos', 'pvn']]
    .map(([t, k]) => ({ t, v22: rp[k], v26: ra[k], d: ra[k] - rp[k] }));
  const prop = PROPORCIONAIS.has(cargo);
  const ga = Object.fromEntries(porPartido(a.cands).map(g => [g.nome, g]));
  const gp = Object.fromEntries(porPartido(p.cands).map(g => [g.nome, g]));
  const partidos = [...new Set([...Object.keys(ga), ...Object.keys(gp)])].map(n => ({
    nome: n, pct22: gp[n]?.pct || 0, pct26: ga[n]?.pct || 0, dpct: (ga[n]?.pct || 0) - (gp[n]?.pct || 0),
    el22: gp[n]?.eleitos || 0, el26: ga[n]?.eleitos || 0, del: (ga[n]?.eleitos || 0) - (gp[n]?.eleitos || 0),
  })).filter(x => x.pct22 + x.pct26 > 0.05 || x.el22 + x.el26 > 0);

  let porEstado = '';
  if (a.partes.length > 1) {
    const mp = Object.fromEntries(p.partes.map(x => [x.uf, x.r]));
    const linhas = a.partes.map(x => {
      const r22 = mp[x.uf]; const l26 = x.r.cands[0], l22 = r22?.cands[0];
      const k = c => c ? (cargo === 1 ? c.nome : c.partido) : '—';
      const t26 = prop ? porPartido(x.r.cands)[0] : null, t22 = prop && r22 ? porPartido(r22.cands)[0] : null;
      return { uf: x.uf, l26: prop ? (t26?.nome || '—') : k(l26), p26: prop ? (t26?.eleitos || 0) : (l26?.pct || 0),
        l22: prop ? (t22?.nome || '—') : k(l22), p22: prop ? (t22?.eleitos || 0) : (l22?.pct || 0),
        comp: x.r.pcomp - (r22?.pcomp || 0), mudou: '' };
    }).map(l => ({ ...l, mudou: l.l26 !== l.l22 ? 'Sim' : 'Não' }));
    porEstado = `<h3>Por estado: ${prop ? 'partido com mais eleitos' : cargo === 1 ? 'mais votado' : 'partido do mais votado'}</h3>${tabela('cmp-uf', [
      { k: 'uf', t: 'UF', f: l => `<b>${l.uf}</b>` }, { k: 'l22', t: '2022' }, { k: 'p22', t: prop ? 'Eleitos' : '%', csvT: '2022 valor', n: 1, f: l => prop ? l.p22 : fP(l.p22) },
      { k: 'l26', t: '2026' }, { k: 'p26', t: prop ? 'Eleitos' : '%', csvT: '2026 valor', n: 1, f: l => prop ? l.p26 : fP(l.p26) },
      { k: 'mudou', t: 'Mudou?' }, { k: 'comp', t: 'Variação do comparecimento', n: 1, f: l => fD(l.comp, 2, ' p.p.', true) }], linhas, { ordem: 'uf', dir: 1, limite: 30 })}`;
  }

  const sobe = partidos.slice().sort((x, y) => y.dpct - x.dpct).slice(0, 8);
  const desce = partidos.slice().sort((x, y) => x.dpct - y.dpct).slice(0, 8);
  corpo.innerHTML = `<h2>${CARGOS[cargo]}, ${esc(nomeEscopo(S.cmpEscopo))}, ${turno}º turno: 2022 x 2026</h2>
    ${tabela('cmp-part', [{ k: 't', t: 'Indicador' }, { k: 'v22', t: '2022', n: 1, f: m => fP(m.v22) }, { k: 'v26', t: '2026', n: 1, f: m => fP(m.v26) },
      { k: 'd', t: 'Variação', n: 1, f: m => fD(m.d, 2, ' p.p.', true) }], metricas, { limite: 10 })}
    <div class="grade-2"><div><h3>Quem mais cresceu em votos</h3>${barras(sobe.filter(x => x.dpct > 0).map(x => ({ ...x, pct: x.dpct })), { rotulo: x => '+' + fP(x.dpct).replace('%', ' p.p.') })}</div>
      <div><h3>Quem mais perdeu</h3>${barras(desce.filter(x => x.dpct < 0).map(x => ({ ...x, pct: -x.dpct, cor: '#8a99b8' })), { rotulo: x => '−' + fP(-x.dpct).replace('%', ' p.p.') })}</div></div>
    <h3>Partidos</h3>${tabela('cmp-partidos', [{ k: 'nome', t: 'Partido', f: x => `<b>${esc(x.nome)}</b>` },
      { k: 'pct22', t: '% votos 2022', n: 1, f: x => fP(x.pct22) }, { k: 'pct26', t: '% votos 2026', n: 1, f: x => fP(x.pct26) }, { k: 'dpct', t: 'Variação', n: 1, f: x => fD(x.dpct) },
      ...(partidos.some(x => x.el22 + x.el26) ? [{ k: 'el22', t: 'Eleitos 2022', n: 1 }, { k: 'el26', t: 'Eleitos 2026', n: 1 }, { k: 'del', t: 'Saldo', n: 1, f: x => fDi(x.del) }] : [])], partidos, { ordem: prop ? 'el26' : 'pct26', limite: 50 })}
    <p class="nota">Partidos que se fundiram ou mudaram de nome entre 2022 e 2026 aparecem como linhas separadas. Em 2022 a sigla do partido é extraída do campo de coligação do arquivo do TSE.</p>
    ${porEstado}`;
}

/* =========================================================================
   TELA: FONTES E DIAGNÓSTICO
   ========================================================================= */
async function telaFontes(el) {
  const A = ELEICOES.atual;
  const ex = [
    ['Configuração das eleições', 'comum/config/ele-c.json'],
    ['Presidente, Brasil, 2º turno', caminhoResultado(A, 1, 2, 'BR')],
    ['Governador, MG, 2º turno', caminhoResultado(A, 3, 2, 'MG')],
    ['Deputado federal, SP, 1º turno', caminhoResultado(A, 6, 1, 'SP')],
    ['Presidente, município de São Paulo, 1º turno', caminhoResultado(A, 1, 1, 'SP', '71072')],
    ['Municípios (configuração)', `${A.ciclo}/${A.fed[0]}/config/mun-e${pad(A.fed[0], 6)}-cm.json`],
  ];
  el.innerHTML = `<h2>Fontes e diagnóstico</h2>
    <p class="nota">Modo de acesso atual: <b>${CONFIG.proxy ? 'função da Vercel (/api/tse), com cache na CDN' : 'direto do navegador'}</b>.
    Arquivos servidos pelo repositório: <b>${fN(MANIFESTO.size)}</b>.
    Códigos usados: 1º turno federal ${A.fed[0]}, estadual ${A.est[0]}; 2º turno federal ${A.fed[1]}, estadual ${A.est[1]}.
    Comparativo: 2022 (${ELEICOES.anterior.fed.join(', ')}, ${ELEICOES.anterior.est.join(', ')}), formato detectado: ${ELEICOES.anterior.indisponivel ? 'indisponível' : ELEICOES.anterior.fmt === 'r' ? 'simplificado (-r.json)' : 'unificado (-u.json)'}.</p>
    <h3>Exemplos de arquivos</h3>
    ${tabela('fontes', [{ k: 't', t: 'Conteúdo' }, { k: 'c', t: 'Endereço', f: l => `<a href="${CONFIG.base}/${l.c}" target="_blank" rel="noopener">${esc(l.c)}</a>` }],
      ex.map(([t, c]) => ({ t, c })), { limite: 20 })}
    <p class="nota">O TSE limita a 100 requisições por segundo por IP e pode bloquear o IP por 10 minutos se esse limite for ultrapassado ou se houver muitos erros 404. Os resultados já totalizados vêm da pasta data/ do repositório e não chegam ao TSE; o restante passa pela CDN da Vercel, que guarda inclusive os 404 por 10 minutos.</p>
    <h3>Últimas requisições</h3>
    <div class="log">${registro.length ? registro.map(r => `${r.h}  ${r.status}  ${esc(r.origem)}  ${esc(r.caminho)}`).join('<br>') : 'Nenhuma requisição ainda.'}</div>
    <p style="margin-top:14px"><button class="btn" data-limpar>Limpar cache do navegador</button></p>`;
}

const TELAS = { aovivo: telaAoVivo, primeiro: telaPrimeiro, bancadas: telaBancadas, comparativo: telaComparativo, fontes: telaFontes };

/* =========================================================================
   EVENTOS
   ========================================================================= */
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-tab],[data-sub],[data-bancada],[data-ordenar],[data-csv],[data-mais],[data-ri],[data-uf],[data-fechar],[data-limpar]');
  if (!t) return;
  const d = t.dataset;
  if (d.tab) { S.aba = d.tab; rotear(); }
  else if (d.sub) { S.sub = d.sub; rotear(); }
  else if (d.bancada) { S.bancada = d.bancada; rotear(); }
  else if (d.ordenar) {
    const [id, k] = d.ordenar.split('|'); const tb = TABELAS[id];
    tb.dir = tb.ordem === k ? -tb.dir : -1; tb.ordem = k; $(`#tb-${CSS.escape(id)}`).innerHTML = tabelaInterna(id);
  }
  else if (d.csv) exportarCSV(d.csv);
  else if (d.mais) { TABELAS[d.mais].limite += 300; $(`#tb-${CSS.escape(d.mais)}`).innerHTML = tabelaInterna(d.mais); }
  else if (d.ri) { const [id, i] = d.ri.split('|'); const tb = TABELAS[id]; tb.aoClicar(tb.linhas[+i]); }
  else if (d.fechar !== undefined) $('#dlg').close();
  else if (d.limpar !== undefined) { memoria.clear(); rotear(); }
  else if (d.uf) cliqueUF(d.uf);
});
document.addEventListener('keydown', ev => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('[data-uf]')) { ev.preventDefault(); cliqueUF(ev.target.dataset.uf); }
});

function cliqueUF(sg) {
  if (S.aba === 'aovivo') { const alvo = $('#vivo-uf'); if (alvo) detalheUF(sg, 1, 2, alvo); }
  else if (S.aba === 'primeiro' && sg !== 'ZZ') { S.escopo = 'UF:' + sg; S.sub = 'partidos'; rotear(); }
}

let atrasoBusca;
document.addEventListener('change', ev => {
  const k = ev.target.dataset?.s; if (!k || k === 'busca') return;
  S[k] = /cargo|Turno/i.test(k) ? +ev.target.value : ev.target.value;
  if (k === 'cargo' || k === 'escopo') S.partido = '';
  rotear();
});
document.addEventListener('input', ev => {
  if (ev.target.dataset?.s !== 'busca') return;
  clearTimeout(atrasoBusca);
  atrasoBusca = setTimeout(() => {
    S.busca = ev.target.value; const pos = ev.target.selectionStart;
    rotear().then(() => { const i = $('[data-s="busca"]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } });
  }, 350);
});

/* =========================================================================
   INÍCIO: carrega o manifesto de dados e testa a função da Vercel
   ========================================================================= */
(async function iniciar() {
  try {
    const m = await fetch(`${CONFIG.dados}/manifest.json`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null);
    MANIFESTO = new Set(m?.arquivos || []);
  } catch { /* sem dados locais: tudo vem pela função */ }
  try {
    const r = await fetch(`${CONFIG.proxy}?ping=1`, { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) throw 0;
  } catch {
    CONFIG.proxy = '';
    $('#aviso-acesso').innerHTML = `<div class="aviso">A função <code>/api/tse</code> não respondeu, então a página está consultando o TSE direto pelo navegador.
      Se os dados não carregarem, é bloqueio de CORS: publique o projeto na Vercel ou rode <code>vercel dev</code> localmente.</div>`;
  }
  rotear();
})();
