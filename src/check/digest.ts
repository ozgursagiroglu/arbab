// Reads the failures out of a failed check's output (DESIGN.md §22), so a worker sees them in the summary instead of
// re-running the suite with another reporter. Pure; the output is worker-controlled text, kept as data.
import type { CheckFailure } from "../types";
import { FAILURE_MESSAGE_MAX } from "./command";

// CSI sequences (colours, cursor moves) and OSC sequences (hyperlinks), as terminals and test runners print them.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

// `FAIL <file>`, `FAIL |<project>| <file>`, then optionally ` > <test path>` (vitest).
const FAIL_LINE = /^\s*FAIL\s+(?:\|[^|]*\|\s+)?(\S.*?)\s*$/;
// vitest's suite-level failure repeats the file in brackets; jest appends the duration.
const FAIL_SUFFIX = /\s+(?:\[[^\]]*\]|\(\d+(?:\.\d+)?\s*m?s\))$/;
const JEST_BULLET = /^\s*●\s+(.+?)\s*$/;
// Lines that close a FAIL block before another FAIL line: the runners' summaries and vitest's separators.
const BLOCK_END = /^\s*(?:Test Files\s|Tests\s|Test Suites:|Snapshots:|PASS\s|⎯{3,})/;
const TSC_PAREN = /^(.+?)\((\d+),(\d+)\): error (TS\d+: .*)$/;
const TSC_COLON = /^(.+?):(\d+):(\d+) - error (TS\d+: .*)$/;
const ESLINT_HEADER = /^(?:\/\S*|\S*[^\s/\\]\.[A-Za-z0-9]+)$/;
const ESLINT_PROBLEM = /^\s+\d+:\d+\s+(error|warning)\s+(.*?)\s*$/;
const PRETTIER = /^\[warn\]\s+(\S+)\s*$/;

interface FailBlock {
  file: string;
  test: string | null;
  message: string | null;
  /** jest's `● suite › test` failures inside the block; when any, they replace the file-level one. */
  bullets: CheckFailure[];
  awaiting: CheckFailure | null;
}

const cut = (message: string): string => message.trim().slice(0, FAILURE_MESSAGE_MAX);

function failLine(line: string): { file: string; test: string | null } | null {
  const match = FAIL_LINE.exec(line);
  if (match === null) return null;
  let rest = match[1] ?? "";
  while (FAIL_SUFFIX.test(rest)) rest = rest.replace(FAIL_SUFFIX, "");
  const gt = rest.indexOf(" > ");
  const file = (gt < 0 ? rest : rest.slice(0, gt)).trim();
  const test = gt < 0 ? null : rest.slice(gt + 3).trim() || null;
  return file === "" ? null : { file, test };
}

function blockFailures(block: FailBlock): CheckFailure[] {
  if (block.awaiting !== null) block.bullets.push({ ...block.awaiting, message: "failed" });
  block.awaiting = null;
  if (block.bullets.length > 0) return block.bullets;
  return [{ file: block.file, test: block.test, message: block.message ?? "failed" }];
}

/**
 * The failures in a check's output, in output order and deduplicated, at most `max`: vitest and jest FAIL lines, tsc
 * errors in both forms, eslint's first error per file, and prettier's unformatted files.
 */
export function parseFailures(output: string, max = 30): CheckFailure[] {
  // A FAIL block's failures are known only when it closes; it keeps its place in the order meanwhile.
  const entries: Array<CheckFailure | FailBlock> = [];
  let block: FailBlock | null = null;
  let eslintFile: string | null = null;
  let eslintTaken = false;

  for (const raw of stripAnsi(output).split(/\r?\n/)) {
    const line = raw.trimEnd();

    const fail = failLine(line);
    if (fail !== null) {
      block = { ...fail, message: null, bullets: [], awaiting: null };
      entries.push(block);
      eslintFile = null;
      continue;
    }
    if (block !== null && line.trim() !== "") {
      if (BLOCK_END.test(line)) {
        block = null;
      } else {
        const bullet = block.test === null ? JEST_BULLET.exec(line) : null;
        if (bullet !== null && !/^Console\b/.test(bullet[1] ?? "")) {
          if (block.awaiting !== null) block.bullets.push({ ...block.awaiting, message: "failed" });
          block.awaiting = { file: block.file, test: (bullet[1] ?? "").split(" › ").join(" > "), message: "" };
        } else if (block.awaiting !== null) {
          block.bullets.push({ ...block.awaiting, message: cut(line) });
          block.awaiting = null;
        } else if (block.message === null) {
          block.message = cut(line);
        }
      }
    }

    const tsc = TSC_PAREN.exec(line) ?? TSC_COLON.exec(line);
    if (tsc !== null) {
      entries.push({ file: tsc[1] ?? "", test: null, message: cut(tsc[4] ?? "") });
      continue;
    }

    const prettier = PRETTIER.exec(line);
    if (prettier !== null) {
      entries.push({ file: prettier[1] ?? "", test: null, message: "not formatted (prettier)" });
      continue;
    }

    if (ESLINT_HEADER.test(line)) {
      eslintFile = line;
      eslintTaken = false;
      continue;
    }
    const problem = ESLINT_PROBLEM.exec(line);
    if (problem !== null && eslintFile !== null) {
      if (problem[1] === "error" && !eslintTaken) {
        // `<message>  <rule>`: the rule is the last word after two or more spaces, when there is one.
        const [, text = "", rule] = /^(.*?)(?:\s{2,}(\S+))?$/.exec(problem[2] ?? "") ?? [];
        entries.push({ file: eslintFile, test: null, message: cut(rule === undefined ? text : `${text} (${rule})`) });
        eslintTaken = true;
      }
      continue;
    }
    eslintFile = null;
  }

  const seen = new Set<string>();
  const failures: CheckFailure[] = [];
  for (const entry of entries) {
    for (const failure of "bullets" in entry ? blockFailures(entry) : [entry]) {
      const key = `${failure.file ?? ""}\0${failure.test ?? ""}\0${failure.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push(failure);
      if (failures.length >= max) return failures;
    }
  }
  return failures;
}
