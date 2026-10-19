---
name: 早间简报
description: 早间简报，汇总天气、今天的日程与未完成的提醒
tags: productivity, weather, calendar
---
目标：在用户开始一天工作时，用一段话给出天气、日程和待办。按以下步骤执行。

1. 调用 `get_datetime` 确认今天的日期和当前时间。
2. 调用 `get_weather` 获取当前所在地的天气，提取温度、天气状况和降水概率。
3. 调用 `run_applescript` 读取「日历」中今天的全部日程，按开始时间排序，例如：
   `tell application "Calendar" to get summary of (every event whose start date ≥ (current date))`。
4. 调用 `run_applescript` 读取「提醒事项」中未完成的条目，例如：
   `tell application "Reminders" to get name of (every reminder whose completed is false)`。
5. 按以下顺序组织简报，使用简洁的中文：
   - 问候与日期：一句话开场。
   - 天气：温度、天气状况；如有降水或高温，给出出行提示。
   - 今日日程：按时间列出日程名称与时间；若无日程则写「今天没有安排」。
   - 待办提醒：列出未完成提醒；若无则写「没有未完成提醒」。
6. 不要编造天气或日程数据；查询失败时如实说明。
7. 调用 `speak` 播报简报，并在对话中输出完整文本。
