import { describe, expect, it } from "vitest";
import type { AudioContextConstructor, AudioContextLike, AudioParamLike, StorageLike } from "./browser";
import type { Sound } from "./sound";
import { createSound, PAYS_PER_SECOND, SOUND_KEY, STONES_PER_SECOND } from "./sound";

interface FakeAudio {
  ctor: AudioContextConstructor;
  created: FakeContext[];
}

type ParamCall = [method: "set" | "linear" | "exp", value: number, time: number];

interface FakeOscillator {
  type: string;
  start: number;
  stop: number;
  frequency: ParamCall[];
}

interface FakeContext extends AudioContextLike {
  oscillators: FakeOscillator[];
  /** The automation of each gain node, in creation order. */
  gains: ParamCall[][];
  resumed: number;
}

function param(calls: ParamCall[] = []): AudioParamLike {
  return {
    value: 0,
    setValueAtTime: (value, time) => void calls.push(["set", value, time]),
    linearRampToValueAtTime: (value, time) => void calls.push(["linear", value, time]),
    exponentialRampToValueAtTime: (value, time) => void calls.push(["exp", value, time]),
  };
}

function fakeAudio(): FakeAudio {
  const created: FakeContext[] = [];
  class Fake implements FakeContext {
    currentTime = 1;
    sampleRate = 8000;
    destination = { connect: () => undefined };
    state = "suspended";
    oscillators: FakeOscillator[] = [];
    gains: ParamCall[][] = [];
    resumed = 0;
    constructor() {
      created.push(this);
    }
    resume(): Promise<void> {
      this.resumed++;
      return Promise.resolve();
    }
    createOscillator() {
      const osc: FakeOscillator = { type: "sine", start: 0, stop: 0, frequency: [] };
      this.oscillators.push(osc);
      return {
        get type() {
          return osc.type;
        },
        set type(value: string) {
          osc.type = value;
        },
        frequency: param(osc.frequency),
        detune: param(),
        connect: () => undefined,
        start: (when?: number) => {
          osc.start = when ?? 0;
        },
        stop: (when?: number) => {
          osc.stop = when ?? 0;
        },
      };
    }
    createGain() {
      const calls: ParamCall[] = [];
      this.gains.push(calls);
      return { gain: param(calls), connect: () => undefined };
    }
    createBiquadFilter() {
      return { type: "lowpass", frequency: param(), connect: () => undefined };
    }
    createBuffer(_channels: number, length: number) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    }
    createBufferSource() {
      return { buffer: null, connect: () => undefined, start: () => undefined, stop: () => undefined };
    }
  }
  return { ctor: Fake, created };
}

function memory(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => void (data[key] = value) };
}

