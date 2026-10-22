import { afterEach, describe, expect, it } from "vitest";
import { makeProject, type TestProject } from "../commands/testkit";
import type { GitRunner } from "../run";
import { checkEnvTemplates, trackedEnvTemplates } from "./env";

let p: TestProject;
afterEach(() => p?.dispose());

// Tracks `paths` without writing them: env files may be unreadable where the tests run, and only the index matters.
function track(t: TestProject, paths: string[]): void {
  t.write("template.txt", "KEY=\n");
  const blob = t.ok(["hash-object", "-w", "template.txt"]).trim();
  for (const path of paths) t.ok(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`]);
}

describe("trackedEnvTemplates", () => {
  it("lists tracked templates at any depth and nothing else", () => {
    p = makeProject();
    track(p, [".env.example", "apps/web/.env.sample", ".env", ".env.local", "x.env.example", "deploy/.env.defaults"]);
    expect(trackedEnvTemplates(p.git, p.root)).toEqual([".env.example", "apps/web/.env.sample", "deploy/.env.defaults"]);
  });

  it("is empty when git fails", () => {
    p = makeProject();
    expect(trackedEnvTemplates(() => ({ code: 128, stdout: "", stderr: "not a repository" }), p.root)).toEqual([]);
  });
});

describe("checkEnvTemplates", () => {
  it("skips a project without tracked templates and with nothing listed", () => {
    p = makeProject();
    expect(checkEnvTemplates(p.git, p.root, [])).toBeNull();
  });

  it("warns about a listed file git does not track at the project root", () => {
    p = makeProject();
    track(p, [".env.example"]);
    expect(checkEnvTemplates(p.git, p.root, [".env.example", "apps/.env.sample", "../.env.example"])).toEqual({
      status: "warn",
      check: "env",
      detail: "git does not track apps/.env.sample, ../.env.example from fence.readableEnvFiles, so each stays unreadable",
    });
  });

  it("warns about a listed file even when the project tracks no template", () => {
    p = makeProject();
    expect(checkEnvTemplates(p.git, p.root, [".env.example"])).toMatchObject({
      status: "warn",
      detail: "git does not track .env.example from fence.readableEnvFiles, so each stays unreadable",
    });
  });

  it("names both kinds in one check when both occur", () => {
    p = makeProject();
    track(p, [".env.example", "api/.env.dist"]);
    expect(checkEnvTemplates(p.git, p.root, ["api/.env.dist", ".env.local"])).toEqual({
      status: "warn",
      check: "env",
      detail:
        "workers cannot read .env.example; add them to fence.readableEnvFiles; " +
        "git does not track .env.local from fence.readableEnvFiles, so each stays unreadable",
    });
  });

  it("asks git about the listed files once, literally, at the project root", () => {
    p = makeProject();
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const spy: GitRunner = (args, cwd) => {
      calls.push({ args, cwd });
      return { code: 0, stdout: "", stderr: "" };
    };
    checkEnvTemplates(spy, p.root, ["./.env.[x]", ".env.example", ".env.example"]);
    const listed = calls.filter((c) => c.args.some((a) => a.startsWith(":(literal)")));
    expect(listed).toEqual([{ args: ["ls-files", "-z", "--", ":(literal).env.[x]", ":(literal).env.example"], cwd: p.root }]);
  });

  it("warns about templates fence.readableEnvFiles does not list", () => {
    p = makeProject();
    track(p, [".env.example", "api/.env.template"]);
    expect(checkEnvTemplates(p.git, p.root, ["api/.env.template"])).toEqual({
      status: "warn",
      check: "env",
      detail: "workers cannot read .env.example; add them to fence.readableEnvFiles",
    });
  });

  it("is ok when every template is listed", () => {
    p = makeProject();
    track(p, [".env.example", "api/.env.dist"]);
    expect(checkEnvTemplates(p.git, p.root, ["./.env.example", "api/.env.dist"])).toEqual({
      status: "ok",
      check: "env",
      detail: "fence.readableEnvFiles lists .env.example, api/.env.dist",
    });
  });
});
