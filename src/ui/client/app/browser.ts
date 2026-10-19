// The browser surface the page uses, as minimal interfaces: the project's tsconfig has no DOM lib. main.ts reads the
// real objects from globalThis once and passes them down; everything else takes them as parameters, so tests pass fakes.

/** The part of CanvasRenderingContext2D the renderer uses: solid rectangles and alpha. */
export interface Canvas2D {
  fillStyle: string;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

export interface EventLike {
  readonly type: string;
  readonly key?: string;
  readonly clientX?: number;
  readonly clientY?: number;
  preventDefault?(): void;
}

export interface StyleLike {
  width: string;
  height: string;
  left: string;
  top: string;
}

export interface ElementLike {
  textContent: string | null;
  hidden: boolean;
  className: string;
  readonly style: StyleLike;
  setAttribute(name: string, value: string): void;
  appendChild(child: ElementLike): unknown;
  replaceChildren(...children: ElementLike[]): void;
  remove(): void;
  addEventListener(type: string, listener: (event: EventLike) => void): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}

export interface CanvasElementLike extends ElementLike {
  width: number;
  height: number;
  getContext(kind: "2d"): Canvas2D | null;
}

export interface DocumentLike {
  getElementById(id: string): ElementLike | null;
  createElement(tag: string): ElementLike;
  addEventListener(type: string, listener: (event: EventLike) => void): void;
}

export interface MessageEventLike {
  readonly data: string;
}

export interface EventSourceLike {
  /** 0 connecting (it retries), 1 open, 2 closed (it gave up). */
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEventLike) => void): void;
  close(): void;
}

export type EventSourceConstructor = new (url: string) => EventSourceLike;

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
}

export interface OscillatorLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
  readonly detune: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface GainLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface BiquadFilterLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
}

export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  readonly state?: string;
  resume(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  createBiquadFilter(): BiquadFilterLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): BufferSourceLike;
}

export type AudioContextConstructor = new () => AudioContextLike;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface MediaQueryListLike {
  readonly matches: boolean;
}

export interface LocationLike {
  readonly hash: string;
}

export interface WindowLike {
  readonly innerWidth: number;
  readonly innerHeight: number;
  addEventListener(type: string, listener: (event: EventLike) => void): void;
}

/** Everything startPage takes from the browser. */
export interface PageEnv {
  document: DocumentLike;
  window: WindowLike;
  location: LocationLike;
  EventSource: EventSourceConstructor;
  /** null where WebAudio is missing. */
  AudioContext: AudioContextConstructor | null;
  /** A getter, because touching localStorage can throw (privacy modes, sandboxed frames). */
  storage: () => StorageLike | null;
  matchMedia: (query: string) => MediaQueryListLike;
  requestAnimationFrame: (callback: (time: number) => void) => unknown;
  devicePixelRatio: number;
  /** The client's clock, epoch ms. */
  now: () => number;
}
