import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assemblePlugin } from "../scripts/assemble-plugin.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort();
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("assemblePlugin", () => {
  let tmp: string;
  let repo: string;
  let out: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "arbab-"));
    repo = join(tmp, "repo");
    out = join(tmp, "plugin");
    write(join(repo, ".claude-plugin", "plugin.json"), '{"name":"arbab"}\n');
    write(join(repo, ".claude-plugin", "marketplace.json"), '{"name":"arbab"}\n');
    write(join(repo, "skills", "arbab", "SKILL.md"), "# skill\n");
    write(join(repo, "skills", "arbab", "references", "end-states.md"), "# end states\n");
    write(join(repo, "skills", "arbab", ".DS_Store"), "junk");
    write(join(repo, "hooks", "hooks.json"), '{"hooks":{}}\n');
    write(join(repo, "hooks", "notes.md"), "not shipped\n");
    write(join(repo, "dist", "arbab.mjs"), "#!/usr/bin/env node\n");
    write(join(repo, "dist", "other.mjs"), "not shipped\n");
    write(join(repo, "node_modules", "x", "index.js"), "not shipped\n");
    write(join(repo, ".arbab", "runs", "r.json"), "{}\n");
    write(join(repo, "evidence", "private.md"), "private\n");
    write(join(repo, "README.md"), "# readme\n");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("copies the manifest, the skills, the hooks and the bundle, and nothing else", () => {
    assemblePlugin(repo, "dist/arbab.mjs", out);
    expect(listFiles(out)).toEqual([
      ".claude-plugin/plugin.json",
      "dist/arbab.mjs",
      "hooks/hooks.json",
      "skills/arbab/SKILL.md",
      "skills/arbab/references/end-states.md",
    ]);
    expect(readFileSync(join(out, ".claude-plugin", "plugin.json"), "utf8")).toBe('{"name":"arbab"}\n');
    expect(readFileSync(join(out, "hooks", "hooks.json"), "utf8")).toBe('{"hooks":{}}\n');
    expect(readFileSync(join(out, "skills", "arbab", "SKILL.md"), "utf8")).toBe("# skill\n");
    expect(readFileSync(join(out, "dist", "arbab.mjs"), "utf8")).toBe("#!/usr/bin/env node\n");
  });

  it("takes the bundle from an absolute path anywhere", () => {
    const bundle = join(tmp, "elsewhere", "bundle.mjs");
    write(bundle, "// bundle\n");
    assemblePlugin(repo, bundle, out);
    expect(readFileSync(join(out, "dist", "arbab.mjs"), "utf8")).toBe("// bundle\n");
  });

  it("rebuilds from scratch, so stale and deleted files are gone", () => {
    assemblePlugin(repo, "dist/arbab.mjs", out);
    write(join(out, "stale.txt"), "stale\n");
    write(join(out, "skills", "arbab", "stale.md"), "stale\n");
    rmSync(join(repo, "skills", "arbab", "references", "end-states.md"));
    write(join(repo, "dist", "arbab.mjs"), "// new bundle\n");

    assemblePlugin(repo, "dist/arbab.mjs", out);
    expect(existsSync(join(out, "stale.txt"))).toBe(false);
    expect(listFiles(out)).toEqual([".claude-plugin/plugin.json", "dist/arbab.mjs", "hooks/hooks.json", "skills/arbab/SKILL.md"]);
    expect(readFileSync(join(out, "dist", "arbab.mjs"), "utf8")).toBe("// new bundle\n");
  });

  it("fails when the bundle, the hooks, the manifest or the skills are missing", () => {
    expect(() => assemblePlugin(repo, "dist/missing.mjs", out)).toThrow(/bundle not found/);
    expect(existsSync(out)).toBe(false);
    rmSync(join(repo, "hooks", "hooks.json"));
    expect(() => assemblePlugin(repo, "dist/arbab.mjs", out)).toThrow(/hooks file not found/);
    expect(existsSync(out)).toBe(false);
    write(join(repo, "hooks", "hooks.json"), '{"hooks":{}}\n');
    rmSync(join(repo, "skills"), { recursive: true });
    expect(() => assemblePlugin(repo, "dist/arbab.mjs", out)).toThrow(/skills directory not found/);
    rmSync(join(repo, ".claude-plugin", "plugin.json"));
    expect(() => assemblePlugin(repo, "dist/arbab.mjs", out)).toThrow(/plugin manifest not found/);
  });

  it("refuses an output directory that is or contains the repository", () => {
    expect(() => assemblePlugin(repo, "dist/arbab.mjs", repo)).toThrow(/contains the repository root/);
    expect(() => assemblePlugin(repo, "dist/arbab.mjs", tmp)).toThrow(/contains the repository root/);
    expect(existsSync(join(repo, "skills", "arbab", "SKILL.md"))).toBe(true);
  });

  it("ships the repository's real manifest, hooks and skill files unchanged", () => {
    const bundle = join(tmp, "arbab.mjs");
    write(bundle, "// bundle\n");
    assemblePlugin(ROOT, bundle, out);
    const skills = listFiles(join(ROOT, "skills")).filter((f) => !f.endsWith(".DS_Store"));
    expect(skills).toContain("arbab/SKILL.md");
    expect(listFiles(out)).toEqual(
      [".claude-plugin/plugin.json", "dist/arbab.mjs", "hooks/hooks.json", ...skills.map((f) => `skills/${f}`)].sort(),
    );
    expect(readFileSync(join(out, ".claude-plugin", "plugin.json"), "utf8")).toBe(
      readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8"),
    );
    expect(readFileSync(join(out, "hooks", "hooks.json"), "utf8")).toBe(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
    for (const file of skills) {
      expect(readFileSync(join(out, "skills", file), "utf8"), file).toBe(readFileSync(join(ROOT, "skills", file), "utf8"));
    }
  });
});

describe("the committed plugin/", () => {
  // A marketplace install copies plugin/ from the repository as it is, so it must be the build of this commit:
  // run `pnpm build` and commit plugin/ with the change (CI checks the bundle the same way).
  it("holds the repository's manifest and skill files, and a bundle of this package's version", () => {
    const plugin = join(ROOT, "plugin");
    const skills = listFiles(join(ROOT, "skills")).filter((f) => !f.endsWith(".DS_Store"));
    expect(listFiles(plugin)).toEqual(
      [".claude-plugin/plugin.json", "dist/arbab.mjs", "hooks/hooks.json", ...skills.map((f) => `skills/${f}`)].sort(),
    );
    expect(readFileSync(join(plugin, ".claude-plugin", "plugin.json"), "utf8")).toBe(
      readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8"),
    );
    expect(readFileSync(join(plugin, "hooks", "hooks.json"), "utf8"), "plugin/hooks/hooks.json is stale: run pnpm build").toBe(
      readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"),
    );
    for (const file of skills) {
      expect(readFileSync(join(plugin, "skills", file), "utf8"), `plugin/skills/${file} is stale: run pnpm build`).toBe(
        readFileSync(join(ROOT, "skills", file), "utf8"),
      );
    }
    const version = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
    expect(readFileSync(join(plugin, "dist", "arbab.mjs"), "utf8")).toContain(JSON.stringify(version));
  });
});
