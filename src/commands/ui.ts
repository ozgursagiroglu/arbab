// arbab ui [--port N] [--hours N] [--no-open] [--json]
//
// Serves the project's pyramid scene on 127.0.0.1 until SIGINT or SIGTERM (DESIGN.md §19). Read-only: it writes
// nothing under .arbab/ or ~/.arbab/ and signals no process. The session token appears only in the printed URL.
// Text: `arbab ui: <project> at <url>` and `read-only; Ctrl-C stops it`. --json: {"url", "port"}.
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
  const port = intOption("--port", values.port, 0, 0, 65535);
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
    if (values.json === true) printJson(ctx, { url: server.url, port: server.port });
    else ctx.stdout(`arbab ui: ${basename(project.root)} at ${server.url}\nread-only; Ctrl-C stops it\n`);
    if (values["no-open"] !== true && !ctx.openUrl(server.url)) ctx.stderr(`open ${server.url} in a browser\n`);
    await stopped;
  } finally {
    untrap();
    await server.close();
  }
  return 0;
}
