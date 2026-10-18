// The page `arbab ui` serves (DESIGN.md §19). Contract stub: lane ui-art replaces this file and keeps the signature.
import type { UiAssets } from "../../protocol";

/** The page, its stylesheet and its script, as the server sends them. */
export function uiAssets(): UiAssets {
  return { html: "<!doctype html>\n<title>arbab</title>\n", css: "", js: "" };
}
