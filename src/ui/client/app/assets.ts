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

/** The page, its stylesheet and its script, as the server sends them. */
export function uiAssets(): UiAssets {
  return { html: PAGE_HTML, css: PAGE_CSS, js: UI_SCRIPT ?? PLACEHOLDER_SCRIPT };
}
