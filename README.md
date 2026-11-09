# OpenCode Subagent Dashboard

[![npm version](https://img.shields.io/npm/v/opencode-subagent-dashboard.svg)](https://www.npmjs.com/package/opencode-subagent-dashboard)
[![license](https://img.shields.io/npm/l/opencode-subagent-dashboard.svg)](LICENSE)
[![OpenCode v2](https://img.shields.io/badge/OpenCode-v2-111111)](https://opencode.ai)

A live progress dashboard for **OpenCode v2** subagents.

When an orchestrator fans work out to several subagents, the normal transcript only shows one session at a time. This plugin adds a full-screen view of the **whole session family** — the root session plus every child subagent — with status, model, effort, elapsed time, context usage, task cards, and recent tool activity.

```text
SUBAGENTS  5 sessions   ● 1 running   ✓ 4 done

╭─ #3 Implement provider search ──────────────╮   0  ✓ build    Orchestrate release…  18m 42s
│ GPT-5.2 · high                              │   1  ✓ general  Implement audio…      12m 10s
│ 182,440 / 400,000 tokens · 45.6%            │   2  ✓ general  Implement device…     14m 05s
│ ██████████████████░░░░░░░░░░░░░░░░░░        │ ▸ 3  ● general  Implement provider…   12m 10s
│                                             │   4  ✓ explore  Review changes…        2m 44s
│ TASK                                        │
│  ✓ Implement provider search       12m 10s   │
│  #3 · from Build release notes              │
│                                             │
│ RECENT ACTIVITY                             │
│  ✓ shell  uv run pytest tests/ -q     3s    │
│  ● edit   src/providers/search.py     0s    │
╰─────────────────────────────────────────────╯
↑↓ select · enter open · r refresh · f fullscreen · esc close
```

## Features

- **Whole family, one screen** — root session and all nested subagents, numbered `#0…N`
- **Live status** — running, completed, failed, interrupted
- **Model + effort** — provider model name and variant (for example `high`, `max`)
- **Context meter** — latest context usage against the model context window, plus remaining tokens
- **Task cards** — child sessions with status and duration
- **Recent activity** — latest tool calls with state and timing
- **Jump into a session** — press `Enter` to open the selected agent
- **Responsive** — two panes on wide terminals, stacked below 112 columns
- **Theme-aware** — uses the active OpenCode theme

## Install

### Recommended

```bash
opencode plugin add opencode-subagent-dashboard
```

Then restart OpenCode (or run `/reload`).

### Manual

Add the package to your global OpenCode config:

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-subagent-dashboard"]
}
```

### TUI-only alternative

The package also works as a CLI-only plugin. If you prefer not to load the no-op server entrypoint:

```json
// ~/.config/opencode/cli.json
{
  "plugins": ["opencode-subagent-dashboard"]
}
```

## Usage

Open the dashboard with any of:

- `/subagents` (alias `/subagent`)
- `Ctrl+Alt+S`
- `Ctrl+P` → **Open subagents dashboard**

### Keys

| Key | Action |
| --- | --- |
| `↑` / `k` | Previous session |
| `↓` / `j` | Next session |
| `Enter` | Open the selected session |
| `r` | Refresh sessions and messages |
| `f` | Toggle fullscreen |
| `Esc` / `q` | Close |

The dashboard opens on the currently active session, auto-selects a running child when one exists, and updates live from OpenCode session events. Elapsed time ticks every second.

## What it reads

Everything comes from the local OpenCode service through the plugin API:

- `session.list`, `session.get`, `session.root`, `session.family`, `session.status`
- session messages for token usage and tool activity
- the model catalog for context-window sizes and display names

The plugin is **read-only**: it does not send prompts, modify sessions, or make external network requests.

## Compatibility

- OpenCode **v2.2.x** (built and tested against `@opencode/plugin` 2.2.6)
- OpenCode v1 is not supported

## Development

```bash
git clone https://github.com/hadvand/opencode-subagent-dashboard.git
cd opencode-subagent-dashboard
npm install
npm run build
npm run typecheck
npm pack --dry-run
```

To use the working copy as a local plugin:

```bash
ln -s "$PWD" ~/.config/opencode/plugins/opencode-subagent-dashboard
```

Then run `/reload` in OpenCode.

The TUI part lives in `src/tui.tsx`; the server entrypoint is a no-op so that `opencode plugin add` works for a TUI plugin.

## License

MIT
