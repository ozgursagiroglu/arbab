import { describe, expect, it } from "vitest";
import { UI_ROUTES } from "../../protocol";
import { PAGE_CSS, PAGE_HTML, PAGE_IDS } from "./page";

describe("PAGE_HTML", () => {
  it("is a semantic English page titled arbab · pyramid, not for indexing", () => {
    expect(PAGE_HTML).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(PAGE_HTML).toContain("<title>arbab · pyramid</title>");
    expect(PAGE_HTML).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(PAGE_HTML).toContain('<meta name="robots" content="noindex">');
    for (const tag of ["header", "main", "aside", "footer"]) expect(PAGE_HTML).toContain(`<${tag}`);
  });

  it("links its stylesheet and deferred script from UI_ROUTES, with nothing inline", () => {
    expect(PAGE_HTML).toContain(`<link rel="stylesheet" href="${UI_ROUTES.style}">`);
    expect(PAGE_HTML).toContain(`<script src="${UI_ROUTES.script}" defer></script>`);
    expect(PAGE_HTML.match(/<script/g)).toHaveLength(1);
    expect(PAGE_HTML).not.toMatch(/<style|\sstyle=|\son[a-z]+=|javascript:|data:/i);
  });

  it("carries every id main.ts fills, once", () => {
    for (const id of Object.values(PAGE_IDS)) expect(PAGE_HTML.split(`id="${id}"`).length - 1, id).toBe(1);
  });

  it("gives the canvas a role and a label, and a polite live region", () => {
    expect(PAGE_HTML).toMatch(/<canvas id="scene" width="480" height="270" role="img" aria-label="[^"]+">/);
    expect(PAGE_HTML).toMatch(/id="live" class="visually-hidden" aria-live="polite"/);
    expect(PAGE_HTML).toContain('aria-pressed="false"');
  });
});

describe("PAGE_CSS", () => {
  it("draws the canvas pixelated, in a dark HUD with a light variant", () => {
    expect(PAGE_CSS).toContain("image-rendering: pixelated");
    expect(PAGE_CSS).toContain("--bg:");
    expect(PAGE_CSS).toContain("@media (prefers-color-scheme: light)");
  });

  it("puts the crew beside the canvas on wide screens and below on narrow ones", () => {
    expect(PAGE_CSS).toMatch(/\.layout \{[^}]*grid-template-columns: minmax\(0, 1fr\) 15rem/);
    expect(PAGE_CSS).toMatch(/@media \(max-width: [^)]+\) \{ \.layout \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  });

  it("has a visually-hidden class, visible focus and no motion when reduced", () => {
    expect(PAGE_CSS).toContain(".visually-hidden {");
    expect(PAGE_CSS).toContain(":focus-visible");
    expect(PAGE_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*transition: none/);
  });

  it("colors a chip for every cast", () => {
    for (const cast of ["laborer", "mason", "scribe", "skeptic", "surveyor", "waterboy", "scout"]) expect(PAGE_CSS).toContain(`.cast-${cast} {`);
  });
});
