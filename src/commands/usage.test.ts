import { describe, expect, it } from "vitest";
import { COMMANDS } from "./index";
import { USAGE } from "./usage";

describe("USAGE", () => {
  it("has a block for every command but the internal ones", () => {
    const names = Object.keys(COMMANDS).filter((n) => n !== "__shepherd" && n !== "hook");
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      expect(Object.hasOwn(USAGE, name), name).toBe(true);
      expect(USAGE[name], name).toMatch(new RegExp(`^usage: arbab ${name}( |\\n)`));
    }
  });

  it("lists every flag of the usage lines as an option line, and nothing else", () => {
    for (const [name, text] of Object.entries(USAGE)) {
      expect(text.endsWith("\n"), name).toBe(true);
      const lines = text.slice(0, -1).split("\n");
      const isUsage = (l: string): boolean => /^(usage:| {6}) arbab /.test(l);
      const usages = lines.filter(isUsage);
      const options = lines.filter((l) => !isUsage(l));
      expect(lines[0], name).toMatch(/^usage: /);
      for (const o of options) expect(o, name).toMatch(/^ {2}--[a-z-]+/);
      const inUsage = new Set(usages.flatMap((l) => l.match(/--[a-z-]+/g) ?? []));
      const listed = new Set(options.map((l) => /^ {2}(--[a-z-]+)/.exec(l)?.[1]));
      expect(listed, name).toEqual(inUsage);
    }
  });

  it("carries the flags this milestone adds", () => {
    expect(USAGE.status).toContain("status [<lane>…] [--active] [--mine] [--json]");
    expect(USAGE.wait).toContain("wait [<lane>… | --any | --all] [--all-sessions] [--timeout-min <n>] [--notify] [--json]");
    expect(USAGE.cleanup).toContain("[--worktrees [--older-than <days>]] [--mine]");
    expect(USAGE.cleanup).toMatch(/^ {2}--older-than <days> .*unlanded integrations.*worktrees\.idleDays/m);
    // The manifest keep is the idle rule's: a merged or landed lane goes whatever its manifests.
    expect(USAGE.cleanup).toMatch(/^ {2}--older-than <days> .*this idle rule keeps a lane whose branch changed dependency manifests.*merged into the base or landed goes/m);
    expect(USAGE.integrate).toMatch(/^ {2}--refresh .*rebuild a missing worktree/m);
    expect(USAGE.quota).toContain("quota [--reset | --refresh] [--json]");
    expect(USAGE.plan).toContain("plan next <plan.json> [--retry <phase>]");
    expect(USAGE.integrate).toContain("integrate <name> --adopt <ref> [--base <branch>]");
    expect(USAGE.integrate).toMatch(/^ {2}--base <branch> /m);
    expect(USAGE.integrate).toContain("integrate <name> --refresh [--json]");
    expect(USAGE.verify).toContain("verify --ref <branch>");
    expect(USAGE.review).toContain("review <name> [--lenses a,b] [--lens-file <name>=<file>]… [--since <sha>]");
    expect(USAGE.land).toContain("land <name> [--squash] [--message <file>]");
    expect(USAGE["host-check"]).toBe("usage: arbab host-check <name>\n");
    expect(USAGE.summary).toContain("summary [--all] [--since <when>] [--json]");
    expect(USAGE.summary).toContain("<n>m, <n>h, <n>d ago (up to 3650d), YYYY-MM-DD (midnight UTC) or an ISO date-time with Z or an offset");
    expect(USAGE.hook).toBe("usage: arbab hook <pre-tool-use|stop|user-prompt-submit|session-start>\n");
    expect(USAGE.report).toContain("report <lane> [--attempt <n>] [--json]");
  });

  it("aligns option texts within a block", () => {
    const options = (USAGE.review ?? "").split("\n").filter((l) => l.startsWith("  "));
    // The text starts after the first run of two or more spaces that follows the flag.
    const starts = new Set(options.map((l) => /^ {2}\S+(?: \S+)*? {2,}/.exec(l)?.[0].length));
    expect(options.length).toBe(5);
    expect([...starts]).toEqual(["  --lens-file <name>=<file>  ".length]);
  });
});
