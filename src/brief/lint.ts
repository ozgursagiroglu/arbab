import type { BriefSectionName, BriefSource, CompiledProfile, LintIssue } from "../types";
import { inlineCodeSpans, scanLines } from "./markdown";
import { unknownSections } from "./parse";
import { isAllowedCommand } from "./rules";

export const MAX_BRIEF_CHARS = 40_000;

const REQUIRED: readonly BriefSectionName[] = ["Task", "Scope", "Acceptance"];

const COMMAND_WORDS = new Set(["git", "pnpm", "npm", "npx", "node", "yarn", "bun", "curl", "wget", "ls", "cat", "rm", "mv",
  "cp", "mkdir", "make", "python", "python3", "docker", "gh"]);

// Fences in other languages hold code samples (TypeScript has semicolons), not commands the worker will run.
const SHELL_FENCES = new Set(["", "sh", "bash", "zsh", "shell", "console", "shell-session"]);

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["cd ", /(?:^|[\s;&|(])cd\s/],
  ["&&", /&&/],
  ["||", /\|\|/],
  [";", /;/],
  ["$(", /\$\(/],
  ["`", /`/],
  ["sleep ", /(?:^|[\s;&|(])sleep\s/],
  ["echo $?", /echo \$\?/],
  ["| tail", /\|\s*tail\b/],
  ["| head", /\|\s*head\b/],
  ["run_in_background", /run_in_background/],
];

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELLS = new Set(["bash", "sh", "zsh"]);

/**
 * A command as the profile sees its program: without leading `NAME=value` assignments or `env`, and with a path in
 * the first word reduced to its basename, so `FOO=1 /usr/bin/git push` is checked as `git push`.
 */
export function normalizeCommand(command: string): string {
  const words = command.trim().split(/\s+/).filter((w) => w !== "");
  let i = 0;
  while (i < words.length && (ASSIGNMENT.test(words[i] ?? "") || words[i] === "env")) i++;
  const rest = words.slice(i);
  const first = rest[0];
  if (first !== undefined && first.includes("/")) rest[0] = first.slice(first.lastIndexOf("/") + 1);
  return rest.join(" ");
}

/** `bash -c …` and the like: a shell that runs a string hides its commands from the fence. */
function shellWithString(command: string): string | null {
  const [shell, ...args] = normalizeCommand(command).split(" ");
  if (shell === undefined || !SHELLS.has(shell)) return null;
  for (const arg of args) {
    if (!arg.startsWith("-")) break;
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(arg)) return `${shell} -c`;
  }
  return null;
}

export function forbiddenShapes(command: string): string[] {
  const shapes = FORBIDDEN.filter(([, re]) => re.test(command)).map(([shape]) => shape);
  const shell = shellWithString(command);
  return shell === null ? shapes : [...shapes, shell];
}

const SECTION = /^## +(.*?)(?:\s+#+)?\s*$/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const TABLE_ROW = /^\s*\|/;

// The prose before an inline span that makes it something to run (DESIGN.md §16).
const RUN_INTRO = /(?:\b(?:run|runs|execute|call)|\bwith the command|\bbash)\s*:?\s*$/i;
// The prose between two spans of one list of commands: "`a`, `b` and then `c`".
const CHAIN = /^\s*(?:(?:,|\band\b|\bthen\b)\s*)+$/i;

/** Each inline code span of a text with its position, in order. */
function spansIn(text: string): Array<{ span: string; start: number; end: number }> {
  const out: Array<{ span: string; start: number; end: number }> = [];
  let from = 0;
  for (const span of inlineCodeSpans(text)) {
    // Find the backtick run that opens this span: the same run must follow the span's content.
    for (const run of text.slice(from).matchAll(/`+/g)) {
      const open = from + run.index;
      const ticks = run[0];
      const end = open + ticks.length + span.length;
      if (text.startsWith(span, open + ticks.length) && text.startsWith(ticks, end) && text.charAt(end + ticks.length) !== "`") {
        out.push({ span, start: open, end: end + ticks.length });
        from = end + ticks.length;
        break;
      }
    }
  }
  return out;
}

