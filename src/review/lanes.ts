import { isAbsolute, relative, sep } from "node:path";
import type { IntegrationPaths } from "../integrate";
import type { JsonSchema, LaneSpec, ReviewFinding } from "../types";
import { ArbabError } from "../util/errors";
import { assertValidName } from "../util/names";

// Reviewer and skeptic lanes (DESIGN.md §17). The brief text is returned with the spec; the review command writes it
// (and the skeptic's schema) to the project-relative paths the spec names before launching.

const MAX_LANE_NAME = 48;
const MAX_FINDINGS = 10;

// A ref becomes a git argument and an inline command span in the brief: no option, whitespace or shell syntax.
const REF = /^[A-Za-z0-9._/@^~{}-]+$/;

/** The part of an integration's paths its generated lanes need: its name and where their files go. */
export type LanePaths = Pick<IntegrationPaths, "name" | "projectRoot" | "lanesDir">;

/**
 * Where a generated lane's brief and schema go: in paths.lanesDir, as paths relative to the project root (lane files
 * name their brief and schema that way).
 */
export function reviewLaneFiles(paths: LanePaths, lane: string): { brief: string; schema: string } {
  const name = assertValidName(lane, "lane name");
  const rel = relative(paths.projectRoot, paths.lanesDir);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ArbabError("usage", `the lanes directory ${paths.lanesDir} is not inside the project ${paths.projectRoot}`);
  }
  const dir = rel.split(sep).join("/");
  return { brief: `${dir}/${name}.md`, schema: `${dir}/${name}.schema.json` };
}

/** Where a generated lane starts (generatedBase): a commit the install may run on, and the head merged on top. */
export interface LaneStart {
  base: string;
  mergeBranches?: string[];
}

function startFields(start: LaneStart): LaneStart {
  const base = checkRef(start.base, "base");
  if (start.mergeBranches === undefined) return { base };
  return { base, mergeBranches: start.mergeBranches.map((ref) => checkRef(ref, "merge branch")) };
}

function laneName(name: string, kind: "review" | "skeptic", lens: string): string {
  assertValidName(name, "integration name");
  assertValidName(lens, "lens");
  const lane = `${name}-${kind}-${lens}`;
  if (lane.length > MAX_LANE_NAME) {
    throw new ArbabError(
      "usage",
      `lane name ${lane} has ${lane.length} characters (at most ${MAX_LANE_NAME}): shorten the integration name or the lens`,
    );
  }
  return assertValidName(lane, "lane name");
}

/**
 * Checks every lane a review of these lenses may generate, before any is launched: the skeptic's name is a character
 * longer than the reviewer's, and finding that out after the reviewers ran would waste the whole review.
 */
export function assertReviewLaneNames(name: string, lenses: readonly string[]): void {
  for (const lens of lenses) for (const kind of ["review", "skeptic"] as const) laneName(name, kind, lens);
}

function checkRef(ref: string, what: string): string {
  if (ref.startsWith("-") || ref.includes("..") || !REF.test(ref)) {
    throw new ArbabError("usage", `${what} ${JSON.stringify(ref)} is not a plain git ref`);
  }
  return ref;
}

// The lens text comes from config: quoting it keeps a "## …" line in it from opening a brief section.
function quote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

export function reviewLane(input: { paths: LanePaths; lens: string; text: string; diffBase: string } & LaneStart): {
  spec: LaneSpec;
  brief: string;
} {
  const name = input.paths.name;
  const lane = laneName(name, "review", input.lens);
  const base = checkRef(input.diffBase, "diff base");
  if (input.text.trim() === "") throw new ArbabError("usage", `lens ${input.lens} has no text`);
  const start = startFields(input);
  const range = `${base}..HEAD`;

  const brief = `# Review ${name}: ${input.lens}

## Task

Review the change on this branch through the **${input.lens}** lens. Run \`git diff ${range}\` to see the change, and
\`git diff --stat ${range}\` for the files it touches.

The ${input.lens} lens looks for:

${quote(input.text)}

Depth floor:

- Read in full every file the diff changes, not only the hunks.
- Where a finding depends on code the changed files call, read that code too; do not assume what it does.

Findings:

- Every finding names a file, a line, a concrete failure scenario (the inputs or events, and what goes wrong) and
  evidence (the code that does it, quoted or cited by line).
- At most ${MAX_FINDINGS} findings, strongest first. Severity: HIGH loses or corrupts work, escapes the fence or
  leaks secrets; MEDIUM is wrong behaviour on a reachable path; LOW is a real but minor defect.
- No style remarks. Report no finding rather than a speculative one.

## Scope

Read-only. Do not edit, create or delete files, and do not commit.

## Acceptance

- \`paths_checked\` lists every file you read in full.
- \`coverage\` says what you verified and how, and what you did not check.
- Each finding has a file, a line, a failure scenario and evidence.
`;

  const spec: LaneSpec = {
    name: lane,
    role: "reviewer",
    brief: reviewLaneFiles(input.paths, lane).brief,
    ...start,
  };
  return { spec, brief };
}

