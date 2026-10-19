#!/usr/bin/env node
// Validates the myna-hub repository (skills, MCP servers and plugins).
// No third-party dependencies.
//
// Usage:
//   node scripts/validate.mjs                   validate skills/, mcps/, plugins/ and registry.json
//   node scripts/validate.mjs --write-registry  regenerate registry.json from the three folders
//
// Exit code is non-zero on any inconsistency.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "skills");
const MCPS_DIR = join(ROOT, "mcps");
const PLUGINS_DIR = join(ROOT, "plugins");
const REGISTRY_PATH = join(ROOT, "registry.json");
const ID_RE = /^[a-z0-9-]+$/;

const errors = [];
const fail = (msg) => errors.push(msg);

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

async function loadSkills() {
  const skills = [];
  for (const id of await listDirs(SKILLS_DIR, "skills")) {
    if (!ID_RE.test(id)) {
      fail(`skills/${id}: invalid directory name; id must match [a-z0-9-]+`);
      continue;
    }
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
    if (body.trim() === "") {
      fail(`${rel}: body must not be empty`);
    }
    if (!nameOk || !descOk) continue;
    skills.push({
      id,
      name: data.name,
      description: data.description,
      tags,
      path: `skills/${id}`,
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
  if (["npx", "node", "npm", "pnpm", "yarn", "bun", "bunx", "deno"].includes(name)) return "node";
  if (["uvx", "uv", "python", "python3", "pipx"].includes(name)) return "uv";
  return "none";
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function loadMcps() {
  const mcps = [];
  for (const id of await listDirs(MCPS_DIR, "mcps")) {
    if (!ID_RE.test(id)) {
      fail(`mcps/${id}: invalid directory name; id must match [a-z0-9-]+`);
      continue;
    }
    const rel = `mcps/${id}/mcp.json`;
    const file = join(MCPS_DIR, id, "mcp.json");
    if (!existsSync(file)) {
      fail(`mcps/${id}: missing mcp.json`);
      continue;
    }
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
    if (!ok) continue;
    mcps.push({
      id,
      name: data.name,
      description: data.description,
      tags,
      runtime: inferRuntime(data.command),
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
    const rel = `plugins/${id}/plugin.json`;
    const file = join(PLUGINS_DIR, id, "plugin.json");
    if (!existsSync(file)) {
      fail(`plugins/${id}: missing plugin.json`);
      continue;
    }
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
    if (!ok) continue;
    const tags = parseTags(data.tags, rel);
    plugins.push({
      id,
      name: data.name,
      description: data.description,
      tags,
      path: `plugins/${id}`,
      skills: data.skills,
      mcps: data.mcps,
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
  }
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
  validateRegistryList(registry, "mcps", "mcp", mcps, null);
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

async function writeRegistry({ skills, mcps, plugins }) {
  let previous = {};
  try {
    previous = JSON.parse(await readFile(REGISTRY_PATH, "utf8"));
  } catch {
    // Start fresh when the file is missing or invalid.
  }
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

  await writeFile(
    REGISTRY_PATH,
    `${JSON.stringify(
      { version: 1, skills: skillEntries, mcps: mcpEntries, plugins: pluginEntries },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(
    `Wrote registry.json with ${skillEntries.length} skill(s), ${mcpEntries.length} MCP server(s) and ${pluginEntries.length} plugin(s).`,
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const skills = await loadSkills();
  const mcps = await loadMcps();
  const plugins = await loadPlugins();
  validatePluginReferences(plugins, skills, mcps);

  if (process.argv.includes("--write-registry")) {
    if (errors.length > 0) {
      report();
      process.exit(1);
    }
    await writeRegistry({ skills, mcps, plugins });
    return;
  }

  const registry = await loadRegistry();
  validateAll(registry, skills, mcps, plugins);
  report();
  if (errors.length > 0) process.exit(1);
  console.log(
    `OK: ${skills.length} skill(s), ${mcps.length} MCP server(s) and ${plugins.length} plugin(s) validated against registry.json.`,
  );
}

function report() {
  if (errors.length === 0) return;
  console.error(`Validation failed with ${errors.length} error(s):`);
  for (const err of errors) console.error(`  - ${err}`);
}

await main();