/** The inline command spans of one paragraph: introduced by the text before them, or chained to one that is. */
function paragraphCommands(text: string, section: string): string[] {
  const out: string[] = [];
  let previous: { end: number; command: boolean } | null = null;
  for (const { span, start, end } of spansIn(text)) {
    const chained: boolean = previous !== null && previous.command && CHAIN.test(text.slice(previous.end, start));
    const command: boolean = section === "Acceptance" || RUN_INTRO.test(text.slice(0, start)) || chained;
    if (command) out.push(span);
    previous = { end, command };
  }
  return out;
}

/**
 * The command spans of a brief, the places a worker copies commands from: every line of a shell fence, inline code
 * in Acceptance, inline code its paragraph introduces as something to run, and the spans chained to such a span in
 * the same sentence. Other inline code is descriptive.
 */
function commandCandidates(markdown: string): Array<{ text: string; inline: boolean }> {
  const out: Array<{ text: string; inline: boolean }> = [];
  let section = "";
  // A paragraph's lines are joined by spaces. A heading, a list item and a table row each start a new block, so an
  // intro in one item does not reach the next.
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) out.push(...paragraphCommands(paragraph.join(" "), section).map((text) => ({ text, inline: true })));
    paragraph = [];
  };
  for (const line of scanLines(markdown)) {
    if (line.inFence) {
      flush();
      if (!line.delimiter && SHELL_FENCES.has((line.info ?? "").toLowerCase()) && line.text.trim() !== "") {
        out.push({ text: line.text, inline: false });
      }
    } else if (line.text.trim() === "") {
      flush();
    } else if (HEADING.test(line.text)) {
      flush();
      const heading = SECTION.exec(line.text)?.[1];
      if (heading !== undefined && heading !== "") section = heading;
      paragraph = [line.text];
      flush();
    } else {
      if (LIST_ITEM.test(line.text) || TABLE_ROW.test(line.text)) flush();
      paragraph.push(paragraph.length === 0 ? line.text : line.text.trim());
    }
  }
  flush();
  return out;
}

function effectiveAllow(profile: CompiledProfile): string[] {
  if (!profile.tools.includes("Bash")) return [];
  return profile.settings.sandbox.autoAllowBashIfSandboxed ? ["Bash"] : profile.settings.permissions.allow;
}

export function lintBrief(markdown: string, source: BriefSource, profile: CompiledProfile): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const name of REQUIRED) {
    if (!source.sections[name]?.trim()) {
      issues.push({ severity: "error", code: "missing-section", message: `the ${name} section is missing or empty`, where: name });
    }
  }

  const allow = effectiveAllow(profile);
  const { deny } = profile.settings.permissions;
  for (const { text, inline } of commandCandidates(markdown)) {
    const shapes = forbiddenShapes(text);
    if (shapes.length > 0) {
      issues.push({
        severity: "error",
        code: "forbidden-shape",
        message: `${inline ? "inline code" : "a code line"} uses a shape the fence refuses (${shapes.join(", ")}): ` +
          "give one command per line, without compounds, cd, sleep or exit-code echoes",
        where: text.trim(),
      });
    }
    const command = text.trim();
    const normalized = normalizeCommand(command);
    const word = normalized.split(" ")[0] ?? "";
    // The fence matches the raw text, so a path or assignment prefix can make an allowed command refused too.
    if (COMMAND_WORDS.has(word) && !(isAllowedCommand(command, allow, deny) && isAllowedCommand(normalized, allow, deny))) {
      issues.push({
        severity: "error",
        code: "denied-command",
        message: `\`${command}\` is not allowed by this lane's profile: the worker would be refused`,
        where: command,
      });
    }
  }

  for (const name of unknownSections(markdown)) {
    issues.push({ severity: "warning", code: "unknown-section", message: `unknown section "${name}" is moved under Notes`, where: name });
  }
  if (markdown.length > MAX_BRIEF_CHARS) {
    issues.push({
      severity: "warning",
      code: "long-brief",
      message: `the brief has ${markdown.length} characters (over ${MAX_BRIEF_CHARS}); move background into files the worker reads`,
    });
  }
  return issues;
}
