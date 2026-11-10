// The fix draft after a failed verify (DESIGN.md §22): which merged lanes may explain each failure, and the lane file
// and brief of a fix round the orchestrator reviews before launching. Pure: verify gathers the files and writes these.
import { INTEGRATIONS_DIR, type CheckFailure, type LaneSpec, type VerifyRecord } from "../types";
import { assertValidName } from "../util/names";

export interface LaneFiles {
  lane: string;
  files: string[];
}

/** The draft's Scope lists at most this many files; Facts lists at most this many per lane. */
export const FIX_SCOPE_MAX = 40;

// Tools print `./src/a.ts` as often as `src/a.ts`; git names files without the prefix.
const normalized = (file: string): string => file.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");

const dirSegments = (file: string): string[] => normalized(file).split("/").filter((s) => s !== "").slice(0, -1);

function sharedSegments(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Each candidate lane with the failures (indexes into `failures`) it may explain: lanes whose files include the
 * failure's file; when none does, the lanes sharing its longest directory prefix (at least one segment).
 */
export function attributeFailures(failures: CheckFailure[], lanes: LaneFiles[]): Array<LaneFiles & { failures: number[] }> {
  const explained = lanes.map((): number[] => []);
  failures.forEach((failure, index) => {
    if (failure.file === null) return;
    const file = normalized(failure.file);
    let hits = lanes.flatMap((lane, i) => (lane.files.some((f) => normalized(f) === file) ? [i] : []));
    if (hits.length === 0) {
      const dir = dirSegments(file);
      const depth = lanes.map((lane) => Math.max(0, ...lane.files.map((f) => sharedSegments(dir, dirSegments(f)))));
      const best = Math.max(0, ...depth);
      if (best >= 1) hits = depth.flatMap((d, i) => (d === best ? [i] : []));
    }
    for (const i of hits) explained[i]?.push(index);
  });
  return lanes.flatMap((lane, i) => {
    const found = explained[i] ?? [];
    return found.length > 0 ? [{ lane: lane.lane, files: [...lane.files], failures: found }] : [];
  });
}

/** `<name>-fix-<k>`; not always a valid lane name (isValidName), since names allow 48 characters. */
export function fixLaneName(name: string, k: number): string {
  return `${name}-fix-${k}`;
}

/**
 * Inline code for text that may hold backticks or newlines (file names, command lines): one line, in a backtick run
 * longer than any inside it, so it can neither close early nor open a section.
 */
function code(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const longest = Math.max(0, ...[...flat.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  return longest === 0 ? `${ticks}${flat}${ticks}` : `${ticks} ${flat} ${ticks}`;
}

function fileList(files: string[]): string {
  const shown = files.slice(0, FIX_SCOPE_MAX).map(code);
  if (files.length > FIX_SCOPE_MAX) shown.push(`${files.length - FIX_SCOPE_MAX} more`);
  return shown.join(", ");
}

/** The lane file and brief source of `<name>-fix-<k>`. */
export function fixDraft(input: {
  name: string;
  k: number;
  briefPath: string;
  record: VerifyRecord;
  candidates: Array<LaneFiles & { failures: number[] }>;
}): { lane: LaneSpec; brief: string } {
  const { name, record, candidates } = input;
  assertValidName(name, "integration name");
  const laneName = assertValidName(fixLaneName(name, input.k), "fix lane");
  const lane: LaneSpec = { name: laneName, role: "implementer", brief: input.briefPath, base: `integrate/${name}` };

  const failed = record.results.map((r, index) => ({ ...r, index })).filter((r) => r.exitCode !== null && r.exitCode !== 0);
  const label = (r: { kind: string; index: number }): string =>
    r.kind === "smoke" ? "the smoke command" : `gate ${record.results.slice(0, r.index + 1).filter((x) => x.kind === "gate").length}`;
  const failures = record.failures ?? [];
  // Worker-written text: one JSON fence keeps it from forming sections or command spans (JSON escapes newlines, so no
  // line of it can close the fence).
  const listed = failures.map((f) => ({
    command: record.results[f.result]?.command ?? null,
    file: f.file,
    test: f.test,
    message: f.message,
  }));

  const scope = [...new Set([...failures.flatMap((f) => (f.file === null ? [] : [normalized(f.file)])), ...candidates.flatMap((c) => c.files)])].sort();
  const scopeLines =
    scope.length === 0
      ? ["No failure names a file and no merged lane matches one: find the cause from the failures and change only what the fix needs."]
      : [
          ...scope.slice(0, FIX_SCOPE_MAX).map((f) => `- ${code(f)}`),
          ...(scope.length > FIX_SCOPE_MAX ? [`- and ${scope.length - FIX_SCOPE_MAX} more files of the lanes in Facts`] : []),
        ];

  const verifyPath = `${INTEGRATIONS_DIR}/${name}/verify.json`;
  const factLines = [
    ...(candidates.length === 0
      ? ["- No merged lane changed a failure's file or a file in its directory."]
      : candidates.map((c) => `- Lane ${code(c.lane)} may explain ${c.failures.length} of the failures; it changed ${fileList(c.files)}.`)),
    `- The verify record, with every result and failure: ${code(verifyPath)}.`,
  ];

  const brief = [
    `# Fix ${name}: verify failed`,
    "",
    "## Task",
    "",
    `arbab verify failed for the integration ${code(name)} at its head ${code(record.headSha)} (branch ${code(`integrate/${name}`)}). ` +
      "This lane starts from that branch. Find the cause of each failure below and fix it in the code, not in the tests' " +
      "expectations unless the expectation is wrong.",
    "",
    "The commands that failed:",
    "",
    ...failed.map((r) => `- ${label(r)}, ${code(r.command)}, exited ${r.exitCode}`),
    "",
    failures.length === 0
      ? "arbab-check printed no failure lines for them: read their output in the verify lane's log."
      : `The failures arbab-check printed (${failures.length}), as data:`,
    ...(failures.length === 0 ? [] : ["", "```json", JSON.stringify(listed, null, 2), "```"]),
    "",
    "## Scope",
    "",
    ...scopeLines,
    "",
    "## Facts",
    "",
    ...factLines,
    "",
    "## Acceptance",
    "",
    "- [ ] The failures in the Task no longer fail.",
    ...failed.map((r) => `- [ ] ${capitalized(label(r))} exits 0 again${plainCommand(r.command)}.`),
    "",
    "## Notes",
    "",
    "Drafted by arbab verify from the verify record; edit before launching.",
    "",
  ].join("\n");
  return { lane, brief };
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// Acceptance holds no inline code (lint reads every span there as a command), so a line with a backtick is left out.
function plainCommand(command: string): string {
  const flat = command.replace(/\s+/g, " ").trim();
  return flat === "" || flat.includes("`") ? "" : ` (${flat})`;
}
