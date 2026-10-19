// The caption under the scene (DESIGN.md §19): which pyramid stands and how far along it is, in the pixel font. It
// reads the World the canvas draws, so the words never disagree with the picture; the snapshot only dates a monument.
import type { UiSnapshot } from "../../../protocol";
import type { Pyramid, World } from "../../model";
import { formatAgo } from "./chronicle";

const CAPSTONE: Readonly<Record<Pyramid["capstone"]["state"], string>> = {
  none: "",
  waiting: "capstone waiting",
  hoisting: "capstone rising",
  set: "capstone set",
};

/** What the caption depends on in the World: when it changes, the caption is written again. */
export function captionKey(world: Pick<World, "pyramid">): string {
  const p = world.pyramid;
  const lanes = p.blocks.filter((b) => b.lane !== null);
  const set = lanes.filter((b) => b.look === "set").length;
  return `${p.monument ?? ""}|${set}/${lanes.length}|${p.capstone.state}|${p.capstone.integration ?? ""}|${p.capstone.flag}`;
}

/**
 * `UI2 · 3/10 BLOCKS SET · CAPSTONE WAITING · VERIFY ✓` while lanes build; `MONUMENT · UI · 8 BLOCKS · LANDED 11H
 * AGO` while a landed integration stands alone; else `THE SITE IS QUIET`.
 */
export function sceneCaption(snapshot: UiSnapshot, nowMs: number, world: Pick<World, "pyramid">): string {
  const p = world.pyramid;
  if (p.monument !== null) {
    const integration = snapshot.integrations.find((i) => i.name === p.monument);
    const at = integration?.landedAt ? Date.parse(integration.landedAt) : Number.NaN;
    const ago = Number.isFinite(at) ? ` · landed ${formatAgo(nowMs - at)}` : "";
    const n = integration ? integration.lanes.length : p.blocks.filter((b) => b.lane !== null).length;
    return `monument · ${p.monument} · ${n} ${n === 1 ? "block" : "blocks"}${ago}`.toUpperCase();
  }
  const lanes = p.blocks.filter((b) => b.lane !== null);
  const cap = p.capstone;
  if (lanes.length === 0 && cap.state === "none") return "THE SITE IS QUIET";
  const parts: string[] = [];
  if (cap.state !== "none" && cap.integration !== null) parts.push(cap.integration);
  parts.push(`${lanes.filter((b) => b.look === "set").length}/${lanes.length} blocks set`);
  if (cap.state !== "none") {
    parts.push(CAPSTONE[cap.state]);
    parts.push(`verify ${cap.flag === "passed" ? "✓" : cap.flag === "failed" ? "✗" : "·"}`);
  }
  return parts.join(" · ").toUpperCase();
}
