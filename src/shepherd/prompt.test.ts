import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config";
import { compileProfile } from "../profile";
import { DEFAULT_SCHEMAS } from "../report";
import type { CompiledProfile } from "../types";
import { buildBrief, CONTINUATION_PROMPT, digestHeadStart, insertBeforeToolBelt, resumePrompt, upstreamSummary } from "./prompt";

let dir: string;
let runs: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-prompt-"));
  runs = join(dir, ".arbab", "runs");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function attempt(lane: string, n: number, files: { summary?: unknown; report?: unknown }): void {
  const d = join(runs, lane, `attempt-${n}`);
  mkdirSync(d, { recursive: true });
  if (files.summary !== undefined) writeFileSync(join(d, "summary.json"), JSON.stringify(files.summary));
  if (files.report !== undefined) writeFileSync(join(d, "report.json"), typeof files.report === "string" ? files.report : JSON.stringify(files.report));
}

const summary = (state: string, resultText: string | null) => ({ state, final: { resultText } });

describe("upstreamSummary", () => {
  it("prefers the latest attempt's report summary", () => {
    attempt("up", 1, { summary: summary("usage-limit", "old"), report: { summary: "old report" } });
    attempt("up", 2, { summary: summary("success", "the result text"), report: { summary: "built the parser" } });
    expect(upstreamSummary(runs, "up")).toBe("built the parser");
  });

  it("falls back to the result text, then to the end state", () => {
    attempt("up", 1, { summary: summary("success", "the result text"), report: "{broken" });
    expect(upstreamSummary(runs, "up")).toBe("the result text");
    attempt("up", 2, { summary: summary("failed", null) });
    expect(upstreamSummary(runs, "up")).toBe("(attempt 2 ended failed without a report)");
  });

  it("skips attempts without a summary and lanes without attempts", () => {
    attempt("up", 1, { summary: summary("success", "done") });
    attempt("up", 2, {});
    expect(upstreamSummary(runs, "up")).toBe("done");
    expect(upstreamSummary(runs, "none")).toBe("(no finished attempt yet)");
  });
});

