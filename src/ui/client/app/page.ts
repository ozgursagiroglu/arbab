// The page and its stylesheet (DESIGN.md §19, the game-studio pass). The CSP allows no inline script or style, so the
// HTML only links /app.css and /app.js; main.ts fills the elements by id, with textContent only.
import { UI_ROUTES } from "../../protocol";
import { CHIPS, TOKENS } from "./hud/tokens";

/** The ids main.ts fills. */
export const PAGE_IDS = {
  header: "top",
  logo: "logo",
  title: "title",
  project: "project",
  version: "version",
  gauge5h: "gauge-5h",
  gauge7d: "gauge-7d",
  held: "held",
  connection: "connection",
  sound: "sound",
  banner: "banner",
  kpis: "kpis",
  site: "site",
  siteTitle: "site-title",
  siteFullscreen: "site-fullscreen",
  stage: "stage",
  canvas: "scene",
  titleCard: "title-card",
  titleCardLogo: "title-card-logo",
  titleCardWord: "title-card-word",
  tooltip: "tooltip",
  notice: "notice",
  caption: "caption",
  crewPanel: "crew-panel",
  crewTitle: "crew-title",
  crewScroll: "crew-scroll",
  crew: "crew",
  crewEmpty: "crew-empty",
  recentGroup: "recent-group",
  recentTitle: "recent-title",
  recent: "recent",
  monumentTitle: "monument-title",
  monument: "monument",
  chronicleTitle: "chronicle-title",
  chronicle: "chronicle",
  chronicleEmpty: "chronicle-empty",
  ledgerTitle: "ledger-title",
  ledgerHead: "ledger-head",
  table: "lanes",
  footer: "footer",
  live: "live",
} as const;

const I = PAGE_IDS;

