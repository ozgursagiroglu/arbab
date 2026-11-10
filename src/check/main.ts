// arbab-check's entry point, bundled alone into dist/arbab-check.mjs (DESIGN.md §22): real effects in, exit code out.
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { sleep } from "../util/proc";
import { killProbe } from "./registry";
import { nodeCheckFs, nodeCheckSpawn, runCheck } from "./run";

const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

try {
  // exitCode rather than exit(): stdout to a pipe is asynchronous on macOS, and the summary must get out whole.
  process.exitCode = await runCheck(process.argv.slice(2), {
    env: process.env,
    cwd: process.cwd(),
    tmpdir: tmpdir(),
    pid: process.pid,
    script: process.argv[1] ?? "arbab-check.mjs",
    spawn: nodeCheckSpawn(),
    now: () => Date.now(),
    sleep,
    fs: nodeCheckFs,
    probe: killProbe((pid, signal) => process.kill(pid, signal)),
    randomHex: (bytes) => randomBytes(bytes).toString("hex"),
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    onSignal: (handler) => {
      for (const signal of SIGNALS) process.on(signal, handler);
      return () => {
        for (const signal of SIGNALS) process.off(signal, handler);
      };
    },
  });
} catch (err) {
  process.stderr.write(`arbab-check: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 2;
}
