import { describe, expect, it } from "vitest";
import { ROLE_DEFAULTS } from "../config/roles";
import { workerTmpPaths } from "../run/workertmp";
import type { ProfileInput, Role } from "../types";
import { ArbabError } from "../util/errors";
import { compileProfile } from "./compile";
import { credentialDenies } from "./rules";

const WORKTREE = "/work/repo/.arbab/worktrees/lane-a";

const TOOLS: Record<Role, string[]> = {
  implementer: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
  verifier: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
  reviewer: ["Read", "Glob", "Grep", "Bash"],
  researcher: ["WebSearch", "WebFetch"],
  probe: ["Read", "Write", "Bash"],
};

function input(role: Role, over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    role,
    fence: "strict",
    tools: TOOLS[role],
    loopback: role !== "reviewer",
    commands: [],
    laneAllow: [],
    credentialPaths: [],
    env: {},
    worktree: WORKTREE,
    ...over,
  };
}

const READ_BASH = [
  "Bash(git status)",
  "Bash(git status *)",
  "Bash(git diff)",
  "Bash(git diff *)",
  "Bash(git log)",
  "Bash(git log *)",
  "Bash(git show)",
  "Bash(git show *)",
  "Bash(git ls-files)",
  "Bash(git ls-files *)",
  "Bash(git blame)",
  "Bash(git blame *)",
  "Bash(ls)",
  "Bash(ls *)",
  "Bash(cat)",
  "Bash(cat *)",
  "Bash(head)",
  "Bash(head *)",
  "Bash(tail)",
  "Bash(tail *)",
  "Bash(wc)",
  "Bash(wc *)",
  "Bash(pwd)",
];

const FILE_BASH = [
  "Bash(mkdir)",
  "Bash(mkdir *)",
  "Bash(cp)",
  "Bash(cp *)",
  "Bash(mv)",
  "Bash(mv *)",
  "Bash(rm)",
  "Bash(rm *)",
  "Bash(touch)",
  "Bash(touch *)",
];

const BASE_DENY = [
  ...credentialDenies([]),
  "Bash(run_in_background:true)",
  "Bash(git commit)",
  "Bash(git commit *)",
  "Bash(git push)",
  "Bash(git push *)",
  "Bash(git reset)",
  "Bash(git reset *)",
  "Bash(git checkout)",
  "Bash(git checkout *)",
  "Bash(git switch)",
  "Bash(git switch *)",
  "Bash(git restore)",
  "Bash(git restore *)",
  "Bash(git rebase)",
  "Bash(git rebase *)",
  "Bash(git merge)",
  "Bash(git merge *)",
  "Bash(git cherry-pick)",
  "Bash(git cherry-pick *)",
  "Bash(git stash)",
  "Bash(git stash *)",
  "Bash(git clean)",
  "Bash(git clean *)",
  "Bash(git branch)",
  "Bash(git branch *)",
  "Bash(git worktree)",
  "Bash(git worktree *)",
  "Bash(git tag)",
  "Bash(git tag *)",
  "Bash(git config)",
  "Bash(git config *)",
  "Bash(git update-ref)",
  "Bash(git update-ref *)",
  "Bash(git remote)",
  "Bash(git remote *)",
  "Bash(git -C)",
  "Bash(git -C *)",
  "NotebookEdit",
];

const STRICT_SANDBOX = {
  enabled: true,
  failIfUnavailable: true,
  autoAllowBashIfSandboxed: false,
  allowUnsandboxedCommands: false,
  network: { allowLocalBinding: true },
};

