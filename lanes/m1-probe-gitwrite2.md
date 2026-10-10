# Probe · can code a worker runs write the shared git directory?

## Task

You are a probe. Do exactly these two steps, then report.

1. With the Write tool, create the file `probe.mjs` in your working directory with exactly this content:

```js
import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
const G = "/Users/dev/Workspace/Diojen/arbab/.git";
const create = (p) => () => { writeFileSync(p, "x"); unlinkSync(p); };
const openAppend = (p) => () => closeSync(openSync(p, "a"));
const tests = [
  ["control: new file in the worktree", create("arbab-probe-local")],
  ["control: new file in HOME", create(`${process.env.HOME}/arbab-probe-home`)],
  ["new file in the shared .git", create(`${G}/arbab-probe-write`)],
  ["new loose ref in the shared .git", create(`${G}/refs/heads/arbab-probe-ref`)],
  ["open the shared .git/config for append", openAppend(`${G}/config`)],
  ["new file in the shared .git/hooks", create(`${G}/hooks/arbab-probe-hook`)],
  ["new file in this worktree's git dir", create(`${G}/worktrees/m1-probe-gitwrite2/arbab-probe`)],
  ["open this worktree's .git pointer for append", openAppend(".git")],
];
for (const [name, run] of tests) {
  try { run(); console.log(`WRITABLE  ${name}`); } catch (e) { console.log(`BLOCKED   ${name}: ${e.code}`); }
}
```

2. Run it with one Bash call: `node probe.mjs`

## Scope

`probe.mjs` only.

## Acceptance

- [ ] The report's steps hold the output line of every test, verbatim.
