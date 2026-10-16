# 记忆图谱 MCP 服务器

官方知识图谱记忆服务器 `@modelcontextprotocol/server-memory`，通过 npx 启动。

## 前置条件

- Node.js 18 或更高版本（随 Node 安装 `npx`）。
- 首次运行时 npx 会从 npm 下载该包，需要网络连接。

## 提供的能力

- 创建、读取、更新、删除实体（entity）、关系（relation）和观察（observation）。
- 把信息以知识图谱的形式持久化到本地文件，供后续会话检索。
- 适合保存用户偏好、项目背景、长期待办等需要跨会话保留的信息。

## 需要修改的参数

`args` 无需修改。默认把图谱保存到服务器进程用户目录下的 JSON 文件。

## 环境变量

`env` 默认为空对象。若要指定图谱文件位置，可设置 `MEMORY_FILE_PATH` 为绝对路径：

```json
"env": { "MEMORY_FILE_PATH": "/Users/quyansiyuanwang/.config/myna/memory.json" }
```

不要把该文件提交到版本库；其中可能包含个人数据。
