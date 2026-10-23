## 变更内容

<!-- 一句话说明新增/修改了什么 -->

## 类型

- [ ] 新增技能（`skills/<id>/SKILL.md`）
- [ ] 新增 MCP 服务器（`mcps/<id>/mcp.json` + `README.md`）
- [ ] 新增插件（`plugins/<id>/plugin.json` + `README.md`）
- [ ] 修改已有条目
- [ ] 移除条目
- [ ] 其他（脚本、文档、CI）

## 自检

- [ ] `npm run verify` 通过（含 `registry.json` 同步与严格模式）
- [ ] 条目 `id` 为 `[a-z0-9-]+`，与目录名一致
- [ ] `name` ≤ 24 字符，`description` ≤ 120 字符且说明了**何时用**
- [ ] 标签取自已有词表（如需新标签，已在 `scripts/validate.mjs` 的 `KNOWN_TAGS` 登记）
- [ ] 技能正文先写清目标，再写编号步骤，工具名用反引号精确引用
- [ ] MCP 服务器的 `command` 可执行，`args` 中不含本机绝对路径与凭据
- [ ] 插件引用的技能与 MCP 均已存在（`skills` / `mcps` 至少一项非空）
- [ ] 没有提交 `.DS_Store`、构建产物或密钥

## 备注

<!-- 需要评审者注意的取舍，例如为什么不做成 MCP、为什么新增标签 -->
