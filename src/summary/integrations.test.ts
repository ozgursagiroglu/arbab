import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeProject, type TestProject } from "../commands/testkit";
import { loadConfig } from "../config";
import { integrationLine, integrationOverview } from "./integrations";
import {
  SHA_HEAD,
  SHA_OLD,
  integrationDir,
  writeIntegration,
  writeLanding,
  writeReadiness,
  writeReview,
  writeVerify,
} from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const line = (name = "rel") => integrationLine(p.root, loadConfig(p.root), name);

describe("integrationLine", () => {
  it("is integrated with every step ahead of it when nothing ran", () => {
    p = makeProject();
    writeIntegration(p.root, "rel");
    expect(line()).toEqual({
      name: "rel",
      stage: "integrated",
      head: SHA_HEAD,
      waitsFor: ["verify has not run", "review missing", "readiness has not run"],
    });
  });

  it("asks for the dependencies to be confirmed", () => {
    p = makeProject();
    writeIntegration(p.root, "rel", { manifests: ["package.json"], depsConfirmed: false });
    expect(line()?.waitsFor[0]).toBe(`dependencies to confirm: arbab integrate rel --deps-installed ${SHA_HEAD}`);
  });

  it("says when verify failed or is stale", () => {
    p = makeProject();
    writeIntegration(p.root, "rel");
    writeVerify(p.root, "rel", { passed: false, reason: "the lane left changes" });
    expect(line()?.waitsFor[0]).toBe("verify failed: the lane left changes");
    writeVerify(p.root, "rel", { headSha: SHA_OLD });
    expect(line()).toMatchObject({ stage: "integrated", waitsFor: expect.arrayContaining(["verify is stale (ran on ccccccc)"]) as unknown });
  });

  it("is verified once verify passed on the head", () => {
    p = makeProject();
    writeIntegration(p.root, "rel");
    writeVerify(p.root, "rel");
    writeReview(p.root, "rel", { headSha: SHA_OLD });
    expect(line()).toMatchObject({ stage: "verified", waitsFor: ["review is stale (ran on ccccccc)", "readiness has not run"] });
  });

  it("is reviewed once a review ran on the head, and lists the skipped items not waived", () => {
    p = makeProject();
    writeIntegration(p.root, "rel");
    writeVerify(p.root, "rel");
    writeReview(p.root, "rel");
    writeReadiness(p.root, "rel", {
      ready: false,
      skipped: [
        { id: "smoke", text: "no smoke", waived: false },
        { id: "skeptic", text: "no skeptic", waived: true },
        { id: "deps", text: "deps", waived: false },
      ],
    });
    expect(line()).toMatchObject({ stage: "reviewed", waitsFor: ["readiness skipped, not waived: smoke, deps"] });
  });

  it("counts a review readiness carried over from before a clean merge of the base", () => {
    p = makeProject();
    writeIntegration(p.root, "rel");
    writeVerify(p.root, "rel");
    writeReview(p.root, "rel", { headSha: SHA_OLD });
    writeReadiness(p.root, "rel", { ready: false, reviewCarriedOverFrom: SHA_OLD });
    expect(line()).toMatchObject({ stage: "reviewed", waitsFor: [] });
  });

  it("says readiness is stale when it ran on another head", () => {
    p = makeProject();
    writeIntegration(p.root, "rel");
    writeVerify(p.root, "rel");
    writeReview(p.root, "rel");
    writeReadiness(p.root, "rel", { headSha: SHA_OLD });
    expect(line()).toMatchObject({ stage: "reviewed", waitsFor: ["readiness is stale"] });
  });

  it("is ready when readiness says so on the head, and waits for the human", () => {
    p = makeProject();
    writeIntegration(p.root, "rel");
    writeVerify(p.root, "rel");
    writeReview(p.root, "rel");
    writeReadiness(p.root, "rel");
    expect(line()).toMatchObject({ stage: "ready", waitsFor: ["ready: ask the human to land"] });
  });

  it("is landed with landing.json and waits for nothing", () => {
    p = makeProject();
    writeIntegration(p.root, "rel");
    writeReadiness(p.root, "rel");
    writeLanding(p.root, "rel");
    expect(line()).toMatchObject({ stage: "landed", waitsFor: [] });
  });

  it("is null for a records directory without integration.json", () => {
    p = makeProject();
    mkdirSync(integrationDir(p.root, "rel"), { recursive: true });
    expect(line()).toBeNull();
  });
});

describe("integrationOverview", () => {
  it("lists every integration by name and reports broken records", () => {
    p = makeProject();
    writeIntegration(p.root, "zeta");
    writeIntegration(p.root, "alpha");
    writeIntegration(p.root, "torn");
    writeFileSync(join(integrationDir(p.root, "torn"), "verify.json"), JSON.stringify({ name: "other" }));
    mkdirSync(integrationDir(p.root, "empty"), { recursive: true });
    const o = integrationOverview(p.root, loadConfig(p.root));
    expect(o.integrations.map((i) => i.name)).toEqual(["alpha", "zeta"]);
    expect(o.errors).toHaveLength(1);
    expect(o.errors[0]).toMatch(/^integration torn: .*not a verify record/);
  });

  it("is empty without integrations", () => {
    p = makeProject();
    expect(integrationOverview(p.root, loadConfig(p.root))).toEqual({ integrations: [], errors: [] });
  });
});
