# Painel Eleições 2026 (TSE)

Acompanhamento do 2º turno ao vivo e análise do 1º turno, com comparação com 2022.
Código e dados ficam no GitHub; a publicação é feita na Vercel.

## Como funciona

- Os resultados que já não mudam (1º turno de 2026 e eleições de 2022) ficam na pasta `data/` do
  repositório. A página lê esses arquivos direto, sem consultar o TSE.
- O que muda (2º turno de 2026) e os resultados por município passam pela função `api/tse.js`,
  que busca no TSE e devolve com cache na CDN da Vercel. Mil visitantes ao mesmo tempo geram uma
  chamada ao TSE a cada 30 segundos por arquivo, não mil.
- Se um arquivo não estiver em `data/`, a página usa a função automaticamente.

## Estrutura

    index.html, styles.css, app.js     interface
    api/tse.js                          função serverless (ponte com o TSE)
    data/                               resultados versionados + manifest.json
    scripts/baixar-dados.mjs            baixa os resultados do TSE para data/
    .github/workflows/atualizar-dados.yml   roda o script pelo GitHub Actions
    vercel.json                         região São Paulo (gru1) e cache dos arquivos

## Publicar

1. Crie um repositório no GitHub e envie todos os arquivos desta pasta, incluindo `.github/` e `.gitignore`.
2. No GitHub, abra **Settings → Actions → General** e, em *Workflow permissions*, marque
   **Read and write permissions** (o workflow precisa gravar em `data/`).
3. Abra a aba **Actions**, escolha **Atualizar dados do TSE** e clique em **Run workflow**.
   Ao terminar, a pasta `data/` aparece no repositório com cerca de 300 arquivos.
4. Na Vercel: **Add New → Project**, importe o repositório e mantenha as configurações padrão
   (Framework Preset: *Other*, sem comando de build). Clique em **Deploy**.
5. Teste `https://seu-projeto.vercel.app/api/tse?ping=1`; deve responder `{"ok":true,...}`.

A cada novo commit (inclusive os do workflow), a Vercel publica de novo automaticamente.

## Depois do 2º turno

Quando o TSE concluir a totalização, rode o workflow de novo marcando
**Incluir o 2º turno de 2026**. Aí todo o painel passa a ser servido pelo repositório.

## Rodar localmente

    npm i -g vercel
    vercel dev

Para baixar os dados na sua máquina em vez de usar o Actions: `npm run dados`.

## Configuração

- `app.js`: `CONFIG.pollSegundos` (atualização do 2º turno) e `CONFIG.paralelo` (requisições simultâneas).
- `api/tse.js`: tempos de cache em `TTL`.
- `scripts/baixar-dados.mjs`: `PAUSA_MS` entre downloads.

## Limites a conhecer

- O TSE limita a 100 requisições por segundo por IP. As funções da Vercel saem por IPs
  compartilhados com outros clientes da Vercel; o cache na CDN e os dados em `data/` reduzem
  muito as chamadas, mas um bloqueio causado por terceiros não pode ser descartado. A aba
  "Fontes e diagnóstico" mostra a origem e o status de cada arquivo.
- Resultados por município não são versionados (são mais de 5.500 arquivos por cargo) e sempre
  passam pela função.
- No plano Hobby da Vercel, a função tem limite de execução e de chamadas mensais; para uso interno
  é suficiente.

## O que foi confirmado e o que é suposição

Confirmado na documentação e em uso real em 2026: os códigos das eleições, o caminho
`ele2026/<eleição>/dados/<uf>/<uf>[município]-c<cargo>-e<eleição>-u.json` e a estrutura
`carg → agr → par → cand`, com `s`, `e` e `v`.

Tratado de forma defensiva: nomes de alguns campos de eleitorado, abstenção e vagas; o formato dos
arquivos de 2022 (o script e a página testam os dois); a sigla do partido em 2022, extraída do campo
de coligação. Se algo vier zerado, compare um arquivo de `data/` com a função `normalizar()` do `app.js`.
