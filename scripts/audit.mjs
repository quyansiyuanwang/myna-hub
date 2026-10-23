#!/usr/bin/env node
// Weekly maintenance audit: verifies that the upstream packages referenced by every
// MCP server still exist, so a renamed or unpublished package does not silently
// break installs.
//
// Usage:
//   node scripts/audit.mjs              check every MCP server (network required)
//   node scripts/audit.mjs --offline    only report what would be checked
//   node scripts/audit.mjs --json       machine-readable result
//
// Exit code is non-zero when a referenced package is definitively gone (404).
// Network errors are reported but do not fail the run: transient outages should not
// open issues.

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MCPS_DIR = join(ROOT, "mcps");

// npx/pnpm/bunx 传包名；uvx/pipx 传 PyPI 包名；其余命令无法从仓库推断。
const PACKAGE_RUNNERS = {
  npx: { registry: "npm", skipArgs: ["-y", "--yes", "-p", "--package"] },
  bunx: { registry: "npm", skipArgs: [] },
  pnpm: { registry: "npm", skipArgs: ["dlx"] },
  yarn: { registry: "npm", skipArgs: ["dlx"] },
  uvx: { registry: "pypi", skipArgs: ["--from"] },
  pipx: { registry: "pypi", skipArgs: ["run"] },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 从 args 里挑出包名：跳过命令自身与开关，取第一个看起来像包名的参数。 */
function packageFromArgs(args, { skipArgs }) {
  const rest = [...args];
  while (rest.length > 0 && (skipArgs.includes(rest[0]) || rest[0].startsWith("-"))) {
    if (rest[0].startsWith("--package=") || rest[0].startsWith("-p=")) {
      return rest[0].split("=")[1];
    }
    rest.shift();
  }
  const candidate = rest[0];
  if (!candidate || candidate.startsWith("/") || candidate.includes("=")) return null;
  return candidate;
}

/** scoped 包名里的 `@` 与 `/` 需要转义才能拼进 URL。 */
function encodePackage(name) {
  return name.replace("/", "%2F");
}

async function checkPackage(registry, name) {
  const url = registry === "npm"
    ? `https://registry.npmjs.org/${encodePackage(name)}`
    : `https://pypi.org/pypi/${name}/json`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "user-agent": "myna-hub-audit" },
    });
    if (response.status === 404) return { status: "missing", url };
    if (!response.ok) return { status: "error", url, detail: `HTTP ${response.status}` };
    return { status: "ok", url };
  } catch (err) {
    return { status: "error", url, detail: err.message };
  }
}

async function main() {
  const offline = process.argv.includes("--offline");
  const json = process.argv.includes("--json");
  const ids = existsSync(MCPS_DIR)
    ? (await readdir(MCPS_DIR, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : [];

  const results = [];
  for (const id of ids) {
    const path = join(MCPS_DIR, id, "mcp.json");
    if (!existsSync(path)) continue;
    let data;
    try {
      data = JSON.parse(await readFile(path, "utf8"));
    } catch {
      results.push({ id, status: "invalid", detail: "mcp.json does not parse" });
      continue;
    }
    const command = String(data.command ?? "").split("/").pop();
    const runner = PACKAGE_RUNNERS[command];
    if (!runner) {
      results.push({ id, status: "skipped", detail: `command "${data.command}" is not a package runner` });
      continue;
    }
    const pkg = packageFromArgs(data.args ?? [], runner);
    if (!pkg) {
      results.push({ id, status: "skipped", detail: "no package argument" });
      continue;
    }
    if (offline) {
      results.push({ id, status: "pending", registry: runner.registry, package: pkg });
      continue;
    }
    const outcome = await checkPackage(runner.registry, pkg);
    results.push({ id, registry: runner.registry, package: pkg, ...outcome });
    await sleep(250); // 对公共 registry 保持礼貌
  }

  const missing = results.filter((r) => r.status === "missing");
  const errored = results.filter((r) => r.status === "error");

  if (json) {
    console.log(JSON.stringify({ checked: results.length, missing, errored, results }, null, 2));
  } else {
    for (const r of results) {
      const label = {
        ok: "ok      ", missing: "MISSING ", error: "error   ",
        skipped: "skipped ", pending: "pending ", invalid: "INVALID ",
      }[r.status] ?? r.status;
      const target = r.package ? `${r.registry}:${r.package}` : (r.detail ?? "");
      console.log(`${label} ${r.id.padEnd(20)} ${target}${r.detail && r.package ? ` (${r.detail})` : ""}`);
    }
    console.log("");
    console.log(`检查 ${results.length} 个 MCP 服务器：${missing.length} 个包已不存在，${errored.length} 个网络错误。`);
  }

  if (missing.length > 0) process.exit(1);
}

await main();
