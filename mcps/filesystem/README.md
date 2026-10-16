# 文件系统 MCP 服务器

官方文件系统服务器 `@modelcontextprotocol/server-filesystem`，通过 npx 启动。

## 前置条件

- Node.js 18 或更高版本（随 Node 安装 `npx`）。
- 首次运行时 npx 会从 npm 下载该包，需要网络连接。

## 提供的能力

- 列出、读取、写入、移动、查找指定目录下的文件。
- 所有操作都被限制在通过参数传入的允许目录之内，越界访问会被拒绝。
- 是否允许写入取决于服务器参数；默认按读写方式挂载传入的目录。

## 需要修改的参数

`mcp.json` 中 `args` 的最后一项是允许访问的目录：

```json
"args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"]
```

请把它替换为实际需要访问的目录。可以追加多个目录，每个目录一个参数，例如：

```json
"args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents", "~/Projects"]
```

只读挂载请追加 `--read-only`。不要在 `args` 中放入机密路径，也不要授予用户目录或磁盘根目录的写权限。

## 环境变量

`env` 默认为空对象，通常无需配置。
