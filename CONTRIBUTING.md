# Contributing to myna-skills

Thank you for contributing a skill to the Myna marketplace. This document describes
the repository layout, the skill format, and the pull-request workflow.

## Repository layout

```
skills/<id>/SKILL.md   One directory per skill.
registry.json          Marketplace index consumed by the Myna app.
scripts/validate.mjs   Validator run in CI.
```

## Adding a skill

1. Fork this repository and clone your fork.
2. Create a new directory `skills/<id>/`, where `<id>` is lowercase and matches
   `[a-z0-9-]+` (for example `daily-report`). The directory name is the skill id.
3. Add `skills/<id>/SKILL.md` using the format below.
4. Add a matching entry to `registry.json`, or regenerate the registry with the
   validator helper:
   ```sh
   node scripts/validate.mjs --write-registry
   ```
   The helper preserves existing `tags` and `author` values and fills defaults for
   new skills, so remember to review and edit the generated entry.
5. Run the validator locally:
   ```sh
   node scripts/validate.mjs
   ```
6. Commit, push to your fork, and open a pull request.

## Skill format

`SKILL.md` starts with optional YAML frontmatter followed by a markdown body.

```markdown
---
name: 日报生成
description: 汇总今天的提醒与日程，生成一段日报文本
---
步骤：
1. 调用 `get_datetime` 获取今天的日期。
2. …
```

Rules:

- `id` is the directory name: lowercase, `[a-z0-9-]+`.
- Frontmatter must contain `name` and `description`. Both must be non-empty and a
  single line. Use Simplified Chinese for the seed-style skills; other languages
  are acceptable as long as the values are clear.
- The body must contain concrete, imperative instructions that a model can follow.
  It may reference Myna tools by name, for example `open_app`, `create_reminder`,
  `clipboard_read`, `get_weather`, `shell_command`, or `speak`.
- Keep each skill focused on one task and under roughly 60 lines.
- Do not include placeholders or secrets. Never instruct a skill to exfiltrate data.

## Registry rules

`registry.json` uses this schema:

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

- `skills` must list exactly the directories present under `skills/`, sorted by `id`.
- Each entry's `name` and `description` must equal the values in that skill's
  frontmatter.
- `path` must be `skills/<id>`.

## Continuous integration

GitHub Actions runs `node scripts/validate.mjs` on every push and pull request
(see `.github/workflows/validate.yml`). The validator checks frontmatter, directory
naming, registry consistency, and that the registry is sorted. A pull request
cannot be merged while validation fails. Run the same command locally before
opening your pull request.
