// Per-command help: `arbab <command> --help`, `-h` and `arbab help <command>` (DESIGN.md §21). Each block follows the
// command's own parse() options; the global help (HELP in index.ts) only lists the commands.

type Option = readonly [flag: string, text: string];

function block(usages: readonly string[], options: readonly Option[] = []): string {
  const width = Math.max(0, ...options.map(([flag]) => flag.length));
  const lines = usages.map((u, i) => `${i === 0 ? "usage:" : "      "} arbab ${u}`);
  for (const [flag, text] of options) lines.push(`  ${flag.padEnd(width)}  ${text}`);
  return lines.join("\n") + "\n";
}

const JSON_OPT: Option = ["--json", "print JSON instead of text"];
const timeout = (fallback: string): Option => ["--timeout-min <n>", `give up after <n> minutes, exit 3 (default ${fallback})`];

/** One synopsis block per command: usage line(s), then one line per option. */
export const USAGE: Readonly<Record<string, string>> = {
  doctor: block(["doctor [--json]"], [JSON_OPT]),
  lint: block(["lint <lane.json> [--json]"], [JSON_OPT]),
  launch: block(["launch <lane.json> [--json]"], [JSON_OPT]),
  plan: block(
    ["plan check <plan.json> [--json]", "plan next <plan.json> [--retry <phase>] [--json]", "plan status <plan.json> [--json]"],
    [["--retry <phase>", "next: relaunch a failed phase"], JSON_OPT],
  ),
  status: block(
    ["status [<lane>…] [--active] [--mine] [--json]"],
    [
      ["--active", "only lanes not finished"],
      ["--mine", "only runs owned by this session or by none"],
      JSON_OPT,
    ],
  ),
  wait: block(
    ["wait [<lane>… | --any | --all] [--timeout-min <n>] [--notify] [--json]"],
    [
      ["--any", "wait for runs owned by this session or by none (the default)"],
      ["--all", "wait for every run"],
      timeout("none"),
      ["--notify", "a desktop notification per finished lane"],
      JSON_OPT,
    ],
  ),
  resume: block(
    ["resume <lane> [--prompt <file> | --digest] [--json]"],
    [
      ["--prompt <file>", "the prompt for the resumed session"],
      ["--digest", "start a fresh session seeded with the latest attempt's digest"],
      JSON_OPT,
    ],
  ),
  stop: block(["stop <lane> [--json]"], [JSON_OPT]),
  preflight: block(["preflight <lane.json> [--timeout-min <n>] [--json]"], [timeout("45"), JSON_OPT]),
  quota: block(
    ["quota [--reset | --refresh] [--json]"],
    [
      ["--reset", "delete the snapshot (after switching accounts)"],
      ["--refresh", "read the current account's windows with one call on the cheapest model"],
      JSON_OPT,
    ],
  ),
  cleanup: block(
    ["cleanup [--worktrees] [--older-than <days>] [--mine] [--json]"],
    [
      ["--worktrees", "also remove finished lanes' merged clean worktrees and landed integrations"],
      ["--older-than <days>", "only what finished at least <days> days ago"],
      ["--mine", "only runs owned by this session or by none"],
      JSON_OPT,
    ],
  ),
  integrate: block(
    [
      "integrate <name> (--lanes a,b,… | --plan <plan.json>) [--json]",
      "integrate <name> --adopt <ref> [--base <ref>] [--json]",
      "integrate <name> --deps-installed <sha> [--json]",
    ],
    [
      ["--lanes a,b,…", "merge these lane branches into integrate/<name>, in order"],
      ["--plan <plan.json>", "merge the plan's lane branches by waves"],
      ["--adopt <ref>", "make an integration of an existing branch"],
      ["--base <ref>", "with --adopt: the base it is compared with"],
      ["--deps-installed <sha>", "record that you reviewed and installed changed dependencies at <sha>"],
      JSON_OPT,
    ],
  ),
  verify: block(
    ["verify <name> [--timeout-min <n>] [--json]", "verify --ref <branch> [--timeout-min <n>] [--json]"],
    [["--ref <branch>", "run the gates on a branch head with no integration"], timeout("90"), JSON_OPT],
  ),
  review: block(
    ["review <name> [--lenses a,b] [--lens-file <name>=<file>]… [--since <sha>] [--timeout-min <n>] [--json]"],
    [
      ["--lenses a,b", "only these lenses; the others' findings from the same head stay"],
      ["--lens-file <name>=<file>", "take lens <name>'s text from <file>; repeatable"],
      ["--since <sha>", "review what changed since <sha> (a fix round)"],
      timeout("120"),
      JSON_OPT,
    ],
  ),
  readiness: block(
    ["readiness <name> [--tier low|medium|high] [--waive id,…] [--json]"],
    [
      ["--tier low|medium|high", "the risk tier (default config landing.tier)"],
      ["--waive id,…", "waive these checks (terminal only)"],
      JSON_OPT,
    ],
  ),
  land: block(
    ["land <name> [--squash] [--message <file>] [--keep-worktrees] [--json]"],
    [
      ["--squash", "make one commit (default config landing.squash)"],
      ["--message <file>", "the commit message"],
      ["--keep-worktrees", "keep the worktrees it landed"],
      JSON_OPT,
    ],
  ),
  ui: block(
    ["ui [--port <n>] [--hours <n>] [--no-open] [--json]"],
    [
      ["--port <n>", "0 (a free port, the default) or 1024 to 65535"],
      ["--hours <n>", "how far back the scene goes (default 24)"],
      ["--no-open", "print the URL instead of opening the browser"],
      JSON_OPT,
    ],
  ),
  summary: block(["summary [--all] [--json]"], [["--all", "every project that launched a lane on this machine"], JSON_OPT]),
  report: block(["report <lane> [--attempt <n>] [--json]"], [["--attempt <n>", "this attempt instead of the latest"], JSON_OPT]),
  hook: block(["hook <pre-tool-use|stop>"]),
  "host-check": block(["host-check <name>"]),
};