describe("createSound", () => {
  it("is off by default and creates no AudioContext before the first toggle on", () => {
    const audio = fakeAudio();
    const sound = createSound({ AudioContext: audio.ctor, storage: () => memory(), now: () => 0 });
    expect(sound.enabled).toBe(false);
    sound.unlock();
    sound.play("brief");
    expect(audio.created).toHaveLength(0);
    expect(sound.toggle()).toBe(true);
    expect(audio.created).toHaveLength(1);
    expect(audio.created[0]?.resumed).toBe(1);
  });

  it("remembers the choice in localStorage", () => {
    const store = memory();
    const sound = createSound({ AudioContext: fakeAudio().ctor, storage: () => store, now: () => 0 });
    sound.toggle();
    expect(store.data[SOUND_KEY]).toBe("on");
    sound.toggle();
    expect(store.data[SOUND_KEY]).toBe("off");
  });

  it("starts remembered sound on the first user gesture, not before", () => {
    const audio = fakeAudio();
    const sound = createSound({ AudioContext: audio.ctor, storage: () => memory({ [SOUND_KEY]: "on" }), now: () => 0 });
    expect(sound.enabled).toBe(true);
    sound.play("brief");
    expect(audio.created).toHaveLength(0);
    sound.unlock();
    expect(audio.created).toHaveLength(1);
    sound.play("brief");
    expect(audio.created[0]?.oscillators.length).toBeGreaterThan(0);
  });

  it("survives storage that throws and a browser without WebAudio", () => {
    const throwing = (): StorageLike => {
      throw new Error("SecurityError");
    };
    const sound = createSound({ AudioContext: null, storage: throwing, now: () => 0 });
    expect(sound.enabled).toBe(false);
    expect(sound.toggle()).toBe(true);
    expect(() => sound.play("capstone")).not.toThrow();
    const refusing = memory();
    refusing.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => createSound({ AudioContext: null, storage: () => refusing, now: () => 0 }).toggle()).not.toThrow();
  });

  it("plays at most three stones a second", () => {
    const audio = fakeAudio();
    let now = 10_000;
    const sound = createSound({ AudioContext: audio.ctor, storage: () => null, now: () => now });
    sound.toggle();
    const ctx = audio.created[0];
    if (!ctx) throw new Error("no context");
    const drums = (): number => ctx.oscillators.filter((o) => o.type === "sine").length;
    for (let i = 0; i < 10; i++) {
      sound.play("stone");
      now += 50;
    }
    expect(drums()).toBe(STONES_PER_SECOND);
    now += 1000;
    sound.play("stone");
    expect(drums()).toBe(STONES_PER_SECOND + 1);
  });

  it("maps events to sounds: horns, a fanfare a fifth up, a thud, a drum roll", () => {
    const audio = fakeAudio();
    const sound = createSound({ AudioContext: audio.ctor, storage: () => null, now: () => 0 });
    sound.toggle();
    const ctx = audio.created[0];
    if (!ctx) throw new Error("no context");
    const count = (play: () => void): { saw: number; sine: number } => {
      ctx.oscillators.length = 0;
      play();
      return {
        saw: ctx.oscillators.filter((o) => o.type === "sawtooth").length,
        sine: ctx.oscillators.filter((o) => o.type === "sine").length,
      };
    };
    expect(count(() => sound.play("brief"))).toEqual({ saw: 2, sine: 0 });
    expect(count(() => sound.play("report"))).toEqual({ saw: 2, sine: 0 });
    expect(count(() => sound.play("set"))).toEqual({ saw: 4, sine: 0 });
    expect(count(() => sound.play("fall"))).toEqual({ saw: 0, sine: 1 });
    expect(count(() => sound.play("capstone"))).toEqual({ saw: 4, sine: 10 });
  });

  it("is silent once turned off", () => {
    const audio = fakeAudio();
    const sound = createSound({ AudioContext: audio.ctor, storage: () => null, now: () => 0 });
    sound.toggle();
    sound.toggle();
    sound.play("set");
    sound.play("pay");
    expect(audio.created[0]?.oscillators).toHaveLength(0);
  });
});

