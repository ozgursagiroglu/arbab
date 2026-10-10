import type { BriefContext, BriefSectionName, BriefSource, CompiledProfile, Role } from "../types";
import { scanLines } from "./markdown";
import { describeSchema } from "./schema";
import { toolBelt } from "./toolbelt";

const SOURCE_ORDER: readonly BriefSectionName[] = ["Task", "Scope", "Facts", "Unverified", "Acceptance", "Notes"];

const ROLE_SPECIFICS: Partial<Record<Role, string>> = {
  reviewer: "You cannot edit files. Report findings with evidence.",
  researcher: "You have only web tools. Cite a source for every claim.",
  probe: "Run each step exactly as written.",
};

export function roleAndIsolation(ctx: Pick<BriefContext, "role" | "worktree" | "branch">, profile: CompiledProfile): string {
  const loopback = profile.settings.sandbox.network.allowLocalBinding ? " Listening on 127.0.0.1 is allowed." : "";
  const lines = [
    `You are an arbab worker in the ${ctx.role} role. You run headless: nobody will answer questions. Decide, and ` +
      "report what you could not decide.",
    "",
    `- Your working directory is a git worktree at \`${ctx.worktree}\` on branch \`${ctx.branch}\`. Work only inside it.`,
    "- Shell commands run in an OS sandbox: no network, no writes outside the worktree and the temp directory, and " +
      `credential files are unreadable.${loopback}`,
    "- You cannot commit, push or switch branches. The runner commits your work when you finish.",
    "- A refused command costs you one turn. Do not retry it; use the tool belt.",
  ];
  const specific = ROLE_SPECIFICS[ctx.role];
  if (specific !== undefined) lines.push(`- ${specific}`);
  return lines.join("\n");
}

/** An instruction file nested under `### <path>`: its own title is dropped and its headings move down two levels. */
export function nestInstruction(content: string): string {
  const lines = scanLines(content.trim());
  if (lines[0] !== undefined && !lines[0].inFence && /^# /.test(lines[0].text)) lines.shift();
  return lines
    .map((l) => (l.inFence ? l.text : l.text.replace(/^(#{1,6}) /, (_, h: string) => `${"#".repeat(Math.min(h.length + 2, 6))} `)))
    .join("\n")
    .trim();
}

function section(heading: string, body: string): string {
  return `## ${heading}\n\n${body}`;
}

/** The worker's full prompt (DESIGN.md §5). */
export function assembleBrief(source: BriefSource, ctx: BriefContext): string {
  const parts: string[] = [`# ${source.title}`, section("Role and isolation", roleAndIsolation(ctx, ctx.profile))];

  if (ctx.instructions.length > 0) {
    parts.push(section("Project rules", ctx.instructions.map((i) => `### ${i.path}\n\n${nestInstruction(i.content)}`).join("\n\n")));
  }
  for (const name of SOURCE_ORDER) {
    const text = source.sections[name]?.trim();
    if (text) parts.push(section(name, text));
  }
  parts.push(section("Tool belt", toolBelt(ctx.profile, ctx.leases, ctx.bashMaxTimeoutMin)));

  const coordination = ctx.coordination?.trim();
  if (coordination) parts.push(section("Coordination", coordination));
  if (ctx.upstream.length > 0) {
    parts.push(section("Upstream reports", ctx.upstream.map((u) => `### ${u.lane}\n\n${u.summary.trim()}`).join("\n\n")));
  }

  const report = ctx.schema === null
    ? describeSchema(null)
    : `Your final answer is a JSON object with these fields:\n\n${describeSchema(ctx.schema)}\n\n` +
      "End with that JSON object as your final answer.";
  parts.push(section("Report", report));
  return `${parts.join("\n\n")}\n`;
}
