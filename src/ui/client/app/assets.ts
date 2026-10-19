// The page `arbab ui` serves (DESIGN.md §19): its HTML, stylesheet and script, from memory.
import type { UiAssets } from "../../protocol";
import { UI_SCRIPT } from "./bundle";
import { gridSize, ICON_COLORS, PYRAMID_GRID } from "./hud/icons";
import { PAGE_CSS, PAGE_HTML } from "./page";

/** Run from source the page script is not built: this says so on the page, with textContent like everything else. */
export const PLACEHOLDER_SCRIPT = `(function () {
  var p = document.createElement("p");
  p.className = "banner";
  p.textContent = "The page script is built by pnpm build.";
  (document.querySelector("main") || document.body).appendChild(p);
})();
`;

/** A pixel grid as SVG `<rect>`s: one per stretch of same-colored pixels in a row. */
export function gridSvg(grid: readonly string[]): string {
  const { w, h } = gridSize(grid);
  const rects: string[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const color = ICON_COLORS[row[x] ?? "."];
      if (color === undefined) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && ICON_COLORS[row[end] ?? "."] === color) end++;
      rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${color}"/>`);
      x = end;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges">${rects.join("")}</svg>\n`;
}

/** The page's icon and logo: the 16 × 16 pixel pyramid, sandstone faces under a gold capstone. */
export const ICON_SVG = gridSvg(PYRAMID_GRID);

/** The page, its stylesheet, its script and its icon, as the server sends them. */
export function uiAssets(): UiAssets {
  return { html: PAGE_HTML, css: PAGE_CSS, js: UI_SCRIPT ?? PLACEHOLDER_SCRIPT, icon: ICON_SVG };
}
