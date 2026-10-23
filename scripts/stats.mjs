#!/usr/bin/env node
// Prints an inventory of the hub: counts, tag spread, runtime split, plugin coverage
// and the token cost each item adds to Myna's system prompt.
//
// Usage:
//   node scripts/stats.mjs              human-readable report
//   node scripts/stats.mjs --json       machine-readable report
//   node scripts/stats.mjs --diff REV   compare against registry.json at git REV (e.g. origin/main)
//
// No third-party dependencies.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = join(ROOT, "registry.json");
const KINDS = ["skills", "mcps", "plugins"];

async function readRegistryFromDisk() {
  return JSON.parse(await readFile(REGISTRY_PATH, "utf8"));
}

function readRegistryAtRev(rev) {
  const text = execFileSync("git", ["show", `${rev}:registry.json`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return JSON.parse(text);
}

/** 粗估 token：中文按 1 字 ≈ 1 token，ASCII 按 4 字符 ≈ 1 token。 */
function approxTokens(text) {
  let cjk = 0;
  let ascii = 0;
  for (const ch of text) {
    if (ch.codePointAt(0) > 0x2e80) cjk += 1;
    else ascii += 1;
  }
  return Math.round(cjk + ascii / 4);
}

/**
 * 系统提示词的常驻部分：技能列表（id + 名称 + 描述）与已启用插件段落。
 * 这部分每个请求都会发送，因此是「装多少就付多少」的成本。
 */
function promptCost(registry) {
  const skillLines = registry.skills.map(
    (s) => `- ${s.name}（id: ${s.id}）：${s.description}`,
  );
  const pluginLines = registry.plugins.map((p) => `### ${p.name}（id: ${p.id}）\n${p.description}`);
  const text = [...skillLines, ...pluginLines].join("\n");
  return { chars: text.length, tokens: approxTokens(text) };
}

function inventory(registry) {
  const all = KINDS.flatMap((kind) => registry[kind].map((item) => ({ kind, item })));
  const tags = new Map();
  for (const { item } of all) {
    for (const tag of item.tags ?? []) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  const runtimes = new Map();
  for (const mcp of registry.mcps) {
    runtimes.set(mcp.runtime ?? "unknown", (runtimes.get(mcp.runtime ?? "unknown") ?? 0) + 1);
  }
  const coverage = new Map();
  for (const plugin of registry.plugins) {
    for (const id of plugin.skills ?? []) coverage.set(id, (coverage.get(id) ?? 0) + 1);
  }
  const referenced = new Set(registry.plugins.flatMap((p) => [...(p.skills ?? []), ...(p.mcps ?? [])]));
  const longest = [...all]
    .sort((a, b) => b.item.description.length - a.item.description.length)
    .slice(0, 5)
    .map(({ kind, item }) => ({ kind, id: item.id, description: item.description }));

  return {
    counts: {
      skills: registry.skills.length,
      mcps: registry.mcps.length,
      plugins: registry.plugins.length,
      total: all.length,
    },
    prompt: promptCost(registry),
    tags: [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    runtimes: [...runtimes].sort(),
    unreferencedSkills: registry.skills.map((s) => s.id).filter((id) => !coverage.has(id)),
    unreferencedMcps: registry.mcps.map((m) => m.id).filter((id) => !referenced.has(id)),
    longestDescriptions: longest,
  };
}

function delta(before, after) {
  const added = {};
  const removed = {};
  for (const kind of KINDS) {
    const beforeIds = new Set(before[kind].map((i) => i.id));
    const afterIds = new Set(after[kind].map((i) => i.id));
    added[kind] = [...afterIds].filter((id) => !beforeIds.has(id));
    removed[kind] = [...beforeIds].filter((id) => !afterIds.has(id));
  }
  const beforePrompt = promptCost(before);
  const afterPrompt = promptCost(after);
  return {
    added,
    removed,
    prompt: {
      chars: afterPrompt.chars - beforePrompt.chars,
      tokens: afterPrompt.tokens - beforePrompt.tokens,
    },
  };
}

function printHuman(report) {
  const { counts, prompt, tags, runtimes, unreferencedSkills, unreferencedMcps, longestDescriptions } = report;
  console.log("概览");
  console.log(`  技能 ${counts.skills} · MCP ${counts.mcps} · 插件 ${counts.plugins} · 合计 ${counts.total}`);
  console.log("");
  console.log("系统提示词常驻成本（每个请求都会发送）");
  console.log(`  ${prompt.chars} 字符 ≈ ${prompt.tokens} tokens`);
  console.log("");
  console.log("MCP 运行时");
  for (const [runtime, count] of runtimes) {
    const label = { none: "无外部依赖", node: "需要 Node", uv: "需要 uv/Python" }[runtime] ?? runtime;
    console.log(`  ${label.padEnd(14)} ${count}`);
  }
  console.log("");
  console.log(`标签分布（${tags.length} 个）`);
  const chunks = tags.map(([tag, count]) => `${tag}(${count})`);
  for (let i = 0; i < chunks.length; i += 6) console.log(`  ${chunks.slice(i, i + 6).join("  ")}`);
  console.log("");
  if (unreferencedMcps.length > 0) {
    console.log(`未被任何插件引用的 MCP（${unreferencedMcps.length}）：${unreferencedMcps.join(", ")}`);
  }
  if (unreferencedSkills.length > 0) {
    console.log(`未被任何插件引用的技能（${unreferencedSkills.length}）：${unreferencedSkills.join(", ")}`);
  }
  if (longestDescriptions.length > 0) {
    console.log("");
    console.log("最长的描述（每次请求都在提示词里）");
    for (const entry of longestDescriptions) {
      console.log(`  ${String(entry.description.length).padStart(4)} 字符  ${entry.kind}:${entry.id}`);
    }
  }
}

function printDelta(result) {
  const lines = [];
  for (const kind of KINDS) {
    for (const id of result.added[kind]) lines.push(`  + ${kind.slice(0, -1)}:${id}`);
    for (const id of result.removed[kind]) lines.push(`  - ${kind.slice(0, -1)}:${id}`);
  }
  if (lines.length === 0) {
    console.log("与基线相比内容无变化。");
  } else {
    console.log(`与基线相比的条目变化（${lines.length}）：`);
    for (const line of lines) console.log(line);
  }
  const sign = result.prompt.tokens >= 0 ? "+" : "";
  console.log(`系统提示词成本变化：${sign}${result.prompt.chars} 字符（≈ ${sign}${result.prompt.tokens} tokens）`);
}

async function main() {
  if (!existsSync(REGISTRY_PATH)) {
    console.error("registry.json not found; run `npm run registry` first.");
    process.exit(1);
  }
  const registry = await readRegistryFromDisk();
  const report = inventory(registry);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const revIndex = process.argv.indexOf("--diff");
  if (revIndex !== -1) {
    const rev = process.argv[revIndex + 1];
    if (!rev) {
      console.error("用法: node scripts/stats.mjs --diff <git 版本，如 origin/main>");
      process.exit(1);
    }
    let base;
    try {
      base = readRegistryAtRev(rev);
    } catch {
      console.log(`无法读取 ${rev}:registry.json（浅克隆或新分支），跳过对比。`);
      printHuman(report);
      return;
    }
    const result = delta(base, registry);
    printDelta(result);
    const markdown = [
      "## 市场条目变化",
      "",
      ...KINDS.flatMap((kind) =>
        [...result.added[kind].map((id) => `- 新增 ${kind.slice(0, -1)} \`${id}\``),
         ...result.removed[kind].map((id) => `- 移除 ${kind.slice(0, -1)} \`${id}\``)]),
      "",
      `系统提示词成本变化：${result.prompt.tokens >= 0 ? "+" : ""}${result.prompt.tokens} tokens` +
        `（${result.prompt.chars >= 0 ? "+" : ""}${result.prompt.chars} 字符）`,
      "",
    ].join("\n");
    console.log("");
    printHuman(report);
    // 供 GitHub Actions 汇总使用
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, "utf8");
    }
    return;
  }

  printHuman(report);
}

await main();
