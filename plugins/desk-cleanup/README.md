# 桌面清理（desk-cleanup）

把下载目录整理技能与文件系统 MCP 组合成一个文件归类助手。

## 组成

- 技能：`file-tidy`（下载目录整理）。
- MCP：`filesystem`（文件系统）。

## 功能

- 按 `file-tidy` 的步骤，把目标目录中的文件按类型归类到子文件夹。
- 借助 `filesystem` 服务器执行列目录、建目录和移动文件等操作。
- 不会删除文件；文件名冲突时追加序号，不覆盖已有文件。

## 安装

1. 按照仓库 README 把 `skills/file-tidy` 复制到 `~/.config/myna/skills/`。
2. 把 `mcps/filesystem/mcp.json` 合并到 `~/.config/myna/mcp.json`，
   并把 `args` 中的目录改为需要整理的目录（默认 `~/Documents`）。
3. 重启 Myna 或重新加载配置。

## 前置条件

- Node.js 18 或更高版本。
- `filesystem` MCP 的允许目录必须覆盖待整理的目录，并具备写入权限。
