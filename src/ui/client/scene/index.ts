// The scene (DESIGN.md §19). Contract stub: lane ui-scene replaces this file and keeps the signature.
import type { Scene, SceneOptions, World } from "../model";
import { PLACES, PYRAMID_AREA } from "../model";

/** A scene that folds snapshots into its world and animates it. */
export function createScene(options: SceneOptions): Scene {
  const apex = { x: PYRAMID_AREA.centerX, y: PYRAMID_AREA.baseY };
  const world: World = {
    sky: { phase: "day", sun: 0.5 },
    pyramid: {
      base: 0,
      blockW: 0,
      blockH: 0,
      blocks: [],
      rubble: 0,
      apex,
      capstone: { state: "none", integration: null, ...PLACES.sledge, flag: "none", ready: false },
    },
    far: [],
    actors: [
      {
        id: "arbab",
        lane: null,
        cast: "arbab",
        ...PLACES.arbab,
        facing: 1,
        pose: "idle",
        poseTime: 0,
        stroke: 0,
        ration: 0,
        icon: null,
        bubble: null,
        alpha: 1,
        ghost: false,
        highlight: false,
      },
    ],
    particles: [],
    coins: 0,
    events: [],
    reducedMotion: options.reducedMotion,
  };
  return { world, apply: () => undefined, step: () => undefined, pick: () => null, highlight: () => undefined };
}
