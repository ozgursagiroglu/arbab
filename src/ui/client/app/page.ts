// The page and its stylesheet (DESIGN.md §19). The CSP allows no inline script or style, so the HTML only links
// /app.css and /app.js; main.ts fills the elements by id, with textContent only.
import { UI_ROUTES } from "../../protocol";

/** The ids main.ts fills. */
export const PAGE_IDS = {
  title: "title",
  counts: "counts",
  cost: "cost",
  quota: "quota",
  held: "held",
  connection: "connection",
  sound: "sound",
  banner: "banner",
  stage: "stage",
  canvas: "scene",
  tooltip: "tooltip",
  notice: "notice",
  crew: "crew",
  table: "lanes",
  hidden: "hidden-lanes",
  live: "live",
  header: "top",
} as const;

export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>arbab · pyramid</title>
<link rel="stylesheet" href="${UI_ROUTES.style}">
<script src="${UI_ROUTES.script}" defer></script>
</head>
<body>
<header id="${PAGE_IDS.header}">
<h1 id="${PAGE_IDS.title}">arbab</h1>
<p id="${PAGE_IDS.counts}" class="counts">connecting…</p>
<p class="money"><span id="${PAGE_IDS.cost}">$0.00</span> <span id="${PAGE_IDS.quota}" class="quota">—</span> <span id="${PAGE_IDS.held}" class="badge" hidden>held</span></p>
<p class="status"><span id="${PAGE_IDS.connection}" class="connection" data-state="connecting">connecting</span>
<button id="${PAGE_IDS.sound}" type="button" aria-pressed="false">sound</button></p>
</header>
<p id="${PAGE_IDS.banner}" class="banner" role="alert" hidden></p>
<div class="layout">
<main>
<div id="${PAGE_IDS.stage}" class="stage">
<canvas id="${PAGE_IDS.canvas}" width="480" height="270" role="img" aria-label="The pyramid scene: each lane is a worker building a block, and arbab hands out the work. The crew list and the lanes table say the same in text."></canvas>
<div id="${PAGE_IDS.tooltip}" class="tooltip" role="tooltip" hidden></div>
<div id="${PAGE_IDS.notice}" class="notice" hidden></div>
</div>
<details>
<summary>All lanes</summary>
<table>
<thead><tr><th scope="col">lane</th><th scope="col">role</th><th scope="col">state</th><th scope="col">end state</th><th scope="col">attempt</th><th scope="col">calls</th><th scope="col">cost</th></tr></thead>
<tbody id="${PAGE_IDS.table}"></tbody>
</table>
</details>
</main>
<aside aria-labelledby="crew-title">
<h2 id="crew-title">Crew</h2>
<ul id="${PAGE_IDS.crew}" class="crew"></ul>
</aside>
</div>
<footer>
<p>Read-only: this page changes nothing. <span id="${PAGE_IDS.hidden}"></span></p>
</footer>
<div id="${PAGE_IDS.live}" class="visually-hidden" aria-live="polite"></div>
</body>
</html>
`;

export const PAGE_CSS = `:root {
  color-scheme: dark light;
  --bg: #1d1610;
  --panel: #2a2017;
  --line: #4a3b26;
  --text: #f4f0e2;
  --muted: #cdb27e;
  --accent: #ffd54a;
  --ok: #3faf5a;
  --bad: #d04040;
  --wait: #e0a800;
  --focus: #ffd54a;
  --chip-laborer: #c9a46b;
  --chip-mason: #3c6fb0;
  --chip-scribe: #6e4c9e;
  --chip-skeptic: #b23a3a;
  --chip-surveyor: #3f8f5a;
  --chip-waterboy: #e2b23a;
  --chip-scout: #2f6b4f;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f6ecd4;
    --panel: #fffaf0;
    --line: #d9c49a;
    --text: #3a2716;
    --muted: #6e5a3c;
    --accent: #a87400;
    --focus: #2a4fa0;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); line-height: 1.4; }
header {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 1.2rem;
  padding: 0.5rem 1rem; background: var(--panel); border-bottom: 1px solid var(--line);
}
header p { margin: 0; }
h1 { font-size: 1.05rem; margin: 0; }
h2 { font-size: 0.95rem; margin: 0 0 0.5rem; color: var(--muted); }
.counts, .quota { color: var(--muted); }
.money { font-variant-numeric: tabular-nums; }
.status { margin-left: auto; display: flex; align-items: center; gap: 0.6rem; }
.badge { background: var(--wait); color: #1d1610; border-radius: 0.6rem; padding: 0 0.5rem; font-size: 0.85rem; }
.connection { color: var(--muted); font-size: 0.85rem; }
.connection::before {
  content: ""; display: inline-block; width: 0.7rem; height: 0.7rem; margin-right: 0.35rem;
  border-radius: 50%; background: var(--wait); vertical-align: -0.05rem;
}
.connection[data-state="live"]::before { background: var(--ok); }
.connection[data-state="lost"]::before, .connection[data-state="closed"]::before { background: var(--bad); }
button {
  font: inherit; color: var(--text); background: transparent; border: 1px solid var(--line);
  border-radius: 0.3rem; padding: 0.15rem 0.6rem; cursor: pointer;
}
button[aria-pressed="true"] { background: var(--accent); color: #1d1610; border-color: var(--accent); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.banner { margin: 0; padding: 0.5rem 1rem; background: var(--bad); color: #fff; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 15rem; gap: 1rem; padding: 1rem; align-items: start; }
@media (max-width: 52rem) { .layout { grid-template-columns: minmax(0, 1fr); } }
main { min-width: 0; }
.stage { position: relative; width: 100%; }
canvas { display: block; image-rendering: pixelated; image-rendering: crisp-edges; width: 480px; height: 270px; }
.tooltip {
  position: absolute; z-index: 2; pointer-events: none; min-width: 11rem; max-width: 22rem;
  background: var(--panel); border: 1px solid var(--line); border-radius: 0.3rem;
  padding: 0.4rem 0.6rem; font-size: 0.85rem; box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
}
.tooltip div:first-child { font-weight: 600; }
.notice {
  position: absolute; inset: 0; display: grid; place-items: center; padding: 1rem; text-align: center;
  background: var(--panel); border: 1px solid var(--line);
}
.notice[hidden] { display: none; }
.crew { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; }
.crew button { width: 100%; display: flex; align-items: center; gap: 0.5rem; text-align: left; }
.crew .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crew .state { color: var(--muted); font-size: 0.85rem; }
.crew button[aria-pressed="true"] { border-color: var(--accent); }
.chip { width: 0.75rem; height: 0.75rem; border-radius: 0.15rem; flex: none; background: var(--muted); }
.cast-laborer { background: var(--chip-laborer); }
.cast-mason { background: var(--chip-mason); }
.cast-scribe { background: var(--chip-scribe); }
.cast-skeptic { background: var(--chip-skeptic); }
.cast-surveyor { background: var(--chip-surveyor); }
.cast-waterboy { background: var(--chip-waterboy); }
.cast-scout { background: var(--chip-scout); }
details { margin-top: 1rem; }
summary { cursor: pointer; color: var(--muted); }
table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 0.2rem 0.5rem; border-bottom: 1px solid var(--line); }
footer { padding: 0 1rem 1rem; color: var(--muted); font-size: 0.85rem; }
.visually-hidden {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;
