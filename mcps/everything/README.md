# Everything 参考服务器

官方参考服务器 `@modelcontextprotocol/server-everything`，通过 npx 启动。

## 为什么使用它

原计划的 `@modelcontextprotocol/server-fetch` 并不存在于 npm（`npm view` 返回 404），
PyPI 上的同名 `mcp-server-fetch` 只是占位包（版本 `0.0.1-security`），无法使用。
因此这里改用官方、可在 npm 上解析的 `@modelcontextprotocol/server-everything`。

需要强调的是：Everything 是一个**协议演示/参考服务器**，用来演练 MCP 的全部特性，
并不是真正的网页抓取工具，也不建议用于生产环境。若需要抓取网页，请使用社区维护的
可用服务器，并在本仓库中新增一个目录。

## 前置条件

- Node.js 18 或更高版本（随 Node 安装 `npx`）。
- 首次运行时 npx 会从 npm 下载该包，需要网络连接。

## 提供的能力

- `echo`：回显输入。
- `add`：整数相加。
- `longRunningOperation`：带进度通知的示例长任务。
- `sampleLLM`：触发采样请求的示例。
- 资源、提示（prompt）以及日志等协议特性的演示。

## 需要修改的参数

`args` 无需修改。`env` 默认为空对象。
