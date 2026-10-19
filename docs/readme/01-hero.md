# arbab

**Turn one Claude Code session into a controlled engineering team.**

Give arbab a large engineering task. Your interactive Claude Code session splits it into independent lanes and runs
each one as a headless Claude Code worker, in parallel, in its own git worktree behind a sandbox. arbab then verifies
the result inside the fence, has it adversarially reviewed, and prepares a merge that lands only when you say yes.

**Parallel lanes · isolated worktrees · sandboxed workers · human-controlled merges**

[![ci](https://github.com/ozgursagiroglu/arbab/actions/workflows/ci.yml/badge.svg)](https://github.com/ozgursagiroglu/arbab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757)
![Zero runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)

![The arbab ui dashboard: workers building a pyramid, with the crew, the chronicle and the ledger](docs/ui/page.png)

```text
                                          ┌─> worker ─┐
you ──> your Claude Code session + arbab ─┼─> worker ─┼─> verify ─> review ─> you approve ─> merge
                                          └─> worker ─┘
```

> *arbab*: master, the one who gives the orders.
> You give the order. arbab runs the team. Claude writes the code.

arbab does not replace Claude Code: it gives your session a controlled way to delegate real engineering work. Every
worker is the unmodified `claude` binary, running under your own login.
