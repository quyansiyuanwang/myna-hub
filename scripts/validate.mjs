#!/usr/bin/env node
// Validates the myna-skills repository. No third-party dependencies.
//
// Usage:
//   node scripts/validate.mjs                 validate skills/ and registry.json
//   node scripts/validate.mjs --write-registry  regenerate registry.json from skills/
//
// Exit code is non-zero on any inconsistency.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "skills");
const REGISTRY_PATH = join(ROOT, "registry.json");
const ID_RE = /^[a-z0-9-]+$/;

const errors = [];
const fail = (msg) => errors.push(msg);

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
  if (!existsSync(SKILLS_DIR)) {
    fail(`skills/ directory not found at ${SKILLS_DIR}`);
    return [];
  }
  const entries = (await readdir(SKILLS_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const skills = [];
  for (const id of entries) {
    if (!ID_RE.test(id)) {
      fail(
        `skills/${id}: invalid directory name; id must match [a-z0-9-]+`,
      );
      continue;
    }
    const skillFile = join(SKILLS_DIR, id, "SKILL.md");
    if (!existsSync(skillFile)) {
      fail(`skills/${id}: missing SKILL.md`);
      continue;
    }
    const rel = `skills/${id}/SKILL.md`;
    const { data, body } = parseFrontmatter(await readFile(skillFile, "utf8"), rel);
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
      path: `skills/${id}`,
    });
  }
  return skills;
}

async function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    fail("registry.json not found");
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(REGISTRY_PATH, "utf8"));
  } catch (err) {
    fail(`registry.json: does not parse as JSON (${err.message})`);
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("registry.json: top level must be an object");
    return null;
  }
  if (parsed.version !== 1) {
    fail(`registry.json: "version" must be 1 (found ${JSON.stringify(parsed.version)})`);
  }
  if (!Array.isArray(parsed.skills)) {
    fail('registry.json: "skills" must be an array');
    return null;
  }
  return parsed;
}

function validateRegistryAgainstSkills(registry, skills) {
  if (registry === null) return;
  const byId = new Map();
  for (const entry of registry.skills) {
    if (entry === null || typeof entry !== "object") {
      fail(`registry.json: each skill entry must be an object`);
      continue;
    }
    if (typeof entry.id !== "string" || !ID_RE.test(entry.id)) {
      fail(`registry.json: invalid entry id ${JSON.stringify(entry.id)}`);
      continue;
    }
    if (byId.has(entry.id)) {
      fail(`registry.json: duplicate entry for id "${entry.id}"`);
      continue;
    }
    byId.set(entry.id, entry);
  }

  const skillIds = new Set(skills.map((s) => s.id));
  for (const id of skillIds) {
    if (!byId.has(id)) {
      fail(`registry.json: missing entry for skill "${id}"`);
    }
  }
  for (const id of byId.keys()) {
    if (!skillIds.has(id)) {
      fail(`registry.json: entry "${id}" has no matching skills/${id}/ directory`);
    }
  }

  for (const skill of skills) {
    const entry = byId.get(skill.id);
    if (!entry) continue;
    if (entry.name !== skill.name) {
      fail(
        `registry.json: "${skill.id}" name mismatch (registry ${JSON.stringify(
          entry.name,
        )} != frontmatter ${JSON.stringify(skill.name)})`,
      );
    }
    if (entry.description !== skill.description) {
      fail(
        `registry.json: "${skill.id}" description mismatch (registry ${JSON.stringify(
          entry.description,
        )} != frontmatter ${JSON.stringify(skill.description)})`,
      );
    }
    const expectedPath = `skills/${skill.id}`;
    if (entry.path !== expectedPath) {
      fail(
        `registry.json: "${skill.id}" path must be "${expectedPath}" (found ${JSON.stringify(
          entry.path,
        )})`,
      );
    }
  }

  const ids = registry.skills
    .filter((e) => e && typeof e.id === "string")
    .map((e) => e.id);
  const sorted = [...ids].sort();
  if (JSON.stringify(ids) !== JSON.stringify(sorted)) {
    fail("registry.json: skills must be sorted by id");
  }
}

async function writeRegistry(skills) {
  let previous = { skills: [] };
  try {
    previous = JSON.parse(await readFile(REGISTRY_PATH, "utf8"));
  } catch {
    // Start fresh when the file is missing or invalid.
  }
  const prevById = new Map(
    (Array.isArray(previous.skills) ? previous.skills : [])
      .filter((e) => e && typeof e.id === "string")
      .map((e) => [e.id, e]),
  );

  const entries = skills.map((skill) => {
    const old = prevById.get(skill.id) ?? {};
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: Array.isArray(old.tags) ? old.tags : [],
      author: typeof old.author === "string" ? old.author : "quyansiyuanwang",
      path: skill.path,
    };
  });

  await writeFile(
    REGISTRY_PATH,
    `${JSON.stringify({ version: 1, skills: entries }, null, 2)}\n`,
    "utf8",
  );
  console.log(`Wrote registry.json with ${entries.length} skill(s).`);
}

async function main() {
  const skills = await loadSkills();
  if (process.argv.includes("--write-registry")) {
    if (errors.length > 0) {
      report();
      process.exit(1);
    }
    await writeRegistry(skills);
    return;
  }
  const registry = await loadRegistry();
  validateRegistryAgainstSkills(registry, skills);
  report();
  if (errors.length > 0) process.exit(1);
  console.log(`OK: ${skills.length} skill(s) validated against registry.json.`);
}

function report() {
  if (errors.length === 0) return;
  console.error(`Validation failed with ${errors.length} error(s):`);
  for (const err of errors) console.error(`  - ${err}`);
}

await main();
