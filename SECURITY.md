# Security policy

arbab supervises code that AI workers write, so its fence is the product. Reports that show worker code running on
the host outside Claude Code's sandbox, or landing without passing its gates, are the ones we care about most.

## Reporting a vulnerability

Please report privately through GitHub's
[private vulnerability reporting](https://github.com/ozgursagiroglu/arbab/security/advisories/new). Do not open a
public issue for a security problem.

Include:

- the arbab version (`arbab --version`) and Claude Code version (`claude --version`);
- the platform;
- the steps or the worker behaviour that reproduce it;
- what ran where it should not have, or what landed that should not have.

You will get an answer within a week. Fixes are released as soon as they are verified, with credit unless you ask
otherwise.

## Scope

In scope:

- the runner (`src/`, shipped as `plugin/dist/arbab.mjs`);
- the skill (`skills/`), when its instructions would lead an orchestrator to an unsafe action.

[DESIGN.md](DESIGN.md) documents the threat model: what the fence allows, what runs on the host and why, and the
rules each review round added.

Out of scope: weaknesses of Claude Code itself or of its sandbox. Report those to Anthropic.
