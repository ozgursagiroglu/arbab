import { resolve } from "node:path";
import type { CompiledProfile, LintIssue, ProfileInput } from "../types";
import { ANY_CODE_PREFIXES, BACKGROUND_DENY, BASH_INPUT_PARAMS, FIXED_ENV, WORKER_TMP_ENV } from "./presets";

const BASH_RULE = /^Bash\((.*)\)$/s;
const PARAM_RULE = /^\s*([A-Za-z_]+)\s*:/;
const PATH_RULE = /^(?:Read|Edit)\((.*)\)$/s;

/** Deterministic checks on a compiled profile; launch refuses when any issue is an error (DESIGN.md §4). */
export function lintProfile(profile: CompiledProfile, input: ProfileInput): LintIssue[] {
  const issues: LintIssue[] = [];
  const error = (code: string, message: string, where: string): void => {
    issues.push({ severity: "error", code, message, where });
  };
  const warn = (code: string, message: string, where: string): void => {
    issues.push({ severity: "warning", code, message, where });
  };
  const { allow, deny } = profile.settings.permissions;
  const denied = new Set(deny);

  for (const rule of allow) {
    const bash = bashContent(rule);
    if (bash !== null) {
      if (bash === "" || bash.startsWith("*")) {
        error("bare-bash-allow", "allows every Bash command", rule);
      } else {
        const fixed = wildcardPrefix(bash);
        if (fixed !== null && ANY_CODE_PREFIXES.includes(fixed)) {
          error("any-code-allow", `"${fixed}" followed by a wildcard runs arbitrary code`, rule);
        }
      }
      if (bash.includes(":*")) warn("colon-star-form", "use the space form (`Bash(cmd *)`) instead of `:*`", rule);
    }
    if (denied.has(rule)) warn("shadowed-allow", "the same rule is denied, so this allow has no effect", rule);
  }

  const rules = [...allow.map((rule) => ({ rule, isDeny: false })), ...deny.map((rule) => ({ rule, isDeny: true }))];
  for (const { rule, isDeny } of rules) {
    const bash = bashContent(rule);
    const param = bash === null ? undefined : PARAM_RULE.exec(bash)?.[1];
    if (param !== undefined && BASH_INPUT_PARAMS.includes(param) && !(isDeny && rule === BACKGROUND_DENY)) {
      error("param-rule", `"${param}:" is read as a Bash input parameter rule, not a command`, rule);
    }
    const path = PATH_RULE.exec(rule)?.[1]?.trim();
    if (path !== undefined && path.startsWith("/") && !path.startsWith("//")) {
      error("relative-path-rule", "a single leading / is relative to the settings file; use // for absolute", rule);
    }
  }

  const sandbox = profile.settings.sandbox;
  if (sandbox.enabled !== true) error("sandbox-disabled", "the sandbox must be enabled", "sandbox.enabled");
  if (sandbox.failIfUnavailable !== true) {
    error("sandbox-fail-open", "a missing sandbox must be fatal", "sandbox.failIfUnavailable");
  }
  if (sandbox.allowUnsandboxedCommands !== false) {
    error("unsandboxed-retry", "an allow rule could approve an unsandboxed retry", "sandbox.allowUnsandboxedCommands");
  }
  if (sandbox.autoAllowBashIfSandboxed !== false && input.fence === "strict") {
    error("auto-allow-strict", "fence strict must not auto-allow sandboxed Bash", "sandbox.autoAllowBashIfSandboxed");
  }

  if (profile.tools.includes("Bash")) {
    const gitDir = input.gitCommonDir;
    if (gitDir === undefined) {
      warn("shared-git-writable", "no shared git directory is known, so sandboxed commands can write its refs and objects",
        "sandbox.filesystem.denyWrite");
    } else if (!(sandbox.filesystem?.denyWrite ?? []).map((p) => resolve(p)).includes(resolve(gitDir))) {
      warn("shared-git-writable", `${gitDir} is not in the sandbox's denyWrite`, "sandbox.filesystem.denyWrite");
    }
  }

  for (const tool of profile.tools) {
    if (tool === "Task" || tool === "Agent") error("agent-tool", "nested agents are not budgeted", tool);
  }

  for (const key of Object.keys(input.env)) {
    if (Object.hasOwn(FIXED_ENV, key) || WORKER_TMP_ENV.includes(key)) {
      warn("reserved-env", `${key} is set by arbab; this value is ignored`, key);
    }
  }
  return issues;
}

/** The text inside `Bash(…)`, "" for a bare `Bash`, null for any other tool. */
function bashContent(rule: string): string | null {
  if (rule === "Bash") return "";
  const content = BASH_RULE.exec(rule)?.[1];
  return content === undefined ? null : content.trim();
}

/** The fixed words before the first wildcard ("pnpm exec *" → "pnpm exec", "npm:*" → "npm"), or null for none. */
function wildcardPrefix(content: string): string | null {
  const star = content.indexOf("*");
  if (star === -1) return null;
  return content.slice(0, star).trim().replace(/:$/, "").trim().split(/\s+/).join(" ");
}
