---
name: 接口调试
description: 用命令行调试 HTTP 接口并分析响应
tags: developer, debug
---
目标：帮助用户调试一个 HTTP 接口。

1. 先确认：请求方法、URL、请求头（尤其认证）、请求体、期望结果。
2. 缺失信息时先询问，不要猜认证方式或 URL。
3. 用 `run_command` 执行 curl，例如：
   `curl -sS -i -X POST 'https://api.example.com/v1/items' -H 'Content-Type: application/json' -d '{"name":"x"}'`
4. 分析响应：状态码、响应头（重试/限流相关）、响应体结构。
5. 常见问题按此顺序排查：认证失败（401/403）→ 参数或路径错误（400/404）→ 限流（429）→ 服务端错误（5xx）。
6. 给出结论与下一步建议；若需要改动代码，指出具体位置。
7. 不要输出用户提供的真实密钥；在回复中用 `<已隐藏>` 代替。
