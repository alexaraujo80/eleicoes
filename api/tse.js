/**
 * Função serverless da Vercel: ponte entre a página e os arquivos públicos do TSE.
 *
 *  - evita o bloqueio de CORS no navegador;
 *  - devolve cabeçalhos de cache para a CDN da Vercel (s-maxage), de modo que muitos
 *    visitantes geram poucas chamadas ao TSE;
 *  - guarda 404 por 10 minutos: muitos 404 podem levar o TSE a bloquear o IP.
 *
 * Uso: /api/tse?p=ele2026/6258/dados/br/br-c0001-e006258-u.json
 *      /api/tse?ping=1
 */
const BASE = 'https://resultados.tse.jus.br/oficial/';
const CICLO_ATUAL = 'ele2026';
const AO_VIVO = new Set(['6258', '6260']); // 2º turno de 2026
const TTL = { aoVivo: 30, atual: 600, historico: 21600, config: 3600, ausente: 600 };
const PERMITIDO = new RegExp('^(comum/config/ele-c\\.json'
  + '|ele20\\d{2}/\\d{1,6}/config/[a-z0-9-]+\\.json'
  + '|ele20\\d{2}/\\d{1,6}/(dados|dados-simplificados)/[a-z]{2}/[a-z0-9-]+\\.json)$');

// Cache em memória enquanto a instância estiver quente (complementa a CDN)
const memoria = new Map();
const LIMITE_MEMORIA = 400;

function ttlPara(p) {
  if (p.startsWith('comum/') || p.includes('/config/')) return TTL.config;
  const [ciclo, ele] = p.split('/');
  if (ciclo !== CICLO_ATUAL) return TTL.historico;
  return AO_VIVO.has(ele) ? TTL.aoVivo : TTL.atual;
}

function responder(res, status, corpo, segundos, estado) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Cache', estado);
  res.setHeader('Cache-Control', segundos > 0
    ? `public, max-age=0, s-maxage=${segundos}, stale-while-revalidate=${segundos * 4}`
    : 'no-store');
  res.status(status).send(corpo);
}

function guardar(p, item) {
  if (memoria.size >= LIMITE_MEMORIA) memoria.delete(memoria.keys().next().value);
  memoria.set(p, item);
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (url.searchParams.has('ping')) {
    return responder(res, 200, JSON.stringify({ ok: true, runtime: 'vercel', node: process.version }), 0, 'PING');
  }

  const p = url.searchParams.get('p') || '';
  if (!PERMITIDO.test(p)) {
    return responder(res, 400, JSON.stringify({ erro: 'Caminho não permitido. Use apenas arquivos de resultados do TSE.' }), 0, 'BAD');
  }

  const ttl = ttlPara(p);
  const m = memoria.get(p);
  if (m && Date.now() - m.t < (m.status === 404 ? TTL.ausente : ttl) * 1000) {
    return responder(res, m.status, m.corpo, m.status === 404 ? TTL.ausente : ttl, 'MEM');
  }

  try {
    const r = await fetch(BASE + p, {
      headers: { Accept: 'application/json', 'User-Agent': 'painel-eleicoes/1.0' },
      signal: AbortSignal.timeout(12000),
    });

    if (r.status === 404 || r.status === 403) { // o bucket do TSE pode responder 403 para arquivo inexistente
      const corpo = JSON.stringify({ erro: 'Arquivo ainda não publicado pelo TSE.' });
      guardar(p, { t: Date.now(), status: 404, corpo });
      return responder(res, 404, corpo, TTL.ausente, 'MISS');
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const corpo = await r.text();
    JSON.parse(corpo); // garante que é JSON válido antes de cachear
    guardar(p, { t: Date.now(), status: 200, corpo });
    return responder(res, 200, corpo, ttl, 'MISS');
  } catch (e) {
    if (m?.status === 200) return responder(res, 200, m.corpo, 15, 'STALE');
    return responder(res, 502, JSON.stringify({ erro: `O TSE não respondeu (${e.message}). Tente novamente em instantes.` }), 5, 'ERRO');
  }
}
