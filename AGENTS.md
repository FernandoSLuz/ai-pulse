# AGENTS.md — AI Pulse

Monorepo npm workspaces: `packages/server` (Node+TS+Express+better-sqlite3+ws),
`packages/web` (HTML/CSS/JS vanilla, sem build), `packages/widget` (Electron; integração
Linux em `src/platform.ts`, regra Hyprland + hook de tema em `linux/`),
`packages/omarchy-plugin/fernando.ai-pulse` (widget da barra do omarchy-shell, QML + manifest).
Roda em Windows (NSIS) e Linux (AppImage + pacman; Omarchy/Hyprland é o desktop de referência).
Fonte única: `README.md` + `docs/ARCHITECTURE.md` + `docs/CONFIGURATION.md` +
`docs/RELEASING.md`. Leia antes de agir.

## Comandos
- `npm ci && npx install-electron` — obrigatório antes de tudo (node_modules pode não existir;
  Electron >= 42 não baixa o binário no install). Node >= 22.14 (`engines`).
- `npm run build` — tsc do server + tsc do widget + build-resources (o web é copiado, não buildado).
- `npm run dev` — server em watch na porta 3847 (`tsx watch src/index.ts`).
- `npm run gate` — build + `node --check packages/web/app.js` +
  `node --check packages/widget/renderer/settings.js`.
- Gate local = o que o CI faz: `npm run gate` + `GET /api/health` 200.
- `npm run dist -w @ai-pulse/widget` (NSIS, Windows) · `npm run dist:linux -w @ai-pulse/widget`
  (AppImage + pacman; `dist:linux:dir` = pasta sem empacotar) · `npm run linux:install`
  (Omarchy: regra Hyprland, hook de tema, plugin da barra; `npm run linux:uninstall -w @ai-pulse/widget` desfaz).
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
- better-sqlite3 >= 13 (raiz, hoisted) é N-API: um único binário serve Node e Electron.
  `npm rebuild better-sqlite3` é no-op; não existe rebuild de ABI no CI. Depois de `npm ci`,
  rode `npx install-electron` (senão o Electron fica sem binário).
- Scripts por máquina: Windows → `.ps1`, PowerShell 5.1, UTF-8 com BOM. Linux/Omarchy →
  `.sh`/`.mjs`, LF sem BOM, sempre a partir de `/work/ai-pulse` (btrfs).
- Config do Hyprland é Lua: regras `o.window` em `packages/widget/linux/hypr/ai-pulse.lua`
  (instalada como `~/.config/hypr/ai-pulse.lua`). Validar com `hyprctl reload && hyprctl configerrors`.
- Plugin do omarchy-shell vive em `packages/omarchy-plugin/`. Validar com
  `omarchy plugin validate <dir>`.
- Classe de janela é `ai-pulse` (vem de `app.setDesktopName`) — nunca casar com "Electron".
- Server escuta em 127.0.0.1 (`AI_PULSE_BIND_HOST=0.0.0.0` expõe); `/api/health` traz
  `app: "ai-pulse"`, `version` e `pid` — o supervisor só adota listener que se identifica assim.

## Release
- Tag `v*` dispara `release.yml` (jobs `windows-installer` = NSIS; `linux-packages` = AppImage
  sempre + pacman só em tag sem `-rc`: o pacman transforma `1.2.0-rc.1` em `1.2.0_rc.1`, que o
  vercmp ordena ACIMA de `1.2.0` e bloquearia o upgrade final); `-rc` no nome = prerelease.
  Bump nos TRÊS `package.json` (raiz, server, widget).
  **Push de tag é gate humano — só com "pode subir" do Fernando.**

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
- Gate duro antes de comparar: `npm run gate` + health 200 + verify-sources +
  gate-check (unicidade do leaderboard, My Stack resolve, contrato /api/videos).

## Exceções medidas de modelo
(nenhuma ainda — registrar aqui: data · tarefa · modelo barato que falhou · evidência ·
modelo adotado no lugar)
