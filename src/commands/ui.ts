// arbab ui [--port N] [--hours N] [--no-open] [--json]
//
// Serves the project's pyramid scene on 127.0.0.1 until SIGINT or SIGTERM (DESIGN.md §19). Read-only: it writes
// nothing under .arbab/ or ~/.arbab/ and signals no process. The session token appears only in the printed URL, and
// only when the browser was not opened.
// Text: `arbab ui: <project> at <url>` and `read-only; Ctrl-C stops it`; once the browser opened, <url> is
// `http://127.0.0.1:<port>/ (opened in your browser)`, without the token. --json: {"url", "port"}, the token always.
import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { uiAssets } from "../ui/client/app/assets";
import { startUiServer } from "../ui/server/http";
import { createSnapshotBuilder } from "../ui/server/snapshot";
import { createToolCallCounter } from "../ui/server/tail";
import { ArbabError } from "../util/errors";
import type { CommandContext } from "./context";
import { openProject, parse, printJson } from "./project";

function intOption(flag: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const n = /^[0-9]{1,6}$/.test(value) ? Number(value) : Number.NaN;
  if (!(n >= min && n <= max)) throw new ArbabError("usage", `${flag} must be an integer from ${min} to ${max}, not ${JSON.stringify(value)}`);
  return n;
}

// 0 picks a free port. Below 1024 is refused: a browser leaves port 80 out of Host and Origin, so the server's own
// checks would refuse every request, and the rest need privileges.
function portOption(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = /^[0-9]{1,6}$/.test(value) ? Number(value) : Number.NaN;
  if (!(n === 0 || (n >= 1024 && n <= 65535))) throw new ArbabError("usage", `--port must be 0 or an integer from 1024 to 65535, not ${JSON.stringify(value)}`);
  return n;
}

export async function runUi(argv: string[], ctx: CommandContext): Promise<number> {
  const { values } = parse("ui", {
    args: argv,
    options: {
      port: { type: "string" },
      hours: { type: "string" },
      "no-open": { type: "boolean" },
      json: { type: "boolean" },
    },
    allowPositionals: false,
  });
  const port = portOption(values.port);
  const hours = intOption("--hours", values.hours, 24, 1, 720);
  const project = openProject(ctx);
  const builder = createSnapshotBuilder({
    root: project.root,
    runsRoot: project.runsRoot,
    config: project.config,
    home: ctx.home,
    version: ctx.version,
    alive: ctx.alive,
    windowHours: hours,
    counter: createToolCallCounter(),
  });
  const server = await startUiServer({
    port,
    token: randomBytes(16).toString("hex"),
    assets: uiAssets(),
    snapshot: () => builder.build(ctx.clock.now()),
  });

  let stop = (): void => undefined;
  const stopped = new Promise<void>((done) => {
    stop = done;
  });
  const untrap = ctx.trapSignals(() => stop());
  try {
    // The URL carries the token, so it goes to stdout only (stderr may end up in logs), and only when someone needs
    // it: a background command's stdout is kept on disk and in the transcript.
    if (values.json === true) {
      printJson(ctx, { url: server.url, port: server.port });
      if (values["no-open"] !== true && !(await ctx.openUrl(server.url))) ctx.stderr("open the URL above in a browser\n");
    } else {
      const opened = values["no-open"] !== true && (await ctx.openUrl(server.url));
      const where = opened ? `http://127.0.0.1:${server.port}/ (opened in your browser)` : server.url;
      ctx.stdout(`arbab ui: ${basename(project.root)} at ${where}\nread-only; Ctrl-C stops it\n`);
      if (!opened && values["no-open"] !== true) ctx.stderr("open the URL above in a browser\n");
    }
    await stopped;
  } finally {
    untrap();
    await server.close();
  }
  return 0;
}
