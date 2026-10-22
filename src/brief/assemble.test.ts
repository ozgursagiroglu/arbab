import { describe, expect, it } from "vitest";
import type { BriefContext, BriefSource, JsonSchema } from "../types";
import { assembleBrief, nestInstruction, roleAndIsolation } from "./assemble";
import { scanLines } from "./markdown";
import { REVIEWER, RESEARCHER, STRICT } from "./test-profiles";

const SCHEMA: JsonSchema = { type: "object", required: ["summary"], properties: { summary: { type: "string" } } };

const SOURCE: BriefSource = {
  title: "Lane title",
  sections: { Notes: "notes", Acceptance: "accept", Scope: "scope", Task: "task", Facts: "facts", Unverified: "  " },
};

function ctx(over: Partial<BriefContext> = {}): BriefContext {
  return {
    lane: "m1-x",
    role: "implementer",
    branch: "arbab/m1-x",
    worktree: "/work/m1-x",
    profile: STRICT,
    leases: [],
    instructions: [{ path: "CLAUDE.md", content: "# Project\n\nIntro.\n\n## Stack\n\nTS.\n\n```md\n## kept\n```\n" }],
    coordination: "m1-y owns src/y",
    upstream: [{ lane: "m1-z", summary: "built z" }],
    schema: SCHEMA,
    bashMaxTimeoutMin: 15,
    ...over,
  };
}

const headings = (text: string): string[] =>
  scanLines(text).filter((l) => !l.inFence && /^#{1,2} /.test(l.text)).map((l) => l.text);

describe("assembleBrief", () => {
  it("orders the sections as DESIGN.md §5 says", () => {
    expect(headings(assembleBrief(SOURCE, ctx()))).toEqual([
      "# Lane title",
      "## Role and isolation",
      "## Project rules",
      "## Task",
      "## Scope",
      "## Facts",
      "## Acceptance",
      "## Notes",
      "## Tool belt",
      "## Coordination",
      "## Upstream reports",
      "## Report",
    ]);
  });
  it("leaves out empty source sections, coordination and upstream", () => {
    const text = assembleBrief({ title: "T", sections: { Task: "t" } }, ctx({ coordination: null, upstream: [], instructions: [] }));
    expect(headings(text)).toEqual(["# T", "## Role and isolation", "## Task", "## Tool belt", "## Report"]);
  });
  it("inlines instructions under their path and upstream reports under their lane", () => {
    const text = assembleBrief(SOURCE, ctx());
    expect(text).toContain("## Project rules\n\n### CLAUDE.md\n\nIntro.\n\n#### Stack\n\nTS.");
    expect(text).toContain("## Upstream reports\n\n### m1-z\n\nbuilt z");
    expect(text).toContain("## Coordination\n\nm1-y owns src/y");
  });
  it("describes the report schema and ends with the JSON instruction", () => {
    const text = assembleBrief(SOURCE, ctx());
    expect(text).toContain("## Report\n\nYour final answer is a JSON object with these fields:\n\n- `summary`: `string`\n\n" +
      "End with that JSON object as your final answer.\n");
  });
  it("asks for a summary when there is no schema", () => {
    expect(assembleBrief(SOURCE, ctx({ schema: null }))).toMatch(/## Report\n\nYour final answer is a short summary .*\n$/);
  });
  it("lists the lane inputs after Notes, only when there are some", () => {
    const text = assembleBrief(SOURCE, ctx({ inputs: ["plan.md", "api.json"] }));
    expect(headings(text).slice(7, 10)).toEqual(["## Notes", "## Inputs", "## Tool belt"]);
    expect(text).toContain("## Inputs\n\nRead-only copies made for this lane, in .arbab-tmp/inputs/: `plan.md`, `api.json`.\n\n## Tool belt");
    expect(assembleBrief(SOURCE, ctx({ inputs: [] }))).not.toContain("## Inputs");
    expect(headings(assembleBrief({ title: "T", sections: { Task: "t" } }, ctx({ inputs: ["a.md"] })))).toContain("## Inputs");
  });
  it("includes the tool belt", () => {
    expect(assembleBrief(SOURCE, ctx())).toContain("## Tool belt\n\n- Shell commands you may run: `git status …`");
  });
});

describe("roleAndIsolation", () => {
  it("states the role, headless operation, worktree, sandbox, no commits and refusal cost", () => {
    const text = roleAndIsolation(ctx(), STRICT);
    expect(text).toContain("You are an arbab worker in the implementer role.");
    expect(text).toContain("You run headless: nobody will answer questions. Decide, and report what you could not decide.");
    expect(text).toContain("`/work/m1-x` on branch `arbab/m1-x`. Work only inside it.");
    expect(text).toContain("no network, no writes outside the worktree and the temp directory, and credential files are unreadable.");
    expect(text).toContain("Listening on 127.0.0.1 is allowed.");
    expect(text).toContain("You cannot commit, push or switch branches. The runner commits your work when you finish.");
    expect(text).toContain("A refused command costs you one turn. Do not retry it; use the tool belt.");
    expect(text).not.toMatch(/cannot edit|web tools|exactly as written/);
  });
  it("mentions loopback only when the profile allows local binding", () => {
    expect(roleAndIsolation(ctx({ role: "reviewer" }), REVIEWER)).not.toContain("127.0.0.1");
  });
  it.each([
    ["reviewer", "You cannot edit files. Report findings with evidence."],
    ["researcher", "You have only web tools. Cite a source for every claim."],
    ["probe", "Run each step exactly as written."],
  ] as const)("adds the %s specifics", (role, line) => {
    const text = assembleBrief(SOURCE, ctx({ role, profile: role === "researcher" ? RESEARCHER : STRICT }));
    expect(text).toContain(`in the ${role} role`);
    expect(text).toContain(`- ${line}`);
  });
});

describe("nestInstruction", () => {
  it("drops the leading title and moves headings down two levels outside fences", () => {
    expect(nestInstruction("# Title\n\n## A\n\n### B\n\n##### E\n\n```\n## code\n```")).toBe(
      "#### A\n\n##### B\n\n###### E\n\n```\n## code\n```",
    );
  });
  it("keeps content without a title", () => {
    expect(nestInstruction("plain\n# late title")).toBe("plain\n### late title");
  });
});
