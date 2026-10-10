import { describe, expect, it } from "vitest";
import { isForbiddenWorkerEnv, isReservedEnv } from "./env-policy";

const FORBIDDEN = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EFFORT_LEVEL",
  "VSCODE_PID",
  "CURSOR_TRACE_ID",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
];

describe("isForbiddenWorkerEnv", () => {
  it.each(FORBIDDEN)("forbids %s", (name) => {
    expect(isForbiddenWorkerEnv(name)).toBe(true);
  });
  it.each(["ANTHROPIC_API_KEY", "HOME", "PATH", "TERM", "NODE_OPTIONS", "MY_CLAUDE", "claude_x"])("allows %s", (name) => {
    expect(isForbiddenWorkerEnv(name)).toBe(false);
  });
});

describe("isReservedEnv", () => {
  it.each([...FORBIDDEN, "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "HOME", "PATH"])("reserves %s", (name) => {
    expect(isReservedEnv(name)).toBe(true);
  });
  it.each(["CI", "TERM", "HOMEBREW_PREFIX", "PATHEXT", "NODE_OPTIONS", "MY_ANTHROPIC"])("leaves %s to the project", (name) => {
    expect(isReservedEnv(name)).toBe(false);
  });
});
