#!/usr/bin/env node
// Validates the myna-hub repository (skills, MCP servers and plugins).
// No third-party dependencies.
//
// Usage:
//   node scripts/validate.mjs                    validate and report problems
//   node scripts/validate.mjs --strict           treat warnings as errors (used by the audit job)
//   node scripts/validate.mjs --json             machine-readable summary on stdout
//   node scripts/validate.mjs --write-registry   regenerate registry.json from the three folders
//   node scripts/validate.mjs --check-registry   fail when registry.json is out of date
//
// Exit code is non-zero on any error (or warning, with --strict).

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, posix } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "skills");
const MCPS_DIR = join(ROOT, "mcps");
const PLUGINS_DIR = join(ROOT, "plugins");
const REGISTRY_PATH = join(ROOT, "registry.json");
const ID_RE = /^[a-z0-9-]+$/;

// 上限按 Myna 的实际消费方式设定：技能与 MCP 的 name/description 会进入**每次请求**的
// 系统提示词（技能列表 + 插件段落），因此描述长度直接等于常驻 token 成本。
const LIMITS = {
  idMax: 32,
  nameMax: 24, // 超过后提示词里换行/挤压，仍可用但会警告
  nameHardMax: 40,
  descMax: 120, // 每次请求都在提示词里
  descHardMax: 200,
  tagsMax: 6,
  skillBodyWarn: 6000, // 正文只在 read_skill 时读取，仍不宜过长
  skillBodyHard: 20000,
  fileMaxBytes: 256 * 1024,
};

// 全仓库通用的标签词表；新标签需先在这里登记，保证搜索结果可用。
const KNOWN_TAGS = new Set([
  "ai", "automation", "browser", "calendar", "communication", "database", "debug",
  "developer", "files", "filesystem", "focus", "free", "git", "knowledge",
  "knowledge-graph", "memory", "native", "notes", "planning", "productivity",
  "reader", "reasoning", "reference", "research", "review", "routine", "search",
  "summary", "time", "translation", "utility", "weather", "web",
]);

// 运行时推断：与 Myna 客户端一致，安装前即可提示缺失的运行时。
const RUNTIME_BINARIES = {
  node: ["npx", "node", "npm", "pnpm", "yarn", "bun", "bunx", "deno"],
  uv: ["uvx", "uv", "python", "python3", "pipx"],
  none: ["docker", "git", "echo", "curl"],
};

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function listDirs(dir, label) {
  if (!existsSync(dir)) {
    fail(`${label}/ directory not found at ${dir}`);
    return [];
  }
  return (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function checkNonEmptyString(value, file, field) {
  if (typeof value !== "string") {
    fail(`${file}: "${field}" must be a string`);
    return false;
  }
  if (value.trim() === "") {
    fail(`${file}: "${field}" must not be empty`);
    return false;
  }
  if (value.includes("\n")) {
    fail(`${file}: "${field}" must be a single line`);
    return false;
  }
  return true;
}

async function readJsonObject(file, label) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    fail(`${label}: does not parse as JSON (${err.message})`);
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`${label}: top level must be an object`);
    return null;
  }
  return parsed;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 递归列出目录下的所有文件（相对仓库根的 posix 路径）。 */
async function walk(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const entry of await readdir(abs, { withFileTypes: true })) {
    const child = posix.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(child)));
    else out.push(child);
  }
  return out;
}

// 标签来源：frontmatter 里的 "a, b" 或 "[a, b]"，以及 JSON 里的字符串数组。
function parseTags(raw, file = "") {
  if (raw === undefined || raw === null || raw === "") return [];
  if (Array.isArray(raw)) {
    const bad = raw.some((t) => typeof t !== "string" || t.trim() === "");
    if (bad) {
      if (file) fail(`${file}: "tags" must be an array of non-empty strings`);
      return [];
    }
    return raw.map((t) => t.trim());
  }
  if (typeof raw === "string") {
    const text = raw.trim().replace(/^\[|\]$/g, "");
    return text.split(",").map((t) => t.trim()).filter((t) => t !== "");
  }
  if (file) fail(`${file}: "tags" must be a string or an array of strings`);
  return [];
}

