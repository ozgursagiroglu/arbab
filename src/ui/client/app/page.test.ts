import { describe, expect, it } from "vitest";
import { UI_ROUTES } from "../../protocol";
import { badgeColors, CHIPS, TOKENS } from "./hud/tokens";
import { PAGE_CSS, PAGE_HTML, PAGE_IDS } from "./page";

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("PAGE_HTML", () => {
  it("is a semantic English page titled arbab · pyramid, dark, not for indexing", () => {
    expect(PAGE_HTML).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(PAGE_HTML).toContain("<title>arbab · pyramid</title>");
    expect(PAGE_HTML).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(PAGE_HTML).toContain('<meta name="robots" content="noindex">');
    expect(PAGE_HTML).toContain('<meta name="color-scheme" content="dark">');
    for (const tag of ["header", "main", "aside", "footer", "h1"]) expect(PAGE_HTML).toContain(`<${tag}`);
  });

  it("links its icon, stylesheet and deferred script from UI_ROUTES, with nothing inline", () => {
    expect(PAGE_HTML).toContain(`<link rel="icon" href="${UI_ROUTES.icon}" type="image/svg+xml">`);
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

  it("heads every panel with an h2 it is labelled by", () => {
    for (const id of [PAGE_IDS.siteTitle, PAGE_IDS.crewTitle, PAGE_IDS.monumentTitle, PAGE_IDS.chronicleTitle, PAGE_IDS.ledgerTitle]) {
      expect(PAGE_HTML).toContain(`<h2 id="${id}"`);
      expect(PAGE_HTML).toContain(`aria-labelledby="${id}"`);
    }
    expect(PAGE_HTML).toMatch(/<h2 id="kpi-heading" class="visually-hidden">/);
  });

  it("keeps an accessible table with column headers", () => {
    expect(PAGE_HTML).toMatch(/<table aria-labelledby="ledger-title">\n<thead><tr id="ledger-head">(<th scope="col">[a-z ]+<\/th>){8}<\/tr><\/thead>/);
  });

  it("has a title card over the canvas", () => {
    expect(PAGE_HTML).toContain('class="title-card"');
    expect(PAGE_HTML).toContain("the site awakens…");
  });
});

describe("PAGE_CSS", () => {
  it("is dark only, with the tokens as variables", () => {
    expect(PAGE_CSS).toContain("color-scheme: dark;");
    expect(PAGE_CSS).not.toContain("prefers-color-scheme");
    for (const [name, value] of Object.entries(TOKENS)) expect(PAGE_CSS).toContain(`--${name}: ${value};`);
    for (const [name, value] of Object.entries(CHIPS)) expect(PAGE_CSS).toContain(`--chip-${name}: ${value};`);
    expect(PAGE_CSS).toContain("--s1: 4px;");
    expect(PAGE_CSS).toContain("font-size: 14px;");
    expect(PAGE_CSS).toContain("font-variant-numeric: tabular-nums;");
  });

  it("draws pixel frames with notched corners: 4 px edges without spread and a 2 px bevel, never rounded", () => {
    const frame = /\.frame \{[^}]*\}/.exec(PAGE_CSS)?.[0] ?? "";
    for (const edge of ["0 -4px 0 0 var(--frame-dark)", "0 4px 0 0 var(--frame-dark)", "-4px 0 0 0 var(--frame-dark)", "4px 0 0 0 var(--frame-dark)"]) {
      expect(frame).toContain(edge);
    }
    expect(frame).toContain("inset 2px 2px 0 0 var(--frame-hi)");
    expect(frame).toContain("inset -2px -2px 0 0 var(--frame-lo)");
    expect(frame).toContain("margin: var(--s1)");
    expect(PAGE_CSS).not.toMatch(/border-radius: (?!0)/);
    // Buttons: 2 px, pressed inverts the bevel.
    expect(PAGE_CSS).toMatch(/button:active, button\[aria-pressed="true"\] \{[^}]*inset 2px 2px 0 0 var\(--frame-lo\), inset -2px -2px 0 0 var\(--frame-hi\)/);
  });

  it("draws the canvases pixelated", () => {
    expect(PAGE_CSS).toContain("image-rendering: pixelated");
    expect(PAGE_CSS).toMatch(/canvas\.px \{[^}]*image-rendering: pixelated/);
  });

  it("puts the side beside the scene from 1280 px, under it from 900 px, and one column below", () => {
    expect(PAGE_CSS).toMatch(/\.grid, \.side, \.below \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(PAGE_CSS).toMatch(/@media \(min-width: 900px\) \{[^@]*\.below \{ grid-template-columns: minmax\(0, 2fr\) minmax\(0, 3fr\); \}/);
    expect(PAGE_CSS).toMatch(/@media \(min-width: 1280px\) \{\n {2}\.grid \{ grid-template-columns: minmax\(0, 1fr\) 360px; align-items: stretch; \}/);
    expect(PAGE_CSS).toContain("grid-template-columns: repeat(auto-fit, minmax(170px, 1fr))");
  });

  it("makes the side column as tall as the scene card: the crew grows and scrolls, the monument keeps its height", () => {
    const wide = /@media \(min-width: 1280px\) \{\n {2}\.grid[^@]*/.exec(PAGE_CSS)?.[0] ?? "";
    expect(wide).toMatch(/\.side \{[^}]*grid-template-rows: minmax\(0, 1fr\) auto;[^}]*contain: size;/);
    // Stretched, or the crew panel shrinks to its title around a zero-basis list (the shared rule says start).
    expect(wide).toMatch(/\.side \{[^}]*align-items: stretch;/);
    expect(wide).toMatch(/\.crew-panel \{ display: flex; flex-direction: column; min-height: 0; \}/);
    expect(wide).toContain(".crew-panel > .titlebar { flex: none; }");
    expect(wide).toMatch(/\.crew-panel \.crew-scroll \{ flex: 1 1 0; min-height: 0; max-height: none; overflow-y: auto; \}/);
    // Stacked (under 1280 px), the list keeps its own cap and scroll.
    expect(PAGE_CSS).toMatch(/\.crew-scroll \{[^}]*max-height: 640px; overflow: auto;/);
    // The empty state sits in the scroll box, so it gets the same height.
    expect(PAGE_HTML).toMatch(/<div id="crew-scroll" class="crew-scroll">[\s\S]*<div id="crew-empty" class="crew-empty"><\/div>[\s\S]*<\/section>/);
    expect(PAGE_CSS).toMatch(/\.crew-panel\[data-more="true"\]::after \{[^}]*linear-gradient\(to bottom, transparent, var\(--panel\)\)/);
    // The crew comes first in the column, the monument after it.
    expect(PAGE_HTML.indexOf('class="frame panel crew-panel"')).toBeLessThan(PAGE_HTML.indexOf('class="frame panel monument-panel"'));
  });

  it("keeps the one full-screen button on the scene card", () => {
    expect(PAGE_HTML.match(/full screen<\/button>/g)).toHaveLength(1);
    expect(PAGE_HTML).toMatch(/<button id="site-fullscreen"[^>]*>full screen<\/button>/);
  });

  it("lets the canvas take the stage's width below 1×, by its aspect ratio", () => {
    expect(PAGE_CSS).toMatch(/#scene\.fluid \{[^}]*aspect-ratio: 480 \/ 270;/);
  });

  it("fits a 420 px screen: min-width 0 on grid children, a stacked top bar, two KPI cards a row, wrapping crew cards", () => {
    expect(PAGE_CSS).toContain(".hud > *, .grid > *, .side > *, .below > * { min-width: 0; }");
    const narrow = /@media \(max-width: 599px\) \{[^@]*/.exec(PAGE_CSS)?.[0] ?? "";
    expect(narrow).toMatch(/\.topbar \{ flex-direction: column;/);
    expect(narrow).toMatch(/\.status \{[^}]*flex-direction: column;/);
    expect(narrow).toContain(".kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }");
    expect(narrow).toContain(".card-head, .card-foot { flex-wrap: wrap; }");
    expect(PAGE_CSS).toMatch(/\.table-wrap \{[^}]*overflow: auto;/);
    // The top bar's rows: the logo, the gauges, the buttons.
    expect(PAGE_HTML).toMatch(/<div class="gauges">[\s\S]*<\/div>\n<div class="controls">/);
  });

  it("has a sticky 56 px top bar and a sticky ledger header", () => {
    expect(PAGE_CSS).toMatch(/\.topbar \{[^}]*position: sticky; top: 0;[^}]*height: 56px/);
    expect(PAGE_CSS).toMatch(/thead th \{ position: sticky; top: 0;/);
  });

  it("has a visually-hidden class, a gold focus outline and no motion when reduced", () => {
    expect(PAGE_CSS).toContain(".visually-hidden {");
    expect(PAGE_CSS).toContain(":focus-visible { outline: 2px solid var(--gold);");
    expect(PAGE_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*transition: none !important; animation: none/);
  });

  it("fades the title card over 0.6 s and slides new chronicle lines in", () => {
    expect(PAGE_CSS).toMatch(/\.title-card \{[^}]*transition: opacity 0\.6s/);
    expect(PAGE_CSS).toContain(".title-card.gone { opacity: 0; visibility: hidden; }");
    expect(PAGE_CSS).toContain(".chronicle-line.enter { animation: slide-in");
  });

  it("colors a chip for every cast and a badge for every state", () => {
    for (const cast of ["laborer", "mason", "scribe", "skeptic", "surveyor", "waterboy", "scout"]) expect(PAGE_CSS).toContain(`.cast-${cast} {`);
    for (const tone of ["running", "preparing", "waiting", "asleep", "success", "failed", "orphaned"]) expect(PAGE_CSS).toContain(`.tone-${tone} {`);
  });

  it("inks every state badge at 4.5:1 or more: light on the failed badge's dark red, dark on the rest", () => {
    for (const tone of ["running", "preparing", "waiting", "asleep", "success", "failed", "orphaned"] as const) {
      const { ground, ink } = badgeColors(tone);
      expect(contrast(ink, ground), tone).toBeGreaterThanOrEqual(4.5);
    }
    expect(badgeColors("failed")).toEqual({ ground: "#b23a3a", ink: TOKENS.text });
    expect(PAGE_CSS).toContain(".tone-failed { --tone: var(--badge-failed); }");
  });

  it("keeps body text at 4.5:1 or more on every panel", () => {
    for (const bg of [TOKENS.bg, TOKENS["bg-2"], TOKENS.panel, TOKENS["panel-2"], TOKENS["panel-hi"]]) {
      expect(contrast(TOKENS.text, bg), `text on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(TOKENS.muted, bg), `muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
