import { describe, expect, it } from "vitest";
import type { AudioContextConstructor, AudioContextLike, AudioParamLike, StorageLike } from "./browser";
import { createSound, SOUND_KEY, STONES_PER_SECOND } from "./sound";

interface FakeAudio {
  ctor: AudioContextConstructor;
  created: FakeContext[];
}

interface FakeContext extends AudioContextLike {
  oscillators: { type: string; start: number }[];
  resumed: number;
}

function param(): AudioParamLike {
  return {
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
  };
}

function fakeAudio(): FakeAudio {
  const created: FakeContext[] = [];
  class Fake implements FakeContext {
    currentTime = 1;
    sampleRate = 8000;
    destination = { connect: () => undefined };
    state = "suspended";
    oscillators: { type: string; start: number }[] = [];
    resumed = 0;
    constructor() {
      created.push(this);
    }
    resume(): Promise<void> {
      this.resumed++;
      return Promise.resolve();
    }
    createOscillator() {
      const osc = { type: "sine", start: 0 };
      this.oscillators.push(osc);
      return {
        get type() {
          return osc.type;
        },
        set type(value: string) {
          osc.type = value;
        },
        frequency: param(),
        detune: param(),
        connect: () => undefined,
        start: (when?: number) => {
          osc.start = when ?? 0;
        },
        stop: () => undefined,
      };
    }
    createGain() {
      return { gain: param(), connect: () => undefined };
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
    expect(audio.created[0]?.oscillators).toHaveLength(0);
  });
});
