/**
 * Baixa do TSE os resultados que já não mudam e grava em data/, com um manifest.json.
 * A página lê esses arquivos direto do repositório, sem passar pela função nem pelo TSE.
 *
 *   node scripts/baixar-dados.mjs                 1º turno de 2026 + 1º e 2º turnos de 2022
 *   node scripts/baixar-dados.mjs --com-2-turno   inclui o 2º turno de 2026 (só após a totalização final)
 */
import { mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const BASE = 'https://resultados.tse.jus.br/oficial/';
const SAIDA = 'data';
const TEMP = 'data.tmp';
const PAUSA_MS = 80; // ~12 req/s, bem abaixo do limite do TSE (100/s por IP)
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
const SEGUNDO_TURNO = /2\s*[ºo°]\s*turno/i;
const com2T2026 = process.argv.includes('--com-2-turno');

const PLANO = [
  { ciclo: 'ele2026', fed: [6257, 6258], est: [6259, 6260], fmt: 'u', segundoTurno: com2T2026 },
  { ciclo: 'ele2022', fed: [544, 545], est: [546, 547], fmt: 'auto', segundoTurno: true },
];

const pad = (n, l) => String(n).padStart(l, '0');
const dormir = ms => new Promise(r => setTimeout(r, ms));
const baixados = [];
let falhas = 0;

async function baixar(p) {
  await dormir(PAUSA_MS);
  let r;
  try { r = await fetch(BASE + p, { signal: AbortSignal.timeout(30000) }); }
  catch (e) { console.warn(`  erro de rede  ${p}`); falhas++; return null; }
  if (!r.ok) { console.warn(`  ${r.status}  ${p}`); if (r.status >= 500) falhas++; return null; }
  const texto = await r.text();
  try { JSON.parse(texto); } catch { console.warn(`  JSON inválido  ${p}`); return null; }
  const destino = join(TEMP, p);
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, texto);
  baixados.push(p);
  return texto;
}

function caminho(ed, ele, abr, cargo) {
  const a = abr.toLowerCase();
  const nome = `${a}-c${pad(cargo, 4)}-e${pad(ele, 6)}`;
  return ed.fmt === 'r'
    ? `${ed.ciclo}/${ele}/dados-simplificados/${a}/${nome}-r.json`
    : `${ed.ciclo}/${ele}/dados/${a}/${nome}-u.json`;
}

async function eleicao(ed) {
  console.log(`\n${ed.ciclo}`);
  const [fed1, fed2] = ed.fed, [est1, est2] = ed.est;

  if (ed.fmt === 'auto') { // 2022 foi publicado no formato antigo; confirma qual responde
    ed.fmt = 'r';
    if (!(await baixar(caminho(ed, fed1, 'BR', 1)))) {
      ed.fmt = 'u';
      if (!(await baixar(caminho(ed, fed1, 'BR', 1)))) { console.warn('  eleição indisponível, pulando'); return; }
    }
  } else {
    await baixar(caminho(ed, fed1, 'BR', 1));
  }

  for (const ele of [...ed.fed, ...ed.est]) await baixar(`${ed.ciclo}/${ele}/config/mun-e${pad(ele, 6)}-cm.json`);

  // Presidente, 1º turno
  for (const uf of [...UFS, 'ZZ']) await baixar(caminho(ed, fed1, uf, 1));

  // Cargos estaduais, 1º turno
  const gov1 = {};
  for (const uf of UFS) {
    gov1[uf] = await baixar(caminho(ed, est1, uf, 3));
    await baixar(caminho(ed, est1, uf, 5));
    await baixar(caminho(ed, est1, uf, 6));
    await baixar(caminho(ed, est1, uf, uf === 'DF' ? 8 : 7));
  }

  if (!ed.segundoTurno) return;

  // 2º turno: só pede o que existe, para não gerar 404 em série
  const brPres = baixados.includes(caminho(ed, fed1, 'BR', 1));
  const presTexto = brPres ? await readFile(join(TEMP, caminho(ed, fed1, 'BR', 1)), 'utf8') : '';
  if (SEGUNDO_TURNO.test(presTexto)) {
    for (const uf of ['BR', ...UFS, 'ZZ']) await baixar(caminho(ed, fed2, uf, 1));
  }
  for (const uf of UFS) if (gov1[uf] && SEGUNDO_TURNO.test(gov1[uf])) await baixar(caminho(ed, est2, uf, 3));
}

await rm(TEMP, { recursive: true, force: true });
await mkdir(TEMP, { recursive: true });
for (const ed of PLANO) await eleicao(ed);

if (baixados.length === 0 || falhas > 20) {
  console.error(`\nAbortado: ${baixados.length} arquivos baixados, ${falhas} falhas. A pasta ${SAIDA}/ foi mantida como estava.`);
  await rm(TEMP, { recursive: true, force: true });
  process.exit(1);
}

await writeFile(join(TEMP, 'manifest.json'), JSON.stringify({ gerado: new Date().toISOString(), arquivos: baixados.sort() }, null, 1));
await rm(SAIDA, { recursive: true, force: true });
await rename(TEMP, SAIDA);
console.log(`\n${baixados.length} arquivos gravados em ${SAIDA}/ (${falhas} falhas).`);
