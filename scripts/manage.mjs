#!/usr/bin/env node
// Adds or removes a hub item and keeps registry.json in sync.
//
// Usage:
//   node scripts/manage.mjs new skill <id> [--name 名称] [--desc 描述] [--tags a,b]
//   node scripts/manage.mjs new mcp <id> [--name 名称] [--desc 描述] [--tags a,b]
//                                        [--command npx] [--args a,b] [--env KEY=VALUE ...]
//   node scripts/manage.mjs new plugin <id> [--name 名称] [--desc 描述] [--tags a,b]
//                                           [--skills a,b] [--mcps c,d] [--instructions "…"]
//   node scripts/manage.mjs remove <skill|mcp|plugin> <id> [--force]
//
// No third-party dependencies.

import { readdir, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ID_RE = /^[a-z0-9-]+$/;
const DIRS = { skill: "skills", mcp: "mcps", plugin: "plugins" };

function die(message) {
  console.error(`错误: ${message}`);
  process.exit(1);
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      flags._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    if (key === "env") {
      flags.env = [...(flags.env ?? []), next];
    } else {
      flags[key] = next;
    }
    i += 1;
  }
  return flags;
}

function list(value) {
  if (value === undefined || value === true) return [];
  return String(value).split(",").map((v) => v.trim()).filter((v) => v !== "");
}