const SEVERITY_VERDICTS = ["HIGH", "MEDIUM", "LOW", "NONE"] as const;

export const SKEPTIC_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          refuted: { type: "boolean" },
          corrected_severity: { type: "string", enum: SEVERITY_VERDICTS },
          reasoning: { type: "string" },
        },
        required: ["id", "refuted", "corrected_severity", "reasoning"],
      },
    },
  },
  required: ["verdicts"],
};

/** The findings a skeptic checks: the lens's MEDIUM and HIGH ones (LOW findings stay unverified). */
export function skepticFindings(lens: string, findings: ReviewFinding[]): ReviewFinding[] {
  return findings.filter((f) => f.lens === lens && (f.severity === "HIGH" || f.severity === "MEDIUM"));
}

export function skepticLane(input: { paths: LanePaths; lens: string; findings: ReviewFinding[]; diffBase?: string } & LaneStart): {
  spec: LaneSpec;
  brief: string;
  schema: JsonSchema;
} {
  const name = input.paths.name;
  const lane = laneName(name, "skeptic", input.lens);
  const findings = skepticFindings(input.lens, input.findings);
  if (findings.length === 0) {
    throw new ArbabError("usage", `lens ${input.lens} has no MEDIUM or HIGH findings: no skeptic lane is needed`);
  }
  const base = input.diffBase === undefined ? null : checkRef(input.diffBase, "diff base");
  const start = startFields(input);

  // Finding text comes from another worker: one JSON fence keeps it from forming sections or command spans (JSON
  // escapes newlines, so no line of it can close the fence).
  const listed = findings.map((f) => ({
    id: f.id,
    severity: f.severity,
    title: f.title,
    file: f.file,
    ...(f.line === undefined ? {} : { line: f.line }),
    failure_scenario: f.failureScenario,
    evidence: f.evidence,
  }));
  const provenance =
    base === null
      ? "use the file's history (`git log` and `git blame`) to tell"
      : `run \`git diff ${base}..HEAD\` and the file's history to tell`;

  const brief = `# Skeptic ${name}: ${input.lens}

## Task

A reviewer reported the findings below about the change on this branch, through the **${input.lens}** lens. Try to
refute each one. Check every finding from three angles:

- Trace: does the code do what the finding says? Read the cited file and line and follow the calls.
- Reachability: can it happen with real inputs, callers and configuration, not only in theory?
- Provenance: was it introduced by this change or was it there before? To check, ${provenance}. A pre-existing defect
  is still real: do not refute it for that, but say "pre-existing" in the reasoning.

Give one verdict per finding id: \`refuted\` true when the finding is wrong or cannot happen, and the severity it
really has (\`NONE\` when it is not a defect). If still uncertain after checking the code, refute it.

The findings:

\`\`\`json
${JSON.stringify(listed, null, 2)}
\`\`\`

## Scope

Read-only. Do not edit, create or delete files, and do not commit.

## Acceptance

- \`verdicts\` has exactly one entry for each finding id listed in the Task.
- Each \`reasoning\` names the code it checked (file and line) for the trace, reachability and provenance angles.
`;

  const files = reviewLaneFiles(input.paths, lane);
  const spec: LaneSpec = {
    name: lane,
    role: "reviewer",
    brief: files.brief,
    ...start,
    schema: files.schema,
  };
  return { spec, brief, schema: SKEPTIC_SCHEMA };
}