export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark">
<title>arbab · pyramid</title>
<link rel="icon" href="${UI_ROUTES.icon}" type="image/svg+xml">
<link rel="stylesheet" href="${UI_ROUTES.style}">
<script src="${UI_ROUTES.script}" defer></script>
</head>
<body>
<header id="${I.header}" class="topbar">
<div class="brand">
<canvas id="${I.logo}" class="px logo" width="32" height="32" aria-hidden="true"></canvas>
<h1 id="${I.title}" class="wordmark">arbab</h1>
<p class="project"><span id="${I.project}">connecting…</span> <span id="${I.version}" class="version"></span></p>
</div>
<div class="status">
<div class="gauges">
<div id="${I.gauge5h}" class="gauge" data-level="ok"></div>
<div id="${I.gauge7d}" class="gauge" data-level="ok"></div>
</div>
<div class="controls">
<span id="${I.held}" class="pill held" hidden>held</span>
<span id="${I.connection}" class="pill connection" data-state="connecting">connecting</span>
<button id="${I.sound}" type="button" aria-pressed="false">sound</button>
</div>
</div>
</header>
<p id="${I.banner}" class="banner" role="alert" hidden></p>
<main class="hud">
<section class="kpi-row" aria-labelledby="kpi-heading">
<h2 id="kpi-heading" class="visually-hidden">Lanes at a glance</h2>
<ul id="${I.kpis}" class="kpis"></ul>
</section>
<div class="grid">
<section id="${I.site}" class="frame panel site" aria-labelledby="${I.siteTitle}">
<div class="titlebar">
<h2 id="${I.siteTitle}">The site</h2>
<button id="${I.siteFullscreen}" type="button" class="small" aria-controls="${I.site}">full screen</button>
</div>
<div id="${I.stage}" class="stage">
<canvas id="${I.canvas}" width="480" height="270" role="img" aria-label="The pyramid scene: each lane is a worker building a block, and arbab hands out the work. The crew, the chronicle and the ledger say the same in text."></canvas>
<div id="${I.titleCard}" class="title-card" aria-hidden="true">
<canvas id="${I.titleCardLogo}" class="px" width="64" height="64"></canvas>
<div id="${I.titleCardWord}" class="title-card-word">ARBAB</div>
<p class="awakens">the site awakens…</p>
</div>
<div id="${I.tooltip}" class="tooltip frame" role="tooltip" hidden></div>
<div id="${I.notice}" class="notice" hidden></div>
</div>
<p id="${I.caption}" class="caption">THE SITE IS QUIET</p>
</section>
<aside class="side" aria-label="Crew and monument">
<section id="${I.crewPanel}" class="frame panel crew-panel" aria-labelledby="${I.crewTitle}" data-more="false">
<div class="titlebar"><h2 id="${I.crewTitle}">Crew</h2></div>
<div id="${I.crewScroll}" class="crew-scroll">
<ul id="${I.crew}" class="crew"></ul>
<div id="${I.crewEmpty}" class="crew-empty"></div>
<details id="${I.recentGroup}" class="recent-group" hidden>
<summary id="${I.recentTitle}">Recently finished</summary>
<ul id="${I.recent}" class="recent"></ul>
</details>
</div>
</section>
<section class="frame panel monument-panel" aria-labelledby="${I.monumentTitle}">
<div class="titlebar"><h2 id="${I.monumentTitle}">Monument</h2></div>
<div id="${I.monument}" class="monument"></div>
</section>
</aside>
</div>
<div class="below">
<section class="frame panel" aria-labelledby="${I.chronicleTitle}">
<div class="titlebar"><h2 id="${I.chronicleTitle}">Chronicle</h2></div>
<ol id="${I.chronicle}" class="chronicle"></ol>
<p id="${I.chronicleEmpty}" class="empty">Nothing has happened yet.</p>
</section>
<section class="frame panel" aria-labelledby="${I.ledgerTitle}">
<div class="titlebar"><h2 id="${I.ledgerTitle}">Ledger</h2></div>
<div class="table-wrap">
<table aria-labelledby="${I.ledgerTitle}">
<thead><tr id="${I.ledgerHead}"><th scope="col">lane</th><th scope="col">role</th><th scope="col">state</th><th scope="col">attempt</th><th scope="col">calls</th><th scope="col">last tool</th><th scope="col">elapsed</th><th scope="col">cost</th></tr></thead>
<tbody id="${I.table}"></tbody>
</table>
</div>
</section>
</div>
</main>
<footer>
<p id="${I.footer}">Read-only</p>
</footer>
<div id="${I.live}" class="visually-hidden" aria-live="polite"></div>
</body>
</html>
`;

const vars = (entries: [string, string][], prefix = ""): string => entries.map(([name, value]) => `  --${prefix}${name}: ${value};`).join("\n");

/** The outer dark edge on each side (no spread, so the corners notch) and the inner bevel. */
const frame = (edge: number, bevel: number, hi = "var(--frame-hi)", lo = "var(--frame-lo)"): string =>
  `0 -${edge}px 0 0 var(--frame-dark), 0 ${edge}px 0 0 var(--frame-dark), -${edge}px 0 0 0 var(--frame-dark), ${edge}px 0 0 0 var(--frame-dark),
    inset ${bevel}px ${bevel}px 0 0 ${hi}, inset -${bevel}px -${bevel}px 0 0 ${lo}`;

export const PAGE_CSS = `:root {
  color-scheme: dark;
${vars(Object.entries(TOKENS))}
${vars(Object.entries(CHIPS), "chip-")}
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 20px;
  --s6: 24px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
* { box-sizing: border-box; }
body {
  margin: 0; color: var(--text); line-height: 1.45;
  background: radial-gradient(ellipse 120% 60% at 50% -10%, #2a1d12 0, var(--bg) 70%) fixed, var(--bg);
}
p { margin: 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--sand); }
canvas.px { display: inline-block; vertical-align: middle; image-rendering: crisp-edges; image-rendering: pixelated; }
.pxt { display: inline-flex; align-items: center; line-height: 0; }
:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.visually-hidden {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
[hidden] { display: none !important; }

/* Pixel frames: square, notched corners; never rounded. */
.frame {
  margin: var(--s1); background: var(--panel); border-radius: 0;
  box-shadow: ${frame(4, 2)};
}
button {
  font: inherit; font-size: 13px; color: var(--text); background: var(--panel-2); border: 0; border-radius: 0;
  margin: 2px; padding: var(--s1) 10px; cursor: pointer; white-space: nowrap;
  box-shadow: ${frame(2, 2)};
}
button:hover { background: var(--panel-hi); }
button:active, button[aria-pressed="true"] {
  color: var(--gold); background: var(--panel);
  box-shadow: ${frame(2, 2, "var(--frame-lo)", "var(--frame-hi)")};
}
button.small { font-size: 12px; padding: 2px var(--s2); }

/* Top bar */
.topbar {
  position: sticky; top: 0; z-index: 10; height: 56px; display: flex; align-items: center; gap: var(--s4);
  padding: 0 var(--s4); background: var(--bg-2); border-bottom: 2px solid var(--frame);
  box-shadow: 0 2px 0 0 var(--frame-dark);
}
.brand { display: flex; align-items: center; gap: var(--s3); min-width: 0; }
.logo { width: 32px; height: 32px; }
h1 { margin: 0; font-size: 18px; line-height: 0; color: var(--gold); }
.project { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#${I.project} { color: var(--text); font-weight: 600; }
.version { color: var(--muted); }
.status, .gauges, .controls { display: flex; align-items: center; gap: var(--s3); min-width: 0; }
.status { margin-left: auto; }
.gauge { display: flex; align-items: center; gap: 6px; --level: var(--sand); }
.gauge[data-level="warn"] { --level: var(--gold-2); }
.gauge[data-level="hold"] { --level: var(--st-failed); }
.gauge-bar {
  position: relative; width: 96px; height: 10px; background: var(--frame-dark);
  box-shadow: 0 0 0 1px var(--frame-lo);
}
.gauge-fill {
  position: absolute; left: 0; top: 0; bottom: 0; width: 0;
  background: repeating-linear-gradient(90deg, var(--level) 0 3px, transparent 3px 4px);
}
.gauge-tick { position: absolute; top: -2px; bottom: -2px; width: 1px; background: var(--text); }
.pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px var(--s2); margin: 2px; line-height: 0;
  background: var(--panel); box-shadow: ${frame(2, 1)}; font-size: 12px;
}
.pill.held { line-height: 1; color: var(--bg); background: var(--st-waiting); font-weight: 700; text-transform: uppercase; }
.connection::before { content: ""; width: 6px; height: 6px; background: var(--muted); }
.connection[data-state="live"]::before { background: var(--st-success); animation: pulse 2s steps(4) infinite; }
.connection[data-state="lost"]::before { background: var(--st-waiting); }
.connection[data-state="closed"]::before { background: var(--st-failed); }
@keyframes pulse { 50% { opacity: 0.3; } }
.banner { padding: var(--s2) var(--s4); background: var(--st-failed); color: #fff; font-weight: 600; }

/* The dashboard. Its vertical spacing around the scene card is PAGE_GAPS in hud.ts: keep the two in step. */
.hud { display: grid; gap: var(--s3); padding: var(--s3) var(--s4) var(--s4); max-width: 1880px; margin: 0 auto; }
.grid, .side, .below { display: grid; gap: var(--s3); grid-template-columns: minmax(0, 1fr); align-items: start; }
.hud > *, .grid > *, .side > *, .below > * { min-width: 0; }
.side { align-content: start; }
@media (min-width: 900px) {
  .side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .below { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); }
}
@media (min-width: 1280px) {
  .grid { grid-template-columns: minmax(0, 1fr) 360px; align-items: stretch; }
  /* As tall as the scene card and no taller: size containment keeps the crew from stretching the row. The items
     stretch, so the crew panel fills the first row instead of shrinking to its title around a zero-basis list. */
  .side { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; align-content: stretch; align-items: stretch; contain: size; }
  .crew-panel { display: flex; flex-direction: column; min-height: 0; }
  .crew-panel > .titlebar { flex: none; }
  .crew-panel .crew-scroll { flex: 1 1 0; min-height: 0; max-height: none; overflow-y: auto; }
}
.panel { padding: var(--s3); min-width: 0; }
.titlebar {
  display: flex; align-items: center; justify-content: space-between; gap: var(--s2);
  min-height: 30px; margin-bottom: var(--s3); padding-bottom: var(--s2); border-bottom: 2px solid var(--frame-lo);
}
h2 { margin: 0; font-size: 14px; line-height: 0; color: var(--gold); }
.empty { color: var(--muted); padding: var(--s2) 0; }

/* KPI cards */
.kpis { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s3); grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
.kpi { display: grid; grid-template-columns: 16px minmax(0, 1fr); grid-template-areas: "icon label" "num num"; gap: var(--s2) var(--s2); align-items: center; padding: var(--s3) 14px; }
.kpi .icon { grid-area: icon; width: 16px; height: 16px; }
.kpi .kpi-label { grid-area: label; }
.kpi .kpi-number { grid-area: num; min-height: 44px; }
/* Wide: one row per card (icon, label, number), so the KPI row leaves the scene its height. */
@media (min-width: 1280px) {
  .kpi { grid-template-columns: 16px auto minmax(0, 1fr); grid-template-areas: "icon label num"; padding: var(--s2) 14px; }
  .kpi .kpi-number { justify-self: end; }
}

/* The scene card: lean chrome, so 3× fits a 1080-px screen (stageRoom in hud.ts measures it). */
.site { padding: var(--s2); }
.site .titlebar { min-height: 28px; margin-bottom: var(--s2); padding-bottom: 6px; }
.stage {
  position: relative; display: flex; align-items: center; justify-content: center; min-width: 0; overflow: hidden;
  background-color: var(--frame-dark);
  background-image:
    repeating-linear-gradient(45deg, rgb(255 255 255 / 0.025) 0 2px, transparent 2px 8px),
    repeating-linear-gradient(-45deg, rgb(0 0 0 / 0.25) 0 2px, transparent 2px 8px),
    radial-gradient(ellipse at center, var(--bg-2) 0, var(--frame-dark) 80%);
  box-shadow: inset 0 0 0 2px var(--frame-lo);
}
#${I.canvas} { display: block; flex: none; width: 480px; height: 270px; image-rendering: crisp-edges; image-rendering: pixelated; }
/* Below 1×: the stage's width, the height by the art's aspect ratio. */
#${I.canvas}.fluid { flex: 1 1 auto; max-width: 100%; aspect-ratio: 480 / 270; }
.caption {
  display: flex; justify-content: center; min-height: 27px; margin-top: 6px; padding: var(--s2);
  line-height: 0; color: var(--sand); background: var(--bg-2); box-shadow: inset 0 0 0 2px var(--frame-lo);
}
.site:fullscreen { margin: 0; width: 100vw; height: 100vh; display: flex; flex-direction: column; background: var(--bg); box-shadow: none; }
.site:fullscreen .stage { flex: 1; min-height: 0; }
.title-card {
  position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--s4); background: radial-gradient(ellipse at center, var(--panel) 0, var(--bg) 75%);
  transition: opacity 0.6s steps(6), visibility 0s linear 0.6s;
}
.title-card.gone { opacity: 0; visibility: hidden; }
.title-card-word { line-height: 0; color: var(--gold); font-size: 32px; }
.awakens { color: var(--muted); font-style: italic; }
.tooltip { position: absolute; z-index: 4; pointer-events: none; min-width: 190px; max-width: 320px; padding: 10px 12px; font-size: 13px; }
.tooltip .tip-title { margin-bottom: 6px; line-height: 0; }
.tooltip div + div { color: var(--muted); }
.notice {
  position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; padding: var(--s4); text-align: center;
  background: rgb(18 13 10 / 0.94); font-size: 15px;
}

/* Crew: the list scrolls inside its panel, with a fade at the bottom edge while there is more below. */
.crew-panel { position: relative; }
.crew-scroll { min-height: 0; max-height: 640px; overflow: auto; }
.crew-panel[data-more="true"]::after {
  content: ""; position: absolute; left: var(--s3); right: var(--s3); bottom: var(--s3); height: 36px; pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--panel));
}
.crew { list-style: none; margin: 0; padding: 2px; display: grid; gap: var(--s3); }
.card {
  width: calc(100% - 4px); display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; align-items: start;
  padding: var(--s2); text-align: left; white-space: normal; font-size: 14px; color: var(--text); background: var(--panel-2);
}
.card[aria-pressed="true"] { color: var(--text); }
.card[aria-pressed="true"] .name { color: var(--gold); }
.tile {
  display: grid; place-items: end center; width: 44px; height: 62px; padding-bottom: var(--s1);
  background: color-mix(in srgb, var(--chip, var(--frame)) 38%, var(--bg-2)); box-shadow: inset 0 0 0 2px var(--frame-dark);
}
.tile .avatar { width: 36px; height: 54px; }
.tile-arbab { flex: none; width: 56px; height: 86px; background: var(--bg-2); }
.tile-arbab .avatar { width: 48px; height: 78px; }
.tile.ghost .avatar { opacity: 0.75; }
${Object.keys(CHIPS)
  .map((cast) => `.cast-${cast} { --chip: var(--chip-${cast}); }`)
  .join("\n")}
