// Procedural WebAudio (DESIGN.md §19): a drum and a horn, no files. Off by default; no AudioContext exists until the
// viewer turns sound on (or, when the choice is remembered, until their first click or key), per autoplay policies.
import type { SceneEventKind } from "../model";
import type { AudioBufferLike, AudioContextConstructor, AudioContextLike, AudioNodeLike, StorageLike } from "./browser";

export const SOUND_KEY = "arbab-ui-sound";

/** At most this many stone drums a second: a busy fleet places many stones. */
export const STONES_PER_SECOND = 3;

export interface Sound {
  readonly enabled: boolean;
  /** Turns sound on or off, remembers the choice, and returns the new state. Call it from a user gesture. */
  toggle(): boolean;
  /** A user gesture happened: with sound remembered on, the AudioContext may start now. */
  unlock(): void;
  play(kind: SceneEventKind): void;
}

export interface SoundDeps {
  AudioContext: AudioContextConstructor | null;
  storage: () => StorageLike | null;
  /** Epoch ms, for the stone throttle. */
  now: () => number;
}

function readChoice(storage: () => StorageLike | null): boolean {
  try {
    return storage()?.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

function writeChoice(storage: () => StorageLike | null, on: boolean): void {
  try {
    storage()?.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Storage refused (privacy mode): the choice lasts for this page only.
  }
}

export function createSound(deps: SoundDeps): Sound {
  let enabled = readChoice(deps.storage);
  let ctx: AudioContextLike | null = null;
  let out: AudioNodeLike | null = null;
  let noise: AudioBufferLike | null = null;
  const stones: number[] = [];

  const start = (): void => {
    if (ctx || !deps.AudioContext) return;
    try {
      ctx = new deps.AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.25;
      master.connect(ctx.destination);
      out = master;
      const length = Math.floor(ctx.sampleRate * 0.2);
      noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noise.getChannelData(0);
      // A fixed LCG: noise needs no real randomness.
      let seed = 12345;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        data[i] = (seed / 4294967296) * 2 - 1;
      }
    } catch {
      ctx = null;
      out = null;
    }
  };

  const resume = (): void => {
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => undefined);
  };

  const drum = (c: AudioContextLike, dest: AudioNodeLike, t: number, freq: number, level: number): void => {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.16);
    const gain = c.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(t);
    osc.stop(t + 0.25);
    if (noise) {
      const burst = c.createBufferSource();
      burst.buffer = noise;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1800, t);
      const ng = c.createGain();
      ng.gain.setValueAtTime(level * 0.35, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      burst.connect(filter);
      filter.connect(ng);
      ng.connect(dest);
      burst.start(t);
      burst.stop(t + 0.08);
    }
  };

  const horn = (c: AudioContextLike, dest: AudioNodeLike, t: number, freq: number, length = 0.4): void => {
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, t);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.05);
    gain.gain.setValueAtTime(0.3, t + length - 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    filter.connect(gain);
    gain.connect(dest);
    for (const cents of [-7, 7]) {
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.setValueAtTime(cents, t);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + length + 0.02);
    }
  };

  const fanfare = (c: AudioContextLike, dest: AudioNodeLike, t: number): void => {
    horn(c, dest, t, 196, 0.35);
    // A fifth up.
    horn(c, dest, t + 0.3, 294, 0.5);
  };

  return {
    get enabled() {
      return enabled;
    },
    toggle() {
      enabled = !enabled;
      writeChoice(deps.storage, enabled);
      if (enabled) {
        start();
        resume();
      }
      return enabled;
    },
    unlock() {
      if (!enabled) return;
      start();
      resume();
    },
    play(kind) {
      if (!enabled || !ctx || !out) return;
      const c = ctx;
      const dest = out;
      const t = c.currentTime + 0.01;
      switch (kind) {
        case "brief":
        case "report":
          horn(c, dest, t, 220);
          break;
        case "stone": {
          const now = deps.now();
          while (stones.length > 0 && now - (stones[0] ?? 0) >= 1000) stones.shift();
          if (stones.length >= STONES_PER_SECOND) return;
          stones.push(now);
          drum(c, dest, t, 140, 0.5);
          break;
        }
        case "set":
          fanfare(c, dest, t);
          break;
        case "fall":
          drum(c, dest, t, 60, 0.8);
          break;
        case "capstone":
          fanfare(c, dest, t);
          for (let i = 0; i < 10; i++) drum(c, dest, t + 0.9 + i * 0.06, 120, 0.2 + i * 0.05);
          break;
      }
    },
  };
}
