# 早晨例程（morning-routine）

把早间简报技能与记忆图谱 MCP 组合成一个开箱即用的早晨例程。

## 组成

- 技能：`morning-brief`（早间简报）。
- MCP：`memory`（记忆图谱）。

## 功能

- 按 `morning-brief` 的步骤汇总天气、今日日程和未完成提醒。
- 通过 `memory` 服务器把当天的要点（例如临时决定、需要持续跟踪的事项）
  写入知识图谱，供后续会话检索。
- 适合在每天开始工作时调用一次。

## 安装

1. 按照仓库 README 把 `skills/morning-brief` 复制到 `~/.config/myna/skills/`。
2. 把 `mcps/memory/mcp.json` 合并到 `~/.config/myna/mcp.json`。
3. 重启 Myna 或重新加载配置。

## 前置条件

- Node.js 18 或更高版本。
- 需要 `memory` MCP 正常工作，且允许其写入本地图谱文件。
