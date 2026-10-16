---
name: 下载目录整理
description: 整理下载目录，按文件类型归类到子文件夹并汇报结果
---
目标：把用户的下载目录按文件类型整理到子文件夹，并汇报整理结果。按以下步骤执行。

1. 确认目标目录，默认为 `~/Downloads`。若用户指定了其它目录，以用户指定为准。
2. 调用 `shell_command` 列出目录内容（不递归）：
   `find ~/Downloads -maxdepth 1 -type f -print`。
3. 按下述类别规划子文件夹，并确定扩展名映射：
   - `Documents`：pdf、doc、docx、txt、md、pages、xls、xlsx、ppt、pptx、csv。
   - `Images`：jpg、jpeg、png、gif、webp、heic、bmp、svg。
   - `Archives`：zip、tar、gz、7z、rar、dmg、pkg。
   - `Audio`：mp3、wav、flac、aac、m4a。
   - `Video`：mp4、mov、mkv、avi、webm。
   - `Installers`：app、iso。
   - `Other`：其余未匹配的文件。
4. 先用 `shell_command` 执行 `mkdir -p` 创建需要的子文件夹。
5. 逐个把文件移动到对应子文件夹。文件名冲突时在原名后追加 `-1`、`-2` 等序号，不要覆盖已有文件。使用带 `-n` 的 `mv` 或先检查再移动。
6. 不要删除任何文件；跳过隐藏文件（以 `.` 开头）。
7. 汇总每个子文件夹移动的文件数量，并用简洁中文汇报。若有文件因冲突或权限未移动，一并说明。
