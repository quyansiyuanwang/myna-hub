# myna-hub

Community hub for [Myna](https://github.com/quyansiyuanwang/myna) — a native macOS
menu bar AI assistant. It manages three kinds of contributions in separate folders:

| Folder | What it contains | Consumed by |
|---|---|---|
| `skills/` | `SKILL.md` instruction packages the model can load | Myna's skill loader |
| `mcps/` | MCP server definitions (stdio) | Myna's MCP client |
| `plugins/` | Bundles that reference existing skills and MCP servers | Myna's marketplace installer |

`registry.json` is the index the app reads.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: fork, add your files under the
matching folder, run `node scripts/validate.mjs --write-registry`, and open a pull
request. CI validates every contribution.

## Validation

```sh
node scripts/validate.mjs                  # validate everything against registry.json
node scripts/validate.mjs --write-registry # regenerate registry.json from the folders
```

The validator checks frontmatter, ids, MCP command/args/env shapes, plugin references,
and that `registry.json` lists exactly the same ids with matching names and descriptions.

## License

MIT
