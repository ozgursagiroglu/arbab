// The page `arbab ui` serves (DESIGN.md §19): its HTML, stylesheet and script, from memory.
import type { UiAssets } from "../../protocol";
import { UI_SCRIPT } from "./bundle";
import { PAGE_CSS, PAGE_HTML } from "./page";

/** Run from source the page script is not built: this says so on the page, with textContent like everything else. */
export const PLACEHOLDER_SCRIPT = `(function () {
  var p = document.createElement("p");
  p.className = "banner";
  p.textContent = "The page script is built by pnpm build.";
  (document.querySelector("main") || document.body).appendChild(p);
})();
`;

/** The page's icon. Contract placeholder: lane ui2-hud draws the real one, in pixels. */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 2 15 14H1z" fill="#E0A800"/></svg>
`;

/** The page, its stylesheet, its script and its icon, as the server sends them. */
export function uiAssets(): UiAssets {
  return { html: PAGE_HTML, css: PAGE_CSS, js: UI_SCRIPT ?? PLACEHOLDER_SCRIPT, icon: ICON_SVG };
}