/** 复用校验器的注册表生成，避免两处逻辑漂移。内容有错时不写注册表，交由 npm run check 报出。 */
function regenerateRegistry() {
  try {
    execFileSync("node", [join(ROOT, "scripts", "validate.mjs"), "--write-registry"], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch {
    console.error("\nregistry.json 未更新：先修正上面的问题，再运行 `npm run registry`。");
    process.exitCode = 1;
  }
}

async function readRegistry() {
  return JSON.parse(await readFile(join(ROOT, "registry.json"), "utf8"));
}

function validateId(id, kind) {
  if (id === undefined) die(`缺少 ${kind} 的 id`);
  if (!ID_RE.test(id)) die(`id ${JSON.stringify(id)} 必须匹配 [a-z0-9-]+（小写字母、数字、连字符）`);
  if (id.length > 32) die(`id 过长（上限 32 字符）`);
}

function defaults(flags, id) {
  return {
    name: typeof flags.name === "string" ? flags.name : id,
    description: typeof flags.desc === "string" ? flags.desc : `待填写：${id} 的一句话说明`,
    tags: list(flags.tags),
  };
}

function tagsLine(tags) {
  return tags.length > 0 ? `\ntags: ${tags.join(", ")}` : "";
}

async function newSkill(flags, id) {
  const { name, description, tags } = defaults(flags, id);
  const dir = join(ROOT, DIRS.skill, id);
  if (existsSync(dir)) die(`skills/${id} 已存在`);
  await mkdir(dir, { recursive: true });
  const body = `---
name: ${name}
description: ${description}${tagsLine(tags)}
---
目标：${description}

1. 第一步要做什么（调用哪个工具、取哪些参数）。
2. 第二步要做什么。
3. 输出格式：最终回复应当包含什么。

注意：
- 需要用户确认的动作先询问。
- 失败时说明原因与可行的替代方案。
`;
  await writeFile(join(dir, "SKILL.md"), body, "utf8");
  console.log(`已创建 skills/${id}/SKILL.md`);
}

async function newMcp(flags, id) {
  const { name, description, tags } = defaults(flags, id);
  const dir = join(ROOT, DIRS.mcp, id);
  if (existsSync(dir)) die(`mcps/${id} 已存在`);
  const command = typeof flags.command === "string" ? flags.command : "npx";
  const args = list(flags.args);
  if (args.length === 0) args.push("-y", `@modelcontextprotocol/server-${id}`);
  const env = {};
  for (const pair of flags.env ?? []) {
    const index = pair.indexOf("=");
    if (index <= 0) die(`--env 需要 KEY=VALUE 形式，收到 ${pair}`);
    env[pair.slice(0, index)] = pair.slice(index + 1);
  }
  await mkdir(dir, { recursive: true });
  const payload = {
    id,
    name,
    description,
    tags,
    command,
    args,
    env: Object.keys(env).length > 0 ? env : {},
  };
  await writeFile(join(dir, "mcp.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`已创建 mcps/${id}/mcp.json（命令：${command} ${args.join(" ")}）`);
  if (command === "npx" || command === "uvx") {
    console.log(`提示：该服务器需要外部运行时可执行 ${command}，README 中请说明。`);
  }
}

async function newPlugin(flags, id) {
  const { name, description, tags } = defaults(flags, id);
  const skills = list(flags.skills);
  const mcps = list(flags.mcps);
  if (skills.length === 0 && mcps.length === 0) {
    die("插件至少要引用一个技能或 MCP：--skills a,b 或 --mcps c,d");
  }
  const registry = await readRegistry();
  const knownSkills = new Set(registry.skills.map((s) => s.id));
  const knownMcps = new Set(registry.mcps.map((m) => m.id));
  for (const ref of skills) if (!knownSkills.has(ref)) die(`未知技能 "${ref}"`);
  for (const ref of mcps) if (!knownMcps.has(ref)) die(`未知 MCP "${ref}"`);
  const dir = join(ROOT, DIRS.plugin, id);
  if (existsSync(dir)) die(`plugins/${id} 已存在`);
  await mkdir(dir, { recursive: true });
  const instructions = typeof flags.instructions === "string" ? flags.instructions : "";
  const payload = { id, name, description, tags, skills, mcps, ...(instructions ? { instructions } : {}) };
  await writeFile(join(dir, "plugin.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const readme = `# ${name}

${description}

## 组成

${skills.map((s) => `- 技能 \`${s}\``).join("\n")}${skills.length > 0 && mcps.length > 0 ? "\n" : ""}${mcps.map((m) => `- MCP \`${m}\``).join("\n")}

## 使用

安装后在 Myna 中启用该插件，随后直接描述任务即可；助手会按上面技能与 MCP 的组合处理。

## 依赖

${mcps.length === 0 ? "无外部运行时依赖。" : "需要使用 Node（`npx`）或 uv（`uvx`），安装前在「设置 → 诊断」确认运行时可用。"}
`;
  await writeFile(join(dir, "README.md"), readme, "utf8");
  console.log(`已创建 plugins/${id}/plugin.json 与 README.md`);
}

/** 删除前检查插件引用，避免留下悬空引用。 */
async function pluginRefs(kind, id) {
  const registry = await readRegistry();
  const field = kind === "skill" ? "skills" : "mcps";
  return registry.plugins
    .filter((plugin) => (plugin[field] ?? []).includes(id))
    .map((plugin) => plugin.id);
}

async function stripRefs(kind, id, plugins) {
  const field = kind === "skill" ? "skills" : "mcps";
  for (const plugin of plugins) {
    const path = join(ROOT, DIRS.plugin, plugin, "plugin.json");
    const data = JSON.parse(await readFile(path, "utf8"));
    data[field] = (data[field] ?? []).filter((ref) => ref !== id);
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(`已从 plugins/${plugin} 移除对 ${id} 的引用`);
  }
}

async function remove(flags, kind, id) {
  if (!DIRS[kind]) die(`未知类型 "${kind}"，应为 skill / mcp / plugin`);
  validateId(id, kind);
  const dir = join(ROOT, DIRS[kind], id);
  if (!existsSync(dir)) die(`${DIRS[kind]}/${id} 不存在`);
  if (kind === "plugin") {
    const info = await stat(dir);
    if (!info.isDirectory()) die(`${DIRS[kind]}/${id} 不是目录`);
  }
  if (kind !== "plugin") {
    const refs = await pluginRefs(kind, id);
    if (refs.length > 0) {
      if (!flags.force) {
        die(`${id} 被插件引用：${refs.join(", ")}；先调整插件，或加 --force 自动移除引用`);
      }
      await stripRefs(kind, id, refs);
    }
  }
  await rm(dir, { recursive: true });
  console.log(`已删除 ${DIRS[kind]}/${id}`);
  regenerateRegistry();
}

async function main() {
  const [action, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const [kind, id] = flags._;

  switch (action) {
    case "new":
      if (!DIRS[kind]) die(`未知类型 "${kind}"，应为 skill / mcp / plugin`);
      validateId(id, kind);
      if (kind === "skill") await newSkill(flags, id);
      if (kind === "mcp") await newMcp(flags, id);
      if (kind === "plugin") await newPlugin(flags, id);
      regenerateRegistry();
      console.log("接下来：npm run check");
      break;
    case "remove":
      await remove(flags, kind, id);
      console.log("接下来：npm run check");
      break;
    default:
      console.log(`用法：
  node scripts/manage.mjs new skill <id> [--name 名称] [--desc 描述] [--tags a,b]
  node scripts/manage.mjs new mcp <id> [--name 名称] [--desc 描述] [--tags a,b] [--command npx] [--args a,b] [--env KEY=VALUE]
  node scripts/manage.mjs new plugin <id> [--name 名称] [--desc 描述] [--tags a,b] [--skills a,b] [--mcps c,d]
  node scripts/manage.mjs remove <skill|mcp|plugin> <id> [--force]`);
      process.exit(action === undefined ? 0 : 1);
  }
}

await main();
