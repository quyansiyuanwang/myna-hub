# 开发工具包（dev-pack）

代码审查与规范化提交的组合：读改动 → 按清单审查 → 生成符合约定的提交信息，并可用
GitHub MCP 直接读到 PR 上下文。

## 组成

- 技能 `code-review`：按清单审查一处改动，指出问题与需要补充的测试。
- 技能 `git-commit`：把改动整理成一条符合约定式提交规范的信息。
- 技能 `api-debug`：接口报错时按「复现 → 定位 → 最小修复」推进。
- MCP `github`：读取 issue / PR / 文件内容（需要 `GITHUB_PERSONAL_ACCESS_TOKEN`）。
- MCP `git`：查看本地仓库状态、提交历史与 diff。

## 使用

装上后直接说「审查一下我这几处改动」或「把当前改动整理成一条提交信息」，助手会调用
上面两个技能；需要远端上下文时才会去用 GitHub MCP。

## 依赖

两个 MCP 都需要 Node.js（`npx`）。只用本地仓库时可以不启用 `github`，`git` 也可以用
Myna 内建的 `git_status` / `git_diff` / `git_log` 替代。

## 可选搭配

- 想要「改完自动跑测试」：追加 `run_command` 相关步骤，或在技能里写明测试命令。
