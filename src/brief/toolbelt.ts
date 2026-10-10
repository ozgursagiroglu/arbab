import { GIT_WRITE_VERBS } from "../profile/presets";
import type { CompiledProfile, Lease } from "../types";
import { envSuffix } from "../util/names";

const FILE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit"];
const WEB_TOOLS = ["WebFetch", "WebSearch"];

function code(text: string): string {
  return `\`${text}\``;
}

/** `Bash(p)` → `p`, `Bash(p *)` and `Bash(p:*)` → `p …`, merged per prefix in first-seen order. */
export function allowedCommands(allow: string[]): string[] {
  const seen = new Map<string, boolean>();
  for (const raw of allow) {
    const rule = raw.trim();
    if (rule === "Bash" || rule === "Bash(*)") return ["any command"];
    const inner = /^Bash\((.*)\)$/s.exec(rule)?.[1];
    if (inner === undefined) continue;
    const prefix = /^(.*?)(?: \*|:\*)$/s.exec(inner)?.[1];
    const key = prefix ?? inner;
    seen.set(key, (seen.get(key) ?? false) || prefix !== undefined);
  }
  return [...seen].map(([p, withArgs]) => code(withArgs ? `${p} …` : p));
}

function minutes(n: number): string {
  return n === 1 ? "1 minute" : `${n} minutes`;
}

function leaseLine(leases: Lease[]): string | null {
  if (leases.length === 0) return null;
  const counts = new Map<string, number>();
  const vars = leases.map((lease) => {
    const i = counts.get(lease.type) ?? 0;
    counts.set(lease.type, i + 1);
    return code(`ARBAB_${envSuffix(lease.type)}_${i}=${lease.value}`);
  });
  return `- Leased resources, exported as environment variables: ${vars.join(", ")}. Use these instead of picking your own.`;
}

function doNotTry(profile: CompiledProfile, hasBash: boolean): string[] {
  const { deny } = profile.settings.permissions;
  // Only bare rules deny a whole tool; `Edit(~/.ssh/**)` denies paths.
  const denied = new Set(deny.map((rule) => rule.trim()));
  const items: string[] = [];
  const gitWrite = deny.some((rule) => GIT_WRITE_VERBS.some((verb) => new RegExp(`^Bash\\(git ${verb}(?:[ :)]|$)`).test(rule.trim())));
  if (gitWrite) items.push("git writes (the runner commits)");
  if (WEB_TOOLS.some((t) => denied.has(t))) items.push("network access and web tools");
  else if (hasBash) items.push("network access from the shell");
  if (denied.has("Edit") || denied.has("Write")) items.push("editing or creating files");
  items.push("files outside the worktree");
  if (deny.some((rule) => /^(?:Read|Edit)\(/.test(rule.trim()))) items.push("credential files");
  return items;
}

/** The tool belt section's body: what the worker may use, the shapes the fence refuses, leases and the do-not-try list. */
export function toolBelt(profile: CompiledProfile, leases: Lease[], bashMaxTimeoutMin: number): string {
  const lines: string[] = [];
  const hasBash = profile.tools.includes("Bash");

  if (!hasBash) {
    lines.push("- You have no shell: the Bash tool is not available.");
  } else if (profile.settings.sandbox.autoAllowBashIfSandboxed) {
    lines.push("- Shell commands run inside the sandbox without an allowlist: any command the sandbox permits runs, " +
      "except the denied ones below.");
  } else {
    const commands = allowedCommands(profile.settings.permissions.allow);
    lines.push(commands.length > 0 ? `- Shell commands you may run: ${commands.join(", ")}.` : "- No shell command is allowed.");
  }

  const fileTools = profile.tools.filter((t) => FILE_TOOLS.includes(t));
  if (fileTools.length > 0) {
    const hints: string[] = [];
    if (fileTools.includes("Write")) hints.push("use Write to create directories and files");
    if (hasBash && fileTools.includes("Read") && fileTools.includes("Grep")) hints.push("use Read and Grep instead of shell pipelines");
    const hint = hints.length > 0 ? ` ${hints.join("; ").replace(/^u/, "U")}.` : "";
    lines.push(`- File tools: ${fileTools.join(", ")}.${hint}`);
  }
  const otherTools = profile.tools.filter((t) => t !== "Bash" && !FILE_TOOLS.includes(t));
  if (otherTools.length > 0) lines.push(`- Other tools: ${otherTools.join(", ")}.`);

  if (hasBash) {
    lines.push(
      "- One command per call, in the foreground. These are refused:",
      "  - `cd X && …`: commands already run in the worktree;",
      "  - `&&`, `;` and pipes into `tail`/`head`: run single commands and read the full output;",
      "  - `$(…)` and `echo $?`: the tool reports the exit code;",
      `  - \`sleep N\`: set the Bash \`timeout\` parameter instead, up to ${minutes(bashMaxTimeoutMin)};`,
      "  - background processes: refused; run everything in the foreground.",
    );
  }

  const lease = leaseLine(leases);
  if (lease !== null) lines.push(lease);
  lines.push(`- Do not try: ${doNotTry(profile, hasBash).join(", ")}.`);
  return lines.join("\n");
}
