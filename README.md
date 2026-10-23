# myna-hub

Community hub for [Myna](https://github.com/quyansiyuanwang/myna) — a native macOS
menu bar AI assistant. It manages three kinds of contributions in separate folders:

| Folder | What it contains | Consumed by |
|---|---|---|
| `skills/` | `SKILL.md` instruction packages the model can load | Myna's skill loader |
| `mcps/` | MCP server definitions (stdio) | Myna's MCP client |
| `plugins/` | Bundles that reference existing skills and MCP servers | Myna's marketplace installer |

`registry.json` is the index the app reads.

## What's available

| Kind | Count | Highlights |
|---|---|---|
| Skills | 12 | `web-research`, `code-review`, `git-commit`, `summarize-url`, `weekly-review`, `api-debug` |
| MCP servers | 17 | Web search (`brave-search`, `tavily`, `duckduckgo`), page fetching (`fetch`), reasoning (`sequential-thinking`), developer tools (`github`, `gitlab`, `git`, `sqlite`, `postgres`, `redis`, `puppeteer`), plus `filesystem`, `memory`, `everything`, `time`, `slack` |
| Plugins | 5 | `research-pack` (search + fetch), `dev-pack` (review + git), `knowledge-pack` (memory + sqlite), `desk-cleanup`, `morning-routine` |

### Web search

Myna also has built-in web search (Settings → Tools → Web search). The hub's search
MCP servers are an alternative that exposes search as MCP tools:

| Server | Requires | Notes |
|---|---|---|
| `duckduckgo` | nothing | Zero-config starting point |
| `fetch` | nothing | Fetches pages as Markdown for the model to read |
| `brave-search` | `BRAVE_API_KEY` | Web, news and image search |
| `tavily` | `TAVILY_API_KEY` | LLM-optimised results, optional synthesised answer |

Servers that need a key or a connection string ship with an empty `env` value or a
placeholder argument — fill it in after installing (Settings → Tools → MCP servers).

### Runtime weight

**Every MCP server needs an external runtime** — there is no zero-dependency MCP
server, because MCP servers are separate processes. `npx`-based entries need Node.js;
`uvx`-based entries need uv. The registry records the required runtime per entry
(`"runtime": "node" | "uv"`), and Myna shows a warning badge when it is not installed.

Myna's own capabilities are native Swift and need **no** runtime, so the common cases
are already covered without installing anything:

| Need | Built into Myna |
|---|---|
| Web search | Settings → Tools → Web search (Tavily / Brave / Serper / custom) |
| Page fetching | `fetch_url` tool |
| Files | `read_file`, `write_file`, `edit_file`, `list_dir`, `find_files`, `search_text` |
| Git | `git_status`, `git_diff`, `git_log`, `git_commit` |
| Shell | `run_command` (with a timeout and an optional confirmation gate) |

The marketplace marks these MCP servers as 已内建 (already built in) so they are not
installed by mistake.

### Runtimes

MCP servers are started over stdio. `npx`-based servers need Node.js; `uvx`-based
servers need [uv](https://docs.astral.sh/uv/). The registry entry records which one
each server uses.

## Repository layout

```
skills/<id>/SKILL.md        one skill per directory
mcps/<id>/mcp.json          one MCP server per directory (+ README.md)
plugins/<id>/plugin.json    one plugin per directory (+ README.md)
registry.json               index of all three kinds
scripts/validate.mjs        consistency validator (Node, no dependencies)
```

## Skill format

`skills/<id>/SKILL.md` starts with optional YAML frontmatter followed by a markdown body:

```markdown
---
name: 日报生成
description: 汇总今天的提醒与日程，生成一段日报文本
---
1. 调用 `get_datetime` 获取今天的日期。
2. …
```

- `id` is the directory name: lowercase, `[a-z0-9-]+`.
- `name` and `description` are required, non-empty, single line.
- The body should be concrete, imperative steps. Referencing Myna's tools by name is
  encouraged. Keep a skill focused and under roughly 60 lines.

## MCP format

`mcps/<id>/mcp.json`:

```json
{
  "id": "filesystem",
  "name": "文件系统",
  "description": "读写指定目录下的文件（只读/读写取决于参数）",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"],
  "env": {}
}
```

- `id` is the directory name; `command` is started through `/usr/bin/env`, so `npx`,
  `uvx` and absolute paths all work.
- `args` is an array of strings; `env` is an object merged into the server environment.
- The accompanying `README.md` documents prerequisites and which `args` the user is
  expected to edit.

## Plugin format

`plugins/<id>/plugin.json`:

```json
{
  "id": "morning-routine",
  "name": "早晨例程",
  "description": "组合早间简报与记忆图谱，生成简报并记录当天要点",
  "skills": ["morning-brief"],
  "mcps": ["memory"]
}
```

A plugin is a bundle: installing it installs every referenced skill and registers every
referenced MCP server. Referenced ids must exist in this repository.

## Installing manually

- **Skill** — copy `skills/<id>/` into `~/.config/myna/skills/`.
- **MCP server** — copy the entry from `mcps/<id>/mcp.json` into the `servers` object of
  `~/.config/myna/mcp.json` (the `id` becomes the key, and the tool names get the
  `mcp__<id>__` prefix).
- **Plugin** — install each skill it lists and each MCP server it lists.

Myna reads the same skill format from `~/.pi/agent/skills/` as well, so skills authored
for the pi CLI work in Myna unchanged.

## Marketplace consumption

Myna's in-app marketplace fetches `registry.json` from this repository and offers the
listed skills, MCP servers and plugins for one-click install. The file is the single
source of truth: the app does not scan the repository tree.

## Seed content

| Kind | Id | Name |
|---|---|---|
| skill | `daily-report` | 日报生成 |
| skill | `file-tidy` | 下载目录整理 |
| skill | `focus-mode` | 专注模式 |
| skill | `meeting-notes` | 会议纪要整理 |
| skill | `morning-brief` | 早间简报 |
| skill | `translate-clipboard` | 剪贴板翻译 |
| mcp | `everything` | Everything 参考服务器 |
| mcp | `filesystem` | 文件系统 |
| mcp | `memory` | 记忆图谱 |
| plugin | `desk-cleanup` | 桌面清理 |
| plugin | `morning-routine` | 早晨例程 |

## Maintaining the hub

Everything is scripted and dependency-free (Node 20+, no `npm install`):

```sh
npm run verify                             # registry in sync + strict validation + inventory
npm run new -- skill my-skill --name 我的技能 --desc 什么时候用它 --tags utility
npm run remove -- skill my-skill           # refuses while a plugin still references it
npm run stats                              # counts, tags, runtimes, prompt cost
npm run stats:diff                         # the same plus what changed vs origin/main
npm run audit                              # probe every upstream npx/uvx package
npm run test                               # inject 16 defects, assert each is rejected
```

`npm run stats` reports the part that decides how expensive the hub is for users: the
skill list and plugin paragraphs are part of **every** request's system prompt, so the
sum of names and descriptions is a permanent per-message cost. It also shows the MCP
runtime split, so it is obvious how much of the hub needs Node or uv.

## Validation

```sh
npm run check          # structural + quality validation
npm run check:strict   # warnings fail (used by the weekly audit)
npm run registry       # regenerate registry.json from the folders
npm run registry:check # fail when registry.json is out of date
```

The validator checks frontmatter, ids, MCP command/args/env shapes, plugin references,
that `registry.json` matches the folders field for field, and a set of quality rules
that prevent silent breakage: prompt-cost limits on names and descriptions, scaffold
placeholder text, machine-specific paths, credential patterns, unresolvable relative
links, missing plugin READMEs, and repository hygiene. See
[CONTRIBUTING.md](CONTRIBUTING.md#what-the-validator-checks) for the full list.

## Automation

| Workflow | Trigger | Purpose |
|---|---|---|
| `validate.yml` | push / PR | validation on Node 20 and 22, validator self-test (16 injected defects), `registry.json` drift, per-PR inventory with prompt-cost delta in the job summary |
| `audit.yml` | weekly | strict validation, upstream package availability (catches unpublished or renamed `npx`/`uvx` packages), stats artifact, opens an issue on failure |

The registry is also usable from any other source: Myna's marketplace accepts multiple
hub sources, so forks and mirrors of this repository can be added side by side.

## License

MIT
