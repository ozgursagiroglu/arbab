import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { lintBrief, parseBriefSource } from "./brief";
import { loadLane, ROLE_DEFAULTS } from "./config";
import { compileProfile } from "./profile";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = join(ROOT, "skills", "arbab");
const REFS = join(SKILL_DIR, "references");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The frontmatter's top-level `key: value` lines; enough for the flat frontmatter skills use. */
function frontmatter(markdown: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (match?.[1] === undefined) throw new Error("no frontmatter");
  const out: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (kv?.[1] !== undefined && kv[2] !== undefined) out[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

/** Link targets of `[text](target)` outside code fences and inline code. */
function relativeLinks(markdown: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const m of line.replace(/`[^`]*`/g, "").matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (target === undefined || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
      out.push(target.split("#")[0] ?? target);
    }
  }
  return out;
}

describe("plugin manifests", () => {
  it("plugin.json parses, is named arbab and has only the agreed fields", () => {
    const plugin = readJson(join(ROOT, ".claude-plugin", "plugin.json"));
    expect(isRecord(plugin)).toBe(true);
    if (!isRecord(plugin)) return;
    expect(plugin.name).toBe("arbab");
    expect(typeof plugin.description).toBe("string");
    expect(Array.isArray(plugin.keywords)).toBe(true);
    expect(Object.keys(plugin).sort()).toEqual(["author", "description", "homepage", "keywords", "license", "name", "repository", "version"]);
    // The plugin ships the runner built from this package, so their versions move together.
    const pkg = readJson(join(ROOT, "package.json"));
    expect(isRecord(pkg) && plugin.version === pkg.version).toBe(true);
    expect(plugin.license).toBe("MIT");
  });

  it("marketplace.json parses and lists the arbab plugin in the assembled plugin/ directory", () => {
    const market = readJson(join(ROOT, ".claude-plugin", "marketplace.json"));
    expect(isRecord(market)).toBe(true);
    if (!isRecord(market)) return;
    expect(market.name).toBe("arbab");
    expect(market.owner).toEqual({ name: "Diojen" });
    expect(Array.isArray(market.plugins)).toBe(true);
    const plugins = market.plugins as unknown[];
    expect(plugins).toHaveLength(1);
    const [entry] = plugins;
    expect(isRecord(entry) && entry.name === "arbab" && entry.source === "./plugin").toBe(true);
    expect(isRecord(entry) && typeof entry.description === "string").toBe(true);
  });
});

describe("SKILL.md", () => {
  const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");

  it("has the frontmatter the plugin loader needs", () => {
    const fm = frontmatter(skill);
    expect(fm.name).toBe("arbab");
    expect(fm.description?.length ?? 0).toBeGreaterThan(0);
    expect(fm.description?.length ?? Infinity).toBeLessThan(600);
    expect(fm["allowed-tools"]).toBe('Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs" *)');
  });

  it("quotes the plugin path in every runner command of the skill and its references", () => {
    const files = [join(SKILL_DIR, "SKILL.md"), ...readdirSync(REFS).filter((f) => f.endsWith(".md")).map((f) => join(REFS, f))];
    let quoted = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(.)\$\{CLAUDE_PLUGIN_ROOT\}([^\s`)"]*)(.)/g)) {
        expect(`${m[1]}${m[3]}`, `${file}: ${m[0]}`).toBe('""');
        quoted++;
      }
    }
    expect(quoted).toBeGreaterThanOrEqual(3);
  });

  it("teaches the landing commands, the readiness tiers and verification inside the fence with its reason", () => {
    for (const command of ["integrate", "verify", "review", "readiness", "land"]) expect(skill).toContain(`arbab ${command} <name>`);
    expect(skill).toContain("--deps-installed");
    expect(skill).toContain("**Verification runs inside the fence, never on the host**: the gates run worker-written code");
    expect(skill).toMatch(/`low`: verify\. `medium` .*: verify and at least one lens\. `high`: verify, every lens, the skeptic pass and smoke/s);
    // Whatever the line wrapping, the rule is stated in bold.
    expect(skill.replace(/\s+/g, " ")).toContain("**It never pushes.**");
    expect(skill).toContain("arbab quota --reset");
  });

  it("stays under 400 lines", () => {
    expect(skill.split("\n").length).toBeLessThan(400);
  });

  it("links only to files that exist", () => {
    const links = relativeLinks(skill);
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) expect(existsSync(resolve(SKILL_DIR, link)), link).toBe(true);
  });

  it("links every reference file", () => {
    const links = relativeLinks(skill);
    for (const file of ["brief-template.md", "lane-example.json", "end-states.md", "landing-checklist.md"]) {
      expect(links).toContain(`references/${file}`);
    }
  });

  it("finds links outside code and skips URLs and anchors", () => {
    const md = "[a](x.md) [b](https://e.com) [c](#top) `[d](y.md)`\n```\n[e](z.md)\n```\n[f](w.md#part)";
    expect(relativeLinks(md)).toEqual(["x.md", "w.md"]);
  });
});

describe("reference examples", () => {
  let tmp: string | null = null;
  afterEach(() => {
    if (tmp !== null) rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it("lane-example.json loads with its brief", () => {
    tmp = mkdtempSync(join(tmpdir(), "arbab-"));
    const lane = readJson(join(REFS, "lane-example.json"));
    if (!isRecord(lane) || typeof lane.brief !== "string") throw new Error("lane example has no brief");
    // Laid out as a project would hold it: the lane file and its brief under the project root.
    mkdirSync(dirname(join(tmp, lane.brief)), { recursive: true });
    copyFileSync(join(REFS, "brief-template.md"), join(tmp, lane.brief));
    mkdirSync(join(tmp, "lanes"), { recursive: true });
    copyFileSync(join(REFS, "lane-example.json"), join(tmp, "lanes", "example.json"));

    const loaded = loadLane(tmp, "lanes/example.json");
    expect(loaded.name).toBe(lane.name);
    expect(loaded.role).toBe("implementer");
    expect(loaded.brief).toBe(lane.brief);
  });

  it("lane-example.json fails to load without its brief", () => {
    tmp = mkdtempSync(join(tmpdir(), "arbab-"));
    mkdirSync(join(tmp, "lanes"), { recursive: true });
    copyFileSync(join(REFS, "lane-example.json"), join(tmp, "lanes", "example.json"));
    expect(() => loadLane(tmp ?? "", "lanes/example.json")).toThrow(/brief/);
  });

  it("brief-template.md parses and lints clean under an implementer profile", () => {
    const markdown = readFileSync(join(REFS, "brief-template.md"), "utf8");
    const source = parseBriefSource(markdown);
    expect(source.title).not.toBe("");
    for (const name of ["Task", "Scope", "Acceptance", "Facts", "Unverified", "Notes"] as const) {
      expect(source.sections[name]?.trim(), name).toBeTruthy();
    }
    const profile = compileProfile({
      role: "implementer",
      fence: "strict",
      tools: [...ROLE_DEFAULTS.implementer.tools],
      loopback: ROLE_DEFAULTS.implementer.loopback,
      commands: ["pnpm test", "pnpm typecheck"],
      laneAllow: [],
      credentialPaths: [],
      env: {},
      worktree: join(tmpdir(), "arbab-worktree"),
    });
    const issues = lintBrief(markdown, source, profile);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(issues).toEqual([]);
  });
});
