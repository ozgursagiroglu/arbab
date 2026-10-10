export type ErrorCode = "usage" | "lint" | "config" | "binary" | "io" | "git" | "lock" | "lease" | "runtime";

/** Every error arbab raises on purpose; the CLI maps the code to an exit status. */
export class ArbabError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ArbabError";
    this.code = code;
  }
}

/** 1: the caller's input or lint; 2: the environment or runtime (DESIGN.md §10). */
export const EXIT_CODES: Readonly<Record<ErrorCode, number>> = {
  usage: 1,
  lint: 1,
  config: 1,
  binary: 2,
  io: 2,
  git: 2,
  lock: 2,
  lease: 2,
  runtime: 2,
};

export function exitCodeFor(err: unknown): number {
  return err instanceof ArbabError ? EXIT_CODES[err.code] : 2;
}
