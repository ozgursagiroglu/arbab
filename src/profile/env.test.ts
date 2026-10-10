import { describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { workerEnv } from "./env";

const HOST: Record<string, string | undefined> = {
  HOME: "/home/worker",
  USER: "worker",
  LOGNAME: "worker",
  LANG: "en_US.UTF-8",
  SHELL: "/bin/zsh",
  PATH: "/host/bin:/usr/bin",
  TERM: "xterm-256color",
  CLAUDECODE: "1",
  CLAUDE_CODE_ENTRYPOINT: "claude-vscode",
  VSCODE_PID: "123",
  TERM_PROGRAM: "vscode",
  AWS_SECRET_ACCESS_KEY: "nope",
  NODE_OPTIONS: "--max-old-space-size=4096",
  UNSET: undefined,
};

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err instanceof ArbabError ? err.code : err;
  }
  return "no error";
}

describe("workerEnv", () => {
  it("builds the environment from scratch", () => {
    expect(workerEnv(HOST, { passEnv: [], extra: {}, nodeDir: "/opt/node/bin" })).toEqual({
      HOME: "/home/worker",
      USER: "worker",
      LOGNAME: "worker",
      LANG: "en_US.UTF-8",
      SHELL: "/bin/zsh",
      PATH: "/opt/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      TERM: "dumb",
      DISABLE_AUTOUPDATER: "1",
    });
  });

  it("skips host keys that are not set", () => {
    const env = workerEnv({ HOME: "/home/worker" }, { passEnv: ["UNSET", "MISSING"], extra: {}, nodeDir: "/n" });
    expect(Object.keys(env).sort()).toEqual(["DISABLE_AUTOUPDATER", "HOME", "PATH", "TERM"]);
  });

  it("puts pnpm after node and drops duplicate PATH entries", () => {
    const env = workerEnv(HOST, { passEnv: [], extra: {}, nodeDir: "/usr/local/bin", pnpmDir: "/opt/pnpm" });
    expect(env.PATH).toBe("/usr/local/bin:/opt/pnpm:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("passes named host variables, then extra, which wins", () => {
    const env = workerEnv(HOST, {
      passEnv: ["NODE_OPTIONS", "LANG"],
      extra: { ARBAB_PORT_0: "4100", LANG: "C" },
      nodeDir: "/n",
    });
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=4096");
    expect(env.ARBAB_PORT_0).toBe("4100");
    expect(env.LANG).toBe("C");
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it.each([
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EFFORT_LEVEL",
    "VSCODE_PID",
    "CURSOR_TRACE_ID",
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
  ])("refuses %s in passEnv and in extra", (name) => {
    expect(codeOf(() => workerEnv(HOST, { passEnv: [name], extra: {}, nodeDir: "/n" }))).toBe("config");
    expect(codeOf(() => workerEnv(HOST, { passEnv: [], extra: { [name]: "x" }, nodeDir: "/n" }))).toBe("config");
  });

  it.each(["HOME", "PATH", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"])("refuses %s in extra only", (name) => {
    expect(codeOf(() => workerEnv(HOST, { passEnv: [], extra: { [name]: "x" }, nodeDir: "/n" }))).toBe("config");
    expect(codeOf(() => workerEnv(HOST, { passEnv: [name], extra: {}, nodeDir: "/n" }))).toBe("no error");
  });

  it("passes ANTHROPIC_API_KEY through for API-key users", () => {
    const env = workerEnv({ ...HOST, ANTHROPIC_API_KEY: "k" }, { passEnv: ["ANTHROPIC_API_KEY"], extra: {}, nodeDir: "/n" });
    expect(env.ANTHROPIC_API_KEY).toBe("k");
  });

  it("refuses names that are not variable names", () => {
    expect(codeOf(() => workerEnv(HOST, { passEnv: ["A=B"], extra: {}, nodeDir: "/n" }))).toBe("config");
    expect(codeOf(() => workerEnv(HOST, { passEnv: [], extra: { "": "x" }, nodeDir: "/n" }))).toBe("config");
  });

  it("refuses empty, relative or colon-separated PATH directories", () => {
    expect(codeOf(() => workerEnv(HOST, { passEnv: [], extra: {}, nodeDir: "" }))).toBe("config");
    expect(codeOf(() => workerEnv(HOST, { passEnv: [], extra: {}, nodeDir: "node/bin" }))).toBe("config");
    expect(codeOf(() => workerEnv(HOST, { passEnv: [], extra: {}, nodeDir: "/n", pnpmDir: "/a:/b" }))).toBe("config");
  });
});
