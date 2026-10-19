import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { gridSvg, ICON_SVG, PLACEHOLDER_SCRIPT, uiAssets } from "./assets";
import { UI_SCRIPT } from "./bundle";
import { PAGE_CSS, PAGE_HTML } from "./page";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("uiAssets", () => {
  it("serves the page, its stylesheet, and the placeholder while the script is not built", () => {
    expect(UI_SCRIPT).toBeNull();
    expect(uiAssets()).toEqual({ html: PAGE_HTML, css: PAGE_CSS, js: PLACEHOLDER_SCRIPT, icon: ICON_SVG });
  });

  it("the placeholder says so with textContent", () => {
    const appended: { textContent: string; className: string }[] = [];
    const main = { appendChild: (el: { textContent: string; className: string }) => appended.push(el) };
    const document = {
      querySelector: (selector: string) => (selector === "main" ? main : null),
      createElement: () => ({ textContent: "", className: "" }),
      body: main,
    };
    runInNewContext(PLACEHOLDER_SCRIPT, { document });
    expect(appended).toEqual([{ textContent: "The page script is built by pnpm build.", className: "banner" }]);
  });
});

/** Test-only sources: the fake DOM names innerHTML to trap it. */
const TEST_ONLY = new Set([join("hud", "fake-dom.ts")]);

/** The non-test sources of the app, with its subdirectories. */
function sources(): { file: string; text: string }[] {
  return (readdirSync(HERE, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !TEST_ONLY.has(f))
    .map((f) => ({ file: f, text: readFileSync(join(HERE, f), "utf8") }));
}

describe("ICON_SVG", () => {
  it("is a 16 × 16 pixel pyramid of crisp rects, gold on top, sandstone below", () => {
    expect(ICON_SVG).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges">/);
    expect(ICON_SVG).not.toMatch(/<path|<image|<script|href=|style=/);
    const rects = [...ICON_SVG.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1" fill="(#[0-9a-f]{6})"\/>/g)];
    expect(rects.length).toBe(ICON_SVG.split("<rect").length - 1);
    expect(rects.length).toBeGreaterThan(16);
    const fills = (row: number): string[] => rects.filter((r) => Number(r[2]) === row).map((r) => r[4] ?? "");
    expect(fills(1)).toEqual(["#ffd54a", "#e0a800"]);
    expect(fills(15)).toEqual(["#dcc796", "#8f6a33"]);
    // Every rect stays on the 16 × 16 grid.
    for (const r of rects) expect(Number(r[1]) + Number(r[3])).toBeLessThanOrEqual(16);
  });

  it("draws each row as runs of one color", () => {
    expect(gridSvg(["Y.YY", "...."])).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 2" width="4" height="2" shape-rendering="crispEdges"><rect x="0" y="0" width="1" height="1" fill="#ffd54a"/><rect x="2" y="0" width="2" height="1" fill="#ffd54a"/></svg>\n',
    );
  });
});

describe("the app's sources", () => {
  it("never put text in as HTML or run strings as code", () => {
    const forbidden = [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function/, /setTimeout\(\s*["'`]/];
    const found: string[] = [];
    for (const { file, text } of sources()) for (const pattern of forbidden) if (pattern.test(text)) found.push(`${file}: ${pattern}`);
    expect(found).toEqual([]);
  });

  it("keep main.ts's import graph away from node: modules and the raster", () => {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gms)) {
        const spec = match[1] ?? "";
        expect(spec.startsWith("node:"), `${file} imports ${spec}`).toBe(false);
        expect(spec.startsWith("."), `${file} imports the package ${spec}`).toBe(true);
        const target = resolve(dirname(file), spec);
        const candidates = [`${target}.ts`, join(target, "index.ts")];
        const next = candidates.find((c) => {
          try {
            readFileSync(c);
            return true;
          } catch {
            return false;
          }
        });
        if (!next) throw new Error(`${file}: cannot resolve ${spec}`);
        visit(next);
      }
    };
    visit(join(HERE, "main.ts"));
    expect([...seen].some((f) => f.endsWith("raster.ts") || f.endsWith("fixtures.ts"))).toBe(false);
    expect([...seen].some((f) => f.endsWith(join("registry", "status.ts")))).toBe(true);
    expect([...seen].some((f) => f.endsWith(join("registry", "index.ts")))).toBe(false);
  });
});