describe("the pay", () => {
  function on(now: () => number = () => 0): { sound: Sound; ctx: FakeContext } {
    const audio = fakeAudio();
    const sound = createSound({ AudioContext: audio.ctor, storage: () => null, now });
    sound.toggle();
    const ctx = audio.created[0];
    if (!ctx) throw new Error("no context");
    return { sound, ctx };
  }
  const freq = (o: FakeOscillator): number => o.frequency.find((c) => c[0] === "set")?.[1] ?? 0;
  const knocks = (ctx: FakeContext): FakeOscillator[] => ctx.oscillators.filter((o) => freq(o) < 1000);
  const clinks = (ctx: FakeContext): FakeOscillator[] => ctx.oscillators.filter((o) => freq(o) >= 1000);
  /** The peak a gain is set to and how long it takes to die away. */
  const envelope = (calls: ParamCall[]): { level: number; decay: number } => {
    const set = calls.find((c) => c[0] === "set");
    const end = calls.find((c) => c[0] === "exp");
    if (!set || !end) throw new Error("no envelope");
    expect(end[1]).toBeLessThanOrEqual(0.001);
    return { level: set[1], decay: end[2] - set[2] };
  };

  it("drops two to four clinks, 45–90 ms apart, over a low wooden knock", () => {
    const { sound, ctx } = on();
    sound.play("pay");
    const t = 1.01;
    const [knock, ...rest] = knocks(ctx);
    expect(rest).toEqual([]);
    expect(knock).toMatchObject({ type: "sine", start: t });
    expect(freq(knock!)).toBeGreaterThanOrEqual(120);
    expect(freq(knock!)).toBeLessThanOrEqual(180);
    expect(knock!.stop - knock!.start).toBeCloseTo(0.07);

    const bright = clinks(ctx);
    const starts = [...new Set(bright.map((o) => o.start))].sort((a, b) => a - b);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts.length).toBeLessThanOrEqual(4);
    expect(starts[0]).toBe(t);
    for (let i = 1; i < starts.length; i += 1) {
      const gap = starts[i]! - starts[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(0.045 - 1e-9);
      expect(gap).toBeLessThanOrEqual(0.09 + 1e-9);
    }
    for (const at of starts) {
      const partials = bright.filter((o) => o.start === at);
      expect(partials.length).toBeGreaterThanOrEqual(1);
      expect(partials.length).toBeLessThanOrEqual(2);
    }
    for (const o of bright) {
      expect(["sine", "triangle"]).toContain(o.type);
      expect(freq(o)).toBeGreaterThanOrEqual(2000);
      expect(freq(o)).toBeLessThanOrEqual(4500);
    }
    // The pitches vary from clink to clink.
    const firsts = starts.map((at) => Math.min(...bright.filter((o) => o.start === at).map(freq)));
    expect(new Set(firsts).size).toBe(firsts.length);

    const [knockGain, ...clinkGains] = ctx.gains.slice(1).map(envelope);
    expect(knockGain!.decay).toBeCloseTo(0.06);
    expect(clinkGains).toHaveLength(bright.length);
    for (const g of clinkGains) {
      expect(g.decay).toBeGreaterThanOrEqual(0.08);
      expect(g.decay).toBeLessThanOrEqual(0.16);
    }
  });

  it("is the same sound every time", () => {
    let now = 0;
    const { sound, ctx } = on(() => now);
    sound.play("pay");
    const first = ctx.oscillators.map((o) => ({ ...o, start: o.start - 1.01, stop: o.stop - 1.01 }));
    ctx.oscillators.length = 0;
    now += 5000;
    sound.play("pay");
    const second = ctx.oscillators.map((o) => ({ ...o, start: o.start - 1.01, stop: o.stop - 1.01 }));
    expect(second.map((o) => [o.type, freq(o)])).toEqual(first.map((o) => [o.type, freq(o)]));
    expect(second.map((o) => o.start)).toEqual(first.map((o) => o.start));
  });

  it("is quieter than the horn", () => {
    const { sound, ctx } = on();
    sound.play("brief");
    const horn = Math.max(...ctx.gains.slice(1).flatMap((g) => g.map((c) => c[1])));
    const before = ctx.gains.length;
    sound.play("pay");
    // Even the nodes that start together, at their peaks, stay under the horn's peak.
    const peaks = new Map<number, number>();
    for (const calls of ctx.gains.slice(before)) {
      const at = calls.find((c) => c[0] === "set")?.[2] ?? 0;
      peaks.set(at, (peaks.get(at) ?? 0) + envelope(calls).level);
    }
    expect(peaks.size).toBeGreaterThan(1);
    for (const peak of peaks.values()) expect(peak).toBeLessThan(horn);
  });

  it("plays at most two pays a second, apart from the stones", () => {
    let now = 10_000;
    const { sound, ctx } = on(() => now);
    for (let i = 0; i < 10; i++) {
      sound.play("pay");
      sound.play("stone");
      now += 100;
    }
    expect(knocks(ctx).filter((o) => o.frequency.some((c) => c[1] === 160))).toHaveLength(PAYS_PER_SECOND);
    expect(ctx.oscillators.filter((o) => freq(o) === 140)).toHaveLength(STONES_PER_SECOND);
    now += 1000;
    sound.play("pay");
    expect(knocks(ctx).filter((o) => o.frequency.some((c) => c[1] === 160))).toHaveLength(PAYS_PER_SECOND + 1);
  });
});
