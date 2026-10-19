---
name: 日报生成
description: 汇总今天的提醒与日程，生成一段日报文本
tags: productivity, summary
---
目标：把今天的工作情况整理成一段可以直接发送的日报。按以下步骤执行。

1. 调用 `get_datetime` 获取今天的日期与当前时间。
2. 调用 `system_info` 读取设备与运行状态，作为日报的环境信息。
3. 调用 `list_running_apps` 查看当前打开的应用，识别今天主要使用的工具。
4. 调用 `run_applescript` 查询「提醒事项」中今天到期和已完成的条目，例如：
   `tell application "Reminders" to get name of (every reminder whose completed is false)`。
5. 调用 `run_applescript` 查询「日历」中今天的日程，例如：
   `tell application "Calendar" to get summary of (every event of calendar "工作" whose start date ≥ (current date))`。
6. 把结果整理成以下结构，用简洁的中文输出：
   - 今日概要：一句话说明日期与整体状态。
   - 已完成：列出今天已完成的提醒与已结束的日程。
   - 进行中：列出尚未完成的提醒与仍在进行的日程。
   - 明日关注：若有临近截止的条目，提醒用户。
7. 不要编造数据；某项查询为空时明确写「无」。
8. 最后调用 `speak` 用一句话播报日报摘要，并在对话中输出完整日报文本。
