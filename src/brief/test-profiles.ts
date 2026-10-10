// Profiles for the brief tests, compiled the way launches compile them, so brief expectations follow the fence.
import { compileProfile } from "../profile/compile";
import type { CompiledProfile, ProfileInput } from "../types";

const BASE: ProfileInput = {
  role: "implementer",
  fence: "strict",
  tools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
  loopback: true,
  commands: [],
  laneAllow: [],
  credentialPaths: [],
  env: {},
  worktree: "/work/repo/.arbab/worktrees/m1-x",
  gitCommonDir: "/work/repo/.git",
};

const compile = (over: Partial<ProfileInput>): CompiledProfile => compileProfile({ ...BASE, ...over });

export const STRICT: CompiledProfile = compile({ commands: ["pnpm test", "pnpm typecheck"] });

export const SANDBOX_AUTO: CompiledProfile = compile({ fence: "sandbox-auto", commands: ["pnpm test", "pnpm typecheck"] });

export const REVIEWER: CompiledProfile = compile({
  role: "reviewer",
  tools: ["Read", "Glob", "Grep", "Bash"],
  loopback: false,
  commands: ["pnpm test"],
});

export const RESEARCHER: CompiledProfile = compile({ role: "researcher", tools: ["WebSearch", "WebFetch"], loopback: false });
