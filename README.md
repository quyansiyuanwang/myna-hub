# myna-skills

Community-contributed skills for [Myna](https://github.com/quyansiyuanwang), the
macOS AI assistant. A skill is a single `SKILL.md` file containing frontmatter and
a short, imperative procedure that Myna can follow using its built-in tools. The
repository also acts as the marketplace index: the Myna app reads `registry.json`
to list and install available skills.

## Repository layout

```
README.md
CONTRIBUTING.md
LICENSE
registry.json                 Marketplace index consumed by the Myna app.
skills/<id>/SKILL.md          One directory per skill; directory name is the skill id.
scripts/validate.mjs          Dependency-free validator, run in CI.
.github/workflows/validate.yml
```

## Skill format

Each `skills/<id>/SKILL.md` starts with optional YAML frontmatter followed by a
markdown body:

```markdown
---
name: 日报生成
description: 汇总今天的提醒与日程，生成一段日报文本
---
步骤：
1. …
```

The `id` is the directory name (lowercase, `[a-z0-9-]+`). Frontmatter requires a
non-empty `name` and `description`, each on one line. The body should contain
concrete, imperative steps and may reference Myna's tools by name, such as
`get_datetime`, `get_weather`, `clipboard_read`, `create_reminder`,
`shell_command`, or `speak`.

## Installing a skill manually

Myna reads skills from the user configuration directory. To install a skill
manually, copy its directory into `~/.config/myna/skills/`:

```sh
mkdir -p ~/.config/myna/skills
cp -R skills/daily-report ~/.config/myna/skills/
```

Restart Myna or reload skills from the app so the new skill is picked up. You can
verify installation from within Myna with the `list_skills` tool, and inspect an
installed skill with `read_skill`.

## Marketplace consumption

The in-app marketplace fetches `registry.json` from this repository. The file uses
the following schema:

```json
{
  "version": 1,
  "skills": [
    {
      "id": "daily-report",
      "name": "日报生成",
      "description": "汇总今天的提醒与日程，生成一段日报文本",
      "tags": ["productivity"],
      "author": "quyansiyuanwang",
      "path": "skills/daily-report"
    }
  ]
}
```

The app uses `id` as the stable identifier, `name` and `description` for display,
`tags` for filtering, and `path` to locate `SKILL.md` for download. The registry
must list exactly the directories present under `skills/`, sorted by `id`, with
`name` and `description` matching each skill's frontmatter. CI enforces this with
`node scripts/validate.mjs`.

## Seed skills

| id | name | description | tags |
| --- | --- | --- | --- |
| `daily-report` | 日报生成 | 汇总今天的提醒与日程，生成一段日报文本 | productivity, summary |
| `file-tidy` | 下载目录整理 | 整理下载目录，按文件类型归类到子文件夹并汇报结果 | utility, files |
| `focus-mode` | 专注模式 | 专注模式，退出干扰类应用、开启勿扰并静音 | productivity, focus |
| `meeting-notes` | 会议纪要整理 | 把剪贴板里的会议记录整理成纪要，包含结论、待办与负责人 | productivity, notes |
| `morning-brief` | 早间简报 | 早间简报，汇总天气、今天的日程与未完成的提醒 | productivity, weather, calendar |
| `translate-clipboard` | 剪贴板翻译 | 读取剪贴板内容并翻译，然后把译文写回剪贴板 | utility, translation |

## Contributing

Contributions are welcome. The short version: fork the repository, add
`skills/<id>/SKILL.md`, add or regenerate the `registry.json` entry, run
`node scripts/validate.mjs`, and open a pull request. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full rules on naming, frontmatter,
style, and the CI checks.

## Validation

The validator is written in Node.js and uses only built-in modules. Node 20 or
newer is recommended.

```sh
node scripts/validate.mjs                 # validate skills and registry
node scripts/validate.mjs --write-registry  # regenerate registry.json from skills
```

The validator exits non-zero with a readable message when frontmatter is missing
or malformed, when a directory id is invalid, or when `registry.json` is out of
sync with the skills (missing or extra ids, mismatched name/description/path, or
incorrect sort order).

## License

Released under the MIT License. See [LICENSE](LICENSE).
