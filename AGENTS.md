# AGENTS.md — AI Pulse

Monorepo npm workspaces: `packages/server` (Node+TS+Express+better-sqlite3+ws),
`packages/web` (HTML/CSS/JS vanilla, sem build), `packages/widget` (Electron).
Fonte única: `README.md` + `docs/ARCHITECTURE.md` + `docs/CONFIGURATION.md` +
`docs/RELEASING.md`. Leia antes de agir.

## Comandos
- `npm ci` — obrigatório antes de tudo (node_modules pode não existir).
- `npm run build` — tsc do server + tsc do widget + build-resources (o web é copiado, não buildado).
- `npm run dev` — server em watch na porta 3847 (`tsx watch src/index.ts`).
- Gate local = o que o CI faz: build + `node --check packages/web/app.js` +
  `node --check packages/widget/renderer/settings.js` + `GET /api/health` 200.
- Não há lint nem testes. Não invente framework de teste sem pedido.

## Regras do projeto
- `config/sources.json` é relido a cada poll (RSS 20 min, YT 30 min) — mudanças em feeds/canais
  não pedem código nem restart. Sem validação de schema: JSON quebrado = fonte silenciosamente vazia.
- `tier` (feeds): menor número ganha no dedupe de matérias quase-idênticas. 1=oficial,
  2=imprensa/Google News, 3=comunidade.
- `merge-models.ts` funde POR SLUG de propósito; variantes ficam separadas no banco.
  Colapso de variantes é só apresentação (`collapse-variants.ts` em `buildRankingsSnapshot`).
- `GET /api/videos` sem `kind` = `kind=creator` — contrato do `widget.html` (`?limit=3`).
  Payload WS `{type:"videos"}`: `items` = creators, `companyItems` = empresas. Não renomear campos.
- Toda URL de feed nova: verificar por GET (200 + parseia RSS/Atom + item ≤90 dias) antes de
  entrar no `sources.json`. `channelId` de YouTube: extrair de `youtube.com/@handle`
  (`"externalId":"UC…"`), nunca chutar.
- Migração de banco: padrão `migrateNewsColumns`/`migrateVideoColumns`
  (`PRAGMA table_info` + `ALTER TABLE ADD COLUMN` condicional). Nunca apagar/recriar o banco.
- better-sqlite3 (raiz, hoisted): o binário alterna entre ABI do Node e do Electron conforme o
  último rebuild. Script de manutenção falhou com NODE_MODULE_VERSION? → `npm rebuild
  better-sqlite3` para o Node; o release.yml refaz para Electron no CI.
- Scripts `.ps1` nesta máquina: PowerShell 5.1, UTF-8 com BOM (regras da máquina do Fernando).

## Release
- Tag `v*` dispara `release.yml`; `-rc` no nome = prerelease. Bump nos TRÊS `package.json`
  (raiz, server, widget). **Push de tag é gate humano — só com "pode subir" do Fernando.**

## Orquestração (regras do Fernando)
- Planner: Fable/Opus Plan. Execução: `executor` GLM-5.3 Flash Bypass Low;
  QA visual: `visao` Grok 4.6 Agent Low; condução: `mini-orquestrador` GLM-5.3 Flash Medium.
- Máx. 5 executores simultâneos. Sem ultracode. Sem subagente nativo em modelo caro.
  >30 min sem progresso = parar e reportar. Nunca re-tentar em silêncio.
- Decisão do Fernando → pergunta de múltipla escolha. Não inventar progresso.

# gauntlet-gates v1
- Barra visual: o próprio painel Creators/News Feed do AI Pulse (escolha de 2026-09-01).
- Loop: construtor → crítico cego (contexto fresco, prints sem rótulo) → A/B binário +
  maior gap nomeado → volta. Parada: vitória cega ou 5 rodadas; no teto, entregar com gap escrito.
- Gate duro antes de comparar: build + node --check + health 200 + verify-sources +
  gate-check (unicidade do leaderboard, My Stack resolve, contrato /api/videos).

## Exceções medidas de modelo
(nenhuma ainda — registrar aqui: data · tarefa · modelo barato que falhou · evidência ·
modelo adotado no lugar)
