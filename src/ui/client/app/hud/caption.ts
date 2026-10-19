// The caption under the scene (DESIGN.md §19): which pyramid stands and how far along it is, in the pixel font.
import type { UiIntegration, UiSnapshot } from "../../../protocol";
import { foreground } from "../../scene/scene";
import { formatAgo } from "./chronicle";
import { isSet } from "./crew";

function landedMs(i: UiIntegration): number {
  const t = i.landedAt === null ? Number.NaN : Date.parse(i.landedAt);
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * `UI2 · 3/10 BLOCKS SET · CAPSTONE WAITING · VERIFY ✓` while lanes build; `MONUMENT · UI · 8 BLOCKS · LANDED 11H
 * AGO` while the newest landed integration stands alone; else `THE SITE IS QUIET`.
 */
export function sceneCaption(snapshot: UiSnapshot, nowMs: number): string {
  const fg = foreground(snapshot);
  if (fg.lanes.length > 0) {
    const set = fg.lanes.filter(isSet).length;
    const parts: string[] = [];
    if (fg.capstone) parts.push(fg.capstone.name);
    parts.push(`${set}/${fg.lanes.length} blocks set`);
    if (fg.capstone) {
      parts.push(fg.capstoneLanded ? "capstone set" : "capstone waiting");
      parts.push(`verify ${fg.capstone.verify === "passed" ? "✓" : fg.capstone.verify === "failed" ? "✗" : "·"}`);
    }
    return parts.join(" · ").toUpperCase();
  }
  let monument: UiIntegration | null = null;
  for (const i of snapshot.integrations) {
    if (i.landedAt !== null && (monument === null || landedMs(i) >= landedMs(monument))) monument = i;
  }
  if (monument) {
    const at = landedMs(monument);
    const ago = Number.isFinite(at) ? ` · landed ${formatAgo(nowMs - at)}` : "";
    const n = monument.lanes.length;
    return `monument · ${monument.name} · ${n} ${n === 1 ? "block" : "blocks"}${ago}`.toUpperCase();
  }
  return "THE SITE IS QUIET";
}