describe("buildBrief", () => {
  const profile = (worktree: string): CompiledProfile =>
    compileProfile({
      role: "implementer",
      fence: "strict",
      tools: ["Read", "Bash"],
      loopback: true,
      commands: ["pnpm test"],
      laneAllow: [],
      credentialPaths: [],
      env: {},
      worktree,
    });

  it("assembles the source, project rules, coordination and upstream reports", () => {
    writeFileSync(join(dir, "RULES.md"), "# Rules\n\n- Be brief.\n");
    writeFileSync(join(dir, "brief.md"), "# Lane x\n\n## Task\n\nDo it.\n\n## Scope\n\n`src/`\n\n## Acceptance\n\n- [ ] done\n");
    attempt("up", 1, { summary: summary("success", "upstream done") });
    const config = { ...defaultConfig(), instructions: ["RULES.md"] };
    const worktree = join(dir, "wt");
    const text = buildBrief({
      projectRoot: dir,
      runsRoot: runs,
      config,
      lane: { name: "x", role: "implementer", brief: "brief.md", coordination: "Lane y owns docs/.", upstream: ["up"] },
      branch: "arbab/x",
      worktree,
      profile: profile(worktree),
      leases: [],
      schema: DEFAULT_SCHEMAS.implementer,
    });
    expect(text).toMatch(/^# Lane x\n/);
    expect(text).toContain("### RULES.md");
    expect(text).toContain("- Be brief.");
    expect(text).toContain("Do it.");
    expect(text).toContain("## Coordination\n\nLane y owns docs/.");
    expect(text).toContain("### up\n\nupstream done");
    expect(text).toContain("`pnpm test …`");
    expect(text).toContain("## Report");
  });

  it("places a head start after the source sections and before the tool belt", () => {
    // A "## Tool belt" line in a fenced block of the source must not be taken for the generated section.
    writeFileSync(
      join(dir, "brief.md"),
      "# Lane x\n\n## Task\n\nDo it.\n\n```md\n## Tool belt\n```\n\n## Scope\n\n`src/`\n\n## Acceptance\n\n- [ ] done\n\n## Notes\n\nLast note.\n",
    );
    const worktree = join(dir, "wt");
    const text = buildBrief({
      projectRoot: dir,
      runsRoot: runs,
      config: defaultConfig(),
      lane: { name: "x", role: "implementer", brief: "brief.md", coordination: "Lane y owns docs/." },
      branch: "arbab/x",
      worktree,
      profile: profile(worktree),
      leases: [],
      schema: DEFAULT_SCHEMAS.implementer,
      headStart: "## Head start\n\nwhat attempt 1 did\n",
    });
    const at = (s: string): number => text.indexOf(s);
    expect(at("## Head start")).toBeGreaterThan(at("Last note."));
    expect(at("\n## Tool belt\n\n- ")).toBeGreaterThan(at("what attempt 1 did"));
    expect(at("## Coordination")).toBeGreaterThan(at("\n## Tool belt\n\n- "));
    expect(text).toContain("Last note.\n\n## Head start\n\nwhat attempt 1 did\n\n## Tool belt\n\n");
    expect(text.match(/## Head start/g)).toHaveLength(1);
  });

  it("names the lane inputs after the source sections, and leaves an empty list out", () => {
    writeFileSync(join(dir, "brief.md"), "# Lane x\n\n## Task\n\nDo it.\n\n## Notes\n\nLast note.\n");
    const worktree = join(dir, "wt");
    const input = {
      projectRoot: dir,
      runsRoot: runs,
      config: defaultConfig(),
      lane: { name: "x", role: "implementer" as const, brief: "brief.md" },
      branch: "arbab/x",
      worktree,
      profile: profile(worktree),
      leases: [],
      schema: DEFAULT_SCHEMAS.implementer,
    };
    const text = buildBrief({ ...input, inputs: ["plan.md", "spec.json"] });
    expect(text).toContain(
      "Last note.\n\n## Inputs\n\nRead-only copies made for this lane, in .arbab-tmp/inputs/: `plan.md`, `spec.json`.\n\n## Tool belt\n\n",
    );
    expect(buildBrief({ ...input, inputs: [] })).not.toContain("## Inputs");
    expect(buildBrief(input)).not.toContain("## Inputs");
  });

  it("fails when the brief or an instruction file is missing", () => {
    const worktree = join(dir, "wt");
    const input = {
      projectRoot: dir,
      runsRoot: runs,
      config: defaultConfig(),
      lane: { name: "x", role: "implementer" as const, brief: "missing.md" },
      branch: "arbab/x",
      worktree,
      profile: profile(worktree),
      leases: [],
      schema: DEFAULT_SCHEMAS.implementer,
    };
    expect(() => buildBrief(input)).toThrow(/cannot read brief/);
    writeFileSync(join(dir, "brief.md"), "# x\n\n## Task\n\nt\n");
    expect(() => buildBrief({ ...input, lane: { ...input.lane, brief: "brief.md" }, config: { ...defaultConfig(), instructions: ["NOPE.md"] } })).toThrow(
      /cannot read instruction file/,
    );
  });
});

describe("digestHeadStart", () => {
  const stream = (n: number, text: string): void => {
    const d = join(runs, "x", `attempt-${n}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "stream.jsonl"), text);
  };
  const line = (v: unknown): string => `${JSON.stringify(v)}\n`;

  it("renders the attempt's stream as a head start section", () => {
    stream(
      2,
      line({ type: "system", subtype: "init" }) +
        line({ type: "assistant", message: { content: [{ type: "text", text: "Reading the parser." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/p.ts" } }] } }) +
        line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "export const p = 1;" }] } }) +
        "{truncated\n",
    );
    const text = digestHeadStart(runs, "x", 2);
    expect(text).toMatch(/^## Head start\n\nA previous attempt \(number 2\)/);
    expect(text).toContain("### NOTE\n\n```text\nReading the parser.\n```");
    expect(text).toContain("### CALL Read");
    expect(text).toContain("export const p = 1;");
  });

  it("refuses a missing stream and one without events", () => {
    expect(() => digestHeadStart(runs, "x", 1)).toThrow(/attempt 1 of x: .*stream\.jsonl does not exist/);
    stream(1, "\n  \n");
    expect(() => digestHeadStart(runs, "x", 1)).toThrow(/has no events/);
    stream(3, "{not json\n");
    expect(() => digestHeadStart(runs, "x", 3)).toThrow(/has no events/);
    expect(() => digestHeadStart(runs, "x", 0)).toThrow(/positive integer/);
  });
});

describe("insertBeforeToolBelt", () => {
  it("inserts before the generated tool belt and refuses a prompt without one", () => {
    const prompt = "# T\n\n## Task\n\nt\n\n## Tool belt\n\nbelt\n\n## Report\n\nr\n";
    expect(insertBeforeToolBelt(prompt, "## Tool belt\n\nbelt", "## Head start\n\nh\n")).toBe(
      "# T\n\n## Task\n\nt\n\n## Head start\n\nh\n\n## Tool belt\n\nbelt\n\n## Report\n\nr\n",
    );
    expect(() => insertBeforeToolBelt(prompt, "## Tool belt\n\nother", "## Head start")).toThrow(/no tool belt/);
  });
});

describe("resumePrompt", () => {
  const laneDir = (): string => {
    const d = join(runs, "x");
    mkdirSync(d, { recursive: true });
    return d;
  };

  it("reads promptFile from inside the lane's run dir, over prompt", () => {
    const d = laneDir();
    writeFileSync(join(d, "resume-prompt.md"), "Also fix the README.\n");
    expect(resumePrompt(d, { promptFile: join(d, "resume-prompt.md"), prompt: "ignored" })).toBe("Also fix the README.\n");
  });

  it("falls back to prompt, then to the continuation prompt", () => {
    expect(resumePrompt(laneDir(), { prompt: "Go on." })).toBe("Go on.");
    expect(resumePrompt(laneDir(), {})).toBe(CONTINUATION_PROMPT);
  });

  it("refuses a relative path, a file outside the run dir and a symlink that leads out", () => {
    const d = laneDir();
    writeFileSync(join(dir, "outside.md"), "secret\n");
    expect(() => resumePrompt(d, { promptFile: "x/resume-prompt.md" })).toThrow(/not an absolute path/);
    expect(() => resumePrompt(d, { promptFile: join(dir, "outside.md") })).toThrow(/not inside the lane's run dir/);
    expect(() => resumePrompt(d, { promptFile: join(d, "..", "..", "..", "outside.md") })).toThrow(/not inside/);
    symlinkSync(join(dir, "outside.md"), join(d, "link.md"));
    expect(() => resumePrompt(d, { promptFile: join(d, "link.md") })).toThrow(/not inside/);
    expect(() => resumePrompt(d, { promptFile: d })).toThrow(/not inside/);
  });

  it("refuses a missing or empty file", () => {
    const d = laneDir();
    expect(() => resumePrompt(d, { promptFile: join(d, "missing.md") })).toThrow(/cannot resolve prompt file/);
    writeFileSync(join(d, "empty.md"), " \n");
    expect(() => resumePrompt(d, { promptFile: join(d, "empty.md") })).toThrow(/is empty/);
  });
});

describe("CONTINUATION_PROMPT", () => {
  it("tells the worker the stop was a usage limit and how to re-orient", () => {
    expect(CONTINUATION_PROMPT).toMatch(/^The run stopped because the account hit its usage limit/);
    expect(CONTINUATION_PROMPT).toContain("`git log --oneline -5`");
    expect(CONTINUATION_PROMPT).toContain("`git status --short`");
  });
});