/** 名称 / 描述的长度与形态检查（直接关系到提示词成本与列表可读性）。 */
function checkText(rel, field, value, hardMax, softMax) {
  if (typeof value !== "string") return;
  const length = [...value].length;
  if (length > hardMax) {
    fail(`${rel}: "${field}" is ${length} characters, limit is ${hardMax}`);
  } else if (length > softMax) {
    warn(`${rel}: "${field}" is ${length} characters (recommended ≤ ${softMax})`);
  }
  if (value !== value.trim()) fail(`${rel}: "${field}" has leading or trailing whitespace`);
  if (/ {2,}/.test(value)) warn(`${rel}: "${field}" contains repeated spaces`);
  // 脚手架留下的占位文案必须在合并前改掉，否则会直接进入提示词与市场列表。
  if (/待填写|placeholder|TODO|TBD/.test(value)) {
    fail(`${rel}: "${field}" still contains scaffold placeholder text`);
  }
  if (/[.!]$/.test(value) && field === "description") {
    warn(`${rel}: "${field}" should not end with punctuation (it is rendered inline)`);
  }
}

function checkTags(rel, tags) {
  if (tags.length > LIMITS.tagsMax) {
    fail(`${rel}: at most ${LIMITS.tagsMax} tags allowed (found ${tags.length})`);
  }
  const seen = new Set();
  for (const tag of tags) {
    if (!ID_RE.test(tag)) {
      fail(`${rel}: tag ${JSON.stringify(tag)} must match [a-z0-9-]+`);
      continue;
    }
    if (seen.has(tag)) fail(`${rel}: duplicate tag "${tag}"`);
    seen.add(tag);
    if (!KNOWN_TAGS.has(tag)) {
      warn(`${rel}: unknown tag "${tag}" (add it to KNOWN_TAGS in scripts/validate.mjs if intentional)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/** Parse a minimal subset of YAML frontmatter (scalar string values only). */
function parseFrontmatter(source, file) {
  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    fail(`${file}: missing YAML frontmatter (file must start with "---")`);
    return { data: {}, body: normalized };
  }
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    fail(`${file}: unterminated YAML frontmatter`);
    return { data: {}, body: normalized };
  }
  const header = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n/, "");
  const data = {};
  for (const rawLine of header.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) {
      fail(`${file}: invalid frontmatter line "${rawLine}"`);
      continue;
    }
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body };
}

function validateFrontmatterField(id, field, value) {
  if (value === undefined) {
    fail(`skills/${id}/SKILL.md: frontmatter is missing "${field}"`);
    return false;
  }
  if (value === "") {
    fail(`skills/${id}/SKILL.md: frontmatter "${field}" must not be empty`);
    return false;
  }
  if (value.includes("\n")) {
    fail(`skills/${id}/SKILL.md: frontmatter "${field}" must be a single line`);
    return false;
  }
  return true;
}

/** 正文质量：结构、占位符、体积。 */
function checkSkillBody(rel, body) {
  const length = [...body].length;
  if (body.trim() === "") {
    fail(`${rel}: body must not be empty`);
    return;
  }
  if (length > LIMITS.skillBodyHard) {
    fail(`${rel}: body is ${length} characters, limit is ${LIMITS.skillBodyHard}`);
  } else if (length > LIMITS.skillBodyWarn) {
    warn(`${rel}: body is ${length} characters; long bodies cost tokens on every read_skill`);
  }
  // 客户端展示时会在正文前加上 "# 名称"，因此正文不需要一级标题；
  // 长正文才要求分节，短步骤清单本身就是可读的。
  if (length > 1500 && !/^##\s+\S/m.test(body)) {
    warn(`${rel}: ${length}-character body has no "## " sections; long skills should be split`);
  }
  for (const marker of ["TODO", "FIXME", "TBD"]) {
    const line = body.split("\n").find((l) => new RegExp(`(^|\\s)${marker}(\\s|:|$)`).test(l));
    if (line) fail(`${rel}: unfinished "${marker}" marker: ${line.trim()}`);
  }
}

async function loadSkills() {
  const skills = [];
  for (const id of await listDirs(SKILLS_DIR, "skills")) {
    if (!ID_RE.test(id)) {
      fail(`skills/${id}: invalid directory name; id must match [a-z0-9-]+`);
      continue;
    }
    if (id.length > LIMITS.idMax) fail(`skills/${id}: id longer than ${LIMITS.idMax} characters`);
    const rel = `skills/${id}/SKILL.md`;
    const skillFile = join(SKILLS_DIR, id, "SKILL.md");
    if (!existsSync(skillFile)) {
      fail(`skills/${id}: missing SKILL.md`);
      continue;
    }
    const { data, body } = parseFrontmatter(await readFile(skillFile, "utf8"), rel);
    const tags = parseTags(data.tags);
    const nameOk = validateFrontmatterField(id, "name", data.name);
    const descOk = validateFrontmatterField(id, "description", data.description);
    checkSkillBody(rel, body);
    checkText(rel, "name", data.name, LIMITS.nameHardMax, LIMITS.nameMax);
    checkText(rel, "description", data.description, LIMITS.descHardMax, LIMITS.descMax);
    checkTags(rel, tags);
    if (!nameOk || !descOk) continue;
    skills.push({
      id,
      name: data.name,
      description: data.description,
      tags,
      path: `skills/${id}`,
      bodyLength: [...body].length,
    });
  }
  return skills;
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

// MCP 启动命令所需的外部运行时（供客户端提前提示，避免装完才发现命令不存在）。
function inferRuntime(command) {
  const name = String(command).split("/").pop().toLowerCase();
  for (const [runtime, binaries] of Object.entries(RUNTIME_BINARIES)) {
    if (binaries.includes(name)) return runtime;
  }
  return "none";
}

/** 机器相关路径在任何机器上都会失效，装到别人机器上等于装坏。 */
const MACHINE_PATH_RE = /(^|[\s"'=:])(\/(Users|home|opt\/home|root)\/|[A-Za-z]:\\\\)/;

function checkNotMachineSpecific(rel, field, value) {
  if (typeof value !== "string") return;
  const hit = value.match(MACHINE_PATH_RE);
  if (hit) fail(`${rel}: "${field}" contains a machine-specific path: ${value}`);
}

/** 常见凭据形态；hub 里出现即视为泄漏。 */
const SECRET_RES = [
  { name: "DeepSeek/OpenAI key", re: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: "GitHub token", re: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Slack token", re: /\bxox[abpsr]-[A-Za-z0-9-]{10,}/ },
];

function checkSecrets(rel, text) {
  for (const { name, re } of SECRET_RES) {
    if (re.test(text)) fail(`${rel}: looks like it contains a ${name}; never commit credentials`);
  }
}

async function loadMcps() {
  const mcps = [];
  for (const id of await listDirs(MCPS_DIR, "mcps")) {
    if (!ID_RE.test(id)) {
      fail(`mcps/${id}: invalid directory name; id must match [a-z0-9-]+`);
      continue;
    }
    if (id.length > LIMITS.idMax) fail(`mcps/${id}: id longer than ${LIMITS.idMax} characters`);
    const rel = `mcps/${id}/mcp.json`;
    const file = join(MCPS_DIR, id, "mcp.json");
    if (!existsSync(file)) {
      fail(`mcps/${id}: missing mcp.json`);
      continue;
    }
    const raw = await readFile(file, "utf8");
    checkSecrets(rel, raw);
    const data = await readJsonObject(file, rel);
    if (data === null) continue;

    let ok = true;
    if (data.id !== id) {
      fail(`${rel}: "id" must equal the directory name "${id}" (found ${JSON.stringify(data.id)})`);
      ok = false;
    }
    ok = checkNonEmptyString(data.name, rel, "name") && ok;
    ok = checkNonEmptyString(data.description, rel, "description") && ok;
    if (!checkNonEmptyString(data.command, rel, "command")) ok = false;
    if (!Array.isArray(data.args) || !data.args.every((a) => typeof a === "string")) {
      fail(`${rel}: "args" must be an array of strings`);
      ok = false;
    }
    if (!isPlainObject(data.env)) {
      fail(`${rel}: "env" must be an object`);
      ok = false;
    }
    const tags = parseTags(data.tags, rel);
    checkText(rel, "name", data.name, LIMITS.nameHardMax, LIMITS.nameMax);
    checkText(rel, "description", data.description, LIMITS.descHardMax, LIMITS.descMax);
    checkTags(rel, tags);
    checkNotMachineSpecific(rel, "command", data.command);
    for (const [i, arg] of (data.args ?? []).entries()) {
      checkNotMachineSpecific(rel, `args[${i}]`, arg);
      if (typeof arg === "string" && arg.trim() === "") fail(`${rel}: args[${i}] is empty`);
    }
    for (const [key, value] of Object.entries(data.env ?? {})) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
        fail(`${rel}: env key ${JSON.stringify(key)} must be UPPER_SNAKE_CASE`);
      }
      if (typeof value !== "string") {
        fail(`${rel}: env["${key}"] must be a string`);
        continue;
      }
      checkNotMachineSpecific(rel, `env["${key}"]`, value);
      if (value.trim() !== value) warn(`${rel}: env["${key}"] has surrounding whitespace`);
    }
    for (const unknown of Object.keys(data)) {
      if (!["id", "name", "description", "tags", "command", "args", "env"].includes(unknown)) {
        warn(`${rel}: unknown field "${unknown}" (ignored by the client)`);
      }
    }
    const runtime = inferRuntime(data.command);
    if (data.runtime !== undefined && data.runtime !== runtime) {
      warn(`${rel}: "runtime" is "${data.runtime}" but command implies "${runtime}"`);
    }
    if (!ok) continue;
    mcps.push({
      id,
      name: data.name,
      description: data.description,
      tags,
      runtime,
      path: `mcps/${id}`,
    });
  }
  return mcps;
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

async function loadPlugins() {
  const plugins = [];
  for (const id of await listDirs(PLUGINS_DIR, "plugins")) {
    if (!ID_RE.test(id)) {
      fail(`plugins/${id}: invalid directory name; id must match [a-z0-9-]+`);
      continue;
    }
    if (id.length > LIMITS.idMax) fail(`plugins/${id}: id longer than ${LIMITS.idMax} characters`);
    const rel = `plugins/${id}/plugin.json`;
    const file = join(PLUGINS_DIR, id, "plugin.json");
    if (!existsSync(file)) {
      fail(`plugins/${id}: missing plugin.json`);
      continue;
    }
    const raw = await readFile(file, "utf8");
    checkSecrets(rel, raw);
    const data = await readJsonObject(file, rel);
    if (data === null) continue;

    let ok = true;
    if (data.id !== id) {
      fail(`${rel}: "id" must equal the directory name "${id}" (found ${JSON.stringify(data.id)})`);
      ok = false;
    }
    ok = checkNonEmptyString(data.name, rel, "name") && ok;
    ok = checkNonEmptyString(data.description, rel, "description") && ok;
    if (!Array.isArray(data.skills) || !data.skills.every((s) => typeof s === "string")) {
      fail(`${rel}: "skills" must be an array of strings`);
      ok = false;
    }
    if (!Array.isArray(data.mcps) || !data.mcps.every((m) => typeof m === "string")) {
      fail(`${rel}: "mcps" must be an array of strings`);
      ok = false;
    }
    if (
      Array.isArray(data.skills) &&
      Array.isArray(data.mcps) &&
      data.skills.length === 0 &&
      data.mcps.length === 0
    ) {
      fail(`${rel}: "skills" and "mcps" must not both be empty`);
      ok = false;
    }
    for (const field of ["skills", "mcps"]) {
      const list = data[field];
      if (!Array.isArray(list)) continue;
      if (new Set(list).size !== list.length) fail(`${rel}: "${field}" contains duplicates`);
      if (list.includes(id)) fail(`${rel}: "${field}" must not reference the plugin itself`);
    }
    const tags = parseTags(data.tags, rel);
    checkText(rel, "name", data.name, LIMITS.nameHardMax, LIMITS.nameMax);
    checkText(rel, "description", data.description, LIMITS.descHardMax, LIMITS.descMax);
    checkTags(rel, tags);
    if (!existsSync(join(PLUGINS_DIR, id, "README.md"))) {
      warn(`plugins/${id}: missing README.md (explains the workflow to contributors)`);
    }
    if (!ok) continue;
    plugins.push({
      id,
      name: data.name,
      description: data.description,
      tags,
      path: `plugins/${id}`,
      skills: data.skills,
      mcps: data.mcps,
      instructions: typeof data.instructions === "string" ? data.instructions : "",
    });
  }
  return plugins;
}

/** Ensure every referenced skill/mcp id exists in this repository. */
function validatePluginReferences(plugins, skills, mcps) {
  const skillIds = new Set(skills.map((s) => s.id));
  const mcpIds = new Set(mcps.map((m) => m.id));
  for (const plugin of plugins) {
    for (const id of plugin.skills) {
      if (!skillIds.has(id)) {
        fail(`plugins/${plugin.id}/plugin.json: references unknown skill "${id}"`);
      }
    }
    for (const id of plugin.mcps) {
      if (!mcpIds.has(id)) {
        fail(`plugins/${plugin.id}/plugin.json: references unknown mcp "${id}"`);
      }
    }
    if (plugin.instructions) {
      checkText(`plugins/${plugin.id}/plugin.json`, "instructions",
        plugin.instructions, 2000, 600);
    }
  }
}

// ---------------------------------------------------------------------------
// Quality gates (cross-cutting)
// ---------------------------------------------------------------------------

/** 相对 markdown 链接必须指向仓库内真实存在的文件。 */
async function checkMarkdownLinks(files) {
  for (const rel of files) {
    if (!rel.endsWith(".md")) continue;
    const text = await readFile(join(ROOT, rel), "utf8");
    checkSecrets(rel, text);
    const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    for (const match of text.matchAll(linkRe)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      if (target.startsWith("/")) {
        fail(`${rel}: absolute link "${target}" (use a path relative to the file)`);
        continue;
      }
      const [pathPart] = target.split("#");
      if (pathPart === "") continue;
      const resolved = posix.normalize(posix.join(posix.dirname(rel), pathPart));
      if (resolved.startsWith("..")) {
        fail(`${rel}: link "${target}" escapes the repository`);
      } else if (!existsSync(join(ROOT, resolved))) {
        fail(`${rel}: link "${target}" does not resolve to ${resolved}`);
      }
    }
  }
}

/** 仓库卫生：体积、垃圾文件、符号链接。 */
async function checkHygiene(files) {
  for (const rel of files) {
    if (/(^|\/)\.DS_Store$/.test(rel)) fail(`${rel}: macOS metadata file must not be committed`);
    if (/(^|\/)(node_modules|\.cache)\//.test(rel)) fail(`${rel}: vendored directory must not be committed`);
    if (rel.startsWith("dist/") || rel.startsWith(".tmp/")) fail(`${rel}: build output must not be committed`);
    const info = await stat(join(ROOT, rel));
    if (info.isSymbolicLink()) fail(`${rel}: symlinks are not allowed in the hub`);
    if (info.size > LIMITS.fileMaxBytes) {
      fail(`${rel}: ${Math.round(info.size / 1024)} KB exceeds the ${LIMITS.fileMaxBytes / 1024} KB limit`);
    }
  }
}

/** 跨条目检查：重名、重复描述、标签分布、提示词成本。 */
function checkCrossItem(skills, mcps, plugins) {
  const all = [
    ...skills.map((s) => ({ kind: "skill", item: s })),
    ...mcps.map((m) => ({ kind: "mcp", item: m })),
    ...plugins.map((p) => ({ kind: "plugin", item: p })),
  ];

  const byName = new Map();
  const byDesc = new Map();
  for (const { kind, item } of all) {
    const nameKey = `${kind}:${item.name}`;
    if (byName.has(nameKey)) {
      warn(`${kind}s "${item.id}" and "${byName.get(nameKey)}" share the name "${item.name}"`);
    } else {
      byName.set(nameKey, item.id);
    }
    const descKey = `${kind}:${item.description.toLowerCase()}`;
    if (byDesc.has(descKey)) {
      fail(`${kind}s "${item.id}" and "${byDesc.get(descKey)}" have identical descriptions`);
    } else {
      byDesc.set(descKey, item.id);
    }
  }

  // 系统提示词里只放「名称 + 描述」，这里量化常驻成本，便于控制描述长度。
  const promptChars = skills.reduce(
    (sum, s) => sum + s.name.length + s.description.length + s.id.length + 12, 0);
  const promptCharsWithPlugins = promptChars + plugins.reduce(
    (sum, p) => sum + p.name.length + p.description.length + p.instructions.length + 12, 0);

  const tagCounts = new Map();
  for (const { item } of all) {
    for (const tag of item.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  // 标签分布只作统计（scripts/stats.mjs 里展示），不当作告警：小仓库里单次使用很正常。
  const coverage = new Map();
  for (const plugin of plugins) {
    for (const id of plugin.skills) coverage.set(id, (coverage.get(id) ?? 0) + 1);
  }

  return { promptChars, promptCharsWithPlugins, tagCounts, coverage, total: all.length };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

async function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    fail("registry.json not found");
    return null;
  }
  const parsed = await readJsonObject(REGISTRY_PATH, "registry.json");
  if (parsed === null) return null;
  if (parsed.version !== 1) {
    fail(`registry.json: "version" must be 1 (found ${JSON.stringify(parsed.version)})`);
  }
  let valid = true;
  for (const key of ["skills", "mcps", "plugins"]) {
    if (!Array.isArray(parsed[key])) {
      fail(`registry.json: "${key}" must be an array`);
      valid = false;
    }
  }
  return valid ? parsed : null;
}

function sameStringSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

/** Validate one registry array against the items discovered on disk. */
function validateRegistryList(registry, key, label, items, compareExtra) {
  const list = registry[key];
  const byId = new Map();
  for (const entry of list) {
    if (!isPlainObject(entry)) {
      fail(`registry.json: each ${label} entry must be an object`);
      continue;
    }
    if (typeof entry.id !== "string" || !ID_RE.test(entry.id)) {
      fail(`registry.json: invalid ${label} entry id ${JSON.stringify(entry.id)}`);
      continue;
    }
    if (byId.has(entry.id)) {
      fail(`registry.json: duplicate entry for ${label} id "${entry.id}"`);
      continue;
    }
    byId.set(entry.id, entry);
  }

  const itemIds = new Set(items.map((i) => i.id));
  for (const id of itemIds) {
    if (!byId.has(id)) fail(`registry.json: missing entry for ${label} "${id}"`);
  }
  for (const id of byId.keys()) {
    if (!itemIds.has(id)) {
      fail(`registry.json: entry "${id}" has no matching ${key}/${id}/ directory`);
    }
  }

  const allowedKeys = new Set([
    "id", "name", "description", "tags", "author", "path",
    ...(label === "mcp" ? ["runtime"] : []),
    ...(label === "plugin" ? ["skills", "mcps"] : []),
  ]);

  for (const item of items) {
    const entry = byId.get(item.id);
    if (!entry) continue;
    if (entry.name !== item.name) {
      fail(
        `registry.json: "${item.id}" name mismatch (registry ${JSON.stringify(
          entry.name,
        )} != ${JSON.stringify(item.name)})`,
      );
    }
    if (entry.description !== item.description) {
      fail(
        `registry.json: "${item.id}" description mismatch (registry ${JSON.stringify(
          entry.description,
        )} != ${JSON.stringify(item.description)})`,
      );
    }
    const expectedPath = item.path;
    if (entry.path !== expectedPath) {
      fail(
        `registry.json: "${item.id}" path must be "${expectedPath}" (found ${JSON.stringify(
          entry.path,
        )})`,
      );
    }
    if (!sameStringSet(entry.tags, item.tags)) {
      fail(`registry.json: "${item.id}" tags mismatch (run --write-registry)`);
    }
    if (checkNonEmptyString(entry.author, `registry.json: "${item.id}"`, "author")) {
      if (!/^[A-Za-z0-9-]+$/.test(entry.author)) {
        warn(`registry.json: "${item.id}" author should be a GitHub handle`);
      }
    }
    for (const unknown of Object.keys(entry)) {
      if (!allowedKeys.has(unknown)) {
        warn(`registry.json: "${item.id}" has unknown field "${unknown}"`);
      }
    }
    if (compareExtra) compareExtra(entry, item);
  }

  const ids = list.filter((e) => isPlainObject(e) && typeof e.id === "string").map((e) => e.id);
  const sorted = [...ids].sort();
  if (JSON.stringify(ids) !== JSON.stringify(sorted)) {
    fail(`registry.json: ${label} must be sorted by id`);
  }
}

function validateAll(registry, skills, mcps, plugins) {
  if (registry === null) return;
  validateRegistryList(registry, "skills", "skill", skills, null);
  validateRegistryList(registry, "mcps", "mcp", mcps, (entry, item) => {
    if (entry.runtime !== item.runtime) {
      fail(`registry.json: "${item.id}" runtime must be "${item.runtime}" (found ${JSON.stringify(entry.runtime)})`);
    }
  });
  validateRegistryList(registry, "plugins", "plugin", plugins, (entry, item) => {
    if (!Array.isArray(entry.skills) || !entry.skills.every((s) => typeof s === "string")) {
      fail(`registry.json: plugins "${item.id}" skills must be an array of strings`);
    } else if (!sameStringSet(entry.skills, item.skills)) {
      fail(`registry.json: "${item.id}" skills mismatch`);
    }
    if (!Array.isArray(entry.mcps) || !entry.mcps.every((m) => typeof m === "string")) {
      fail(`registry.json: plugins "${item.id}" mcps must be an array of strings`);
    } else if (!sameStringSet(entry.mcps, item.mcps)) {
      fail(`registry.json: "${item.id}" mcps mismatch`);
    }
  });
}

// ---------------------------------------------------------------------------
// Registry generation
// ---------------------------------------------------------------------------

function buildRegistry({ skills, mcps, plugins }, previous = {}) {
  const prevFor = (key) => {
    const list = Array.isArray(previous[key]) ? previous[key] : [];
    return new Map(
      list
        .filter((e) => isPlainObject(e) && typeof e.id === "string")
        .map((e) => [e.id, e]),
    );
  };
  // 标签优先取各文件自身的声明；未声明时沿用旧注册表的值，避免历史标签丢失。
  const meta = (old, derived) => ({
    tags: derived.length > 0 ? derived : (Array.isArray(old.tags) ? old.tags : []),
    author: typeof old.author === "string" ? old.author : "quyansiyuanwang",
  });

  const prevSkills = prevFor("skills");
  const prevMcps = prevFor("mcps");
  const prevPlugins = prevFor("plugins");

  const skillEntries = skills.map((item) => {
    const old = prevSkills.get(item.id) ?? {};
    return { id: item.id, name: item.name, description: item.description, ...meta(old, item.tags), path: item.path };
  });
  const mcpEntries = mcps.map((item) => {
    const old = prevMcps.get(item.id) ?? {};
    return { id: item.id, name: item.name, description: item.description, ...meta(old, item.tags),
             runtime: item.runtime, path: item.path };
  });
  const pluginEntries = plugins.map((item) => {
    const old = prevPlugins.get(item.id) ?? {};
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      ...meta(old, item.tags),
      path: item.path,
      skills: item.skills,
      mcps: item.mcps,
    };
  });

  return { version: 1, skills: skillEntries, mcps: mcpEntries, plugins: pluginEntries };
}

function registryText(registry) {
  // 每个条目一行内联字段 + 固定键序，保证 diff 只出现在真正变化的地方。
  return `${JSON.stringify(registry, null, 2)}\n`;
}

async function writeRegistry(targets) {
  let previous = {};
  try {
    previous = JSON.parse(await readFile(REGISTRY_PATH, "utf8"));
  } catch {
    // Start fresh when the file is missing or invalid.
  }
  const registry = buildRegistry(targets, previous);
  await writeFile(REGISTRY_PATH, registryText(registry), "utf8");
  console.log(
    `Wrote registry.json with ${registry.skills.length} skill(s), ` +
    `${registry.mcps.length} MCP server(s) and ${registry.plugins.length} plugin(s).`,
  );
  return registry;
}

async function checkRegistryDrift(targets) {
  if (!existsSync(REGISTRY_PATH)) {
    fail("registry.json not found");
    return;
  }
  const onDisk = await readFile(REGISTRY_PATH, "utf8");
  let previous = {};
  try {
    previous = JSON.parse(onDisk);
  } catch {
    return; // 解析失败已在 loadRegistry 里报过
  }
  const expected = registryText(buildRegistry(targets, previous));
  if (onDisk !== expected) {
    fail("registry.json is out of date; run `npm run registry` and commit the result");
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const strict = process.argv.includes("--strict");
  const json = process.argv.includes("--json");
  const skills = await loadSkills();
  const mcps = await loadMcps();
  const plugins = await loadPlugins();
  validatePluginReferences(plugins, skills, mcps);

  // 仓库内所有文件（卫生、密钥、链接）
  const files = [
    ...(await walk("skills")),
    ...(await walk("mcps")),
    ...(await walk("plugins")),
  ];
  await checkHygiene(files);
  await checkMarkdownLinks(files);
  const stats = checkCrossItem(skills, mcps, plugins);

  if (process.argv.includes("--write-registry")) {
    if (errors.length > 0) {
      report();
      process.exit(1);
    }
    await writeRegistry({ skills, mcps, plugins });
    return;
  }

  if (process.argv.includes("--check-registry")) {
    await checkRegistryDrift({ skills, mcps, plugins });
  }

  const registry = await loadRegistry();
  validateAll(registry, skills, mcps, plugins);
  if (strict) {
    errors.push(...warnings.splice(0));
  }
  report();

  const summary = {
    skills: skills.length,
    mcps: mcps.length,
    plugins: plugins.length,
    errors: errors.length,
    warnings: warnings.length,
    promptChars: stats.promptChars,
    promptCharsWithPlugins: stats.promptCharsWithPlugins,
    tags: Object.fromEntries([...stats.tagCounts].sort()),
  };
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else if (errors.length === 0) {
    const tail = warnings.length === 0 ? "" : `, ${warnings.length} warning(s)`;
    console.log(
      `OK: ${skills.length} skill(s), ${mcps.length} MCP server(s) and ` +
      `${plugins.length} plugin(s) validated against registry.json${tail}.`,
    );
  }
  if (errors.length > 0) process.exit(1);
}

function report() {
  if (warnings.length > 0) {
    console.error(`Warnings (${warnings.length}):`);
    for (const msg of warnings) console.error(`  ! ${msg}`);
  }
  if (errors.length === 0) return;
  console.error(`Validation failed with ${errors.length} error(s):`);
  for (const err of errors) console.error(`  - ${err}`);
}

await main();
