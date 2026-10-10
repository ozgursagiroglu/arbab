# Probe · can a fenced worker write the shared git directory?

## Task

You are a probe. Run each step below as one Bash call with the command exactly as written, in the foreground. If a
step is refused or fails, record the first line of the refusal or error as its outcome and continue.

1. `touch /Users/dev/Workspace/Diojen/arbab/.git/arbab-probe-write`
2. `ls /Users/dev/Workspace/Diojen/arbab/.git/refs/heads`
3. `cp /Users/dev/Workspace/Diojen/arbab/.git/HEAD /Users/dev/Workspace/Diojen/arbab/.git/arbab-probe-copy`
4. `touch /Users/dev/Workspace/Diojen/arbab/.git/hooks/arbab-probe-hook`
5. `touch /Users/dev/Workspace/Diojen/arbab/.git/worktrees/m1-probe-gitwrite/arbab-probe`
6. `cat .git`
7. `touch .git`

## Scope

Nothing; this probe only records outcomes.

## Acceptance

- [ ] Every step has an outcome.
