# AGENTS.md — AI Pulse

Monorepo npm workspaces: `packages/server` (Node+TS+Express+better-sqlite3+ws),
`packages/web` (HTML/CSS/JS vanilla, sem build), `packages/widget` (Electron; integração
Linux em `src/platform.ts`, regra Hyprland + hook de tema em `linux/`),
`packages/omarchy-plugin/fernando.ai-pulse` (widget da barra do omarchy-shell, QML + manifest).
Roda em Windows (NSIS) e Linux (AppImage + pacman; Omarchy/Hyprland é o desktop de referência).
Fonte única: `README.md` + `docs/ARCHITECTURE.md` + `docs/CONFIGURATION.md` +
`docs/RELEASING.md`. Leia antes de agir.

## Comandos
- Node >= 22.14 (`engines`). Quando faltarem dependências ou o lockfile mudar, rode `npm ci`.
  Para executar ou empacotar o widget, rode também `npx install-electron` se faltar o binário
  (Electron >= 42 não o baixa no install). Leitura e edição de documentação dispensam instalação.
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
- Benchmarks: fonte primária é o leaderboard público da Artificial Analysis (payload RSC, sem
  chave), que serializa metadados e métricas em objetos separados — juntar por slug. `AA_API_KEY`
  é enriquecimento opcional (índices compostos de coding/math) e NUNCA pode gerar linhas
  sintéticas/demo. Com feed completo (≥100 modelos) o poll poda linhas ausentes: o banco espelha
  o feed em vez de acumular modelos aposentados.
- Curadoria de IA: `deepseek-flash` (V4.1 Flash) é o primeiro candidato do router
  (`deepseek-v4-pro` depois); Gemini/Cerebras/Groq/OpenRouter são spillover. Chave
  `DEEPSEEK_API_KEY` (`.env` em dev, `config.json` no app); os modelos de raciocínio pedem
  timeout maior que o padrão de 45s.
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
- Scripts: Linux/Omarchy → `.sh`/`.mjs`, LF sem BOM, sempre a partir de `/work/ai-pulse` (btrfs).
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

## Memory protocol

1. Registre apenas convenções duráveis do projeto e decisões confirmadas, úteis a tarefas futuras.
2. Atualize o documento que já é dono do assunto; substitua o trecho superado. Use este arquivo para instruções de agente e ponteiros, não para receitas, resultados de sessão ou histórico de tentativas.
3. Não transforme uma observação isolada em regra permanente nem duplique conteúdo em memórias privadas. Segredos ficam fora da documentação.