.card-body { display: grid; gap: 3px; min-width: 0; }
.card-head, .card-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); min-width: 0; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta, .stats, .calls, .elapsed, .num { color: var(--muted); font-size: 13px; }
.stats { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.elapsed, .calls { white-space: nowrap; }
.progress { display: flex; align-items: center; gap: var(--s2); }
.bar { position: relative; flex: 1; height: 8px; overflow: hidden; background: var(--frame-dark); box-shadow: 0 0 0 1px var(--frame-lo); }
.bar-fill {
  position: absolute; left: 0; top: 0; bottom: 0; width: 0;
  background: repeating-linear-gradient(90deg, var(--gold) 0 4px, var(--gold-2) 4px 5px, var(--frame-dark) 5px 6px);
}
.badge { display: inline-flex; align-items: center; flex: none; padding: 2px var(--s1); background: var(--tone, var(--st-orphaned)); box-shadow: 0 0 0 1px var(--frame-dark); }
${["running", "preparing", "waiting", "asleep", "success", "orphaned"].map((t) => `.tone-${t} { --tone: var(--st-${t}); }`).join("\n")}
.tone-failed { --tone: var(--badge-failed); }
.crew-empty { display: flex; align-items: center; gap: var(--s3); padding: var(--s2) 0; }
.empty-lead { font-weight: 600; }
.empty-hint { color: var(--muted); font-size: 13px; }
.recent-group { margin-top: var(--s3); }
.recent-group summary { cursor: pointer; padding: var(--s1) 0; line-height: 0; }
.recent { list-style: none; margin: var(--s2) 0 0; padding: 0; display: grid; gap: var(--s1); }
.recent-item { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto auto; gap: var(--s2); align-items: center; }
.recent-item .tile { height: 44px; overflow: hidden; }

/* Monument */
.monument-head { display: flex; align-items: baseline; gap: var(--s2); margin-bottom: 10px; }
.stepper { list-style: none; margin: 0; padding: 0; }
.step { position: relative; display: grid; grid-template-columns: 20px auto minmax(0, 1fr); gap: 10px; align-items: center; padding: 6px 0; }
.step + .step::before { content: ""; position: absolute; left: 9px; top: -8px; width: 2px; height: 16px; background: var(--frame-lo); }
.step[data-state="done"] + .step::before { background: var(--gold-2); }
.node {
  position: relative; z-index: 1; justify-content: center; width: 20px; height: 20px; background: var(--bg-2);
  box-shadow: 0 0 0 2px var(--frame-dark), inset 0 0 0 2px var(--frame-lo);
}
.step[data-state="done"] .node { box-shadow: 0 0 0 2px var(--frame-dark), inset 0 0 0 2px var(--gold-2); }
.step[data-state="failed"] .node { box-shadow: 0 0 0 2px var(--frame-dark), inset 0 0 0 2px var(--st-failed); }
.detail { color: var(--muted); font-size: 13px; text-align: right; }

/* Chronicle */
.chronicle { list-style: none; margin: 0; padding: 0; max-height: 380px; overflow: auto; }
.chronicle-line {
  display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: var(--s2); align-items: center;
  padding: 5px var(--s1); border-bottom: 1px solid var(--frame-lo);
}
.chronicle-line .ago { color: var(--muted); font-size: 12px; white-space: nowrap; }
.chronicle-line.enter { animation: slide-in 0.4s steps(5) both; }
@keyframes slide-in { from { transform: translateX(-16px); opacity: 0; } to { transform: none; opacity: 1; } }

/* Ledger */
.table-wrap { max-height: 380px; overflow: auto; box-shadow: inset 0 0 0 1px var(--frame-lo); }
table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px; }
thead th { position: sticky; top: 0; z-index: 1; padding: 0; text-align: left; background: var(--panel-hi); border-bottom: 2px solid var(--frame-dark); }
thead th.num { text-align: right; }
button.sort {
  width: 100%; margin: 0; padding: 6px var(--s2); text-align: inherit; font-size: 12px; font-weight: 600;
  color: var(--muted); background: transparent; box-shadow: none; text-transform: uppercase; letter-spacing: 0.04em;
}
button.sort:hover { color: var(--text); }
th[aria-sort="ascending"] .sort, th[aria-sort="descending"] .sort { color: var(--gold); }
th[aria-sort="ascending"] .sort::after { content: " ▲"; }
th[aria-sort="descending"] .sort::after { content: " ▼"; }
tbody th, tbody td { padding: 5px var(--s2); text-align: left; font-weight: 400; white-space: nowrap; border-bottom: 1px solid var(--frame-lo); }
tbody th { font-weight: 600; }
tbody tr { cursor: pointer; }
tbody tr:nth-child(even) { background: var(--panel-2); }
tbody tr:hover, tbody tr.pinned { background: var(--panel-hi); }
tbody tr.pinned th { color: var(--gold); }
tbody .num { text-align: right; color: var(--text); }

footer { padding: 0 var(--s4) var(--s4); color: var(--muted); font-size: 13px; text-align: center; }

@media (max-width: 899px) {
  .topbar { height: auto; min-height: 56px; flex-wrap: wrap; padding: var(--s2) var(--s4); }
  .status { flex-wrap: wrap; }
}
/* Narrow (a phone): nothing wider than the screen. The top bar stacks its rows: the logo, the gauges, the buttons. */
@media (max-width: 599px) {
  .topbar { flex-direction: column; align-items: stretch; gap: var(--s2); }
  .status { margin-left: 0; flex-direction: column; align-items: flex-start; gap: var(--s2); }
  .gauges, .controls { flex-wrap: wrap; }
  .hud { padding: var(--s2); }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .card-head, .card-foot { flex-wrap: wrap; }
  .recent-item { grid-template-columns: 44px minmax(0, 1fr) auto; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;