describe("compileProfile, fence strict", () => {
  it.each(["implementer", "verifier"] as const)("compiles the %s fence", (role) => {
    const profile = compileProfile(input(role));
    expect(profile.tools).toEqual(TOOLS[role]);
    expect(profile.settings.permissions.allow).toEqual(["Read", "Edit", "Write", "Glob", "Grep", ...READ_BASH, ...FILE_BASH]);
    expect(profile.settings.permissions.deny).toEqual([...BASE_DENY, "WebFetch", "WebSearch"]);
    expect(profile.settings.sandbox).toEqual(STRICT_SANDBOX);
  });

  it("compiles the reviewer fence: no file writes, Edit and Write denied", () => {
    const profile = compileProfile(input("reviewer", { tools: ["Read", "Edit", "Glob", "Grep", "Bash"] }));
    expect(profile.settings.permissions.allow).toEqual(["Read", "Glob", "Grep", ...READ_BASH]);
    expect(profile.settings.permissions.deny).toEqual([...BASE_DENY, "WebFetch", "WebSearch", "Edit", "Write"]);
    expect(profile.settings.sandbox).toEqual({ ...STRICT_SANDBOX, network: { allowLocalBinding: false } });
  });

  it("compiles the researcher fence: web tools allowed, nothing local", () => {
    const profile = compileProfile(input("researcher"));
    expect(profile.tools).toEqual(["WebSearch", "WebFetch"]);
    expect(profile.settings.permissions.allow).toEqual(["WebSearch", "WebFetch"]);
    expect(profile.settings.permissions.deny).toEqual(BASE_DENY);
  });

  it("compiles the probe fence: Read and Write among file tools, a few read commands", () => {
    const profile = compileProfile(input("probe"));
    expect(profile.settings.permissions.allow).toEqual([
      "Read",
      "Write",
      "Bash(git rev-parse *)",
      "Bash(git status)",
      "Bash(ls)",
      "Bash(ls *)",
    ]);
    expect(profile.settings.permissions.deny).toEqual([...BASE_DENY, "WebFetch", "WebSearch"]);
  });

  it("appends project commands, then lane rules verbatim, without duplicates", () => {
    const profile = compileProfile(
      input("implementer", {
        commands: ["pnpm test", "pnpm typecheck"],
        laneAllow: ["Bash(make check)", "Bash(pnpm test)", "Read"],
      }),
    );
    expect(profile.settings.permissions.allow.slice(-5)).toEqual([
      "Bash(pnpm test)",
      "Bash(pnpm test *)",
      "Bash(pnpm typecheck)",
      "Bash(pnpm typecheck *)",
      "Bash(make check)",
    ]);
    expect(profile.settings.permissions.allow.filter((r) => r === "Read")).toHaveLength(1);
  });

  it("adds config credential paths to the denies", () => {
    const deny = compileProfile(input("implementer", { credentialPaths: ["~/.vault/**"] })).settings.permissions.deny;
    expect(deny).toContain("Read(~/.vault/**)");
    expect(deny).toContain("Edit(~/.vault/**)");
    expect(deny.indexOf("Edit(~/.vault/**)")).toBeLessThan(deny.indexOf("Bash(run_in_background:true)"));
  });

  it("lets the fixed env keys win over config env", () => {
    const env = compileProfile(
      input("implementer", {
        env: { FOO: "1", BASH_MAX_TIMEOUT_MS: "1", XDG_CONFIG_HOME: "/elsewhere", ARBAB_PORT_0: "4100" },
      }),
    ).settings.env;
    expect(env).toEqual({
      FOO: "1",
      ARBAB_PORT_0: "4100",
      BASH_DEFAULT_TIMEOUT_MS: "300000",
      BASH_MAX_TIMEOUT_MS: "900000",
      XDG_CONFIG_HOME: `${WORKTREE}/.arbab-tmp/xdg-config`,
      YARN_CACHE_FOLDER: `${WORKTREE}/.arbab-tmp/yarn-cache`,
      NPM_CONFIG_USERCONFIG: `${WORKTREE}/.arbab-tmp/npmrc`,
    });
  });

  it("points the package managers' homes at the worker's temp paths, over config env", () => {
    const tmp = workerTmpPaths(WORKTREE);
    const env = compileProfile(
      input("reviewer", { env: { XDG_CONFIG_HOME: "/x", YARN_CACHE_FOLDER: "/x", NPM_CONFIG_USERCONFIG: "/x" } }),
    ).settings.env;
    expect(env["XDG_CONFIG_HOME"]).toBe(tmp.xdgConfig);
    expect(env["YARN_CACHE_FOLDER"]).toBe(tmp.yarnCache);
    expect(env["NPM_CONFIG_USERCONFIG"]).toBe(tmp.npmrc);
  });

  it("leaves XDG_DATA_HOME and XDG_CACHE_HOME alone, so corepack and pnpm find their caches", () => {
    for (const role of ["implementer", "reviewer", "researcher"] as const) {
      const env = compileProfile(input(role)).settings.env;
      expect("XDG_DATA_HOME" in env, role).toBe(false);
      expect("XDG_CACHE_HOME" in env, role).toBe(false);
    }
    // A value the config sets on purpose passes through untouched.
    const env = compileProfile(input("reviewer", { env: { XDG_DATA_HOME: "/d", XDG_CACHE_HOME: "/c" } })).settings.env;
    expect(env["XDG_DATA_HOME"]).toBe("/d");
    expect(env["XDG_CACHE_HOME"]).toBe("/c");
  });

  it("carries bashOutputMaxChars only when the input names it", () => {
    expect(compileProfile(input("implementer", { bashOutputMaxChars: 100000 })).settings.bashOutputMaxChars).toBe(100000);
    expect(compileProfile(input("reviewer", { bashOutputMaxChars: 4000 })).settings.bashOutputMaxChars).toBe(4000);
    expect("bashOutputMaxChars" in compileProfile(input("implementer")).settings).toBe(false);
  });

  it("lets the reviewer preset bind loopback, so its tests can listen on 127.0.0.1", () => {
    const reviewer = ROLE_DEFAULTS.reviewer;
    const profile = compileProfile(input("reviewer", { tools: [...reviewer.tools], loopback: reviewer.loopback }));
    expect(profile.settings.sandbox.network.allowLocalBinding).toBe(true);
  });

  describe("readable env templates", () => {
    const TEMPLATES = [`${WORKTREE}/.env.example`, `${WORKTREE}/apps/web/.env.sample`];

    it("leaves the deny list identical with and without readable templates", () => {
      const plain = compileProfile(input("implementer", { gitCommonDir: "/work/repo/.git" })).settings.permissions.deny;
      for (const over of [
        { readableEnvFiles: [".env.example"] },
        { readableEnvFiles: [".env.example", "apps/web/.env.sample"], envFileAllowReads: TEMPLATES },
        { readableEnvFiles: [".env.example"], envFileDenies: ["/work/repo/.env"] },
      ]) {
        const deny = compileProfile(input("implementer", { gitCommonDir: "/work/repo/.git", ...over })).settings.permissions.deny;
        expect(deny).toEqual(plain);
        expect(deny).toContain("Read(**/.env*)");
        expect(deny).toContain("Edit(**/.env*)");
      }
    });

    it("re-opens the tracked templates in the sandbox's allowRead, beside denyWrite", () => {
      const profile = compileProfile(
        input("implementer", {
          gitCommonDir: "/work/repo/.git",
          readableEnvFiles: [".env.example", "apps/web/.env.sample"],
          envFileAllowReads: [...TEMPLATES, `${WORKTREE}/apps/./web/.env.sample`],
        }),
      );
      expect(profile.settings.sandbox.filesystem).toEqual({ denyWrite: ["/work/repo/.git"], allowRead: TEMPLATES });
    });

    it("writes allowRead without a shared git directory, and no allowRead without templates", () => {
      expect(compileProfile(input("implementer", { envFileAllowReads: TEMPLATES })).settings.sandbox.filesystem).toEqual({
        denyWrite: [],
        allowRead: TEMPLATES,
      });
      const none = compileProfile(input("implementer", { gitCommonDir: "/work/repo/.git", envFileAllowReads: [] }));
      expect(none.settings.sandbox.filesystem).toEqual({ denyWrite: ["/work/repo/.git"] });
    });

    it("refuses a template path that is relative or outside the worktree", () => {
      for (const path of [".env.example", "/work/repo/.env.example", `${WORKTREE}/../lane-b/.env.example`, WORKTREE]) {
        expect(() => compileProfile(input("implementer", { envFileAllowReads: [path] }))).toThrow(ArbabError);
      }
    });
  });

  it("never allows git grep, whose -O runs a named program", () => {
    for (const role of ["implementer", "verifier", "reviewer", "probe"] as const) {
      expect(compileProfile(input(role)).settings.permissions.allow.filter((r) => r.includes("git grep"))).toEqual([]);
    }
  });

  it("denies writes to the shared git directory in the sandbox and in Edit/Write rules", () => {
    const profile = compileProfile(input("implementer", { gitCommonDir: "/work/repo/.git" }));
    expect(profile.settings.sandbox).toEqual({ ...STRICT_SANDBOX, filesystem: { denyWrite: ["/work/repo/.git"] } });
    expect(profile.settings.permissions.deny).toEqual([
      ...credentialDenies([]),
      "Edit(//work/repo/.git/**)",
      "Write(//work/repo/.git/**)",
      ...BASE_DENY.slice(credentialDenies([]).length),
      "WebFetch",
      "WebSearch",
    ]);
  });

  it("normalises the shared git directory", () => {
    const profile = compileProfile(input("reviewer", { gitCommonDir: "/work/repo/./.git/" }));
    expect(profile.settings.sandbox.filesystem).toEqual({ denyWrite: ["/work/repo/.git"] });
    expect(profile.settings.permissions.deny).toContain("Write(//work/repo/.git/**)");
  });

  it("adds no filesystem block without a shared git directory", () => {
    const profile = compileProfile(input("implementer"));
    expect(profile.settings.sandbox.filesystem).toBeUndefined();
    expect(profile.settings.permissions.deny).toEqual([...BASE_DENY, "WebFetch", "WebSearch"]);
  });

  it.each(["relative/.git", "", "/"])("refuses the shared git directory %j", (gitCommonDir) => {
    let code: unknown;
    try {
      compileProfile(input("implementer", { gitCommonDir }));
    } catch (err) {
      code = err instanceof ArbabError ? err.code : err;
    }
    expect(code).toBe("usage");
  });

  it("refuses a relative worktree", () => {
    let code: unknown;
    try {
      compileProfile(input("implementer", { worktree: "relative/path" }));
    } catch (err) {
      code = err instanceof ArbabError ? err.code : err;
    }
    expect(code).toBe("usage");
  });
});

describe("compileProfile, fence sandbox-auto", () => {
  it("auto-allows sandboxed Bash and drops every Bash allow rule", () => {
    const profile = compileProfile(
      input("implementer", {
        fence: "sandbox-auto",
        commands: ["pnpm test"],
        laneAllow: ["Bash(make check)", "WebFetch(domain:example.com)"],
      }),
    );
    expect(profile.settings.sandbox).toEqual({ ...STRICT_SANDBOX, autoAllowBashIfSandboxed: true });
    expect(profile.settings.permissions.allow).toEqual([
      "Read",
      "Edit",
      "Write",
      "Glob",
      "Grep",
      "WebFetch(domain:example.com)",
    ]);
    expect(profile.settings.permissions.deny).toEqual([...BASE_DENY, "WebFetch", "WebSearch"]);
  });

  it("drops the probe's Bash allow rules too", () => {
    const profile = compileProfile(input("probe", { fence: "sandbox-auto" }));
    expect(profile.settings.permissions.allow).toEqual(["Read", "Write"]);
  });
});
