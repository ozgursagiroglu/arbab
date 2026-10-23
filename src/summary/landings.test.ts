import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { landingOwner, landingText, landingsSince } from "./landings";
import { SHA_OLD, integrationDir, writeLanding } from "./testkit";

const OTHER = "bbbbbbbb-1111-2222-3333-444444444444";
const at = (hhmm: string): string => `2026-10-09T${hhmm}:00.000Z`;
const ms = (hhmm: string): number => Date.parse(at(hhmm));

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "arbab-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("landingsSince", () => {
  it("lists the landings after the moment, oldest first, with owner, squash and lane count", () => {
    writeLanding(root, "zeta", { landedAt: at("11:00"), owner: OTHER, squash: true, lanes: [{ lane: "a", sha: SHA_OLD }] });
    writeLanding(root, "alpha", { landedAt: at("11:30"), owner: null });
    writeLanding(root, "early", { landedAt: at("09:00"), owner: OTHER });
    // Exactly at the moment: not after it.
    writeLanding(root, "edge", { landedAt: at("10:00") });
    writeLanding(root, "legacy", { landedAt: at("11:30") });
    expect(landingsSince(root, ms("10:00"))).toEqual([
      { name: "zeta", into: "main", landedAt: at("11:00"), owner: OTHER, mergeSha: SHA_OLD, squash: true, lanes: 1 },
      { name: "alpha", into: "main", landedAt: at("11:30"), owner: null, mergeSha: SHA_OLD, squash: false, lanes: 0 },
      { name: "legacy", into: "main", landedAt: at("11:30"), mergeSha: SHA_OLD, squash: false, lanes: 0 },
    ]);
    expect(landingsSince(root, -Infinity).map((l) => l.name)).toEqual(["early", "edge", "zeta", "alpha", "legacy"]);
  });

  it("skips records it cannot read and integrations that did not land", () => {
    const raw = (name: string, text: string): void => {
      mkdirSync(integrationDir(root, name), { recursive: true });
      writeFileSync(join(integrationDir(root, name), "landing.json"), text);
    };
    raw("broken", "{");
    raw("array", "[]");
    writeLanding(root, "renamed", { name: "other", landedAt: at("11:00") });
    writeLanding(root, "badtime", { landedAt: "soon" });
    raw("nointo", JSON.stringify({ name: "nointo", landedAt: at("11:00"), mergeSha: SHA_OLD }));
    raw("nosha", JSON.stringify({ name: "nosha", into: "main", landedAt: at("11:00") }));
    mkdirSync(integrationDir(root, "open"), { recursive: true });
    mkdirSync(integrationDir(root, "Not A Name"), { recursive: true });
    writeLanding(root, "ok", { landedAt: at("11:00") });
    expect(landingsSince(root, 0).map((l) => l.name)).toEqual(["ok"]);
  });

  it("reads an owner of the wrong type as unknown", () => {
    writeLanding(root, "rel", { landedAt: at("11:00"), owner: 42 as unknown as string });
    const [landing] = landingsSince(root, 0);
    expect(landing).not.toHaveProperty("owner");
  });

  it("is empty for a project with no integrations", () => {
    expect(landingsSince(join(root, "missing"), 0)).toEqual([]);
  });
});

describe("landingOwner and landingText", () => {
  it("names the session by 8 characters, or says outside Claude Code or unknown", () => {
    expect(landingOwner(OTHER)).toBe("session bbbbbbbb");
    expect(landingOwner(null)).toBe("outside Claude Code");
    expect(landingOwner(undefined)).toBe("session unknown");
    expect(landingText({ name: "rel", into: "main", landedAt: at("11:00"), owner: OTHER, mergeSha: SHA_OLD, squash: false, lanes: 1 })).toBe(
      `rel at ${at("11:00")} (session bbbbbbbb)`,
    );
  });
});
