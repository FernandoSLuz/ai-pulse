# ai-pulse — Claude Code

The single source of truth for agent instructions, user preferences, and working agreements is
`AGENTS.md` at the repo root. It is shared with Cursor, Claude Code, Codex, and every other agent.
Read and follow it:

@AGENTS.md

## Memory

When you learn a durable user preference, correction, or standing decision, record it in `AGENTS.md`
(the shared source of truth) — not only in Claude Code's private memory store. The `.claude/**/memory`
store must hold at most a short pointer to `AGENTS.md`, never a second copy of its content. This repo
has no local `remember` skill; the generic one lives at `/work/unity/Abyss/.claude/skills/remember/`
(same contract: append to `AGENTS.md`, never duplicate it).
