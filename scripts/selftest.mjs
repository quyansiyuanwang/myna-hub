#!/usr/bin/env node
// Self-test for the validator: applies one deliberate defect per case to a scratch copy
// of the hub and asserts that the validator rejects it (and accepts a clean copy).
// This keeps the checks themselves from silently regressing.
//
// Usage:
//   node scripts/selftest.mjs          run every case
//   node scripts/selftest.mjs --keep   keep the scratch copies for inspection
//
// No third-party dependencies.

import { cp, mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function copyRepo(target) {
  await cp(ROOT, target, {
    recursive: true,
    filter: (src) => !src.includes("/.git") && !src.includes("node_modules") && !src.includes("/.tmp"),
  });
}

function run(root, args) {
  const result = spawnSync("node", [join(root, "scripts", "validate.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    code: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

async function editJson(root, rel, mutate) {
  const path = join(root, rel);
  const data = JSON.parse(await readFile(path, "utf8"));
  mutate(data);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const append = async (root, rel, text) => {
  const path = join(root, rel);
  await writeFile(path, `${await readFile(path, "utf8")}${text}`, "utf8");
};

const CASES = [];
CASES.push(
  { name: "干净副本通过", expectCode: 0, apply: async () => {} },
  {
    name: "描述超过硬上限",
    contains: "limit is 200",
    apply: async (root) => {
      const before = await readFile(join(root, "registry.json"), "utf8");
      const desc = "很长".repeat(120);
      await editJson(root, "registry.json", (r) => { r.skills[0].description = desc; });
      // 同步改源文件，确保命中的是长度检查而不是注册表不一致
      const id = JSON.parse(before).skills[0].id;
      const rel = `skills/${id}/SKILL.md`;
      const text = await readFile(join(root, rel), "utf8");
      await writeFile(join(root, rel), text.replace(/^description: .*$/m, `description: ${desc}`), "utf8");
    },
  },
  {
    name: "脚手架占位文案",
    contains: "scaffold placeholder",
    apply: async (root) => {
      const rel = "skills/daily-report/SKILL.md";
      const text = await readFile(join(root, rel), "utf8");
      await writeFile(join(root, rel), text.replace(/^description: .*$/m, "description: 待填写：日报的一句话说明"), "utf8");
      await editJson(root, "registry.json", (r) => {
        r.skills.find((s) => s.id === "daily-report").description = "待填写：日报的一句话说明";
      });
    },
  },
  {
    name: "MCP 参数含本机路径",
    contains: "machine-specific path",
    apply: async (root) => {
      await editJson(root, "mcps/filesystem/mcp.json", (m) => {
        m.args = ["-y", "@modelcontextprotocol/server-filesystem", "/Users/someone/Documents"];
      });
    },
  },
  {
    name: "技能里出现密钥",
    contains: "never commit credentials",
    apply: (root) => append(root, "skills/daily-report/SKILL.md",
      "\n例如把 sk-a4a316eff40940aeb6c318ec464f25b3 填进去。\n"),
  },
  {
    name: "相对链接指向不存在的文件",
    contains: "does not resolve",
    apply: (root) => append(root, "skills/daily-report/SKILL.md", "\n参见 [细节](details.md)。\n"),
  },
  {
    name: "注册表被手改（条目多余）",
    contains: "no matching",
    apply: (root) => editJson(root, "registry.json", (r) => {
      r.skills.push({ id: "ghost", name: "幽灵", description: "不存在", tags: [], author: "quyansiyuanwang", path: "skills/ghost" });
      r.skills.sort((a, b) => a.id.localeCompare(b.id));
    }),
  },
  {
    name: "注册表漂移（未重新生成）",
    contains: "out of date",
    args: ["--check-registry"],
    apply: (root) => editJson(root, "registry.json", (r) => {
      r.skills[0].tags = [...(r.skills[0].tags ?? []), "manual-edit"];
      r.skills[0].tags.sort();
    }),
  },
  {
    name: "插件引用不存在的技能",
    contains: "references unknown skill",
    apply: (root) => editJson(root, "plugins/dev-pack/plugin.json", (p) => {
      p.skills = [...p.skills, "missing-skill"];
    }),
  },
  {
    name: "未知标签只是警告（普通模式通过）",
    expectCode: 0,
    apply: async (root) => {
      await editJson(root, "registry.json", (r) => { r.skills[0].tags = ["brand-new"]; });
      const rel = `skills/${JSON.parse(await readFile(join(root, "registry.json"), "utf8")).skills[0].id}/SKILL.md`;
      const text = await readFile(join(root, rel), "utf8");
      await writeFile(join(root, rel), text.replace(/^tags: .*$/m, "tags: brand-new"), "utf8");
    },
  },
  {
    name: "未知标签在严格模式下失败",
    args: ["--strict"],
    contains: "unknown tag",
    apply: async (root) => {
      await editJson(root, "registry.json", (r) => { r.skills[0].tags = ["brand-new"]; });
      const rel = `skills/${JSON.parse(await readFile(join(root, "registry.json"), "utf8")).skills[0].id}/SKILL.md`;
      const text = await readFile(join(root, rel), "utf8");
      await writeFile(join(root, rel), text.replace(/^tags: .*$/m, "tags: brand-new"), "utf8");
    },
  },
  {
    name: "提交了 .DS_Store",
    contains: "macOS metadata",
    apply: (root) => writeFile(join(root, "skills/daily-report/.DS_Store"), "junk", "utf8"),
  },
  {
    name: "两个条目描述完全相同",
    contains: "identical descriptions",
    apply: async (root) => {
      const registry = JSON.parse(await readFile(join(root, "registry.json"), "utf8"));
      const [first, second] = registry.skills;
      const rel = `skills/${second.id}/SKILL.md`;
      const text = await readFile(join(root, rel), "utf8");
      await writeFile(join(root, rel),
        text.replace(/^description: .*$/m, `description: ${first.description}`), "utf8");
      await editJson(root, "registry.json", (r) => {
        r.skills.find((s) => s.id === second.id).description = first.description;
      });
    },
  },
  {
    name: "env 键不是大写下划线形式",
    contains: "UPPER_SNAKE_CASE",
    apply: (root) => editJson(root, "mcps/github/mcp.json", (m) => {
      m.env = { githubToken: "" };
    }),
  },
  {
    name: "技能正文过长",
    contains: "limit is 20000",
    apply: (root) => append(root, "skills/daily-report/SKILL.md", `\n${"填充。".repeat(7000)}\n`),
  },
  {
    name: "目录名不合法",
    contains: "invalid directory name",
    apply: async (root) => {
      await mkdir(join(root, "skills/Bad_ID"), { recursive: true });
      await writeFile(join(root, "skills/Bad_ID/SKILL.md"), "---\nname: x\ndescription: y\n---\n正文\n", "utf8");
    },
  },
);

async function main() {
  const keep = process.argv.includes("--keep");
  const base = await mkdtemp(join(tmpdir(), "myna-hub-selftest-"));
  const failures = [];
  let passed = 0;

  for (const [index, testCase] of CASES.entries()) {
    const root = join(base, `case-${index}`);
    await copyRepo(root);
    await testCase.apply(root);

    const result = run(root, testCase.args ?? []);
    const expectedCode = testCase.expectCode ?? 1;
    let ok = result.code === expectedCode;
    if (ok && testCase.contains) ok = result.output.includes(testCase.contains);
    if (ok) {
      passed += 1;
      console.log(`  ok   ${testCase.name}`);
      await rm(root, { recursive: true, force: true });
    } else {
      failures.push({ name: testCase.name, expectedCode, code: result.code, output: result.output });
      console.log(`  FAIL ${testCase.name}（期望退出码 ${expectedCode}，实际 ${result.code}）`);
    }
  }

  console.log("");
  console.log(`校验器自检：通过 ${passed}/${CASES.length}`);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`\n--- ${failure.name} 输出 ---`);
      console.log(failure.output.trim().split("\n").slice(0, 12).join("\n"));
    }
    if (!keep) await rm(base, { recursive: true, force: true });
    else console.log(`\n临时副本保留在 ${base}`);
    process.exit(1);
  }
  await rm(base, { recursive: true, force: true });
}

await main();
