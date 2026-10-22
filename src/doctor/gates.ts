import { basename, join } from "node:path";
import { listNames, packageScripts, readOptional, readPackageJson } from "./read";
import type { DoctorCheck } from "./types";

// verify runs the gates and nothing else: a check script no gate reaches passes in a lane and fails in CI.

const CHECK_NAMES = new Set(["check", "lint", "test", "typecheck", "type-check", "build", "format", "format:check"]);
const CHECK_PREFIXES = ["check:", "lint:", "test:", "i18n", "e2e"];
const RUNNERS = new Set(["run-s", "run-p", "npm-run-all"]);
const SCRIPT_NAME = /^[^\s-][^\s]*$/;

/** Whether a package.json script name looks like a check verify should run. */
export function isCheckScript(name: string): boolean {
  return CHECK_NAMES.has(name) || CHECK_PREFIXES.some((p) => name.startsWith(p));
}

/** The script an argv runs: `pnpm <s>`, `pnpm run <s>`, `npm run <s>`, `npm test`, `yarn <s>`, `yarn run <s>`; else null. */
export function scriptOf(argv: readonly string[]): string | null {
  const pm = basename(argv[0] ?? "");
  let name: string | undefined;
  if (pm === "pnpm" || pm === "yarn") name = argv[1] === "run" ? argv[2] : argv[1];
  else if (pm === "npm") name = argv[1] === "run" || argv[1] === "run-script" ? argv[2] : argv[1] === "test" ? "test" : undefined;
  return name !== undefined && SCRIPT_NAME.test(name) ? name : null;
}

/**
 * The scripts a shell command line calls, in package-manager form or as run-s / run-p / npm-run-all arguments (which
 * may end in `*`). Approximate on purpose: quotes are dropped and only `&&`, `||`, `;`, `|` and `&` split commands.
 */
export function scriptCalls(command: string): string[] {
  const out: string[] = [];
  for (const segment of command.split(/&&|\|\||[;|&\n]/)) {
    const words = segment.trim().split(/\s+/).map((w) => w.replace(/^['"]|['"]$/g, "")).filter((w) => w !== "");
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? "")) words.shift();
    const name = scriptOf(words);
    if (name !== null) out.push(name);
    if (RUNNERS.has(basename(words[0] ?? ""))) out.push(...words.slice(1).filter((w) => SCRIPT_NAME.test(w)));
  }
  return out;
}

function matching(pattern: string, names: readonly string[]): string[] {
  if (!pattern.endsWith("*")) return names.includes(pattern) ? [pattern] : [];
  const prefix = pattern.replace(/\*+$/, "");
  return names.filter((n) => n.startsWith(prefix));
}

/** The scripts the gates run, directly or through the scripts those call. */
export function coveredScripts(gates: readonly (readonly string[])[], scripts: Record<string, string>): Set<string> {
  const names = Object.keys(scripts);
  const covered = new Set<string>();
  const queue: string[] = [];
  const mark = (pattern: string): void => {
    for (const name of matching(pattern, names)) {
      if (covered.has(name)) continue;
      covered.add(name);
      queue.push(name);
    }
  };
  for (const gate of gates) {
    const name = scriptOf(gate);
    if (name !== null) mark(name);
  }
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    for (const call of scriptCalls(scripts[name] ?? "")) mark(call);
  }
  return covered;
}

/** The command lines of a GitHub Actions workflow's `run:` steps: inline values and the lines of block scalars. */
export function workflowRunLines(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const out: string[] = [];
  const indentOf = (line: string): number => line.length - line.trimStart().length;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:(?:\s+(.*))?$/.exec(lines[i] ?? "");
    if (m === null) continue;
    const indent = (m[1] ?? "").length;
    const value = (m[2] ?? "").replace(/\s+#.*$/, "").trim();
    if (value === "" || /^[|>][-+0-9]*$/.test(value)) {
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? "";
        if (next.trim() !== "" && indentOf(next) <= indent) break;
        if (next.trim() !== "") out.push(next.trim());
        i++;
      }
    } else {
      out.push(value.replace(/^(['"])(.*)\1$/, "$2"));
    }
  }
  return out;
}

/**
 * One warn line for the check scripts in package.json that no gate runs, and one for those the CI workflows run that
 * no gate does. Nothing when package.json has no check script.
 */
export function checkGates(root: string, gates: readonly (readonly string[])[]): DoctorCheck[] {
  const scripts = packageScripts(readPackageJson(root));
  const checks = Object.keys(scripts).filter(isCheckScript).sort();
  if (checks.length === 0) return [];
  const covered = coveredScripts(gates, scripts);
  const missing = checks.filter((s) => !covered.has(s));
  const out: DoctorCheck[] = [
    missing.length === 0
      ? { status: "ok", check: "gates", detail: `gates run ${checks.join(", ")}` }
      : { status: "warn", check: "gates", detail: `no gate runs these package.json scripts: ${missing.join(", ")}` },
  ];

  const workflows = join(root, ".github", "workflows");
  const inCi = new Set<string>();
  for (const file of listNames(workflows).filter((n) => /\.ya?ml$/.test(n))) {
    for (const line of workflowRunLines(readOptional(join(workflows, file)) ?? "")) {
      for (const call of scriptCalls(line)) for (const name of matching(call, missing)) inCi.add(name);
    }
  }
  if (inCi.size > 0) out.push({ status: "warn", check: "gates", detail: `CI runs checks verify does not: ${[...inCi].sort().join(", ")}` });
  return out;
}
