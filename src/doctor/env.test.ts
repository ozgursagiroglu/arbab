import { afterEach, describe, expect, it } from "vitest";
import { makeProject, type TestProject } from "../commands/testkit";
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
  it("skips a project without tracked templates", () => {
    p = makeProject();
    expect(checkEnvTemplates(p.git, p.root, [])).toBeNull();
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
