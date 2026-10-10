import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAttempt, listAttempts } from "./index";

// Interleave two creators deterministically: the second runs to completion between the first's listing and its
// mkdir, which is the window a read-then-create scheme loses.
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return { ...real, readdirSync: vi.fn(real.readdirSync) };
});

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), "arbab-race-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.mocked(fs.readdirSync).mockClear();
});

describe("createAttempt under a race", () => {
  it("never hands out the same number to two creators", async () => {
    const real = (await vi.importActual<typeof import("node:fs")>("node:fs")).readdirSync;
    let other: number | null = null;
    vi.mocked(fs.readdirSync).mockImplementationOnce(((...args: Parameters<typeof real>) => {
      const stale = real(...args);
      other = createAttempt(root, "lane").n;
      return stale;
    }) as typeof real);

    const mine = createAttempt(root, "lane").n;
    expect(other).toBe(1);
    expect(mine).toBe(2);
    expect(listAttempts(root, "lane")).toEqual([1, 2]);
  });
});
